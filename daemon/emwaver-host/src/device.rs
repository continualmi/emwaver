use anyhow::{Context, Result};
use midir::{Ignore, MidiInput, MidiInputConnection, MidiOutput, MidiOutputConnection};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};
use tracing::{info, warn};

use crate::protocol::{decode_sysex_to_superframe, encode_superframe, make_superframe, LANE_SIZE, SUPERFRAME_SIZE};

struct DeviceState {
    capture_buffer: Vec<u8>,
    rx_packets: Vec<Vec<u8>>, // lanes (18B)

    waiting_for_response: bool,
    response_data: Option<Vec<u8>>,

    is_sampler_streaming_active: bool,

    // SysEx accumulation (incoming MIDI stream may chunk arbitrarily).
    sysex_buf: Vec<u8>,
    in_sysex: bool,
}

impl Default for DeviceState {
    fn default() -> Self {
        Self {
            capture_buffer: Vec::new(),
            rx_packets: Vec::new(),
            waiting_for_response: false,
            response_data: None,
            is_sampler_streaming_active: false,
            sysex_buf: Vec::with_capacity(512),
            in_sysex: false,
        }
    }
}

pub struct Device {
    state: Mutex<DeviceState>,
    cv: Condvar,

    out_conn: Mutex<Option<MidiOutputConnection>>,
    _in_conn: Mutex<Option<MidiInputConnection<()>>>,
}

impl Device {
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            state: Mutex::new(DeviceState::default()),
            cv: Condvar::new(),
            out_conn: Mutex::new(None),
            _in_conn: Mutex::new(None),
        })
    }

    /// Best-effort auto-connect: pick the first matching MIDI port.
    pub fn connect_auto(self: &Arc<Self>) -> Result<()> {
        let midi_in = MidiInput::new("emwaver-host-in")?;
        let mut midi_in = midi_in;
        midi_in.ignore(Ignore::None);

        let midi_out = MidiOutput::new("emwaver-host-out")?;

        let in_ports = midi_in.ports();
        let out_ports = midi_out.ports();

        if in_ports.is_empty() || out_ports.is_empty() {
            anyhow::bail!("no MIDI ports found");
        }

        // Prefer ports containing "EMW".
        let pick_port = |names: Vec<(usize, String)>| -> usize {
            for (i, n) in &names {
                let l = n.to_lowercase();
                if l.contains("emw") || l.contains("emwaver") {
                    return *i;
                }
            }
            names.first().map(|x| x.0).unwrap_or(0)
        };

        let in_names: Vec<(usize, String)> = in_ports
            .iter()
            .enumerate()
            .map(|(i, p)| (i, midi_in.port_name(p).unwrap_or_else(|_| format!("in#{i}"))))
            .collect();
        let out_names: Vec<(usize, String)> = out_ports
            .iter()
            .enumerate()
            .map(|(i, p)| (i, midi_out.port_name(p).unwrap_or_else(|_| format!("out#{i}"))))
            .collect();

        let in_idx = pick_port(in_names.clone());
        let out_idx = pick_port(out_names.clone());

        info!("midi in ports: {:?}", in_names);
        info!("midi out ports: {:?}", out_names);
        info!("connecting midi in #{in_idx}, out #{out_idx}");

        let out_conn = midi_out
            .connect(&out_ports[out_idx], "emwaver-host-out")
            .map_err(|e| anyhow::anyhow!("failed to connect MIDI out: {e}"))?;

        let dev = Arc::clone(self);
        let in_conn = midi_in
            .connect(
                &in_ports[in_idx],
                "emwaver-host-in",
                move |_stamp, bytes, _| {
                    dev.handle_midi_bytes(bytes);
                },
                (),
            )
            .map_err(|e| anyhow::anyhow!("failed to connect MIDI in: {e}"))?;

        *self.out_conn.lock().unwrap() = Some(out_conn);
        *self._in_conn.lock().unwrap() = Some(in_conn);

        Ok(())
    }

    pub fn get_buffer(&self) -> Vec<u8> {
        self.state.lock().unwrap().capture_buffer.clone()
    }

    pub fn clear_buffer(&self) {
        let mut st = self.state.lock().unwrap();
        st.capture_buffer.clear();
        st.rx_packets.clear();
    }

    pub fn load_buffer(&self, data: Vec<u8>) {
        let mut st = self.state.lock().unwrap();
        st.capture_buffer = data;
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

    pub fn send_packet(&self, cmd_lane: &[u8]) -> Result<()> {
        // Track sampler mode so we don't drop all-zero stream lanes while sampling.
        if cmd_lane.len() >= 2 {
            let op = cmd_lane[0];
            let sub = cmd_lane[1];
            if op == 0x60 {
                // EMW_OP_SAMPLE
                let mut st = self.state.lock().unwrap();
                if sub == 0x00 {
                    // START
                    st.is_sampler_streaming_active = true;
                } else if sub == 0x01 {
                    // STOP
                    st.is_sampler_streaming_active = false;
                }
            }
        }

        let sf = make_superframe(Some(cmd_lane), None);
        self.send_superframe(&sf)
    }

    pub fn send_command(&self, cmd_lane: &[u8], timeout_ms: u64) -> Result<Option<Vec<u8>>> {
        {
            let mut st = self.state.lock().unwrap();
            st.rx_packets.clear();
            st.waiting_for_response = true;
            st.response_data = None;
        }

        self.send_packet(cmd_lane)?;

        let deadline = Instant::now() + Duration::from_millis(timeout_ms.max(1));
        let mut st = self.state.lock().unwrap();
        while st.response_data.is_none() {
            let now = Instant::now();
            if now >= deadline {
                break;
            }
            let remaining = deadline.saturating_duration_since(now);
            let (guard, _res) = self.cv.wait_timeout(st, remaining).unwrap();
            st = guard;
        }

        st.waiting_for_response = false;
        Ok(st.response_data.take())
    }

    fn send_superframe(&self, superframe: &[u8; SUPERFRAME_SIZE]) -> Result<()> {
        let sysex = encode_superframe(superframe);
        let mut guard = self.out_conn.lock().unwrap();
        let Some(conn) = guard.as_mut() else {
            anyhow::bail!("midi out not connected");
        };
        conn.send(&sysex).context("midi send failed")?;
        Ok(())
    }

    fn handle_midi_bytes(&self, bytes: &[u8]) {
        // Accumulate SysEx frames from the incoming byte stream.
        // Start at 0xF0, end at 0xF7.
        let mut frames: Vec<Vec<u8>> = Vec::new();

        {
            let mut st = self.state.lock().unwrap();
            for &b in bytes {
                if b == 0xF0 {
                    st.sysex_buf.clear();
                    st.in_sysex = true;
                }

                if !st.in_sysex {
                    continue;
                }

                st.sysex_buf.push(b);

                if b == 0xF7 {
                    frames.push(st.sysex_buf.clone());
                    st.sysex_buf.clear();
                    st.in_sysex = false;
                }
            }
        }

        for f in frames {
            if let Err(e) = self.handle_sysex_frame(&f) {
                warn!("sysex decode error: {e:#}");
            }
        }
    }

    fn handle_sysex_frame(&self, sysex: &[u8]) -> Result<()> {
        let sf = decode_sysex_to_superframe(sysex)?;
        let cmd_lane = &sf[0..LANE_SIZE];
        let stream_lane = &sf[LANE_SIZE..LANE_SIZE * 2];

        let cmd_empty = cmd_lane.iter().all(|&b| b == 0);
        let stream_empty = stream_lane.iter().all(|&b| b == 0);

        if !cmd_empty {
            self.store_rx_lane(cmd_lane);
        }

        let sampler_active = self.state.lock().unwrap().is_sampler_streaming_active;
        if !stream_empty || sampler_active {
            self.store_rx_lane(stream_lane);
        }

        Ok(())
    }

    fn store_rx_lane(&self, lane: &[u8]) {
        let mut st = self.state.lock().unwrap();
        st.capture_buffer.extend_from_slice(lane);
        st.rx_packets.push(lane.to_vec());

        if st.waiting_for_response && st.response_data.is_none() {
            st.response_data = Some(lane.to_vec());
            self.cv.notify_all();
        }
    }
}
