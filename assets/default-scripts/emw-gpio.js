'use strict';

var protocol = require('emw-protocol');

function encodePin(value) {
  if (typeof value === 'number') return value & 0xff;
  if (!value || typeof value !== 'object') {
    throw new Error('pin requires { port, number } or { gpio }');
  }

  if (typeof value.gpio === 'number') {
    return value.gpio & 0xff;
  }

  var port = String(value.port || '').trim().toUpperCase();
  var number = Number(value.number);
  if (!isFinite(number) || number < 0) {
    throw new Error('pin number must be a non-negative number');
  }
  if (port === 'A') return number & 0xff;
  if (port === 'B') return (16 + number) & 0xff;
  if (port === 'C') return (32 + number) & 0xff;
  if (port === 'D') return (48 + number) & 0xff;
  throw new Error('unsupported pin port: ' + port);
}

function pin(value) {
  return {
    kind: 'pin',
    value: encodePin(value),
    descriptor: value
  };
}

function pinValue(value) {
  if (value && typeof value === 'object' && value.kind === 'pin') {
    return value.value & 0xff;
  }
  return encodePin(value);
}

var gpio = {
  mode: function (target, mode) {
    var normalized = String(mode || '').trim().toLowerCase();
    if (normalized === 'input') {
      return protocol.sendCommand(new Uint8Array([protocol.op.gpio, protocol.gpio.input, pinValue(target) & 0xff]), 1500);
    }
    if (normalized === 'output') {
      return protocol.sendCommand(new Uint8Array([protocol.op.gpio, protocol.gpio.output, pinValue(target) & 0xff]), 1500);
    }
    throw new Error('unsupported GPIO mode: ' + String(mode));
  },
  write: function (target, value) {
    var level = Number(value) ? protocol.gpio.high : protocol.gpio.low;
    return protocol.sendCommand(new Uint8Array([protocol.op.gpio, level, pinValue(target) & 0xff]), 1500);
  },
  read: function (target) {
    var resp = protocol.sendCommand(new Uint8Array([protocol.op.gpio, protocol.gpio.read, pinValue(target) & 0xff]), 1500);
    return resp && resp.length > 1 ? (resp[1] ? 1 : 0) : 0;
  },
  value: pinValue
};

module.exports = {
  pin: pin,
  gpio: gpio
};
