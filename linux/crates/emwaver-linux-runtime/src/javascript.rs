use boa_engine::{Context, Source};
use emwaver_linux_transport::{
    runtime::{run_script_commands, ScriptCommandStep, ScriptExecutionReport},
    EmwaverTransport,
};
use serde::{Deserialize, Serialize};
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

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ScriptUiTree {
    pub root: ScriptUiNode,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ScriptUiNode {
    pub node_type: String,
    #[serde(default)]
    pub props: BTreeMap<String, serde_json::Value>,
    #[serde(default)]
    pub handlers: BTreeMap<String, String>,
    #[serde(default)]
    pub children: Vec<ScriptUiNode>,
}

#[derive(Debug, Deserialize)]
struct RawScriptUiNode {
    #[serde(rename = "type")]
    node_type: String,
    #[serde(default)]
    props: BTreeMap<String, serde_json::Value>,
    #[serde(default)]
    handlers: BTreeMap<String, String>,
    #[serde(default)]
    children: Vec<RawScriptUiNode>,
}

impl From<RawScriptUiNode> for ScriptUiNode {
    fn from(value: RawScriptUiNode) -> Self {
        Self {
            node_type: value.node_type,
            props: value.props,
            handlers: value.handlers,
            children: value.children.into_iter().map(Into::into).collect(),
        }
    }
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
    let source = transform_script_source(source)?;
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

pub fn render_javascript_ui(
    source: &str,
    module_sources: &BTreeMap<String, String>,
) -> Result<Option<ScriptUiTree>, JavaScriptRuntimeError> {
    let source = transform_script_source(source)?;
    let module_loader = module_loader_script(module_sources)?;
    let wrapped =
        format!("{JS_PRELUDE}\n{module_loader}\n{source}\nJSON.stringify(__emwRenderedTree);");
    let mut context = Context::default();
    let value = context
        .eval(Source::from_bytes(wrapped.as_bytes()))
        .map_err(|err| JavaScriptRuntimeError::Eval(err.to_string()))?;
    if value.is_null() || value.is_undefined() {
        return Ok(None);
    }
    let json = value
        .to_string(&mut context)
        .map_err(|err| JavaScriptRuntimeError::Eval(err.to_string()))?
        .to_std_string_escaped();
    if json == "null" {
        return Ok(None);
    }
    let root: RawScriptUiNode =
        serde_json::from_str(&json).map_err(|err| JavaScriptRuntimeError::Json(err.to_string()))?;
    Ok(Some(ScriptUiTree { root: root.into() }))
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

fn transform_script_source(source: &str) -> Result<String, JavaScriptRuntimeError> {
    transform_jsx(&transform_imports(source)?)
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

fn transform_jsx(source: &str) -> Result<String, JavaScriptRuntimeError> {
    JsxParser::new(source).transpile()
}

struct JsxParser {
    chars: Vec<char>,
    index: usize,
}

impl JsxParser {
    fn new(source: &str) -> Self {
        Self {
            chars: source.chars().collect(),
            index: 0,
        }
    }

    fn transpile(mut self) -> Result<String, JavaScriptRuntimeError> {
        let mut output = String::new();
        while !self.is_at_end() {
            if self.starts_line_comment() {
                output.push_str(&self.consume_line_comment());
            } else if self.starts_block_comment() {
                output.push_str(&self.consume_block_comment());
            } else if matches!(self.current(), Some('"') | Some('\'') | Some('`')) {
                output.push_str(&self.consume_quoted_string(self.current().expect("quote"))?);
            } else if self.current() == Some('<') && self.looks_like_jsx_element_start(self.index) {
                output.push_str(&self.parse_element()?);
            } else {
                output.push(self.advance());
            }
        }
        Ok(output)
    }

    fn is_at_end(&self) -> bool {
        self.index >= self.chars.len()
    }

    fn current(&self) -> Option<char> {
        self.chars.get(self.index).copied()
    }

    fn peek(&self) -> Option<char> {
        self.chars.get(self.index + 1).copied()
    }

    fn advance(&mut self) -> char {
        let ch = self.chars[self.index];
        self.index += 1;
        ch
    }

    fn starts_line_comment(&self) -> bool {
        self.current() == Some('/') && self.peek() == Some('/')
    }

    fn starts_block_comment(&self) -> bool {
        self.current() == Some('/') && self.peek() == Some('*')
    }

    fn consume_line_comment(&mut self) -> String {
        let start = self.index;
        while !self.is_at_end() && self.current() != Some('\n') {
            self.advance();
        }
        if !self.is_at_end() {
            self.advance();
        }
        self.chars[start..self.index].iter().collect()
    }

    fn consume_block_comment(&mut self) -> String {
        let start = self.index;
        self.advance();
        self.advance();
        while !self.is_at_end() {
            if self.current() == Some('*') && self.peek() == Some('/') {
                self.advance();
                self.advance();
                break;
            }
            self.advance();
        }
        self.chars[start..self.index].iter().collect()
    }

    fn consume_quoted_string(&mut self, quote: char) -> Result<String, JavaScriptRuntimeError> {
        let start = self.index;
        self.advance();
        while !self.is_at_end() {
            let ch = self.advance();
            if ch == '\\' {
                if !self.is_at_end() {
                    self.advance();
                }
                continue;
            }
            if ch == quote {
                break;
            }
        }
        Ok(self.chars[start..self.index].iter().collect())
    }

    fn parse_element(&mut self) -> Result<String, JavaScriptRuntimeError> {
        self.consume('<')?;
        let tag = self.parse_tag_name();
        if tag.is_empty() {
            return Err(JavaScriptRuntimeError::Transform(
                "unterminated JSX element <unknown>".to_string(),
            ));
        }

        let mut attributes = Vec::new();
        let mut self_closing = false;
        let mut closed = false;
        while !self.is_at_end() {
            self.skip_whitespace();
            if self.starts_with("/>") {
                self.index += 2;
                self_closing = true;
                break;
            }
            if self.current() == Some('>') {
                self.advance();
                break;
            }
            attributes.push(self.parse_attribute()?);
        }

        let mut children = Vec::new();
        if !self_closing {
            while !self.is_at_end() {
                if self.starts_with("</") {
                    self.index += 2;
                    let closing = self.parse_tag_name();
                    self.skip_whitespace();
                    self.consume('>')?;
                    if closing != tag {
                        return Err(JavaScriptRuntimeError::Transform(format!(
                            "mismatched JSX closing tag: expected </{tag}>, found </{closing}>"
                        )));
                    }
                    closed = true;
                    break;
                }
                if self.current() == Some('<') && self.looks_like_jsx_element_start(self.index) {
                    children.push(self.parse_element()?);
                    continue;
                }
                if self.current() == Some('{') {
                    let expression = self.parse_brace_expression()?;
                    if !expression.trim().is_empty() {
                        children.push(expression);
                    }
                    continue;
                }
                let text = normalize_jsx_text(&self.parse_text_child());
                if !text.is_empty() {
                    children.push(js_string_literal(&text));
                }
            }
        }

        if !self_closing && !closed {
            return Err(JavaScriptRuntimeError::Transform(format!(
                "unterminated JSX element <{tag}>"
            )));
        }

        let props = make_jsx_props(&attributes);
        let args = std::iter::once(tag_reference(&tag))
            .chain(std::iter::once(props))
            .chain(children)
            .collect::<Vec<_>>()
            .join(", ");
        Ok(format!("JSX.h({args})"))
    }

    fn parse_attribute(&mut self) -> Result<(String, String), JavaScriptRuntimeError> {
        let name = self.parse_attribute_name();
        if name.is_empty() {
            return Err(JavaScriptRuntimeError::Transform(format!(
                "unsupported JSX attribute: {}",
                self.current().unwrap_or('?')
            )));
        }
        self.skip_whitespace();
        if self.current() != Some('=') {
            return Ok((name, "true".to_string()));
        }
        self.advance();
        self.skip_whitespace();
        if self.current() == Some('{') {
            return Ok((name, self.parse_brace_expression()?));
        }
        if matches!(self.current(), Some('"') | Some('\'')) {
            let quote = self.current().expect("quote");
            return Ok((name, self.consume_quoted_string(quote)?));
        }
        let start = self.index;
        while !self.is_at_end()
            && !self.current().unwrap_or(' ').is_whitespace()
            && self.current() != Some('>')
            && !self.starts_with("/>")
        {
            self.advance();
        }
        Ok((name, self.chars[start..self.index].iter().collect()))
    }

    fn parse_brace_expression(&mut self) -> Result<String, JavaScriptRuntimeError> {
        self.consume('{')?;
        let start = self.index;
        let mut depth = 1;
        while !self.is_at_end() {
            if self.starts_line_comment() {
                self.consume_line_comment();
                continue;
            }
            if self.starts_block_comment() {
                self.consume_block_comment();
                continue;
            }
            if matches!(self.current(), Some('"') | Some('\'') | Some('`')) {
                self.consume_quoted_string(self.current().expect("quote"))?;
                continue;
            }
            let ch = self.advance();
            if ch == '{' {
                depth += 1;
            } else if ch == '}' {
                depth -= 1;
                if depth == 0 {
                    return Ok(self.chars[start..self.index - 1].iter().collect());
                }
            }
        }
        Err(JavaScriptRuntimeError::Transform(
            "unterminated JSX expression".to_string(),
        ))
    }

    fn parse_text_child(&mut self) -> String {
        let start = self.index;
        while !self.is_at_end() && self.current() != Some('<') && self.current() != Some('{') {
            self.advance();
        }
        self.chars[start..self.index].iter().collect()
    }

    fn parse_tag_name(&mut self) -> String {
        let start = self.index;
        while !self.is_at_end() && is_tag_name_character(self.current().expect("char")) {
            self.advance();
        }
        self.chars[start..self.index].iter().collect()
    }

    fn parse_attribute_name(&mut self) -> String {
        let start = self.index;
        while !self.is_at_end() && is_attribute_name_character(self.current().expect("char")) {
            self.advance();
        }
        self.chars[start..self.index].iter().collect()
    }

    fn skip_whitespace(&mut self) {
        while !self.is_at_end() && self.current().is_some_and(char::is_whitespace) {
            self.advance();
        }
    }

    fn consume(&mut self, expected: char) -> Result<(), JavaScriptRuntimeError> {
        if self.current() != Some(expected) {
            return Err(JavaScriptRuntimeError::Transform(
                "unterminated JSX expression".to_string(),
            ));
        }
        self.advance();
        Ok(())
    }

    fn starts_with(&self, text: &str) -> bool {
        let end = self.index + text.chars().count();
        end <= self.chars.len() && self.chars[self.index..end].iter().collect::<String>() == text
    }

    fn looks_like_jsx_element_start(&self, start: usize) -> bool {
        if self.chars.get(start) != Some(&'<') {
            return false;
        }
        let mut cursor = start + 1;
        if cursor >= self.chars.len() || !self.chars[cursor].is_uppercase() {
            return false;
        }
        while cursor < self.chars.len() && is_tag_name_character(self.chars[cursor]) {
            cursor += 1;
        }
        while cursor < self.chars.len() && self.chars[cursor].is_whitespace() {
            cursor += 1;
        }
        if cursor >= self.chars.len() {
            return false;
        }
        self.chars[cursor] == '>'
            || (self.chars[cursor] == '/' && self.chars.get(cursor + 1) == Some(&'>'))
            || is_attribute_name_start(self.chars[cursor])
    }
}

fn make_jsx_props(attributes: &[(String, String)]) -> String {
    if attributes.is_empty() {
        return "null".to_string();
    }
    let pairs = attributes
        .iter()
        .map(|(name, value)| format!("{}: {}", property_key(name), value))
        .collect::<Vec<_>>()
        .join(", ");
    format!("{{ {pairs} }}")
}

fn property_key(name: &str) -> String {
    if is_identifier(name) {
        name.to_string()
    } else {
        js_string_literal(name)
    }
}

fn tag_reference(tag: &str) -> String {
    if is_identifier(tag) {
        tag.to_string()
    } else {
        js_string_literal(tag)
    }
}

fn js_string_literal(value: &str) -> String {
    serde_json::to_string(value).expect("string literal serialization succeeds")
}

fn normalize_jsx_text(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn is_tag_name_character(ch: char) -> bool {
    ch.is_alphanumeric() || ch == '_' || ch == '.'
}

fn is_attribute_name_character(ch: char) -> bool {
    ch.is_alphanumeric() || ch == '_' || ch == '-' || ch == ':'
}

fn is_attribute_name_start(ch: char) -> bool {
    ch.is_alphabetic() || ch == '_' || ch == ':'
}

fn module_loader_script(
    module_sources: &BTreeMap<String, String>,
) -> Result<String, JavaScriptRuntimeError> {
    if module_sources.is_empty() {
        return Ok(String::new());
    }
    let transformed = module_sources
        .iter()
        .map(|(name, source)| transform_script_source(source).map(|source| (name.clone(), source)))
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
let __emwRenderedTree = null;
let __emwNextHandlerId = 1;
const __emwHandlers = {};
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
function __emwFlattenChildren(input, out) {
  for (let i = 0; i < input.length; i += 1) {
    const child = input[i];
    if (child === null || child === undefined || child === false) continue;
    if (Array.isArray(child)) {
      __emwFlattenChildren(child, out);
    } else if (typeof child === 'string' || typeof child === 'number' || typeof child === 'boolean') {
      out.push({ type: 'text', props: { text: String(child) }, children: [] });
    } else {
      out.push(child);
    }
  }
  return out;
}
function __emwEventName(prop) {
  switch (prop) {
    case 'onTap': return 'tap';
    case 'onChange': return 'change';
    case 'onSubmit': return 'submit';
    case 'onSelect': return 'select';
    case 'onClose': return 'close';
    case 'onViewport': return 'viewport';
    case 'onCursor': return 'cursor';
    default: return null;
  }
}
function __emwNode(type, props, children) {
  const cleanProps = {};
  const handlers = {};
  const inputProps = props || {};
  Object.keys(inputProps).forEach(function(key) {
    const value = inputProps[key];
    const eventName = __emwEventName(key);
    if (eventName && typeof value === 'function') {
      const token = 'handler:' + (__emwNextHandlerId++);
      __emwHandlers[token] = value;
      handlers[eventName] = token;
    } else if (key !== 'children' && typeof value !== 'function') {
      cleanProps[key] = value;
    }
  });
  return { type: type, props: cleanProps, handlers: handlers, children: __emwFlattenChildren(children || [], []) };
}
const __emwUI = {};
[
  'column', 'row', 'card', 'tile', 'text', 'button', 'slider', 'logViewer', 'scroll',
  'textField', 'textEditor', 'picker', 'toggle', 'grid', 'plot', 'modal', 'spacer',
  'divider', 'progress'
].forEach(function(name) {
  __emwUI[name] = function(props) {
    const assigned = props || {};
    const children = Array.isArray(assigned.children) ? assigned.children : [];
    return __emwNode(name, assigned, children);
  };
});
__emwUI.buffer = function(bytes) {
  return Array.from(bytes || []);
};
const __emwJSX = {
  h(type, props) {
    const children = Array.prototype.slice.call(arguments, 2);
    const assigned = Object.assign({}, props || {});
    if (children.length) {
      assigned.children = children;
    }
    if (typeof type === 'function') {
      return type(assigned);
    }
    return __emwNode(String(type), assigned, children);
  }
};
function __emwRender(node) {
  __emwRenderedTree = node;
  return node;
}
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
    fn renders_jsx_tree_through_shared_ui_modules() {
        let modules = BTreeMap::from([
            (
                "emw-jsx.js".to_string(),
                include_str!("../../../../assets/default-scripts/emw-jsx.js").to_string(),
            ),
            (
                "emw-ui.js".to_string(),
                include_str!("../../../../assets/default-scripts/emw-ui.js").to_string(),
            ),
        ]);
        let tree = render_javascript_ui(
            r#"
            import { JSX, render } from "emw-jsx";
            import { Column, Text, Button } from "emw-ui";
            let count = 2;
            function App() {
              return (
                <Column padding={16} spacing={12}>
                  <Text font="title2">Hello {count}</Text>
                  <Button onTap={() => { count += 1; }}>Increment</Button>
                </Column>
              );
            }
            render(<App />);
            "#,
            &modules,
        )
        .unwrap()
        .unwrap();

        assert_eq!(tree.root.node_type, "column");
        assert_eq!(tree.root.children.len(), 2);
        assert_eq!(tree.root.children[0].node_type, "text");
        assert_eq!(
            tree.root.children[0].props.get("text"),
            Some(&serde_json::Value::String("Hello2".to_string()))
        );
        assert_eq!(tree.root.children[1].node_type, "button");
        assert_eq!(
            tree.root.children[1]
                .handlers
                .get("tap")
                .map(String::as_str),
            Some("handler:1")
        );
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
