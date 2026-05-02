use anyhow::{Context, Result};
use serde::Deserialize;
use std::collections::{HashMap, HashSet};
use std::sync::Mutex;

use crate::engine::CommandBridge;

const STATUS_OK: u8 = 0x80;

const OP_VERSION: u8 = 0x01;
const OP_RESET: u8 = 0x02;
const OP_NAME_GET: u8 = 0x04;
const OP_BOARD_GET: u8 = 0x09;
const OP_GPIO: u8 = 0x10;
const OP_ADC_READ: u8 = 0x20;
const OP_UART: u8 = 0x30;
const OP_I2C: u8 = 0x40;
const OP_SPI_XFER: u8 = 0x50;
const OP_PWM: u8 = 0x70;

const GPIO_IN: u8 = 0x00;
const GPIO_OUT: u8 = 0x01;
const GPIO_READ: u8 = 0x02;
const GPIO_HIGH: u8 = 0x03;
const GPIO_LOW: u8 = 0x04;
const GPIO_PULL: u8 = 0x05;
const GPIO_INFO: u8 = 0x06;

const ADC_SRC_PIN: u8 = 0x00;
const ADC_SRC_TEMP: u8 = 0x01;
const ADC_SRC_VREFINT: u8 = 0x02;
const ADC_SRC_VBAT: u8 = 0x03;

const UART_OPEN: u8 = 0x00;
const UART_CLOSE: u8 = 0x01;
const UART_WRITE: u8 = 0x02;
const UART_READ: u8 = 0x03;

const I2C_OPEN: u8 = 0x00;
const I2C_CLOSE: u8 = 0x01;
const I2C_WRITE: u8 = 0x02;
const I2C_READ: u8 = 0x03;
const I2C_XFER: u8 = 0x04;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SimulatorFixture {
    pub board: BoardFixture,
    pub gpio: GpioFixture,
    pub adc: AdcFixture,
    pub pwm: PwmFixture,
    pub serial: SerialFixture,
    pub i2c: I2cFixture,
    pub spi: SpiFixture,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BoardFixture {
    #[serde(rename = "type")]
    pub board_type: String,
    pub name: String,
    pub firmware_version: FirmwareVersion,
    pub hardware_uid: String,
    pub protocol_version: u8,
}

#[derive(Debug, Clone, Deserialize)]
pub struct FirmwareVersion {
    pub major: u8,
    pub minor: u8,
}

#[derive(Debug, Clone, Deserialize)]
pub struct GpioFixture {
    pub pins: Vec<GpioPinFixture>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GpioPinFixture {
    pub number: u8,
    pub name: String,
    pub modes: Vec<String>,
    pub initial_level: u8,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdcFixture {
    pub pin_values: HashMap<String, u16>,
    pub internal_sources: HashMap<String, u16>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PwmFixture {
    pub default_frequency_hz: u32,
    pub pins: Vec<u8>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SerialFixture {
    pub read_bytes: Vec<u8>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct I2cFixture {
    pub default_read_byte: u8,
    pub addresses: HashMap<String, I2cAddressFixture>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct I2cAddressFixture {
    pub read_bytes: Vec<u8>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpiFixture {
    pub default_read_byte: u8,
    pub transfers: HashMap<String, Vec<u8>>,
}

#[derive(Debug)]
struct SimulatorState {
    gpio_levels: HashMap<u8, u8>,
    gpio_modes: HashMap<u8, String>,
}

pub struct SimulatorCommandBridge {
    fixture: SimulatorFixture,
    pins: HashSet<u8>,
    pwm_pins: HashSet<u8>,
    state: Mutex<SimulatorState>,
}

impl SimulatorFixture {
    pub fn from_json(source: &str) -> Result<Self> {
        serde_json::from_str(source).context("failed to parse EMWaver simulator fixture")
    }

    pub fn basic_board() -> Result<Self> {
        Self::from_json(include_str!("../../../simulator/fixtures/basic-board.json"))
    }
}

impl SimulatorCommandBridge {
    pub fn new(fixture: SimulatorFixture) -> Self {
        let pins: HashSet<u8> = fixture.gpio.pins.iter().map(|pin| pin.number).collect();
        let pwm_pins: HashSet<u8> = fixture.pwm.pins.iter().copied().collect();
        let gpio_levels = fixture
            .gpio
            .pins
            .iter()
            .map(|pin| (pin.number, pin.initial_level.min(1)))
            .collect();
        let gpio_modes = fixture
            .gpio
            .pins
            .iter()
            .map(|pin| (pin.number, "input".to_string()))
            .collect();

        Self {
            fixture,
            pins,
            pwm_pins,
            state: Mutex::new(SimulatorState {
                gpio_levels,
                gpio_modes,
            }),
        }
    }

    pub fn basic_board() -> Result<Self> {
        Ok(Self::new(SimulatorFixture::basic_board()?))
    }

    fn handle_command(&self, cmd: &[u8]) -> Result<Vec<u8>> {
        let Some(op) = cmd.first().copied() else {
            anyhow::bail!("simulator_empty_command");
        };

        match op {
            OP_VERSION => Ok(vec![
                STATUS_OK,
                self.fixture.board.firmware_version.major,
                self.fixture.board.firmware_version.minor,
            ]),
            OP_RESET => Ok(ok()),
            OP_NAME_GET => Ok(ok_with_text(&self.fixture.board.name)),
            OP_BOARD_GET => Ok(ok_with_text(&self.fixture.board.board_type)),
            OP_GPIO => self.handle_gpio(cmd),
            OP_ADC_READ => self.handle_adc(cmd),
            OP_UART => self.handle_uart(cmd),
            OP_I2C => self.handle_i2c(cmd),
            OP_SPI_XFER => self.handle_spi(cmd),
            OP_PWM => self.handle_pwm(cmd),
            _ => anyhow::bail!("simulator_unsupported_opcode_0x{op:02X}"),
        }
    }

    fn handle_gpio(&self, cmd: &[u8]) -> Result<Vec<u8>> {
        let sub = *cmd.get(1).context("simulator_gpio_missing_subcommand")?;
        let pin = *cmd.get(2).context("simulator_gpio_missing_pin")?;
        self.require_pin(pin)?;

        let mut state = self.state.lock().unwrap();
        match sub {
            GPIO_IN => {
                state.gpio_modes.insert(pin, "input".to_string());
                Ok(ok())
            }
            GPIO_OUT => {
                state.gpio_modes.insert(pin, "output".to_string());
                Ok(ok())
            }
            GPIO_READ => Ok(vec![STATUS_OK, *state.gpio_levels.get(&pin).unwrap_or(&0)]),
            GPIO_HIGH => {
                state.gpio_levels.insert(pin, 1);
                Ok(ok())
            }
            GPIO_LOW => {
                state.gpio_levels.insert(pin, 0);
                Ok(ok())
            }
            GPIO_PULL | GPIO_INFO => Ok(ok()),
            _ => anyhow::bail!("simulator_unsupported_gpio_subcommand_0x{sub:02X}"),
        }
    }

    fn handle_adc(&self, cmd: &[u8]) -> Result<Vec<u8>> {
        let src = *cmd.get(1).context("simulator_adc_missing_source")?;
        let pin = *cmd.get(2).unwrap_or(&0);
        let value = match src {
            ADC_SRC_PIN => {
                self.require_pin(pin)?;
                self.fixture
                    .adc
                    .pin_values
                    .get(&pin.to_string())
                    .copied()
                    .unwrap_or(0)
            }
            ADC_SRC_TEMP => internal_adc_value(&self.fixture, "temp"),
            ADC_SRC_VREFINT => internal_adc_value(&self.fixture, "vrefint"),
            ADC_SRC_VBAT => internal_adc_value(&self.fixture, "vbat"),
            _ => anyhow::bail!("simulator_unsupported_adc_source_0x{src:02X}"),
        };

        Ok(vec![STATUS_OK, (value & 0xff) as u8, (value >> 8) as u8])
    }

    fn handle_uart(&self, cmd: &[u8]) -> Result<Vec<u8>> {
        let sub = *cmd.get(1).context("simulator_uart_missing_subcommand")?;
        match sub {
            UART_OPEN | UART_CLOSE => Ok(ok()),
            UART_WRITE => {
                let written = *cmd.get(8).unwrap_or(&0);
                Ok(vec![STATUS_OK, written])
            }
            UART_READ => {
                let len = *cmd.get(8).unwrap_or(&0) as usize;
                let mut resp = vec![STATUS_OK];
                let read_len = len.min(self.fixture.serial.read_bytes.len()).min(63);
                resp.push(read_len as u8);
                resp.extend_from_slice(&self.fixture.serial.read_bytes[..read_len]);
                Ok(resp)
            }
            _ => anyhow::bail!("simulator_unsupported_uart_subcommand_0x{sub:02X}"),
        }
    }

    fn handle_i2c(&self, cmd: &[u8]) -> Result<Vec<u8>> {
        let sub = *cmd.get(1).context("simulator_i2c_missing_subcommand")?;
        match sub {
            I2C_OPEN | I2C_CLOSE | I2C_WRITE => Ok(ok()),
            I2C_READ | I2C_XFER => {
                let addr = *cmd.get(8).unwrap_or(&0) & 0x7f;
                let len = if sub == I2C_READ {
                    *cmd.get(9).unwrap_or(&0) as usize
                } else {
                    *cmd.get(10).unwrap_or(&0) as usize
                }
                .min(63);
                let mut resp = vec![STATUS_OK];
                resp.extend(repeated_reply(
                    self.fixture
                        .i2c
                        .addresses
                        .get(&addr.to_string())
                        .map(|fixture| fixture.read_bytes.as_slice())
                        .unwrap_or(&[]),
                    self.fixture.i2c.default_read_byte,
                    len,
                ));
                Ok(resp)
            }
            _ => anyhow::bail!("simulator_unsupported_i2c_subcommand_0x{sub:02X}"),
        }
    }

    fn handle_spi(&self, cmd: &[u8]) -> Result<Vec<u8>> {
        let rx_len = (*cmd.get(2).unwrap_or(&0) as usize).min(62);
        let tx_len = (*cmd.get(3).unwrap_or(&0) as usize).min(cmd.len().saturating_sub(4));
        let tx = &cmd[4..4 + tx_len];
        let want = if rx_len > 0 { rx_len } else { tx_len };
        let key = hex_key(tx);
        let configured = self
            .fixture
            .spi
            .transfers
            .get(&key)
            .map(Vec::as_slice)
            .unwrap_or(&[]);

        let mut resp = vec![STATUS_OK];
        if configured.is_empty() && rx_len == 0 {
            resp.extend_from_slice(tx);
        } else {
            resp.extend(repeated_reply(
                configured,
                self.fixture.spi.default_read_byte,
                want,
            ));
        }
        Ok(resp)
    }

    fn handle_pwm(&self, cmd: &[u8]) -> Result<Vec<u8>> {
        let sub = *cmd.get(1).context("simulator_pwm_missing_subcommand")?;
        let pin = *cmd.get(2).context("simulator_pwm_missing_pin")?;
        self.require_pin(pin)?;
        if !self.pwm_pins.contains(&pin) {
            anyhow::bail!("simulator_pin_{pin}_does_not_support_pwm");
        }
        match sub {
            0x00..=0x02 => Ok(ok()),
            _ => anyhow::bail!("simulator_unsupported_pwm_subcommand_0x{sub:02X}"),
        }
    }

    fn require_pin(&self, pin: u8) -> Result<()> {
        if self.pins.contains(&pin) {
            Ok(())
        } else {
            anyhow::bail!("simulator_unknown_pin_{pin}")
        }
    }
}

impl CommandBridge for SimulatorCommandBridge {
    fn send_command(&self, cmd_lane: &[u8], _timeout_ms: u64) -> Result<Option<Vec<u8>>> {
        Ok(Some(self.handle_command(cmd_lane)?))
    }
}

fn ok() -> Vec<u8> {
    vec![STATUS_OK]
}

fn ok_with_text(text: &str) -> Vec<u8> {
    let mut resp = ok();
    resp.extend_from_slice(text.as_bytes());
    resp
}

fn internal_adc_value(fixture: &SimulatorFixture, key: &str) -> u16 {
    fixture.adc.internal_sources.get(key).copied().unwrap_or(0)
}

fn repeated_reply(configured: &[u8], fill: u8, len: usize) -> Vec<u8> {
    (0..len)
        .map(|i| configured.get(i).copied().unwrap_or(fill))
        .collect()
}

fn hex_key(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02X}")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Engine;
    use std::sync::Arc;

    const BOOTSTRAP: &str = include_str!("../../../assets/default-scripts/script_bootstrap.emw");

    #[test]
    fn basic_fixture_parses() {
        let fixture = SimulatorFixture::basic_board().expect("fixture");
        assert_eq!(fixture.board.board_type, "emwaver-sim");
        assert!(fixture.gpio.pins.iter().any(|pin| pin.number == 13));
    }

    #[test]
    fn simulator_runs_hardware_touching_script() {
        let bridge: Arc<dyn CommandBridge> =
            Arc::new(SimulatorCommandBridge::basic_board().expect("simulator"));
        let engine = Engine::new(BOOTSTRAP, bridge).expect("engine");

        engine
            .run_script(
                r#"
                pinMode(13, OUTPUT);
                digitalWrite(13, HIGH);
                var readback = digitalRead(13);
                var adc = analogRead(0);
                analogWrite(13, 512);
                var version = device.version();
                var board = device.boardType({ refresh: true });
                var spi = SPI.transfer([0x9f], { rxLength: 3 });
                Wire.begin();
                var i2c = Wire.read(0x40, 2);
                Serial.begin(115200);
                var serial = Serial.read(2);
                UI.render(UI.column({ children: [
                  UI.text({ text: board + " " + version }),
                  UI.text({ text: String(readback) + ":" + String(adc) + ":" + String(spi[0]) + ":" + String(i2c[0]) + ":" + String(serial[0]) })
                ] }));
                "#,
            )
            .expect("script");

        let tree = engine.latest_tree.lock().unwrap().clone().expect("tree");
        assert_eq!(tree.node_type, "column");
        assert_eq!(tree.children.len(), 2);
        assert_eq!(
            tree.children[0]
                .props
                .get("text")
                .and_then(serde_json::Value::as_str),
            Some("emwaver-sim 1.0")
        );
    }

    #[test]
    fn simulator_rejects_unknown_pins() {
        let bridge: Arc<dyn CommandBridge> =
            Arc::new(SimulatorCommandBridge::basic_board().expect("simulator"));
        let engine = Engine::new(BOOTSTRAP, bridge).expect("engine");

        let err = engine
            .run_script("pinMode(99, OUTPUT);")
            .expect_err("unknown pin");
        assert!(format!("{err:#}").contains("Device error: 129"));
    }
}
