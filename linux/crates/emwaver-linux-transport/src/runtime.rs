use crate::command::{send_command, RESPONSE_BUSY, RESPONSE_ERR, RESPONSE_OK};
use crate::usb_midi_sysex::LANE_SIZE_BYTES;
use crate::{EmwaverTransport, TransportError, TransportResult};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct ScriptCommandStep {
    pub label: String,
    pub command_lane: Vec<u8>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub enum ScriptStepStatus {
    Ok,
    Busy,
    Error,
    Malformed,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct ScriptStepResult {
    pub label: String,
    pub status: ScriptStepStatus,
    pub response_lane: Vec<u8>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct ScriptExecutionReport {
    pub completed: bool,
    pub steps: Vec<ScriptStepResult>,
    pub log: Vec<String>,
}

impl ScriptCommandStep {
    pub fn new(label: impl Into<String>, command_lane: Vec<u8>) -> TransportResult<Self> {
        if command_lane.is_empty() {
            return Err(TransportError::Command(
                "script command is empty".to_string(),
            ));
        }
        if command_lane.len() > LANE_SIZE_BYTES {
            return Err(TransportError::Command(format!(
                "script command is {} bytes; expected at most {LANE_SIZE_BYTES}",
                command_lane.len()
            )));
        }
        Ok(Self {
            label: label.into(),
            command_lane,
        })
    }
}

pub async fn run_script_commands(
    transport: &mut dyn EmwaverTransport,
    steps: &[ScriptCommandStep],
) -> TransportResult<ScriptExecutionReport> {
    let mut report = ScriptExecutionReport {
        completed: true,
        steps: Vec::with_capacity(steps.len()),
        log: Vec::new(),
    };

    for step in steps {
        report.log.push(format!("running {}", step.label));
        let response = send_command(transport, &step.command_lane).await?;
        let status = classify_response(&response);
        report.steps.push(ScriptStepResult {
            label: step.label.clone(),
            status: status.clone(),
            response_lane: response,
        });

        match status {
            ScriptStepStatus::Ok => report.log.push(format!("{} ok", step.label)),
            ScriptStepStatus::Busy => {
                report.completed = false;
                report.log.push(format!("{} busy", step.label));
                break;
            }
            ScriptStepStatus::Error | ScriptStepStatus::Malformed => {
                report.completed = false;
                report.log.push(format!("{} failed", step.label));
                break;
            }
        }
    }

    Ok(report)
}

pub fn parse_hex_command_script(source: &str) -> TransportResult<Vec<ScriptCommandStep>> {
    let mut steps = Vec::new();
    for (line_index, raw_line) in source.lines().enumerate() {
        let line = raw_line.split('#').next().unwrap_or("").trim();
        if line.is_empty() {
            continue;
        }

        let mut bytes = Vec::new();
        for token in line.split(|ch: char| ch.is_ascii_whitespace() || ch == ',') {
            let token = token.trim();
            if token.is_empty() {
                continue;
            }
            let hex = token
                .strip_prefix("0x")
                .or_else(|| token.strip_prefix("0X"))
                .unwrap_or(token);
            let byte = u8::from_str_radix(hex, 16).map_err(|err| {
                TransportError::Command(format!(
                    "line {} has invalid hex byte '{token}': {err}",
                    line_index + 1
                ))
            })?;
            bytes.push(byte);
        }

        steps.push(ScriptCommandStep::new(
            format!("line {}", line_index + 1),
            bytes,
        )?);
    }
    Ok(steps)
}

fn classify_response(response_lane: &[u8]) -> ScriptStepStatus {
    match response_lane.first().copied() {
        Some(RESPONSE_OK) => ScriptStepStatus::Ok,
        Some(RESPONSE_BUSY) => ScriptStepStatus::Busy,
        Some(RESPONSE_ERR) => ScriptStepStatus::Error,
        _ => ScriptStepStatus::Malformed,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::usb_midi_sysex::SUPERFRAME_SIZE_BYTES;
    use crate::{EmwFrame, TransportDescriptor, TransportId};
    use async_trait::async_trait;
    use emwaver_linux_core::TransportKind;
    use std::collections::VecDeque;

    struct ScriptedTransport {
        sent: Vec<Vec<u8>>,
        responses: VecDeque<Vec<u8>>,
    }

    impl ScriptedTransport {
        fn new(response_lanes: Vec<Vec<u8>>) -> Self {
            Self {
                sent: Vec::new(),
                responses: response_lanes
                    .into_iter()
                    .map(superframe_with_lane)
                    .collect(),
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

    #[test]
    fn parses_hex_command_script() {
        let steps = parse_hex_command_script(
            r#"
            # version
            0x01
            10 01 0d
            "#,
        )
        .unwrap();

        assert_eq!(steps.len(), 2);
        assert_eq!(steps[0].command_lane, vec![0x01]);
        assert_eq!(steps[1].command_lane, vec![0x10, 0x01, 0x0d]);
    }

    #[tokio::test]
    async fn runs_steps_until_all_ok() {
        let mut transport =
            ScriptedTransport::new(vec![vec![RESPONSE_OK, 1, 0], vec![RESPONSE_OK]]);
        let steps = vec![
            ScriptCommandStep::new("version", vec![0x01]).unwrap(),
            ScriptCommandStep::new("gpio", vec![0x10, 0x01, 0x0d]).unwrap(),
        ];

        let report = run_script_commands(&mut transport, &steps).await.unwrap();

        assert!(report.completed);
        assert_eq!(report.steps.len(), 2);
        assert_eq!(report.steps[0].status, ScriptStepStatus::Ok);
        assert_eq!(transport.sent.len(), 2);
    }

    #[tokio::test]
    async fn stops_when_device_reports_busy() {
        let mut transport = ScriptedTransport::new(vec![vec![RESPONSE_BUSY], vec![RESPONSE_OK]]);
        let steps = vec![
            ScriptCommandStep::new("claim", vec![0x0b, 0x01]).unwrap(),
            ScriptCommandStep::new("gpio", vec![0x10, 0x01, 0x0d]).unwrap(),
        ];

        let report = run_script_commands(&mut transport, &steps).await.unwrap();

        assert!(!report.completed);
        assert_eq!(report.steps.len(), 1);
        assert_eq!(report.steps[0].status, ScriptStepStatus::Busy);
        assert_eq!(transport.sent.len(), 1);
    }
}
