use anyhow::{Context, Result};

pub const EMW_OP_VERSION: u8 = 0x01;
pub const EMW_OP_HARDWARE_UID_GET: u8 = 0x08;
pub const EMW_OP_WIFI_CONFIG: u8 = 0x0a;

const WIFI_CFG_BEGIN: u8 = 0x00;
const WIFI_CFG_FIELD: u8 = 0x01;
const WIFI_CFG_APPLY: u8 = 0x02;
const WIFI_CFG_CLEAR: u8 = 0x03;
const WIFI_CFG_STATUS: u8 = 0x04;
const WIFI_FIELD_SSID: u8 = 0x00;
const WIFI_FIELD_PASSWORD: u8 = 0x01;

const WIFI_SSID_LIMIT: usize = 32;
const WIFI_PASSWORD_LIMIT: usize = 64;
const WIFI_FIELD_CHUNK: usize = 13;

pub trait DeviceCommandSender {
    fn send_command(&self, cmd_lane: &[u8], timeout_ms: u64) -> Result<Option<Vec<u8>>>;
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WiFiStatus {
    pub provisioned: bool,
    pub socket_connected: bool,
    pub station_online: Option<bool>,
    pub retrying: Option<bool>,
    pub disconnect_reason: Option<u16>,
    pub station_ip: Option<String>,
    pub runtime_active: Option<bool>,
}

pub fn query_hardware_uid(
    sender: &dyn DeviceCommandSender,
    timeout_ms: u64,
) -> Result<Option<String>> {
    let Some(response) = sender.send_command(&[EMW_OP_HARDWARE_UID_GET], timeout_ms)? else {
        return Ok(None);
    };
    Ok(parse_hardware_uid_response(&response))
}

pub fn query_version(sender: &dyn DeviceCommandSender, timeout_ms: u64) -> Result<Option<String>> {
    let Some(response) = sender.send_command(&[EMW_OP_VERSION], timeout_ms)? else {
        return Ok(None);
    };
    Ok(parse_version_response(&response))
}

pub fn wifi_provision(
    sender: &dyn DeviceCommandSender,
    ssid: &str,
    password: Option<&str>,
    timeout_ms: u64,
) -> Result<()> {
    let ssid = ssid.trim();
    if ssid.is_empty() {
        anyhow::bail!("Wi-Fi SSID is required");
    }
    let ssid_bytes = ssid.as_bytes();
    let password_bytes = password.unwrap_or("").as_bytes();
    if ssid_bytes.len() > WIFI_SSID_LIMIT {
        anyhow::bail!("Wi-Fi SSID must be {WIFI_SSID_LIMIT} bytes or less");
    }
    if password_bytes.len() > WIFI_PASSWORD_LIMIT {
        anyhow::bail!("Wi-Fi password must be {WIFI_PASSWORD_LIMIT} bytes or less");
    }

    send_wifi_ack(sender, &[EMW_OP_WIFI_CONFIG, WIFI_CFG_BEGIN], timeout_ms)
        .context("Wi-Fi setup failed to start")?;
    send_wifi_field(sender, WIFI_FIELD_SSID, ssid_bytes, timeout_ms)
        .context("Wi-Fi setup failed while sending SSID")?;
    if !password_bytes.is_empty() {
        send_wifi_field(sender, WIFI_FIELD_PASSWORD, password_bytes, timeout_ms)
            .context("Wi-Fi setup failed while sending password")?;
    }
    send_wifi_ack(sender, &[EMW_OP_WIFI_CONFIG, WIFI_CFG_APPLY], timeout_ms)
        .context("Wi-Fi setup was rejected by the device")
}

pub fn wifi_clear(sender: &dyn DeviceCommandSender, timeout_ms: u64) -> Result<()> {
    send_wifi_ack(sender, &[EMW_OP_WIFI_CONFIG, WIFI_CFG_CLEAR], timeout_ms)
        .context("Wi-Fi setup clear was rejected by the device")
}

pub fn wifi_status(sender: &dyn DeviceCommandSender, timeout_ms: u64) -> Result<WiFiStatus> {
    let response = sender
        .send_command(&[EMW_OP_WIFI_CONFIG, WIFI_CFG_STATUS], timeout_ms)?
        .context("Wi-Fi status request timed out")?;
    parse_wifi_status_response(&response).context("Wi-Fi status request was rejected by the device")
}

pub fn parse_hardware_uid_response(response: &[u8]) -> Option<String> {
    if response.len() < 7 || response.first().copied() != Some(0x80) {
        return None;
    }
    let payload = &response[1..];
    let significant_len = payload
        .iter()
        .rposition(|byte| *byte != 0)
        .map(|idx| idx + 1)
        .unwrap_or(0);
    if significant_len != 6 {
        return None;
    }
    Some(
        payload[..significant_len]
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect(),
    )
}

pub fn parse_version_response(response: &[u8]) -> Option<String> {
    if response.len() < 4 || response.first().copied() != Some(0x80) {
        return None;
    }
    if response[4..].iter().any(|byte| *byte != 0) {
        return None;
    }
    Some(format!("{}.{}", response[1], response[2]))
}

pub fn parse_wifi_status_response(response: &[u8]) -> Option<WiFiStatus> {
    if response.len() < 3 || response.first().copied() != Some(0x80) {
        return None;
    }
    let station_online = response.get(3).map(|value| *value != 0);
    let retrying = response.get(4).map(|value| *value != 0);
    let disconnect_reason = if response.len() >= 7 {
        Some(u16::from(response[5]) | (u16::from(response[6]) << 8))
    } else {
        None
    };
    let station_ip = if response.len() >= 12 && response[7] != 0 {
        Some(format!(
            "{}.{}.{}.{}",
            response[8], response[9], response[10], response[11]
        ))
    } else {
        None
    };
    let runtime_active = response.get(12).map(|value| *value != 0);
    Some(WiFiStatus {
        provisioned: response[1] != 0,
        socket_connected: response[2] != 0,
        station_online,
        retrying,
        disconnect_reason,
        station_ip,
        runtime_active,
    })
}

fn send_wifi_ack(sender: &dyn DeviceCommandSender, command: &[u8], timeout_ms: u64) -> Result<()> {
    let response = sender
        .send_command(command, timeout_ms)?
        .context("command timed out")?;
    if response.first().copied() == Some(0x80) {
        Ok(())
    } else {
        anyhow::bail!("device returned negative Wi-Fi config response")
    }
}

fn send_wifi_field(
    sender: &dyn DeviceCommandSender,
    field: u8,
    bytes: &[u8],
    timeout_ms: u64,
) -> Result<()> {
    let mut offset = 0usize;
    while offset < bytes.len() {
        let count = (bytes.len() - offset).min(WIFI_FIELD_CHUNK);
        let mut command = Vec::with_capacity(5 + count);
        command.extend_from_slice(&[
            EMW_OP_WIFI_CONFIG,
            WIFI_CFG_FIELD,
            field,
            offset as u8,
            count as u8,
        ]);
        command.extend_from_slice(&bytes[offset..offset + count]);
        send_wifi_ack(sender, &command, timeout_ms)?;
        offset += count;
    }
    Ok(())
}

pub fn wifi_disconnect_reason_text(reason: u16) -> &'static str {
    match reason {
        0 => "none",
        2 => "auth expired",
        3 => "auth leave",
        4 => "association expired",
        5 => "association limit",
        7 => "not authenticated",
        8 => "not associated",
        15 => "4-way handshake timeout",
        201 => "no AP found",
        202 => "auth failed",
        203 => "association failed",
        204 => "handshake timeout",
        205 => "connection failed",
        _ => "unknown",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    struct FakeSender {
        responses: Mutex<Vec<Vec<u8>>>,
        commands: Mutex<Vec<Vec<u8>>>,
    }

    impl FakeSender {
        fn new(responses: Vec<Vec<u8>>) -> Self {
            Self {
                responses: Mutex::new(responses.into_iter().rev().collect()),
                commands: Mutex::new(Vec::new()),
            }
        }
    }

    impl DeviceCommandSender for FakeSender {
        fn send_command(&self, cmd_lane: &[u8], _timeout_ms: u64) -> Result<Option<Vec<u8>>> {
            self.commands.lock().unwrap().push(cmd_lane.to_vec());
            Ok(self.responses.lock().unwrap().pop())
        }
    }

    #[test]
    fn parses_six_byte_hardware_uid() {
        let response = [0x80, 1, 2, 3, 0xab, 0xcd, 0xef, 0, 0];
        assert_eq!(
            parse_hardware_uid_response(&response).as_deref(),
            Some("010203abcdef")
        );
    }

    #[test]
    fn rejects_non_six_byte_hardware_uid() {
        assert_eq!(parse_hardware_uid_response(&[0x80, 1, 2, 0, 0, 0, 0]), None);
    }

    #[test]
    fn parses_wifi_status_payload() {
        let status = parse_wifi_status_response(&[
            0x80, 1, 0, 1, 1, 201, 0, 1, 192, 168, 1, 44, 1, 0, 0, 0, 0, 0,
        ])
        .expect("status");
        assert!(status.provisioned);
        assert!(!status.socket_connected);
        assert_eq!(status.station_online, Some(true));
        assert_eq!(status.retrying, Some(true));
        assert_eq!(status.disconnect_reason, Some(201));
        assert_eq!(status.station_ip.as_deref(), Some("192.168.1.44"));
        assert_eq!(status.runtime_active, Some(true));
    }

    #[test]
    fn wifi_provision_chunks_fields_like_macos() {
        let sender = FakeSender::new(vec![vec![0x80]; 6]);
        wifi_provision(
            &sender,
            "abcdefghijklmnopqrstuvwxyz123456",
            Some("password"),
            10,
        )
        .expect("provision");
        let commands = sender.commands.lock().unwrap();
        assert_eq!(commands[0], vec![EMW_OP_WIFI_CONFIG, WIFI_CFG_BEGIN]);
        assert_eq!(
            commands[1][0..5],
            [EMW_OP_WIFI_CONFIG, WIFI_CFG_FIELD, WIFI_FIELD_SSID, 0, 13]
        );
        assert_eq!(
            commands[2][0..5],
            [EMW_OP_WIFI_CONFIG, WIFI_CFG_FIELD, WIFI_FIELD_SSID, 13, 13]
        );
        assert_eq!(
            commands[3][0..5],
            [EMW_OP_WIFI_CONFIG, WIFI_CFG_FIELD, WIFI_FIELD_SSID, 26, 6]
        );
        assert_eq!(
            commands.last().unwrap(),
            &[EMW_OP_WIFI_CONFIG, WIFI_CFG_APPLY]
        );
    }
}
