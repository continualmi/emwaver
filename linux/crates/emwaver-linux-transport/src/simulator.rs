use crate::{
    command::{RESPONSE_ERR, RESPONSE_OK},
    usb_midi_sysex::LANE_SIZE_BYTES,
    EmwFrame, EmwaverTransport, TransportDescriptor, TransportError, TransportId, TransportResult,
};
use async_trait::async_trait;
use emwaver_linux_core::TransportKind;
use serde::Deserialize;
use std::collections::VecDeque;

#[derive(Clone, Debug, Deserialize)]
pub struct SimulatorFixture {
    pub board: SimulatorBoard,
}

#[derive(Clone, Debug, Deserialize)]
pub struct SimulatorBoard {
    #[serde(rename = "type")]
    pub board_type: String,
    pub name: String,
    #[serde(rename = "firmwareVersion")]
    pub firmware_version: FirmwareVersion,
    #[serde(rename = "hardwareUid")]
    pub hardware_uid: String,
    #[serde(rename = "protocolVersion")]
    pub protocol_version: u8,
}

#[derive(Clone, Debug, Deserialize)]
pub struct FirmwareVersion {
    pub major: u8,
    pub minor: u8,
}

pub struct SimulatorTransport {
    fixture: SimulatorFixture,
    connected: bool,
    frames: VecDeque<EmwFrame>,
}

impl SimulatorTransport {
    pub fn from_fixture_json(json: &str) -> TransportResult<Self> {
        let fixture =
            serde_json::from_str(json).map_err(|err| TransportError::Fixture(err.to_string()))?;
        Ok(Self {
            fixture,
            connected: false,
            frames: VecDeque::new(),
        })
    }

    pub fn default_fixture() -> TransportResult<Self> {
        Self::from_fixture_json(include_str!(
            "../../../../simulator/fixtures/basic-board.json"
        ))
    }

    fn handle_frame(&self, superframe: &[u8]) -> TransportResult<EmwFrame> {
        if superframe.len() < LANE_SIZE_BYTES {
            return Err(TransportError::Fixture(format!(
                "simulator frame is {} bytes; expected at least {LANE_SIZE_BYTES}",
                superframe.len()
            )));
        }

        let command_lane = &superframe[..LANE_SIZE_BYTES];
        let response = match command_lane.first().copied().unwrap_or(0) {
            0x01 => vec![
                RESPONSE_OK,
                self.fixture.board.firmware_version.major,
                self.fixture.board.firmware_version.minor,
            ],
            0x08 => {
                let mut out = vec![RESPONSE_OK];
                out.extend(
                    self.fixture
                        .board
                        .hardware_uid
                        .as_bytes()
                        .iter()
                        .copied()
                        .take(12),
                );
                out
            }
            0x09 => {
                let mut out = vec![RESPONSE_OK];
                out.extend(self.fixture.board.board_type.as_bytes());
                out
            }
            0x10 => vec![RESPONSE_OK],
            _ => vec![RESPONSE_ERR],
        };

        let mut response_frame = vec![0u8; superframe.len()];
        let len = response.len().min(LANE_SIZE_BYTES);
        response_frame[..len].copy_from_slice(&response[..len]);
        Ok(EmwFrame {
            bytes: response_frame,
        })
    }
}

#[async_trait]
impl EmwaverTransport for SimulatorTransport {
    fn descriptor(&self) -> TransportDescriptor {
        TransportDescriptor {
            id: TransportId("simulator:basic-board".to_string()),
            kind: TransportKind::Simulator,
            display_name: self.fixture.board.name.clone(),
            hardware_uid: Some(self.fixture.board.hardware_uid.clone()),
            firmware_version: Some(format!(
                "{}.{}",
                self.fixture.board.firmware_version.major,
                self.fixture.board.firmware_version.minor
            )),
        }
    }

    async fn connect(&mut self) -> TransportResult<()> {
        self.connected = true;
        Ok(())
    }

    async fn send_frame(&mut self, frame: EmwFrame) -> TransportResult<()> {
        if !self.connected {
            return Err(TransportError::NotConnected);
        }
        self.frames.push_back(self.handle_frame(&frame.bytes)?);
        Ok(())
    }

    async fn next_frame(&mut self) -> TransportResult<EmwFrame> {
        if !self.connected {
            return Err(TransportError::NotConnected);
        }
        self.frames.pop_front().ok_or(TransportError::NotConnected)
    }

    async fn close(&mut self) -> TransportResult<()> {
        self.connected = false;
        self.frames.clear();
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn simulator_loads_shared_fixture_and_handles_board_command() {
        let mut transport = SimulatorTransport::default_fixture().unwrap();
        let descriptor = transport.descriptor();
        assert_eq!(descriptor.hardware_uid.as_deref(), Some("SIM-00000001"));

        transport.connect().await.unwrap();
        transport
            .send_frame(EmwFrame {
                bytes: {
                    let mut frame = vec![0u8; 36];
                    frame[0] = 0x09;
                    frame
                },
            })
            .await
            .unwrap();

        let response = transport.next_frame().await.unwrap();
        assert_eq!(response.bytes[0], RESPONSE_OK);
        assert_eq!(&response.bytes[1..12], b"emwaver-sim");
    }
}
