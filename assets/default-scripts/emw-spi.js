'use strict';

var gpioLib = require('emw-gpio');
var protocol = require('emw-protocol');

function normalizeOptions(opts) {
  opts = opts || {};
  var out = {};
  if (opts.cs !== undefined) out.cs = gpioLib.gpio.value(opts.cs);
  if (typeof opts.rxLength === 'number') out.rxLength = opts.rxLength;
  return out;
}

var spi = {
  open: function (opts) {
    opts = opts || {};
    return {
      sck: opts.sck,
      miso: opts.miso,
      mosi: opts.mosi,
      cs: opts.cs,
      transfer: function (bytes, transferOpts) {
        var merged = Object.assign({}, opts, transferOpts || {});
        return spi.transfer(bytes, merged);
      }
    };
  },
  transfer: function (bytes, opts) {
    var normalized = normalizeOptions(opts);
    var cs = typeof normalized.cs === 'number' ? (normalized.cs & 0xff) : 4;
    var rxLen = typeof normalized.rxLength === 'number' ? (normalized.rxLength | 0) : 0;
    if (rxLen < 0) rxLen = 0;
    if (rxLen > 62) rxLen = 62;

    var tx = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
    var txLen = tx.length;
    if (txLen > 60) txLen = 60;

    var pkt = new Uint8Array(4 + txLen);
    pkt[0] = protocol.op.spiTransfer;
    pkt[1] = cs;
    pkt[2] = rxLen & 0xff;
    pkt[3] = txLen & 0xff;
    for (var i = 0; i < txLen; i += 1) {
      pkt[4 + i] = tx[i] & 0xff;
    }

    var resp = protocol.sendCommand(pkt, 1500);
    var want = rxLen > 0 ? rxLen : txLen;
    return resp.slice(1, 1 + want);
  }
};

module.exports = { spi: spi };
