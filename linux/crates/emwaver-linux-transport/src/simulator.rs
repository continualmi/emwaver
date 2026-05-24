use crate::{
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
        self.frames.push_back(EmwFrame {
            bytes: format!(
                "connected:{}:proto{}",
                self.fixture.board.hardware_uid, self.fixture.board.protocol_version
            )
            .into_bytes(),
        });
        Ok(())
    }

    async fn send_frame(&mut self, frame: EmwFrame) -> TransportResult<()> {
        if !self.connected {
            return Err(TransportError::NotConnected);
        }
        self.frames.push_back(EmwFrame {
            bytes: [b"sim-ack:".as_slice(), frame.bytes.as_slice()].concat(),
        });
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
    async fn simulator_loads_shared_fixture_and_echoes_frames() {
        let mut transport = SimulatorTransport::default_fixture().unwrap();
        let descriptor = transport.descriptor();
        assert_eq!(descriptor.hardware_uid.as_deref(), Some("SIM-00000001"));

        transport.connect().await.unwrap();
        transport
            .send_frame(EmwFrame {
                bytes: b"run blink".to_vec(),
            })
            .await
            .unwrap();

        let connected = transport.next_frame().await.unwrap();
        assert!(String::from_utf8(connected.bytes)
            .unwrap()
            .contains("connected:SIM-00000001"));

        let ack = transport.next_frame().await.unwrap();
        assert_eq!(ack.bytes, b"sim-ack:run blink".to_vec());
    }
}
