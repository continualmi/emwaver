'use strict';

function payload(response) {
  return __emwPayload(response);
}

function assertOk(response) {
  return __emwAssertOk(response);
}

function sendCommand(packet, timeoutMs) {
  return __emwSendPacket(packet, timeoutMs || 1500);
}

function writeU16LE(out, offset, value) {
  return __emwWriteU16LE(out, offset, value);
}

function writeU32LE(out, offset, value) {
  return __emwWriteU32LE(out, offset, value);
}

module.exports = {
  payload: payload,
  assertOk: assertOk,
  sendCommand: sendCommand,
  writeU16LE: writeU16LE,
  writeU32LE: writeU32LE,
  op: {
    gpio: EMW_OP_GPIO,
    adcRead: EMW_OP_ADC_READ,
    uart: EMW_OP_UART,
    i2c: EMW_OP_I2C,
    spiTransfer: EMW_OP_SPI_XFER,
    sample: EMW_OP_SAMPLE,
    pwm: EMW_OP_PWM,
    transmit: EMW_OP_TRANSMIT
  },
  gpio: {
    input: EMW_GPIO_IN,
    output: EMW_GPIO_OUT,
    read: EMW_GPIO_READ,
    high: EMW_GPIO_HIGH,
    low: EMW_GPIO_LOW
  },
  adc: {
    pin: EMW_ADC_SRC_PIN,
    temp: EMW_ADC_SRC_TEMP,
    vrefint: EMW_ADC_SRC_VREFINT,
    vbat: EMW_ADC_SRC_VBAT
  },
  uart: {
    open: EMW_UART_OPEN,
    close: EMW_UART_CLOSE,
    write: EMW_UART_WRITE,
    read: EMW_UART_READ
  },
  i2c: {
    open: EMW_I2C_OPEN,
    close: EMW_I2C_CLOSE,
    write: EMW_I2C_WRITE,
    read: EMW_I2C_READ,
    xfer: EMW_I2C_XFER
  },
  pwm: {
    write: EMW_PWM_WRITE
  }
};
