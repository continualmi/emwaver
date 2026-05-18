'use strict';

var protocol = require('emw-protocol');

function timeoutOf(opts, fallback) {
  return opts && typeof opts.timeout === 'number' ? opts.timeout | 0 : fallback;
}

var i2c = {
  open: function (opts) {
    opts = opts || {};
    var hz = typeof opts.hz === 'number' ? opts.hz : (typeof opts.frequency === 'number' ? opts.frequency : 100000);
    i2c.begin(hz, opts);
    return {
      scl: opts.scl,
      sda: opts.sda,
      write: function (addr, bytes, writeOpts) { return i2c.write(addr, bytes, writeOpts || opts); },
      read: function (addr, length, readOpts) { return i2c.read(addr, length, readOpts || opts); },
      xfer: function (addr, tx, rxLength, xferOpts) { return i2c.xfer(addr, tx, rxLength, xferOpts || opts); },
      close: function (closeOpts) { return i2c.end(closeOpts); }
    };
  },
  begin: function (hz, opts) {
    var timeout = timeoutOf(opts, 1500);
    var pkt = new Uint8Array(6);
    pkt[0] = protocol.op.i2c;
    pkt[1] = protocol.i2c.open;
    protocol.writeU32LE(pkt, 2, typeof hz === 'number' ? hz | 0 : 100000);
    return protocol.sendCommand(pkt, timeout);
  },
  end: function (opts) {
    return protocol.sendCommand(new Uint8Array([protocol.op.i2c, protocol.i2c.close]), timeoutOf(opts, 1500));
  },
  write: function (addr, data, opts) {
    var timeout = timeoutOf(opts, 250);
    var tx = data instanceof Uint8Array ? data : new Uint8Array(data || []);
    var txLen = Math.min(tx.length, 52);
    var pkt = new Uint8Array(11 + txLen);
    pkt[0] = protocol.op.i2c;
    pkt[1] = protocol.i2c.write;
    protocol.writeU32LE(pkt, 2, opts && typeof opts.hz === 'number' ? opts.hz | 0 : 0);
    protocol.writeU16LE(pkt, 6, timeout);
    pkt[8] = (Number(addr) | 0) & 0x7f;
    pkt[9] = txLen & 0xff;
    pkt[10] = 0;
    for (var i = 0; i < txLen; i += 1) pkt[11 + i] = tx[i] & 0xff;
    return protocol.sendCommand(pkt, timeout);
  },
  read: function (addr, length, opts) {
    var timeout = timeoutOf(opts, 250);
    var len = Math.max(0, Math.min(Number(length) | 0, 63));
    var pkt = new Uint8Array(11);
    pkt[0] = protocol.op.i2c;
    pkt[1] = protocol.i2c.read;
    protocol.writeU32LE(pkt, 2, opts && typeof opts.hz === 'number' ? opts.hz | 0 : 0);
    protocol.writeU16LE(pkt, 6, timeout);
    pkt[8] = (Number(addr) | 0) & 0x7f;
    pkt[9] = len & 0xff;
    pkt[10] = 0;
    return protocol.sendCommand(pkt, timeout).slice(1, 1 + len);
  },
  xfer: function (addr, tx, rxLength, opts) {
    var timeout = timeoutOf(opts, 250);
    var len = Math.max(0, Math.min(Number(rxLength) | 0, 62));
    var txBytes = tx instanceof Uint8Array ? tx : new Uint8Array(tx || []);
    var txLen = Math.min(txBytes.length, 51);
    var pkt = new Uint8Array(11 + txLen);
    pkt[0] = protocol.op.i2c;
    pkt[1] = protocol.i2c.xfer;
    protocol.writeU32LE(pkt, 2, opts && typeof opts.hz === 'number' ? opts.hz | 0 : 0);
    protocol.writeU16LE(pkt, 6, timeout);
    pkt[8] = (Number(addr) | 0) & 0x7f;
    pkt[9] = txLen & 0xff;
    pkt[10] = len & 0xff;
    for (var i = 0; i < txLen; i += 1) pkt[11 + i] = txBytes[i] & 0xff;
    return protocol.sendCommand(pkt, timeout).slice(1, 1 + len);
  }
};

module.exports = { i2c: i2c };
