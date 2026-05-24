use crate::usb_midi_sysex::{decode_sysex_to_superframe, encode_superframe_to_sysex};
use crate::{
    EmwFrame, EmwaverTransport, TransportDescriptor, TransportError, TransportId, TransportResult,
};
use async_trait::async_trait;
use emwaver_linux_core::TransportKind;
use futures::{SinkExt, StreamExt};
use std::net::Ipv6Addr;
use tokio::net::TcpStream;
use tokio_tungstenite::{
    connect_async,
    tungstenite::protocol::{frame::coding::CloseCode, CloseFrame, Message},
    MaybeTlsStream, WebSocketStream,
};

pub const DEFAULT_WIFI_PORT: u16 = 3922;
pub const WIFI_SERVICE_TYPE: &str = "_emwaver._tcp";

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

#[derive(Default, Debug)]
pub struct LinuxWifiManager;

impl LinuxWifiManager {
    pub fn discover_mdns(&self) -> TransportResult<Vec<ManualWifiTarget>> {
        Err(TransportError::NotImplemented(
            "Wi-Fi mDNS discovery via Avahi/D-Bus",
        ))
    }

    pub fn manual_target(
        &self,
        host: impl Into<String>,
        port: Option<u16>,
    ) -> TransportResult<ManualWifiTarget> {
        ManualWifiTarget::new(host, port.unwrap_or(DEFAULT_WIFI_PORT))
    }
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
}
