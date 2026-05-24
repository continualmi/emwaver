use boa_engine::{Context, Source};
use emwaver_linux_transport::{
    runtime::{run_script_commands, ScriptCommandStep, ScriptExecutionReport},
    EmwaverTransport,
};
use serde::Deserialize;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum JavaScriptRuntimeError {
    #[error("JavaScript evaluation failed: {0}")]
    Eval(String),
    #[error("JavaScript returned invalid command JSON: {0}")]
    Json(String),
    #[error("invalid generated command: {0}")]
    Command(String),
    #[error("transport execution failed: {0}")]
    Transport(String),
}

#[derive(Debug, Deserialize)]
struct RawCommand {
    label: String,
    bytes: Vec<u8>,
}

pub fn compile_javascript(source: &str) -> Result<Vec<ScriptCommandStep>, JavaScriptRuntimeError> {
    let wrapped = format!("{JS_PRELUDE}\n{source}\nJSON.stringify(__emwCommands);");
    let mut context = Context::default();
    let value = context
        .eval(Source::from_bytes(wrapped.as_bytes()))
        .map_err(|err| JavaScriptRuntimeError::Eval(err.to_string()))?;
    let json = value
        .to_string(&mut context)
        .map_err(|err| JavaScriptRuntimeError::Eval(err.to_string()))?
        .to_std_string_escaped();
    let raw_commands: Vec<RawCommand> =
        serde_json::from_str(&json).map_err(|err| JavaScriptRuntimeError::Json(err.to_string()))?;

    raw_commands
        .into_iter()
        .map(|command| {
            ScriptCommandStep::new(command.label, command.bytes)
                .map_err(|err| JavaScriptRuntimeError::Command(err.to_string()))
        })
        .collect()
}

pub async fn execute_javascript(
    source: &str,
    transport: &mut dyn EmwaverTransport,
) -> Result<ScriptExecutionReport, JavaScriptRuntimeError> {
    let steps = compile_javascript(source)?;
    run_script_commands(transport, &steps)
        .await
        .map_err(|err| JavaScriptRuntimeError::Transport(err.to_string()))
}

const JS_PRELUDE: &str = r#"
const __emwCommands = [];
function __emwByte(value, name) {
  if (!Number.isInteger(value) || value < 0 || value > 255) {
    throw new Error(name + " must be an integer byte");
  }
  return value;
}
function __emwPin(pin) {
  return __emwByte(pin, "pin");
}
function __emwBytes(bytes) {
  if (!Array.isArray(bytes)) {
    throw new Error("command bytes must be an array");
  }
  return bytes.map((value, index) => __emwByte(value, "byte[" + index + "]"));
}
const emw = {
  command(bytes, label = "command") {
    __emwCommands.push({ label, bytes: __emwBytes(bytes) });
  }
};
const device = {
  version() { emw.command([0x01], "device.version"); },
  hardwareUid() { emw.command([0x08], "device.hardwareUid"); },
  board() { emw.command([0x09], "device.board"); }
};
const gpio = {
  input(pin) { emw.command([0x10, 0x00, __emwPin(pin)], "gpio.input"); },
  out(pin) { emw.command([0x10, 0x01, __emwPin(pin)], "gpio.out"); },
  output(pin) { this.out(pin); },
  read(pin) { emw.command([0x10, 0x02, __emwPin(pin)], "gpio.read"); },
  high(pin) { emw.command([0x10, 0x03, __emwPin(pin)], "gpio.high"); },
  low(pin) { emw.command([0x10, 0x04, __emwPin(pin)], "gpio.low"); },
  info(pin) { emw.command([0x10, 0x06, __emwPin(pin)], "gpio.info"); },
  write(pin, value) {
    this.out(pin);
    if (value) {
      this.high(pin);
    } else {
      this.low(pin);
    }
  }
};
"#;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compiles_device_and_gpio_calls_to_command_steps() {
        let steps = compile_javascript(
            r#"
            device.version();
            gpio.write(13, 1);
            gpio.read(13);
            "#,
        )
        .unwrap();

        assert_eq!(steps.len(), 4);
        assert_eq!(steps[0].label, "device.version");
        assert_eq!(steps[0].command_lane, vec![0x01]);
        assert_eq!(steps[1].command_lane, vec![0x10, 0x01, 13]);
        assert_eq!(steps[2].command_lane, vec![0x10, 0x03, 13]);
        assert_eq!(steps[3].command_lane, vec![0x10, 0x02, 13]);
    }

    #[test]
    fn supports_raw_emw_command_calls() {
        let steps = compile_javascript("emw.command([0x09], 'board probe');").unwrap();

        assert_eq!(steps.len(), 1);
        assert_eq!(steps[0].label, "board probe");
        assert_eq!(steps[0].command_lane, vec![0x09]);
    }

    #[test]
    fn rejects_invalid_command_bytes() {
        let err = compile_javascript("emw.command([999]);").unwrap_err();
        assert!(err.to_string().contains("JavaScript evaluation failed"));
    }

    #[tokio::test]
    async fn executes_javascript_against_simulator_transport() {
        let mut transport =
            emwaver_linux_transport::simulator::SimulatorTransport::default_fixture().unwrap();
        transport.connect().await.unwrap();

        let report = execute_javascript(
            r#"
            device.version();
            gpio.write(13, true);
            "#,
            &mut transport,
        )
        .await
        .unwrap();

        assert!(report.completed);
        assert_eq!(report.steps.len(), 3);
    }
}
