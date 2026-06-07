'use strict';

var protocol = require('emw-protocol');

function timeoutOf(opts, fallback) {
  return opts && typeof opts.timeout === 'number' ? opts.timeout | 0 : fallback;
}

function asciiBytes(text) {
  var s = String(text);
  var out = new Uint8Array(s.length);
  for (var i = 0; i < s.length; i += 1) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}

var uart = {
  open: function (opts) {
    opts = opts || {};
    var baud = opts.baud || 115200;
    uart.begin(baud, opts);
    return {
      tx: opts.tx,
      rx: opts.rx,
      write: function (data, writeOpts) { return uart.write(data, Object.assign({ baud: baud }, writeOpts || {})); },
      read: function (length, readOpts) { return uart.read(length, Object.assign({ baud: baud }, readOpts || {})); },
      close: function (closeOpts) { return uart.end(closeOpts); }
    };
  },
  begin: function (baud, opts) {
    var pkt = new Uint8Array(6);
    pkt[0] = protocol.op.uart;
    pkt[1] = protocol.uart.open;
    protocol.writeU32LE(pkt, 2, typeof baud === 'number' ? baud | 0 : 115200);
    return protocol.sendCommand(pkt, timeoutOf(opts, 1500));
  },
  end: function (opts) {
    return protocol.sendCommand(new Uint8Array([protocol.op.uart, protocol.uart.close]), timeoutOf(opts, 1500));
  },
  write: function (data, opts) {
    var timeout = timeoutOf(opts, 1500);
    var tx = typeof data === 'string' ? asciiBytes(data) : (data instanceof Uint8Array ? data : new Uint8Array(data || []));
    var txLen = Math.min(tx.length, 54);
    var pkt = new Uint8Array(9 + txLen);
    pkt[0] = protocol.op.uart;
    pkt[1] = protocol.uart.write;
    protocol.writeU32LE(pkt, 2, opts && typeof opts.baud === 'number' ? opts.baud | 0 : 0);
    protocol.writeU16LE(pkt, 6, timeout);
    pkt[8] = txLen & 0xff;
    for (var i = 0; i < txLen; i += 1) pkt[9 + i] = tx[i] & 0xff;
    return protocol.sendCommand(pkt, timeout).slice(1, 2);
  },
  read: function (length, opts) {
    var timeout = timeoutOf(opts, 250);
    var len = Math.max(0, Math.min(Number(length) | 0, 63));
    var pkt = new Uint8Array(9);
    pkt[0] = protocol.op.uart;
    pkt[1] = protocol.uart.read;
    protocol.writeU32LE(pkt, 2, opts && typeof opts.baud === 'number' ? opts.baud | 0 : 0);
    protocol.writeU16LE(pkt, 6, timeout);
    pkt[8] = len & 0xff;
    var resp = protocol.sendCommand(pkt, timeout);
    var got = resp && resp.length > 1 ? (resp[1] & 0xff) : 0;
    return resp.slice(2, 2 + got);
  }
};

module.exports = { uart: uart };
