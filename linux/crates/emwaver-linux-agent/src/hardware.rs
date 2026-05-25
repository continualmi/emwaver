use thiserror::Error;

const EMW_OP_GPIO: u8 = 0x10;
const EMW_GPIO_IN: u8 = 0x00;
const EMW_GPIO_OUT: u8 = 0x01;
const EMW_GPIO_READ: u8 = 0x02;
const EMW_GPIO_HIGH: u8 = 0x03;
const EMW_GPIO_LOW: u8 = 0x04;
const EMW_GPIO_PULL: u8 = 0x05;

const EMW_OP_ADC_READ: u8 = 0x20;
const EMW_ADC_SRC_PIN: u8 = 0x00;

const EMW_OP_SPI_XFER: u8 = 0x50;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum GpioMode {
    Input,
    Output,
    InputPullup,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum GpioLevel {
    Low,
    High,
}

#[derive(Debug, Error, Eq, PartialEq)]
pub enum AgentHardwareCommandError {
    #[error("{name} must be 0-255")]
    ByteOutOfRange { name: &'static str },
    #[error("SPI transfer is too long ({actual} bytes, max {max})")]
    SpiTransferTooLong { actual: usize, max: usize },
    #[error("SPI rx_length is too large ({actual}, max {max})")]
    SpiRxTooLong { actual: usize, max: usize },
    #[error("payload is too short for {tool}")]
    ShortPayload { tool: &'static str },
}

pub fn gpio_mode_command(pin: u16, mode: GpioMode) -> Result<Vec<u8>, AgentHardwareCommandError> {
    let pin = byte_arg(pin, "pin")?;
    let mut command = match mode {
        GpioMode::Input => vec![EMW_OP_GPIO, EMW_GPIO_IN, pin],
        GpioMode::Output => vec![EMW_OP_GPIO, EMW_GPIO_OUT, pin],
        GpioMode::InputPullup => vec![EMW_OP_GPIO, EMW_GPIO_PULL, pin],
    };
    if mode == GpioMode::InputPullup {
        command.push(1);
    }
    Ok(command)
}

pub fn gpio_write_command(
    pin: u16,
    level: GpioLevel,
) -> Result<Vec<u8>, AgentHardwareCommandError> {
    let pin = byte_arg(pin, "pin")?;
    let subcommand = match level {
        GpioLevel::Low => EMW_GPIO_LOW,
        GpioLevel::High => EMW_GPIO_HIGH,
    };
    Ok(vec![EMW_OP_GPIO, subcommand, pin])
}

pub fn gpio_read_command(pin: u16) -> Result<Vec<u8>, AgentHardwareCommandError> {
    Ok(vec![EMW_OP_GPIO, EMW_GPIO_READ, byte_arg(pin, "pin")?])
}

pub fn analog_read_command(pin: u16) -> Result<Vec<u8>, AgentHardwareCommandError> {
    Ok(vec![
        EMW_OP_ADC_READ,
        EMW_ADC_SRC_PIN,
        byte_arg(pin, "pin")?,
        1,
    ])
}

pub fn spi_transfer_command(
    cs_pin: u16,
    tx: &[u8],
    rx_length: usize,
    max_packet_bytes: usize,
) -> Result<Vec<u8>, AgentHardwareCommandError> {
    let cs_pin = byte_arg(cs_pin, "cs")?;
    let max_tx = max_packet_bytes.saturating_sub(4);
    if tx.len() > max_tx {
        return Err(AgentHardwareCommandError::SpiTransferTooLong {
            actual: tx.len(),
            max: max_tx,
        });
    }
    let max_rx = max_packet_bytes.saturating_sub(1);
    if rx_length > max_rx {
        return Err(AgentHardwareCommandError::SpiRxTooLong {
            actual: rx_length,
            max: max_rx,
        });
    }

    let mut command = vec![EMW_OP_SPI_XFER, cs_pin, rx_length as u8, tx.len() as u8];
    command.extend_from_slice(tx);
    Ok(command)
}

pub fn parse_gpio_read_payload(payload: &[u8]) -> Result<GpioLevel, AgentHardwareCommandError> {
    let Some(level) = payload.first() else {
        return Err(AgentHardwareCommandError::ShortPayload { tool: "gpio_read" });
    };
    Ok(if *level == 0 {
        GpioLevel::Low
    } else {
        GpioLevel::High
    })
}

pub fn parse_analog_read_payload(payload: &[u8]) -> Result<u16, AgentHardwareCommandError> {
    if payload.len() < 2 {
        return Err(AgentHardwareCommandError::ShortPayload {
            tool: "analog_read",
        });
    }
    Ok(u16::from_le_bytes([payload[0], payload[1]]))
}

pub fn parse_spi_transfer_payload(payload: &[u8], rx_length: usize) -> Vec<u8> {
    payload.iter().copied().take(rx_length).collect()
}

fn byte_arg(value: u16, name: &'static str) -> Result<u8, AgentHardwareCommandError> {
    u8::try_from(value).map_err(|_| AgentHardwareCommandError::ByteOutOfRange { name })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_gpio_commands_matching_native_protocol() {
        assert_eq!(
            gpio_mode_command(13, GpioMode::Input).unwrap(),
            vec![0x10, 0x00, 13]
        );
        assert_eq!(
            gpio_mode_command(13, GpioMode::Output).unwrap(),
            vec![0x10, 0x01, 13]
        );
        assert_eq!(
            gpio_mode_command(13, GpioMode::InputPullup).unwrap(),
            vec![0x10, 0x05, 13, 1]
        );
        assert_eq!(
            gpio_write_command(13, GpioLevel::High).unwrap(),
            vec![0x10, 0x03, 13]
        );
        assert_eq!(
            gpio_write_command(13, GpioLevel::Low).unwrap(),
            vec![0x10, 0x04, 13]
        );
        assert_eq!(gpio_read_command(13).unwrap(), vec![0x10, 0x02, 13]);
    }

    #[test]
    fn builds_analog_and_spi_commands_matching_native_protocol() {
        assert_eq!(analog_read_command(2).unwrap(), vec![0x20, 0x00, 2, 1]);
        assert_eq!(
            spi_transfer_command(4, &[0x80, 0x00], 2, 18).unwrap(),
            vec![0x50, 4, 2, 2, 0x80, 0x00]
        );
    }

    #[test]
    fn rejects_oversized_agent_tool_arguments() {
        assert_eq!(
            gpio_read_command(300),
            Err(AgentHardwareCommandError::ByteOutOfRange { name: "pin" })
        );
        assert_eq!(
            spi_transfer_command(4, &[0; 15], 1, 18),
            Err(AgentHardwareCommandError::SpiTransferTooLong {
                actual: 15,
                max: 14
            })
        );
        assert_eq!(
            spi_transfer_command(4, &[0; 2], 18, 18),
            Err(AgentHardwareCommandError::SpiRxTooLong {
                actual: 18,
                max: 17
            })
        );
    }

    #[test]
    fn parses_hardware_tool_payloads() {
        assert_eq!(parse_gpio_read_payload(&[0]).unwrap(), GpioLevel::Low);
        assert_eq!(parse_gpio_read_payload(&[7]).unwrap(), GpioLevel::High);
        assert_eq!(parse_analog_read_payload(&[0x34, 0x12]).unwrap(), 0x1234);
        assert_eq!(parse_spi_transfer_payload(&[1, 2, 3], 2), vec![1, 2]);
    }
}
