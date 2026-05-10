use anyhow::{Context, Result};
use std::collections::HashMap;
use std::net::{Ipv4Addr, Ipv6Addr, SocketAddrV4, TcpStream, UdpSocket};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tracing::warn;
use tungstenite::stream::MaybeTlsStream;
use tungstenite::{connect, Message, WebSocket};
use url::Url;

use crate::commands::DeviceCommandSender;
use crate::protocol::{
    decode_sysex_to_superframe, encode_superframe, make_superframe, LANE_SIZE, SUPERFRAME_SIZE,
};

const DEFAULT_WIFI_PORT: u16 = 3922;
const WIFI_WS_PATH: &str = "/v1/ws";
const MDNS_ADDR: SocketAddrV4 = SocketAddrV4::new(Ipv4Addr::new(224, 0, 0, 251), 5353);
const MDNS_SERVICE_NAME: &str = "_emwaver._tcp.local";

type WiFiSocket = WebSocket<MaybeTlsStream<TcpStream>>;

#[derive(Debug, Clone)]
pub struct WiFiDeviceInfo {
    pub id: String,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub addresses: Vec<String>,
    pub txt: HashMap<String, String>,
}

struct WiFiState {
    capture_buffer: Vec<u8>,
    waiting_for_response: bool,
    response_data: Option<Vec<u8>>,
}

impl Default for WiFiState {
    fn default() -> Self {
        Self {
            capture_buffer: Vec::new(),
            waiting_for_response: false,
            response_data: None,
        }
    }
}

pub struct WiFiDevice {
    socket: Mutex<WiFiSocket>,
    state: Mutex<WiFiState>,
}

pub fn list_wifi_devices(timeout_ms: u64) -> Result<Vec<WiFiDeviceInfo>> {
    let socket = UdpSocket::bind(SocketAddrV4::new(Ipv4Addr::UNSPECIFIED, 0))
        .context("failed to bind mDNS discovery socket")?;
    socket
        .set_read_timeout(Some(Duration::from_millis(timeout_ms.max(250))))
        .context("failed to set mDNS read timeout")?;
    let query = build_mdns_ptr_query(MDNS_SERVICE_NAME)?;
    socket
        .send_to(&query, MDNS_ADDR)
        .context("failed to send mDNS discovery query")?;

    let deadline = Instant::now() + Duration::from_millis(timeout_ms.max(250));
    let mut records = MdnsRecords::default();
    let mut buf = [0u8; 2048];
    while Instant::now() < deadline {
        match socket.recv_from(&mut buf) {
            Ok((len, _addr)) => {
                if let Err(err) = parse_mdns_packet(&buf[..len], &mut records) {
                    warn!("mDNS packet parse failed: {err:#}");
                }
            }
            Err(err)
                if err.kind() == std::io::ErrorKind::WouldBlock
                    || err.kind() == std::io::ErrorKind::TimedOut =>
            {
                break;
            }
            Err(err) => return Err(err).context("failed to receive mDNS discovery response"),
        }
    }

    Ok(records.into_devices())
}

impl WiFiDevice {
    pub fn connect_host(host: &str) -> Result<Arc<Self>> {
        Self::connect(host, DEFAULT_WIFI_PORT)
    }

    pub fn connect(host: &str, port: u16) -> Result<Arc<Self>> {
        let url = wifi_websocket_url(host, port)?;
        let (socket, _) = connect(url.as_str()).context("failed to connect Wi-Fi WebSocket")?;

        Ok(Arc::new(Self {
            socket: Mutex::new(socket),
            state: Mutex::new(WiFiState::default()),
        }))
    }

    pub fn get_buffer(&self) -> Vec<u8> {
        self.state.lock().unwrap().capture_buffer.clone()
    }

    pub fn clear_buffer(&self) {
        self.state.lock().unwrap().capture_buffer.clear();
    }

    pub fn load_buffer(&self, data: Vec<u8>) {
        self.state.lock().unwrap().capture_buffer = data;
    }

    pub fn transmit_buffer(&self) -> Result<()> {
        let data = self.get_buffer();
        if data.is_empty() {
            return Ok(());
        }

        let mut idx = 0usize;
        while idx < data.len() {
            let end = (idx + LANE_SIZE).min(data.len());
            let chunk = &data[idx..end];
            let sf = make_superframe(None, Some(chunk));
            self.send_superframe(&sf)?;
            idx = end;
            std::thread::sleep(Duration::from_millis(1));
        }

        Ok(())
    }

    pub fn send_command(&self, cmd_lane: &[u8], timeout_ms: u64) -> Result<Option<Vec<u8>>> {
        {
            let mut st = self.state.lock().unwrap();
            st.waiting_for_response = true;
            st.response_data = None;
        }

        let sf = make_superframe(Some(cmd_lane), None);
        self.send_superframe(&sf)?;

        let deadline = Instant::now() + Duration::from_millis(timeout_ms.max(1));
        loop {
            {
                let mut st = self.state.lock().unwrap();
                if st.response_data.is_some() {
                    st.waiting_for_response = false;
                    return Ok(st.response_data.take());
                }
            }

            let now = Instant::now();
            if now >= deadline {
                self.state.lock().unwrap().waiting_for_response = false;
                return Ok(None);
            }
            let remaining = deadline.saturating_duration_since(now);

            let message = {
                let mut socket = self.socket.lock().unwrap();
                set_read_timeout(socket.get_mut(), Some(remaining));
                socket.read()
            };

            match message {
                Ok(Message::Binary(data)) => {
                    if let Err(err) = self.handle_binary_frame(&data) {
                        warn!("Wi-Fi frame decode error: {err:#}");
                    }
                }
                Ok(Message::Text(text)) if text.trim().eq_ignore_ascii_case("busy") => {
                    self.state.lock().unwrap().waiting_for_response = false;
                    anyhow::bail!("Wi-Fi device is busy with another session");
                }
                Ok(Message::Close(_)) => {
                    self.state.lock().unwrap().waiting_for_response = false;
                    return Ok(None);
                }
                Ok(_) => {}
                Err(err) => {
                    let mut st = self.state.lock().unwrap();
                    st.waiting_for_response = false;
                    if st.response_data.is_some() {
                        return Ok(st.response_data.take());
                    }
                    warn!("Wi-Fi receive failed: {err:#}");
                    return Ok(None);
                }
            }
        }
    }

    fn send_superframe(&self, superframe: &[u8; SUPERFRAME_SIZE]) -> Result<()> {
        let sysex = encode_superframe(superframe);
        self.socket
            .lock()
            .unwrap()
            .send(Message::Binary(sysex))
            .context("Wi-Fi WebSocket send failed")
    }

    fn handle_binary_frame(&self, data: &[u8]) -> Result<()> {
        let sf = decode_sysex_to_superframe(data)?;
        let mut st = self.state.lock().unwrap();
        apply_received_superframe(&mut st, &sf);
        Ok(())
    }
}

impl DeviceCommandSender for WiFiDevice {
    fn send_command(&self, cmd_lane: &[u8], timeout_ms: u64) -> Result<Option<Vec<u8>>> {
        WiFiDevice::send_command(self, cmd_lane, timeout_ms)
    }
}

fn apply_received_superframe(st: &mut WiFiState, sf: &[u8; SUPERFRAME_SIZE]) {
    let cmd_lane = &sf[0..LANE_SIZE];
    let stream_lane = &sf[LANE_SIZE..LANE_SIZE * 2];

    let cmd_empty = cmd_lane.iter().all(|&b| b == 0);
    let stream_empty = stream_lane.iter().all(|&b| b == 0);

    if !cmd_empty {
        if st.waiting_for_response && st.response_data.is_none() {
            st.response_data = Some(cmd_lane.to_vec());
        } else {
            st.capture_buffer.extend_from_slice(cmd_lane);
        }
    }
    if !stream_empty && !is_buffer_status_lane(stream_lane) {
        st.capture_buffer.extend_from_slice(stream_lane);
    }
}

fn is_buffer_status_lane(stream_lane: &[u8]) -> bool {
    stream_lane.len() == LANE_SIZE
        && stream_lane.starts_with(b"BS")
        && stream_lane[4..].iter().all(|&byte| byte == 0)
}

fn set_read_timeout(stream: &mut MaybeTlsStream<TcpStream>, timeout: Option<Duration>) {
    if let MaybeTlsStream::Plain(stream) = stream {
        let _ = stream.set_read_timeout(timeout);
    }
}

fn wifi_websocket_url(host: &str, port: u16) -> Result<String> {
    let host = host.trim();
    if host.is_empty() {
        anyhow::bail!("Wi-Fi host is required");
    }
    if host.chars().any(char::is_whitespace)
        || host.contains("://")
        || host.contains('/')
        || host.contains('?')
        || host.contains('#')
        || host.contains('@')
        || host.starts_with('[')
        || host.ends_with(']')
    {
        anyhow::bail!(
            "Wi-Fi host must be a hostname or IP address without a scheme, path, or port"
        );
    }

    let url_host = if host.contains(':') {
        host.parse::<Ipv6Addr>()
            .with_context(|| format!("invalid IPv6 Wi-Fi host: {host}"))?;
        format!("[{host}]")
    } else {
        host.to_string()
    };
    let url = format!("ws://{url_host}:{port}{WIFI_WS_PATH}");
    Url::parse(&url).with_context(|| format!("invalid Wi-Fi device URL for {host}:{port}"))?;
    Ok(url)
}

#[derive(Default)]
struct MdnsRecords {
    ptrs: Vec<String>,
    srv: HashMap<String, (String, u16)>,
    addresses: HashMap<String, Vec<String>>,
    txt: HashMap<String, HashMap<String, String>>,
}

impl MdnsRecords {
    fn into_devices(self) -> Vec<WiFiDeviceInfo> {
        let mut out = Vec::new();
        for instance in self.ptrs {
            let Some((target, port)) = self.srv.get(&instance).cloned() else {
                continue;
            };
            let addresses = self.addresses.get(&target).cloned().unwrap_or_default();
            let host = addresses
                .first()
                .cloned()
                .unwrap_or_else(|| trim_local_suffix(&target).to_string());
            let txt = self.txt.get(&instance).cloned().unwrap_or_default();
            out.push(WiFiDeviceInfo {
                id: txt.get("id").cloned().unwrap_or_else(|| instance.clone()),
                name: service_instance_label(&instance).to_string(),
                host,
                port,
                addresses,
                txt,
            });
        }
        out.sort_by(|a, b| a.name.cmp(&b.name).then(a.host.cmp(&b.host)));
        out.dedup_by(|a, b| a.name == b.name && a.host == b.host && a.port == b.port);
        out
    }
}

fn trim_local_suffix(name: &str) -> &str {
    name.strip_suffix(".local").unwrap_or(name)
}

fn service_instance_label(name: &str) -> &str {
    name.strip_suffix("._emwaver._tcp.local")
        .or_else(|| name.strip_suffix("._emwaver._tcp"))
        .unwrap_or_else(|| trim_local_suffix(name))
}

fn build_mdns_ptr_query(name: &str) -> Result<Vec<u8>> {
    let mut out = Vec::new();
    out.extend_from_slice(&0u16.to_be_bytes()); // transaction id
    out.extend_from_slice(&0u16.to_be_bytes()); // flags
    out.extend_from_slice(&1u16.to_be_bytes()); // questions
    out.extend_from_slice(&0u16.to_be_bytes()); // answers
    out.extend_from_slice(&0u16.to_be_bytes()); // authority
    out.extend_from_slice(&0u16.to_be_bytes()); // additional
    write_dns_name(&mut out, name)?;
    out.extend_from_slice(&12u16.to_be_bytes()); // PTR
    out.extend_from_slice(&0x8001u16.to_be_bytes()); // IN with unicast-response bit
    Ok(out)
}

fn write_dns_name(out: &mut Vec<u8>, name: &str) -> Result<()> {
    for label in name.trim_end_matches('.').split('.') {
        if label.is_empty() || label.len() > 63 {
            anyhow::bail!("invalid DNS label in {name}");
        }
        out.push(label.len() as u8);
        out.extend_from_slice(label.as_bytes());
    }
    out.push(0);
    Ok(())
}

fn parse_mdns_packet(packet: &[u8], records: &mut MdnsRecords) -> Result<()> {
    if packet.len() < 12 {
        anyhow::bail!("short mDNS packet");
    }
    let qd = read_u16(packet, 4)? as usize;
    let an = read_u16(packet, 6)? as usize;
    let ns = read_u16(packet, 8)? as usize;
    let ar = read_u16(packet, 10)? as usize;
    let mut offset = 12usize;
    for _ in 0..qd {
        let (_name, next) = read_dns_name(packet, offset)?;
        offset = next + 4;
        if offset > packet.len() {
            anyhow::bail!("mDNS question overruns packet");
        }
    }

    for _ in 0..(an + ns + ar) {
        let (name, next) = read_dns_name(packet, offset)?;
        offset = next;
        if offset + 10 > packet.len() {
            anyhow::bail!("mDNS record header overruns packet");
        }
        let record_type = read_u16(packet, offset)?;
        offset += 2;
        let _class = read_u16(packet, offset)?;
        offset += 2;
        let _ttl = read_u32(packet, offset)?;
        offset += 4;
        let rd_len = read_u16(packet, offset)? as usize;
        offset += 2;
        let rd_start = offset;
        let rd_end = offset + rd_len;
        if rd_end > packet.len() {
            anyhow::bail!("mDNS record data overruns packet");
        }

        match record_type {
            1 if rd_len == 4 => {
                let addr = Ipv4Addr::new(
                    packet[rd_start],
                    packet[rd_start + 1],
                    packet[rd_start + 2],
                    packet[rd_start + 3],
                );
                records
                    .addresses
                    .entry(name)
                    .or_default()
                    .push(addr.to_string());
            }
            12 => {
                let (ptr, _) = read_dns_name(packet, rd_start)?;
                if name == MDNS_SERVICE_NAME && !records.ptrs.contains(&ptr) {
                    records.ptrs.push(ptr);
                }
            }
            16 => {
                let txt = parse_txt_record(&packet[rd_start..rd_end]);
                records.txt.entry(name).or_default().extend(txt);
            }
            28 if rd_len == 16 => {
                let segments: Vec<String> = packet[rd_start..rd_end]
                    .chunks_exact(2)
                    .map(|chunk| format!("{:x}", u16::from_be_bytes([chunk[0], chunk[1]])))
                    .collect();
                records
                    .addresses
                    .entry(name)
                    .or_default()
                    .push(segments.join(":"));
            }
            33 if rd_len >= 6 => {
                let port = read_u16(packet, rd_start + 4)?;
                let (target, _) = read_dns_name(packet, rd_start + 6)?;
                records.srv.insert(name, (target, port));
            }
            _ => {}
        }
        offset = rd_end;
    }
    Ok(())
}

fn parse_txt_record(data: &[u8]) -> HashMap<String, String> {
    let mut out = HashMap::new();
    let mut offset = 0usize;
    while offset < data.len() {
        let len = data[offset] as usize;
        offset += 1;
        if offset + len > data.len() {
            break;
        }
        let item = String::from_utf8_lossy(&data[offset..offset + len]);
        if let Some((key, value)) = item.split_once('=') {
            out.insert(key.to_string(), value.to_string());
        } else if !item.is_empty() {
            out.insert(item.to_string(), String::new());
        }
        offset += len;
    }
    out
}

fn read_u16(data: &[u8], offset: usize) -> Result<u16> {
    let bytes = data
        .get(offset..offset + 2)
        .context("short u16 in mDNS packet")?;
    Ok(u16::from_be_bytes([bytes[0], bytes[1]]))
}

fn read_u32(data: &[u8], offset: usize) -> Result<u32> {
    let bytes = data
        .get(offset..offset + 4)
        .context("short u32 in mDNS packet")?;
    Ok(u32::from_be_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]))
}

fn read_dns_name(packet: &[u8], mut offset: usize) -> Result<(String, usize)> {
    let mut labels = Vec::new();
    let mut consumed = None;
    let mut jumps = 0usize;
    loop {
        let Some(&len) = packet.get(offset) else {
            anyhow::bail!("DNS name overruns packet");
        };
        if len == 0 {
            let next = consumed.unwrap_or(offset + 1);
            return Ok((labels.join("."), next));
        }
        if len & 0xc0 == 0xc0 {
            let Some(&next_byte) = packet.get(offset + 1) else {
                anyhow::bail!("DNS compression pointer overruns packet");
            };
            let pointer = (((len & 0x3f) as usize) << 8) | next_byte as usize;
            if jumps > 16 {
                anyhow::bail!("DNS compression pointer loop");
            }
            jumps += 1;
            consumed.get_or_insert(offset + 2);
            offset = pointer;
            continue;
        }
        if len & 0xc0 != 0 {
            anyhow::bail!("unsupported DNS label encoding");
        }
        let start = offset + 1;
        let end = start + len as usize;
        let label = packet
            .get(start..end)
            .context("DNS label overruns packet")?;
        labels.push(String::from_utf8_lossy(label).to_string());
        offset = end;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wifi_superframe_routes_command_response_to_pending_request() {
        let mut state = WiFiState::default();
        state.waiting_for_response = true;
        let response = b"OK";
        let sf = make_superframe(Some(response), Some(b"sample"));

        apply_received_superframe(&mut state, &sf);

        assert_eq!(state.response_data.as_deref(), Some(&sf[0..LANE_SIZE]));
        assert_eq!(&state.capture_buffer[..6], b"sample");
    }

    #[test]
    fn wifi_superframe_keeps_uncorrelated_stream_data_in_capture_buffer() {
        let mut state = WiFiState::default();
        let sf = make_superframe(None, Some(b"sample"));

        apply_received_superframe(&mut state, &sf);

        assert_eq!(&state.capture_buffer[..6], b"sample");
    }

    #[test]
    fn wifi_superframe_ignores_exact_buffer_status_frame() {
        let mut state = WiFiState::default();
        let sf = make_superframe(None, Some(&[b'B', b'S', 0x12, 0x34]));

        apply_received_superframe(&mut state, &sf);

        assert!(state.capture_buffer.is_empty());
    }

    #[test]
    fn wifi_superframe_keeps_stream_data_that_starts_with_bs() {
        let mut state = WiFiState::default();
        let sf = make_superframe(None, Some(b"BSdata"));

        apply_received_superframe(&mut state, &sf);

        assert_eq!(&state.capture_buffer[..6], b"BSdata");
    }

    #[test]
    fn wifi_websocket_url_accepts_hostname_ipv4_and_bare_ipv6() {
        assert_eq!(
            wifi_websocket_url("emwaver-1234.local", 3922).expect("hostname url"),
            "ws://emwaver-1234.local:3922/v1/ws"
        );
        assert_eq!(
            wifi_websocket_url("192.168.1.44", 3922).expect("ipv4 url"),
            "ws://192.168.1.44:3922/v1/ws"
        );
        assert_eq!(
            wifi_websocket_url("fd00::1234", 3922).expect("ipv6 url"),
            "ws://[fd00::1234]:3922/v1/ws"
        );
    }

    #[test]
    fn wifi_websocket_url_rejects_url_or_socket_address_input() {
        for host in [
            "",
            "ws://192.168.1.44",
            "192.168.1.44:3922",
            "emwaver.local/v1/ws",
            "emwaver.local?x=1",
            "emwaver.local#frag",
            "[fd00::1234]",
            "fd00::1234%en0",
            "emwaver local",
        ] {
            assert!(
                wifi_websocket_url(host, 3922).is_err(),
                "expected {host:?} to be rejected"
            );
        }
    }

    #[test]
    fn mdns_query_targets_emwaver_service() {
        let query = build_mdns_ptr_query(MDNS_SERVICE_NAME).expect("build query");
        assert_eq!(
            &query[12..],
            b"\x08_emwaver\x04_tcp\x05local\0\0\x0c\x80\x01"
        );
    }

    #[test]
    fn mdns_records_build_device_info_from_txt_and_srv() {
        let mut records = MdnsRecords::default();
        records
            .ptrs
            .push("EMWaver ESP32-S3._emwaver._tcp.local".to_string());
        records.srv.insert(
            "EMWaver ESP32-S3._emwaver._tcp.local".to_string(),
            ("emwaver-1234.local".to_string(), 3922),
        );
        records.addresses.insert(
            "emwaver-1234.local".to_string(),
            vec!["192.168.1.44".to_string()],
        );
        records.txt.insert(
            "EMWaver ESP32-S3._emwaver._tcp.local".to_string(),
            HashMap::from([
                ("id".to_string(), "local-id".to_string()),
                ("board".to_string(), "esp32s3".to_string()),
            ]),
        );

        let devices = records.into_devices();
        assert_eq!(devices.len(), 1);
        assert_eq!(devices[0].id, "local-id");
        assert_eq!(devices[0].name, "EMWaver ESP32-S3");
        assert_eq!(devices[0].host, "192.168.1.44");
        assert_eq!(devices[0].port, 3922);
        assert_eq!(
            devices[0].txt.get("board").map(String::as_str),
            Some("esp32s3")
        );
    }
}
