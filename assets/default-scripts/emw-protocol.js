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
  }
};
