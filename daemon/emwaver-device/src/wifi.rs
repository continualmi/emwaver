use anyhow::{Context, Result};
use hmac::{Hmac, Mac};
use serde_json::{json, Value};
use sha2::Sha256;
use std::collections::HashMap;
use std::net::TcpStream;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tracing::warn;
use tungstenite::stream::MaybeTlsStream;
use tungstenite::{connect, Message, WebSocket};
use url::Url;

use crate::protocol::{
    decode_sysex_to_superframe, encode_superframe, make_superframe, LANE_SIZE, SUPERFRAME_SIZE,
};

const DEFAULT_WIFI_PORT: u16 = 3922;
const WIFI_WS_PATH: &str = "/v1/ws";
const ENVELOPE_HEADER_BYTES: usize = 10;
const ENVELOPE_VERSION: u8 = 1;
const ENVELOPE_KIND_SYSEX: u8 = 1;

type HmacSha256 = Hmac<Sha256>;
type WiFiSocket = WebSocket<MaybeTlsStream<TcpStream>>;

struct WiFiState {
    capture_buffer: Vec<u8>,
    pending: HashMap<u16, PendingResponse>,
    next_sequence: u16,
}

impl Default for WiFiState {
    fn default() -> Self {
        Self {
            capture_buffer: Vec::new(),
            pending: HashMap::new(),
            next_sequence: 1,
        }
    }
}

#[derive(Default)]
struct PendingResponse {
    response_data: Option<Vec<u8>>,
}

pub struct WiFiDevice {
    socket: Mutex<WiFiSocket>,
    state: Mutex<WiFiState>,
}

impl WiFiDevice {
    pub fn connect_host(host: &str, secret: &str) -> Result<Arc<Self>> {
        Self::connect(host, DEFAULT_WIFI_PORT, secret)
    }

    pub fn connect(host: &str, port: u16, secret: &str) -> Result<Arc<Self>> {
        let host = host.trim();
        let secret = secret.trim();
        if host.is_empty() {
            anyhow::bail!("Wi-Fi host is required");
        }
        if secret.is_empty() {
            anyhow::bail!("Wi-Fi pairing secret is required");
        }

        let url = format!("ws://{host}:{port}{WIFI_WS_PATH}");
        Url::parse(&url).with_context(|| format!("invalid Wi-Fi device URL for {host}:{port}"))?;
        let (mut socket, _) = connect(url.as_str()).context("failed to connect Wi-Fi WebSocket")?;
        authenticate(&mut socket, secret)?;

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
            self.send_superframe(&sf, 0)?;
            idx = end;
            std::thread::sleep(Duration::from_millis(1));
        }

        Ok(())
    }

    pub fn send_command(&self, cmd_lane: &[u8], timeout_ms: u64) -> Result<Option<Vec<u8>>> {
        let sequence = {
            let mut st = self.state.lock().unwrap();
            let sequence = st.next_sequence;
            st.next_sequence = st.next_sequence.wrapping_add(1).max(1);
            st.pending.insert(sequence, PendingResponse::default());
            sequence
        };

        let sf = make_superframe(Some(cmd_lane), None);
        self.send_superframe(&sf, sequence)?;

        let deadline = Instant::now() + Duration::from_millis(timeout_ms.max(1));
        loop {
            {
                let mut st = self.state.lock().unwrap();
                if let Some(pending) = st.pending.get(&sequence) {
                    if pending.response_data.is_some() {
                        return Ok(st
                            .pending
                            .remove(&sequence)
                            .and_then(|pending| pending.response_data));
                    }
                } else {
                    return Ok(None);
                }
            }

            let now = Instant::now();
            if now >= deadline {
                self.state.lock().unwrap().pending.remove(&sequence);
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
                Ok(Message::Close(_)) => {
                    self.state.lock().unwrap().pending.remove(&sequence);
                    return Ok(None);
                }
                Ok(_) => {}
                Err(err) => {
                    let mut st = self.state.lock().unwrap();
                    if let Some(pending) = st.pending.get(&sequence) {
                        if pending.response_data.is_some() {
                            return Ok(st
                                .pending
                                .remove(&sequence)
                                .and_then(|pending| pending.response_data));
                        }
                    }
                    st.pending.remove(&sequence);
                    warn!("Wi-Fi receive failed: {err:#}");
                    return Ok(None);
                }
            }
        }
    }

    fn send_superframe(&self, superframe: &[u8; SUPERFRAME_SIZE], sequence: u16) -> Result<()> {
        let sysex = encode_superframe(superframe);
        let frame = build_envelope(sequence, &sysex);
        self.socket
            .lock()
            .unwrap()
            .send(Message::Binary(frame))
            .context("Wi-Fi WebSocket send failed")
    }

    fn handle_binary_frame(&self, data: &[u8]) -> Result<()> {
        let (sequence, sysex) = unwrap_envelope(data).context("invalid Wi-Fi envelope")?;
        let sf = decode_sysex_to_superframe(sysex)?;
        let cmd_lane = &sf[0..LANE_SIZE];
        let stream_lane = &sf[LANE_SIZE..LANE_SIZE * 2];

        let cmd_empty = cmd_lane.iter().all(|&b| b == 0);
        let stream_empty = stream_lane.iter().all(|&b| b == 0);

        let mut st = self.state.lock().unwrap();
        if !cmd_empty {
            if let Some(pending) = st.pending.get_mut(&sequence) {
                pending.response_data = Some(cmd_lane.to_vec());
            } else {
                st.capture_buffer.extend_from_slice(cmd_lane);
            }
        }
        if !stream_empty {
            st.capture_buffer.extend_from_slice(stream_lane);
        }
        Ok(())
    }
}

fn set_read_timeout(stream: &mut MaybeTlsStream<TcpStream>, timeout: Option<Duration>) {
    if let MaybeTlsStream::Plain(stream) = stream {
        let _ = stream.set_read_timeout(timeout);
    }
}

fn authenticate(socket: &mut WiFiSocket, secret: &str) -> Result<()> {
    set_read_timeout(socket.get_mut(), Some(Duration::from_secs(8)));
    let challenge_text = match socket.read().context("failed to read Wi-Fi challenge")? {
        Message::Text(text) => text,
        other => anyhow::bail!("expected Wi-Fi auth challenge, got {other:?}"),
    };
    let challenge_json: Value =
        serde_json::from_str(&challenge_text).context("invalid Wi-Fi challenge JSON")?;
    let challenge = challenge_json
        .get("challenge")
        .and_then(Value::as_str)
        .context("Wi-Fi challenge missing challenge string")?;
    let response = hmac_sha256_hex(secret, challenge);
    let auth = json!({
        "type": "auth",
        "client": "emwaver-daemon",
        "protocolVersion": 1,
        "envelopeVersion": 1,
        "challenge": challenge,
        "response": response,
    });
    socket
        .send(Message::Binary(auth.to_string().into_bytes()))
        .context("failed to send Wi-Fi auth response")?;

    match socket.read().context("failed to read Wi-Fi auth result")? {
        Message::Text(text) if text.to_ascii_lowercase().contains("auth ok") => Ok(()),
        Message::Text(text) => anyhow::bail!("Wi-Fi authentication failed: {text}"),
        other => anyhow::bail!("Wi-Fi authentication failed: unexpected {other:?}"),
    }
}

fn hmac_sha256_hex(secret: &str, message: &str) -> String {
    let mut mac = HmacSha256::new_from_slice(secret.as_bytes()).expect("HMAC accepts any key size");
    mac.update(message.as_bytes());
    mac.finalize()
        .into_bytes()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn build_envelope(sequence: u16, payload: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(ENVELOPE_HEADER_BYTES + payload.len());
    out.extend_from_slice(b"EMW");
    out.push(ENVELOPE_VERSION);
    out.push(ENVELOPE_KIND_SYSEX);
    out.push((sequence & 0xff) as u8);
    out.push((sequence >> 8) as u8);
    out.push(0);
    out.push((payload.len() & 0xff) as u8);
    out.push(((payload.len() >> 8) & 0xff) as u8);
    out.extend_from_slice(payload);
    out
}

fn unwrap_envelope(data: &[u8]) -> Result<(u16, &[u8])> {
    if data.len() < ENVELOPE_HEADER_BYTES {
        anyhow::bail!("envelope too short");
    }
    if &data[0..3] != b"EMW" || data[3] != ENVELOPE_VERSION || data[4] != ENVELOPE_KIND_SYSEX {
        anyhow::bail!("unsupported envelope");
    }
    let sequence = u16::from(data[5]) | (u16::from(data[6]) << 8);
    let payload_len = usize::from(data[8]) | (usize::from(data[9]) << 8);
    if data.len() != ENVELOPE_HEADER_BYTES + payload_len {
        anyhow::bail!("envelope length mismatch");
    }
    Ok((sequence, &data[ENVELOPE_HEADER_BYTES..]))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wifi_envelope_round_trips_sequence_and_payload() {
        let payload = b"payload";
        let envelope = build_envelope(0x1234, payload);
        let (sequence, decoded) = unwrap_envelope(&envelope).expect("unwrap envelope");

        assert_eq!(sequence, 0x1234);
        assert_eq!(decoded, payload);
    }

    #[test]
    fn hmac_matches_known_sha256_vector() {
        let digest = hmac_sha256_hex("key", "The quick brown fox jumps over the lazy dog");
        assert_eq!(
            digest,
            "f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8"
        );
    }
}
