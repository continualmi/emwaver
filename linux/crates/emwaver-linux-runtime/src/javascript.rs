use boa_engine::{Context, Source};
use emwaver_linux_transport::{
    runtime::{run_script_commands, ScriptCommandStep, ScriptExecutionReport},
    EmwaverTransport,
};
use serde::Deserialize;
use std::collections::BTreeMap;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum JavaScriptRuntimeError {
    #[error("JavaScript evaluation failed: {0}")]
    Eval(String),
    #[error("JavaScript returned invalid command JSON: {0}")]
    Json(String),
    #[error("invalid generated command: {0}")]
    Command(String),
    #[error("JavaScript transform failed: {0}")]
    Transform(String),
    #[error("transport execution failed: {0}")]
    Transport(String),
}

#[derive(Debug, Deserialize)]
struct RawCommand {
    label: String,
    bytes: Vec<u8>,
}

pub fn compile_javascript(source: &str) -> Result<Vec<ScriptCommandStep>, JavaScriptRuntimeError> {
    compile_javascript_with_modules(source, &BTreeMap::new())
}

pub fn compile_javascript_with_modules(
    source: &str,
    module_sources: &BTreeMap<String, String>,
) -> Result<Vec<ScriptCommandStep>, JavaScriptRuntimeError> {
    let source = transform_imports(source)?;
    let module_loader = module_loader_script(module_sources)?;
    let wrapped =
        format!("{JS_PRELUDE}\n{module_loader}\n{source}\nJSON.stringify(__emwCommands);");
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
    execute_javascript_with_modules(source, &BTreeMap::new(), transport).await
}

pub async fn execute_javascript_with_modules(
    source: &str,
    module_sources: &BTreeMap<String, String>,
    transport: &mut dyn EmwaverTransport,
) -> Result<ScriptExecutionReport, JavaScriptRuntimeError> {
    let steps = compile_javascript_with_modules(source, module_sources)?;
    run_script_commands(transport, &steps)
        .await
        .map_err(|err| JavaScriptRuntimeError::Transport(err.to_string()))
}

fn transform_imports(source: &str) -> Result<String, JavaScriptRuntimeError> {
    source
        .lines()
        .map(transform_import_line)
        .collect::<Result<Vec<_>, _>>()
        .map(|lines| lines.join("\n"))
}

fn transform_import_line(line: &str) -> Result<String, JavaScriptRuntimeError> {
    let trimmed = line.trim();
    if !trimmed.starts_with("import ") {
        return Ok(line.to_string());
    }
    let leading = line
        .chars()
        .take_while(|ch| *ch == ' ' || *ch == '\t')
        .collect::<String>();
    let statement = trimmed.strip_suffix(';').unwrap_or(trimmed).trim();

    if let Some(rest) = statement.strip_prefix("import {") {
        let Some((bindings, module)) = rest.split_once("} from ") else {
            return Err(JavaScriptRuntimeError::Transform(format!(
                "unsupported import syntax: {trimmed}"
            )));
        };
        let names = transform_import_bindings(bindings)?;
        let module = quoted_module_name(module)?;
        return Ok(format!(
            "{leading}const {{ {names} }} = require(\"{module}\");"
        ));
    }

    if let Some(rest) = statement.strip_prefix("import * as ") {
        let Some((name, module)) = rest.split_once(" from ") else {
            return Err(JavaScriptRuntimeError::Transform(format!(
                "unsupported import syntax: {trimmed}"
            )));
        };
        let name = name.trim();
        if !is_identifier(name) {
            return Err(JavaScriptRuntimeError::Transform(format!(
                "unsupported import binding: {name}"
            )));
        }
        let module = quoted_module_name(module)?;
        return Ok(format!("{leading}const {name} = require(\"{module}\");"));
    }

    if let Some(module) = statement.strip_prefix("import ") {
        let module = quoted_module_name(module)?;
        return Ok(format!("{leading}require(\"{module}\");"));
    }

    Err(JavaScriptRuntimeError::Transform(format!(
        "unsupported import syntax: {trimmed}"
    )))
}

fn transform_import_bindings(bindings: &str) -> Result<String, JavaScriptRuntimeError> {
    let mut transformed = Vec::new();
    for binding in bindings.split(',') {
        let binding = binding.trim();
        if binding.is_empty() {
            continue;
        }
        let parts = binding.split_whitespace().collect::<Vec<_>>();
        match parts.as_slice() {
            [name] if is_identifier(name) => transformed.push((*name).to_string()),
            [source, "as", alias] if is_identifier(source) && is_identifier(alias) => {
                transformed.push(format!("{source}: {alias}"));
            }
            _ => {
                return Err(JavaScriptRuntimeError::Transform(format!(
                    "unsupported import binding: {binding}"
                )));
            }
        }
    }
    if transformed.is_empty() {
        return Err(JavaScriptRuntimeError::Transform(
            "import list cannot be empty".to_string(),
        ));
    }
    Ok(transformed.join(", "))
}

fn quoted_module_name(value: &str) -> Result<String, JavaScriptRuntimeError> {
    let value = value.trim();
    let Some(quote) = value.chars().next() else {
        return Err(JavaScriptRuntimeError::Transform(
            "missing module name".to_string(),
        ));
    };
    if quote != '"' && quote != '\'' {
        return Err(JavaScriptRuntimeError::Transform(format!(
            "unsupported module name: {value}"
        )));
    }
    let Some(end) = value[1..].find(quote) else {
        return Err(JavaScriptRuntimeError::Transform(format!(
            "unterminated module name: {value}"
        )));
    };
    if !value[1 + end + 1..].trim().is_empty() {
        return Err(JavaScriptRuntimeError::Transform(format!(
            "unsupported trailing import content: {value}"
        )));
    }
    Ok(value[1..1 + end].to_string())
}

fn is_identifier(value: &str) -> bool {
    let mut chars = value.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    (first == '_' || first == '$' || first.is_ascii_alphabetic())
        && chars.all(|ch| ch == '_' || ch == '$' || ch.is_ascii_alphanumeric())
}

fn module_loader_script(
    module_sources: &BTreeMap<String, String>,
) -> Result<String, JavaScriptRuntimeError> {
    if module_sources.is_empty() {
        return Ok(String::new());
    }
    let transformed = module_sources
        .iter()
        .map(|(name, source)| transform_imports(source).map(|source| (name.clone(), source)))
        .collect::<Result<BTreeMap<_, _>, _>>()?;
    let json = serde_json::to_string(&transformed)
        .map_err(|err| JavaScriptRuntimeError::Json(err.to_string()))?;
    Ok(format!(
        r#"
globalThis.__emwModuleSources = {json};
(function(global) {{
  const sources = global.__emwModuleSources || {{}};
  const cache = {{}};
  function normalize(name) {{
    return String(name || '').trim();
  }}
  function candidates(name) {{
    const n = normalize(name);
    const out = [n];
    if (n.slice(-3) !== '.js') out.push(n + '.js');
    if (n.indexOf('./') === 0) {{
      const bare = n.slice(2);
      out.push(bare);
      if (bare.slice(-3) !== '.js') out.push(bare + '.js');
    }}
    return out;
  }}
  function resolve(name) {{
    const list = candidates(name);
    for (let i = 0; i < list.length; i += 1) {{
      if (Object.prototype.hasOwnProperty.call(sources, list[i])) return list[i];
    }}
    throw new Error('Module not found: ' + name);
  }}
  global.require = function(name) {{
    const id = resolve(name);
    if (cache[id]) return cache[id].exports;
    const module = {{ id, exports: {{}} }};
    cache[id] = module;
    const fn = new Function('require', 'module', 'exports', sources[id]);
    fn(global.require, module, module.exports);
    return module.exports;
  }};
}})(globalThis);
"#
    ))
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
    fn compiles_imports_through_local_module_loader() {
        let modules = BTreeMap::from([(
            "board-tools.js".to_string(),
            r#"
            const value = 0x09;
            module.exports = {
                boardProbe(label) {
                    emw.command([value], label);
                }
            };
            "#
            .to_string(),
        )]);
        let steps = compile_javascript_with_modules(
            r#"
            import { boardProbe as probe } from "board-tools";
            probe("module board probe");
            "#,
            &modules,
        )
        .unwrap();

        assert_eq!(steps.len(), 1);
        assert_eq!(steps[0].label, "module board probe");
        assert_eq!(steps[0].command_lane, vec![0x09]);
    }

    #[test]
    fn compiles_nested_imports_in_modules() {
        let modules = BTreeMap::from([
            (
                "inner.js".to_string(),
                "module.exports = { command: [0x01] };".to_string(),
            ),
            (
                "outer.js".to_string(),
                r#"
                import { command } from "./inner";
                module.exports = { run() { emw.command(command, "nested"); } };
                "#
                .to_string(),
            ),
        ]);
        let steps = compile_javascript_with_modules(
            r#"
            import * as outer from 'outer';
            outer.run();
            "#,
            &modules,
        )
        .unwrap();

        assert_eq!(steps.len(), 1);
        assert_eq!(steps[0].label, "nested");
        assert_eq!(steps[0].command_lane, vec![0x01]);
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
