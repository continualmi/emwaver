use crate::command;
use crate::usb_midi_sysex::{decode_sysex_to_superframe, encode_superframe_to_sysex};
use crate::{
    EmwFrame, EmwaverTransport, TransportDescriptor, TransportError, TransportId, TransportResult,
};
use async_trait::async_trait;
use emwaver_linux_core::TransportKind;
use futures::{SinkExt, StreamExt};
use mdns_sd::{ResolvedService, ServiceDaemon, ServiceEvent};
use std::collections::BTreeMap;
use std::net::Ipv6Addr;
use std::time::{Duration, Instant};
use tokio::net::TcpStream;
use tokio_tungstenite::{
    connect_async,
    tungstenite::protocol::{frame::coding::CloseCode, CloseFrame, Message},
    MaybeTlsStream, WebSocketStream,
};

pub const DEFAULT_WIFI_PORT: u16 = 3922;
pub const WIFI_SERVICE_TYPE: &str = "_emwaver._tcp";
pub const WIFI_SERVICE_TYPE_LOCAL: &str = "_emwaver._tcp.local.";
pub const WIFI_DISCOVERY_TIMEOUT: Duration = Duration::from_millis(1400);

type WifiSocket = WebSocketStream<MaybeTlsStream<TcpStream>>;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ManualWifiTarget {
    pub host: String,
    pub port: u16,
}

impl ManualWifiTarget {
    pub fn new(host: impl Into<String>, port: u16) -> TransportResult<Self> {
        let host = host.into().trim().to_string();
        if !is_valid_manual_host(&host) {
            return Err(TransportError::Wifi(
                "manual Wi-Fi host must be a bare hostname or IP".to_string(),
            ));
        }
        Ok(Self { host, port })
    }

    pub fn id(&self) -> String {
        format!("wifi:{}:{}", self.host.to_ascii_lowercase(), self.port)
    }

    pub fn display_name(&self) -> String {
        format!("Wi-Fi: {}:{}", self.host, self.port)
    }

    pub fn websocket_url(&self) -> String {
        let host = if self.host.contains(':') {
            format!("[{}]", self.host)
        } else {
            self.host.clone()
        };
        format!("ws://{host}:{}/v1/ws", self.port)
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WifiDiscoveryRecord {
    pub target: ManualWifiTarget,
    pub display_name: String,
    pub board_type: Option<String>,
    pub firmware_version: Option<String>,
    pub protocol_version: Option<String>,
    pub capabilities: Vec<String>,
    pub hardware_uid: Option<String>,
    pub advertised: bool,
}

impl WifiDiscoveryRecord {
    pub fn descriptor(&self) -> TransportDescriptor {
        TransportDescriptor {
            id: TransportId(self.target.id()),
            kind: TransportKind::Wifi,
            display_name: self.display_name.clone(),
            hardware_uid: self.hardware_uid.clone(),
            firmware_version: self.firmware_version.clone(),
        }
    }
}

#[derive(Default, Debug)]
pub struct LinuxWifiManager;

impl LinuxWifiManager {
    pub fn discover_mdns(&self) -> TransportResult<Vec<ManualWifiTarget>> {
        Ok(self
            .discover_mdns_records(WIFI_DISCOVERY_TIMEOUT)?
            .into_iter()
            .map(|record| record.target)
            .collect())
    }

    pub fn discover_mdns_records(
        &self,
        timeout: Duration,
    ) -> TransportResult<Vec<WifiDiscoveryRecord>> {
        let mdns = ServiceDaemon::new()
            .map_err(|err| TransportError::Wifi(format!("mDNS daemon failed: {err}")))?;
        let receiver = mdns
            .browse(WIFI_SERVICE_TYPE_LOCAL)
            .map_err(|err| TransportError::Wifi(format!("mDNS browse failed: {err}")))?;
        let deadline = Instant::now() + timeout;
        let mut records = BTreeMap::<String, WifiDiscoveryRecord>::new();

        while Instant::now() < deadline {
            let remaining = deadline.saturating_duration_since(Instant::now());
            match receiver.recv_timeout(remaining.min(Duration::from_millis(200))) {
                Ok(ServiceEvent::ServiceResolved(service)) => {
                    if let Some(record) = discovery_record_from_resolved(&service) {
                        records.insert(record.target.id(), record);
                    }
                }
                Ok(_) => {}
                Err(_) => {}
            }
        }
        let _ = mdns.stop_browse(WIFI_SERVICE_TYPE_LOCAL);
        let _ = mdns.shutdown();
        Ok(records.into_values().collect())
    }

    pub async fn discover_live_mdns_records(
        &self,
        timeout: Duration,
    ) -> TransportResult<Vec<WifiDiscoveryRecord>> {
        let mut live = Vec::new();
        for mut record in self.discover_mdns_records(timeout)? {
            let mut transport = LinuxWifiTransport::new(record.target.clone());
            if transport.connect().await.is_err() {
                continue;
            }
            match command::query_hardware_uid(&mut transport).await {
                Ok(uid) => {
                    record.hardware_uid = Some(uid);
                    live.push(record);
                }
                Err(_) => {}
            }
            let _ = transport.close().await;
        }
        Ok(live)
    }

    pub fn manual_target(
        &self,
        host: impl Into<String>,
        port: Option<u16>,
    ) -> TransportResult<ManualWifiTarget> {
        ManualWifiTarget::new(host, port.unwrap_or(DEFAULT_WIFI_PORT))
    }
}

fn discovery_record_from_resolved(service: &ResolvedService) -> Option<WifiDiscoveryRecord> {
    if !service.is_valid() || service.get_port() == 0 {
        return None;
    }

    let metadata_host = txt_value(service, "host").and_then(|host| normalized_mdns_host(&host));
    let host = metadata_host
        .or_else(|| normalized_mdns_host(service.get_hostname()))
        .or_else(|| {
            service
                .get_addresses_v4()
                .iter()
                .next()
                .map(ToString::to_string)
        })?;
    let target = ManualWifiTarget::new(host, service.get_port()).ok()?;
    let protocol_version = txt_value(service, "proto").unwrap_or_else(|| "1".to_string());
    let capabilities = capabilities_from_txt(txt_value(service, "cap").as_deref());
    if protocol_version != "1" || !advertises_wifi_capability(&capabilities) {
        return None;
    }

    let display_name = service_instance_name(service.get_fullname())
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| target.host.clone());

    Some(WifiDiscoveryRecord {
        target,
        display_name,
        board_type: txt_value(service, "board").map(|board| normalized_board_type(&board)),
        firmware_version: txt_value(service, "fw"),
        protocol_version: Some(protocol_version),
        capabilities,
        hardware_uid: None,
        advertised: true,
    })
}

fn txt_value(service: &ResolvedService, key: &str) -> Option<String> {
    service
        .get_property_val_str(key)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

fn normalized_mdns_host(value: &str) -> Option<String> {
    let mut host = value.trim().trim_end_matches('.').to_string();
    if host.is_empty() || host.chars().any(char::is_whitespace) {
        return None;
    }
    if !host.to_ascii_lowercase().ends_with(".local") && !host.parse::<Ipv6Addr>().is_ok() {
        host.push_str(".local");
    }
    is_valid_manual_host(&host).then_some(host)
}

fn service_instance_name(fullname: &str) -> Option<String> {
    let suffix = format!(".{WIFI_SERVICE_TYPE_LOCAL}");
    fullname
        .strip_suffix(&suffix)
        .or_else(|| fullname.strip_suffix(WIFI_SERVICE_TYPE_LOCAL))
        .map(|name| name.trim_end_matches('.').to_string())
}

fn normalized_board_type(value: &str) -> String {
    match value.trim().to_ascii_lowercase().as_str() {
        "esp32s3" | "esp32-s3" => "esp32s3".to_string(),
        "esp32s2" | "esp32-s2" => "esp32s2".to_string(),
        "esp32" => "esp32".to_string(),
        other => other.to_string(),
    }
}

fn capabilities_from_txt(value: Option<&str>) -> Vec<String> {
    let capabilities = value
        .unwrap_or("wifi")
        .split(',')
        .map(|capability| capability.trim().to_ascii_lowercase())
        .filter(|capability| !capability.is_empty())
        .collect::<Vec<_>>();
    if capabilities.is_empty() {
        vec!["wifi".to_string()]
    } else {
        capabilities
    }
}

fn advertises_wifi_capability(capabilities: &[String]) -> bool {
    capabilities
        .iter()
        .any(|capability| capability.eq_ignore_ascii_case("wifi"))
}

#[derive(Debug)]
pub struct LinuxWifiTransport {
    target: ManualWifiTarget,
    socket: Option<WifiSocket>,
}

impl LinuxWifiTransport {
    pub fn new(target: ManualWifiTarget) -> Self {
        Self {
            target,
            socket: None,
        }
    }
}

#[async_trait]
impl EmwaverTransport for LinuxWifiTransport {
    fn descriptor(&self) -> TransportDescriptor {
        TransportDescriptor {
            id: TransportId(self.target.id()),
            kind: TransportKind::Wifi,
            display_name: self.target.display_name(),
            hardware_uid: None,
            firmware_version: None,
        }
    }

    async fn connect(&mut self) -> TransportResult<()> {
        let url = self.target.websocket_url();
        let (socket, _response) = connect_async(&url)
            .await
            .map_err(|err| TransportError::Wifi(format!("failed to connect {url}: {err}")))?;
        self.socket = Some(socket);
        Ok(())
    }

    async fn send_frame(&mut self, frame: EmwFrame) -> TransportResult<()> {
        let socket = self.socket.as_mut().ok_or(TransportError::NotConnected)?;
        let sysex = encode_superframe_to_sysex(&frame.bytes)
            .map_err(|err| TransportError::Wifi(err.to_string()))?;
        socket
            .send(Message::Binary(sysex.to_vec()))
            .await
            .map_err(|err| TransportError::Wifi(format!("WebSocket send failed: {err}")))
    }

    async fn next_frame(&mut self) -> TransportResult<EmwFrame> {
        let socket = self.socket.as_mut().ok_or(TransportError::NotConnected)?;
        while let Some(message) = socket.next().await {
            match message {
                Ok(Message::Binary(bytes)) => {
                    let superframe = decode_sysex_to_superframe(&bytes)
                        .map_err(|err| TransportError::Wifi(err.to_string()))?;
                    return Ok(EmwFrame {
                        bytes: superframe.to_vec(),
                    });
                }
                Ok(Message::Text(text)) if text.to_ascii_lowercase().contains("busy") => {
                    return Err(TransportError::Wifi(
                        "Wi-Fi device is busy with another session".to_string(),
                    ));
                }
                Ok(Message::Close(_)) => {
                    self.socket = None;
                    return Err(TransportError::NotConnected);
                }
                Ok(_) => {}
                Err(err) => {
                    self.socket = None;
                    return Err(TransportError::Wifi(format!(
                        "WebSocket receive failed: {err}"
                    )));
                }
            }
        }
        self.socket = None;
        Err(TransportError::NotConnected)
    }

    async fn close(&mut self) -> TransportResult<()> {
        if let Some(mut socket) = self.socket.take() {
            let _ = socket
                .close(Some(CloseFrame {
                    code: CloseCode::Normal,
                    reason: "EMWaver disconnect".into(),
                }))
                .await;
        }
        Ok(())
    }
}

pub fn is_valid_manual_host(host: &str) -> bool {
    if host.is_empty()
        || host.contains("://")
        || host.contains('/')
        || host.contains('?')
        || host.contains('#')
        || host.contains('@')
        || host.contains('[')
        || host.contains(']')
        || host.chars().any(char::is_whitespace)
    {
        return false;
    }

    if host.contains(':') {
        return host.parse::<Ipv6Addr>().is_ok();
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::usb_midi_sysex::SUPERFRAME_SIZE_BYTES;

    #[test]
    fn manual_wifi_rejects_urlish_hosts() {
        assert!(ManualWifiTarget::new("ws://emwaver.local", 3922).is_err());
        assert!(ManualWifiTarget::new("emwaver.local:3922", 3922).is_err());
        assert!(ManualWifiTarget::new("192.168.4.2/path", 3922).is_err());
        assert!(ManualWifiTarget::new("[fd00::1234]", 3922).is_err());
        assert!(ManualWifiTarget::new("emwaver local", 3922).is_err());
        assert!(ManualWifiTarget::new("emwaver.local", 3922).is_ok());
    }

    #[test]
    fn manual_wifi_accepts_ipv4_dns_and_bare_ipv6_hosts() {
        assert_eq!(
            ManualWifiTarget::new("192.168.4.2", 3922)
                .unwrap()
                .websocket_url(),
            "ws://192.168.4.2:3922/v1/ws"
        );
        assert_eq!(
            ManualWifiTarget::new("emwaver-a1b2.local", 3922)
                .unwrap()
                .websocket_url(),
            "ws://emwaver-a1b2.local:3922/v1/ws"
        );
        assert_eq!(
            ManualWifiTarget::new("fd00::1234", 3922)
                .unwrap()
                .websocket_url(),
            "ws://[fd00::1234]:3922/v1/ws"
        );
    }

    #[test]
    fn wifi_descriptor_matches_transport_registry_shape() {
        let transport =
            LinuxWifiTransport::new(ManualWifiTarget::new("EMWAVER-A1B2.local", 3922).unwrap());
        let descriptor = transport.descriptor();
        assert_eq!(descriptor.id.0, "wifi:emwaver-a1b2.local:3922");
        assert_eq!(descriptor.kind, TransportKind::Wifi);
        assert_eq!(descriptor.display_name, "Wi-Fi: EMWAVER-A1B2.local:3922");
    }

    #[test]
    fn wifi_uses_sysex_frames_over_websocket_payloads() {
        let mut frame = EmwFrame {
            bytes: vec![0; SUPERFRAME_SIZE_BYTES],
        };
        frame.bytes[0] = 0x08;

        let sysex = encode_superframe_to_sysex(&frame.bytes).unwrap();
        assert_eq!(sysex.len(), 48);
        assert_eq!(
            decode_sysex_to_superframe(&sysex).unwrap().to_vec(),
            frame.bytes
        );
    }

    #[test]
    fn normalizes_mdns_hosts_like_macos() {
        assert_eq!(
            normalized_mdns_host("emwaver-a1b2").as_deref(),
            Some("emwaver-a1b2.local")
        );
        assert_eq!(
            normalized_mdns_host("emwaver-a1b2.local.").as_deref(),
            Some("emwaver-a1b2.local")
        );
        assert!(normalized_mdns_host("bad host").is_none());
    }

    #[test]
    fn filters_txt_capabilities_like_macos() {
        assert!(advertises_wifi_capability(&capabilities_from_txt(Some(
            " ble, wifi "
        ))));
        assert!(!advertises_wifi_capability(&capabilities_from_txt(Some(
            "ble"
        ))));
        assert_eq!(capabilities_from_txt(None), vec!["wifi"]);
    }

    #[test]
    fn extracts_mdns_instance_name() {
        assert_eq!(
            service_instance_name("emwaver-a1b2._emwaver._tcp.local.").as_deref(),
            Some("emwaver-a1b2")
        );
    }
}
