use anyhow::{Context, Result};

pub const EMW_OP_VERSION: u8 = 0x01;
pub const EMW_OP_HARDWARE_UID_GET: u8 = 0x08;
pub const EMW_OP_BOARD_GET: u8 = 0x09;
pub const EMW_OP_WIFI_CONFIG: u8 = 0x0a;
pub const EMW_OP_TRANSPORT_SESSION: u8 = 0x0b;

pub const EMW_RESP_STATUS_OK: u8 = 0x80;
pub const EMW_RESP_STATUS_ERR: u8 = 0x81;
pub const EMW_RESP_STATUS_BUSY: u8 = 0x82;

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

const TRANSPORT_SESSION_STATUS: u8 = 0x00;
const TRANSPORT_SESSION_CONNECT: u8 = 0x01;
const TRANSPORT_SESSION_DISCONNECT: u8 = 0x02;
const TRANSPORT_SESSION_HEARTBEAT: u8 = 0x03;

pub trait DeviceCommandSender: Send + Sync + 'static {
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

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TransportSessionStatus {
    pub active_source: u8,
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

pub fn query_board(sender: &dyn DeviceCommandSender, timeout_ms: u64) -> Result<Option<String>> {
    let Some(response) = sender.send_command(&[EMW_OP_BOARD_GET], timeout_ms)? else {
        return Ok(None);
    };
    Ok(parse_text_response(&response))
}

pub fn transport_session_status(
    sender: &dyn DeviceCommandSender,
    timeout_ms: u64,
) -> Result<Option<TransportSessionStatus>> {
    let Some(response) = sender.send_command(
        &[EMW_OP_TRANSPORT_SESSION, TRANSPORT_SESSION_STATUS],
        timeout_ms,
    )?
    else {
        return Ok(None);
    };
    Ok(parse_transport_session_status_response(&response))
}

pub fn transport_session_connect(
    sender: &dyn DeviceCommandSender,
    source: u8,
    timeout_ms: u64,
) -> Result<()> {
    send_ack(
        sender,
        &[EMW_OP_TRANSPORT_SESSION, TRANSPORT_SESSION_CONNECT, source],
        timeout_ms,
        "transport connect was rejected by the device",
    )
}

pub fn transport_session_disconnect(
    sender: &dyn DeviceCommandSender,
    source: u8,
    timeout_ms: u64,
) -> Result<()> {
    send_ack(
        sender,
        &[
            EMW_OP_TRANSPORT_SESSION,
            TRANSPORT_SESSION_DISCONNECT,
            source,
        ],
        timeout_ms,
        "transport disconnect was rejected by the device",
    )
}

pub fn transport_session_heartbeat(
    sender: &dyn DeviceCommandSender,
    source: u8,
    timeout_ms: u64,
) -> Result<()> {
    send_ack(
        sender,
        &[
            EMW_OP_TRANSPORT_SESSION,
            TRANSPORT_SESSION_HEARTBEAT,
            source,
        ],
        timeout_ms,
        "transport heartbeat was rejected by the device",
    )
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

    send_ack(
        sender,
        &[EMW_OP_WIFI_CONFIG, WIFI_CFG_BEGIN],
        timeout_ms,
        "Wi-Fi setup failed to start",
    )
    .context("Wi-Fi setup failed to start")?;
    send_wifi_field(sender, WIFI_FIELD_SSID, ssid_bytes, timeout_ms)
        .context("Wi-Fi setup failed while sending SSID")?;
    if !password_bytes.is_empty() {
        send_wifi_field(sender, WIFI_FIELD_PASSWORD, password_bytes, timeout_ms)
            .context("Wi-Fi setup failed while sending password")?;
    }
    send_ack(
        sender,
        &[EMW_OP_WIFI_CONFIG, WIFI_CFG_APPLY],
        timeout_ms,
        "Wi-Fi setup was rejected by the device",
    )
    .context("Wi-Fi setup was rejected by the device")
}

pub fn wifi_clear(sender: &dyn DeviceCommandSender, timeout_ms: u64) -> Result<()> {
    send_ack(
        sender,
        &[EMW_OP_WIFI_CONFIG, WIFI_CFG_CLEAR],
        timeout_ms,
        "Wi-Fi setup clear was rejected by the device",
    )
    .context("Wi-Fi setup clear was rejected by the device")
}

pub fn wifi_status(sender: &dyn DeviceCommandSender, timeout_ms: u64) -> Result<WiFiStatus> {
    let response = sender
        .send_command(&[EMW_OP_WIFI_CONFIG, WIFI_CFG_STATUS], timeout_ms)?
        .context("Wi-Fi status request timed out")?;
    parse_wifi_status_response(&response).context("Wi-Fi status request was rejected by the device")
}

pub fn parse_hardware_uid_response(response: &[u8]) -> Option<String> {
    if response.len() < 7 || response.first().copied() != Some(EMW_RESP_STATUS_OK) {
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
    if response.len() < 4 || response.first().copied() != Some(EMW_RESP_STATUS_OK) {
        return None;
    }
    if response[4..].iter().any(|byte| *byte != 0) {
        return None;
    }
    Some(format!("{}.{}", response[1], response[2]))
}

pub fn parse_text_response(response: &[u8]) -> Option<String> {
    if response.first().copied() != Some(EMW_RESP_STATUS_OK) {
        return None;
    }
    let bytes = response[1..]
        .iter()
        .copied()
        .take_while(|byte| *byte != 0)
        .collect::<Vec<_>>();
    if bytes.is_empty() {
        return None;
    }
    String::from_utf8(bytes).ok()
}

pub fn parse_wifi_status_response(response: &[u8]) -> Option<WiFiStatus> {
    if response.len() < 3 || response.first().copied() != Some(EMW_RESP_STATUS_OK) {
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

pub fn parse_transport_session_status_response(response: &[u8]) -> Option<TransportSessionStatus> {
    if response.len() < 2 || response.first().copied() != Some(EMW_RESP_STATUS_OK) {
        return None;
    }
    Some(TransportSessionStatus {
        active_source: response[1],
    })
}

fn send_ack(
    sender: &dyn DeviceCommandSender,
    command: &[u8],
    timeout_ms: u64,
    rejected_message: &str,
) -> Result<()> {
    let response = sender
        .send_command(command, timeout_ms)?
        .context("command timed out")?;
    match response.first().copied() {
        Some(EMW_RESP_STATUS_OK) => Ok(()),
        Some(EMW_RESP_STATUS_BUSY) => anyhow::bail!("device is busy with another transport"),
        _ => anyhow::bail!("{rejected_message}"),
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
        send_ack(
            sender,
            &command,
            timeout_ms,
            "Wi-Fi setup field was rejected by the device",
        )?;
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
        let response = [EMW_RESP_STATUS_OK, 1, 2, 3, 0xab, 0xcd, 0xef, 0, 0];
        assert_eq!(
            parse_hardware_uid_response(&response).as_deref(),
            Some("010203abcdef")
        );
    }

    #[test]
    fn rejects_non_six_byte_hardware_uid() {
        assert_eq!(
            parse_hardware_uid_response(&[EMW_RESP_STATUS_OK, 1, 2, 0, 0, 0, 0]),
            None
        );
    }

    #[test]
    fn parses_board_text_response() {
        let response = [
            EMW_RESP_STATUS_OK,
            b'e',
            b's',
            b'p',
            b'3',
            b'2',
            b's',
            b'3',
            0,
            0,
        ];
        assert_eq!(parse_text_response(&response).as_deref(), Some("esp32s3"));
    }

    #[test]
    fn parses_transport_session_status() {
        let response = [EMW_RESP_STATUS_OK, 2, 0, 0];
        assert_eq!(
            parse_transport_session_status_response(&response),
            Some(TransportSessionStatus { active_source: 2 })
        );
    }

    #[test]
    fn transport_connect_reports_busy() {
        let sender = FakeSender::new(vec![vec![EMW_RESP_STATUS_BUSY]]);
        let err = transport_session_connect(&sender, 1, 10).expect_err("busy");
        assert!(err.to_string().contains("busy"));
    }

    #[test]
    fn parses_wifi_status_payload() {
        let status = parse_wifi_status_response(&[
            EMW_RESP_STATUS_OK,
            1,
            0,
            1,
            1,
            201,
            0,
            1,
            192,
            168,
            1,
            44,
            1,
            0,
            0,
            0,
            0,
            0,
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
        let sender = FakeSender::new(vec![vec![EMW_RESP_STATUS_OK]; 6]);
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
