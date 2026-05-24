use crate::usb_midi_sysex::{LANE_SIZE_BYTES, SUPERFRAME_SIZE_BYTES};
use crate::{EmwFrame, EmwaverTransport, TransportError, TransportResult};
use serde::{Deserialize, Serialize};

pub const RESPONSE_OK: u8 = 0x80;
pub const RESPONSE_ERR: u8 = 0x81;
pub const RESPONSE_BUSY: u8 = 0x82;

pub const OP_VERSION: u8 = 0x01;
pub const OP_ENTER_DFU: u8 = 0x06;
pub const OP_HARDWARE_UID_GET: u8 = 0x08;
pub const OP_BOARD_GET: u8 = 0x09;

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct DeviceProbe {
    pub firmware_version: Option<String>,
    pub board_type: Option<String>,
    pub hardware_uid: Option<String>,
}

pub async fn send_command(
    transport: &mut dyn EmwaverTransport,
    command_lane: &[u8],
) -> TransportResult<Vec<u8>> {
    if command_lane.is_empty() {
        return Err(TransportError::Command("command lane is empty".to_string()));
    }
    if command_lane.len() > LANE_SIZE_BYTES {
        return Err(TransportError::Command(format!(
            "command lane is {} bytes; expected at most {LANE_SIZE_BYTES}",
            command_lane.len()
        )));
    }

    let mut superframe = [0u8; SUPERFRAME_SIZE_BYTES];
    superframe[..command_lane.len()].copy_from_slice(command_lane);
    transport
        .send_frame(EmwFrame {
            bytes: superframe.to_vec(),
        })
        .await?;

    let response = transport.next_frame().await?;
    response_command_lane(&response.bytes)
}

pub async fn probe_device(transport: &mut dyn EmwaverTransport) -> DeviceProbe {
    DeviceProbe {
        firmware_version: query_version(transport).await.ok(),
        board_type: query_board_type(transport).await.ok(),
        hardware_uid: query_hardware_uid(transport).await.ok(),
    }
}

pub async fn query_version(transport: &mut dyn EmwaverTransport) -> TransportResult<String> {
    let lane = send_command(transport, &[OP_VERSION]).await?;
    if lane.len() < 3 || lane[0] != RESPONSE_OK {
        return Err(TransportError::Command(
            "version probe returned a non-OK response".to_string(),
        ));
    }
    Ok(format!("{}.{}", lane[1], lane[2]))
}

pub async fn query_board_type(transport: &mut dyn EmwaverTransport) -> TransportResult<String> {
    let lane = send_command(transport, &[OP_BOARD_GET]).await?;
    if lane.first() != Some(&RESPONSE_OK) {
        return Err(TransportError::Command(
            "board probe returned a non-OK response".to_string(),
        ));
    }
    let bytes: Vec<u8> = lane
        .iter()
        .skip(1)
        .copied()
        .take_while(|byte| *byte != 0)
        .collect();
    if bytes.is_empty() {
        return Err(TransportError::Command(
            "board probe returned an empty board type".to_string(),
        ));
    }
    String::from_utf8(bytes)
        .map_err(|err| TransportError::Command(format!("board type is not UTF-8: {err}")))
}

pub async fn query_hardware_uid(transport: &mut dyn EmwaverTransport) -> TransportResult<String> {
    let lane = send_command(transport, &[OP_HARDWARE_UID_GET]).await?;
    if lane.first() != Some(&RESPONSE_OK) {
        return Err(TransportError::Command(
            "hardware UID probe returned a non-OK response".to_string(),
        ));
    }
    let payload = &lane[1..];
    let significant_len = payload
        .iter()
        .rposition(|byte| *byte != 0)
        .map(|index| index + 1)
        .unwrap_or(0);
    match significant_len {
        6 | 12 => Ok(payload[..significant_len]
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>()),
        0 => Err(TransportError::Command(
            "hardware UID probe returned an empty UID".to_string(),
        )),
        len => Err(TransportError::Command(format!(
            "hardware UID probe returned {len} significant bytes; expected 6 or 12"
        ))),
    }
}

fn response_command_lane(superframe: &[u8]) -> TransportResult<Vec<u8>> {
    if superframe.len() < LANE_SIZE_BYTES {
        return Err(TransportError::Command(format!(
            "response superframe is {} bytes; expected at least {LANE_SIZE_BYTES}",
            superframe.len()
        )));
    }
    Ok(superframe[..LANE_SIZE_BYTES].to_vec())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{TransportDescriptor, TransportId};
    use async_trait::async_trait;
    use emwaver_linux_core::TransportKind;
    use std::collections::VecDeque;

    struct ScriptedTransport {
        sent: Vec<Vec<u8>>,
        responses: VecDeque<Vec<u8>>,
    }

    impl ScriptedTransport {
        fn new(response_lanes: Vec<Vec<u8>>) -> Self {
            let responses = response_lanes
                .into_iter()
                .map(superframe_with_lane)
                .collect::<VecDeque<_>>();
            Self {
                sent: Vec::new(),
                responses,
            }
        }
    }

    #[async_trait]
    impl EmwaverTransport for ScriptedTransport {
        fn descriptor(&self) -> TransportDescriptor {
            TransportDescriptor {
                id: TransportId("scripted".to_string()),
                kind: TransportKind::Simulator,
                display_name: "Scripted".to_string(),
                hardware_uid: None,
                firmware_version: None,
            }
        }

        async fn connect(&mut self) -> TransportResult<()> {
            Ok(())
        }

        async fn send_frame(&mut self, frame: EmwFrame) -> TransportResult<()> {
            self.sent.push(frame.bytes);
            Ok(())
        }

        async fn next_frame(&mut self) -> TransportResult<EmwFrame> {
            let bytes = self
                .responses
                .pop_front()
                .ok_or(TransportError::NotConnected)?;
            Ok(EmwFrame { bytes })
        }

        async fn close(&mut self) -> TransportResult<()> {
            Ok(())
        }
    }

    fn superframe_with_lane(lane: Vec<u8>) -> Vec<u8> {
        let mut superframe = vec![0u8; SUPERFRAME_SIZE_BYTES];
        superframe[..lane.len()].copy_from_slice(&lane);
        superframe
    }

    #[tokio::test]
    async fn send_command_pads_command_lane_and_returns_response_lane() {
        let mut transport = ScriptedTransport::new(vec![vec![RESPONSE_OK, 1, 2]]);
        let response = send_command(&mut transport, &[OP_VERSION]).await.unwrap();

        assert_eq!(response[..3], [RESPONSE_OK, 1, 2]);
        assert_eq!(transport.sent[0].len(), SUPERFRAME_SIZE_BYTES);
        assert_eq!(transport.sent[0][0], OP_VERSION);
        assert!(transport.sent[0][1..].iter().all(|byte| *byte == 0));
    }

    #[tokio::test]
    async fn probes_version_board_and_hardware_uid() {
        let mut transport = ScriptedTransport::new(vec![
            vec![RESPONSE_OK, 1, 5],
            [vec![RESPONSE_OK], b"stm32f042".to_vec()].concat(),
            vec![RESPONSE_OK, 1, 2, 3, 4, 5, 6],
        ]);

        assert_eq!(query_version(&mut transport).await.unwrap(), "1.5");
        assert_eq!(query_board_type(&mut transport).await.unwrap(), "stm32f042");
        assert_eq!(
            query_hardware_uid(&mut transport).await.unwrap(),
            "010203040506"
        );
    }

    #[tokio::test]
    async fn hardware_uid_accepts_12_byte_uid() {
        let mut transport = ScriptedTransport::new(vec![vec![
            RESPONSE_OK,
            1,
            2,
            3,
            4,
            5,
            6,
            7,
            8,
            9,
            10,
            11,
            12,
        ]]);

        assert_eq!(
            query_hardware_uid(&mut transport).await.unwrap(),
            "0102030405060708090a0b0c"
        );
    }

    #[tokio::test]
    async fn hardware_uid_rejects_unexpected_length() {
        let mut transport = ScriptedTransport::new(vec![vec![RESPONSE_OK, 1, 2, 3]]);
        assert!(query_hardware_uid(&mut transport).await.is_err());
    }
}
