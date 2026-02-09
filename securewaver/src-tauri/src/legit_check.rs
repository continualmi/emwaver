use crate::usb_midi_sysex;
use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use ed25519_dalek::{Signature, VerifyingKey};
use midir::{MidiInput, MidiInputConnection, MidiOutput, MidiOutputConnection};
use std::{sync::mpsc, time::Duration};

const EMW_OP_IDENTITY_GET: u8 = 0x07;
const EMW_IDENTITY_DEVICE_ID: u8 = 0x00;
const EMW_IDENTITY_PROOF: u8 = 0x01;

fn parse_root_public_key() -> Result<VerifyingKey, String> {
    let b64 = std::env::var("EMWAVER_ROOT_PUBLIC_KEY_B64").unwrap_or_default();
    let b64 = b64.trim();
    if b64.is_empty() {
        return Err("Missing EMWAVER_ROOT_PUBLIC_KEY_B64".to_string());
    }
    let bytes = B64
        .decode(b64)
        .map_err(|e| format!("Invalid EMWAVER_ROOT_PUBLIC_KEY_B64: {e}"))?;
    let key_bytes: [u8; 32] = bytes
        .try_into()
        .map_err(|_| "Root public key must be 32 bytes".to_string())?;
    VerifyingKey::from_bytes(&key_bytes).map_err(|e| format!("Invalid root public key: {e}"))
}

fn find_emwaver_out_port(midi_out: &MidiOutput) -> Result<midir::MidiOutputPort, String> {
    let ports = midi_out.ports();
    if ports.is_empty() {
        return Err("No MIDI output ports found".to_string());
    }
    for p in &ports {
        if let Ok(name) = midi_out.port_name(p) {
            if name.to_lowercase().contains("emwaver") {
                return Ok(p.clone());
            }
        }
    }
    Ok(ports[0].clone())
}

fn find_emwaver_in_port(midi_in: &MidiInput) -> Result<midir::MidiInputPort, String> {
    let ports = midi_in.ports();
    if ports.is_empty() {
        return Err("No MIDI input ports found".to_string());
    }
    for p in &ports {
        if let Ok(name) = midi_in.port_name(p) {
            if name.to_lowercase().contains("emwaver") {
                return Ok(p.clone());
            }
        }
    }
    Ok(ports[0].clone())
}

fn open_connections() -> Result<(MidiOutputConnection, MidiInputConnection<()>, mpsc::Receiver<Vec<u8>>, String), String> {
    let midi_out = MidiOutput::new("SecureWaver").map_err(|e| format!("MIDI init failed: {e}"))?;
    let midi_in = MidiInput::new("SecureWaver").map_err(|e| format!("MIDI init failed: {e}"))?;

    let out_port = find_emwaver_out_port(&midi_out)?;
    let in_port = find_emwaver_in_port(&midi_in)?;

    let out_name = midi_out.port_name(&out_port).unwrap_or_else(|_| "(unknown)".to_string());

    let (tx, rx) = mpsc::channel::<Vec<u8>>();
    let mut acc = usb_midi_sysex::SysexAccumulator::new();

    let in_conn = midi_in
        .connect(
            &in_port,
            "securewaver-legit-check",
            move |_ts, msg, _| {
                for frame in acc.feed(msg) {
                    let _ = tx.send(frame);
                }
            },
            (),
        )
        .map_err(|e| format!("Failed to open MIDI input: {e}"))?;

    let out_conn = midi_out
        .connect(&out_port, "securewaver-legit-check")
        .map_err(|e| format!("Failed to open MIDI output: {e}"))?;

    Ok((out_conn, in_conn, rx, out_name))
}

fn send_request_and_wait_payload(
    out: &mut MidiOutputConnection,
    rx: &mpsc::Receiver<Vec<u8>>,
    request: &[u8],
    timeout: Duration,
) -> Result<Vec<u8>, String> {
    let pkt = usb_midi_sysex::make_packet(request)?;
    let sf = usb_midi_sysex::make_superframe(Some(&pkt), None);
    let sysex = usb_midi_sysex::encode_superframe(&sf)?;
    out.send(&sysex)
        .map_err(|e| format!("Failed to send request: {e}"))?;

    let deadline = std::time::Instant::now() + timeout;
    while std::time::Instant::now() < deadline {
        let remaining = deadline.saturating_duration_since(std::time::Instant::now());
        match rx.recv_timeout(remaining.min(Duration::from_millis(250))) {
            Ok(frame) => {
                if let Ok(superframe) = usb_midi_sysex::decode_sysex_to_superframe(&frame) {
                    let cmd = &superframe[0..usb_midi_sysex::LANE_SIZE];
                    let status = cmd[0];
                    if status != 0 {
                        return Err("Device returned error".to_string());
                    }
                    // payload starts at 1
                    return Ok(cmd[1..].to_vec());
                }
            }
            Err(mpsc::RecvTimeoutError::Timeout) => continue,
            Err(_) => break,
        }
    }

    Err("Timeout waiting for device response".to_string())
}

pub struct LegitCheckResult {
    pub port_name: String,
    pub device_id_b64: String,
    pub proof_b64: String,
    pub ok: bool,
}

pub fn run_mode_legit_check() -> Result<LegitCheckResult, String> {
    let root = parse_root_public_key()?;
    let (mut out_conn, _in_conn, rx, port_name) = open_connections()?;

    // DeviceID
    let device_payload = send_request_and_wait_payload(
        &mut out_conn,
        &rx,
        &[EMW_OP_IDENTITY_GET, EMW_IDENTITY_DEVICE_ID, 0],
        Duration::from_millis(900),
    )?;
    let device_id = device_payload[0..16].to_vec();

    // Proof in 4 chunks.
    let mut proof: Vec<u8> = Vec::with_capacity(64);
    for chunk in 0..4u8 {
        let p = send_request_and_wait_payload(
            &mut out_conn,
            &rx,
            &[EMW_OP_IDENTITY_GET, EMW_IDENTITY_PROOF, chunk],
            Duration::from_millis(900),
        )?;
        proof.extend_from_slice(&p[0..16]);
    }

    let sig_bytes: [u8; 64] = proof
        .clone()
        .try_into()
        .map_err(|_| "Proof must be 64 bytes".to_string())?;
    let sig = Signature::from_bytes(&sig_bytes);

    let ok = root.verify_strict(&device_id, &sig).is_ok();

    Ok(LegitCheckResult {
        port_name,
        device_id_b64: B64.encode(device_id),
        proof_b64: B64.encode(proof),
        ok,
    })
}

pub fn detect_run_mode_device() -> Result<Vec<String>, String> {
    let midi_out = MidiOutput::new("SecureWaver").map_err(|e| format!("MIDI init failed: {e}"))?;
    let mut names: Vec<String> = Vec::new();
    for p in midi_out.ports() {
        if let Ok(name) = midi_out.port_name(&p) {
            if name.to_lowercase().contains("emwaver") {
                names.push(name);
            }
        }
    }
    Ok(names)
}
