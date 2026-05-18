'use strict';

var gpioLib = require('emw-gpio');
var protocol = require('emw-protocol');

var readBits = 12;

function u16(bytes) {
  if (!bytes || bytes.length < 2) return 0;
  return ((bytes[1] & 0xff) << 8) | (bytes[0] & 0xff);
}

function scale(value12) {
  if (readBits === 12) return value12;
  if (readBits > 12) return value12 << (readBits - 12);
  return value12 >> (12 - readBits);
}

function readSource(source, pinNumber, opts) {
  var samples = opts && typeof opts.samples === 'number' ? opts.samples | 0 : 1;
  samples = Math.max(1, Math.min(samples, 64));
  var resp = protocol.sendCommand(new Uint8Array([protocol.op.adcRead, source & 0xff, pinNumber & 0xff, samples & 0xff]), 1500);
  return scale(u16(protocol.payload(resp)));
}

var adc = {
  read: function (target, opts) {
    return readSource(protocol.adc.pin, gpioLib.gpio.value(target), opts);
  },
  resolution: function (bits) {
    var n = Number(bits);
    if (!isFinite(n) || n < 1 || n > 16) {
      throw new Error('adc.resolution: invalid bits ' + String(bits));
    }
    readBits = n | 0;
  },
  vrefint: function (opts) {
    return readSource(protocol.adc.vrefint, 0, opts);
  },
  temp: function (opts) {
    return readSource(protocol.adc.temp, 0, opts);
  },
  vbat: function (opts) {
    return readSource(protocol.adc.vbat, 0, opts);
  }
};

module.exports = { adc: adc };
