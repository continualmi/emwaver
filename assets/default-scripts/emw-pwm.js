'use strict';

var gpioLib = require('emw-gpio');
var protocol = require('emw-protocol');

var writeBits = 12;

function scale(value) {
  var v = Math.max(0, Number(value) | 0);
  var max = writeBits >= 31 ? 0x7fffffff : (1 << writeBits) - 1;
  if (v > max) v = max;
  if (writeBits === 12) return v;
  if (writeBits > 12) return v >> (writeBits - 12);
  return v << (12 - writeBits);
}

var pwm = {
  write: function (target, value, opts) {
    var options = opts || {};
    var pkt = new Uint8Array(9);
    pkt[0] = protocol.op.pwm;
    pkt[1] = protocol.pwm.write;
    pkt[2] = gpioLib.gpio.value(target) & 0xff;
    protocol.writeU16LE(pkt, 3, scale(value));
    protocol.writeU32LE(pkt, 5, typeof options.hz === 'number' ? options.hz | 0 : 0);
    return protocol.sendCommand(pkt, typeof options.timeout === 'number' ? options.timeout | 0 : 1500);
  },
  resolution: function (bits) {
    var n = Number(bits);
    if (!isFinite(n) || n < 1 || n > 16) {
      throw new Error('pwm.resolution: invalid bits ' + String(bits));
    }
    writeBits = n | 0;
  }
};

module.exports = { pwm: pwm };
