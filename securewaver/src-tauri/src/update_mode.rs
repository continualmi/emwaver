use crate::usb_midi_sysex;
use midir::{MidiOutput, MidiOutputConnection};

const EMW_OPCODE_ENTER_DFU: u8 = 0x06;

fn find_emwaver_port(midi_out: &MidiOutput) -> Result<midir::MidiOutputPort, String> {
    let ports = midi_out.ports();
    if ports.is_empty() {
        return Err("No MIDI output ports found".to_string());
    }

    // Prefer ports that look like the device.
    for p in &ports {
        if let Ok(name) = midi_out.port_name(p) {
            let n = name.to_lowercase();
            if n.contains("emwaver") {
                return Ok(p.clone());
            }
        }
    }

    // Fallback to first port.
    Ok(ports[0].clone())
}

pub fn enter_update_mode_via_midi() -> Result<String, String> {
    let midi_out = MidiOutput::new("SecureWaver").map_err(|e| format!("MIDI init failed: {e}"))?;
    let port = find_emwaver_port(&midi_out)?;
    let port_name = midi_out
        .port_name(&port)
        .unwrap_or_else(|_| "(unknown)".to_string());

    let mut conn: MidiOutputConnection = midi_out
        .connect(&port, "securewaver-enter-update-mode")
        .map_err(|e| format!("Failed to open MIDI port: {e}"))?;

    let pkt = usb_midi_sysex::make_packet(&[EMW_OPCODE_ENTER_DFU])?;
    let sf = usb_midi_sysex::make_superframe(Some(&pkt), None);
    let sysex = usb_midi_sysex::encode_superframe(&sf)?;

    conn.send(&sysex)
        .map_err(|e| format!("Failed to send Update Mode command: {e}"))?;

    // Connection drops when device reboots; best-effort close.
    drop(conn);

    Ok(port_name)
}
