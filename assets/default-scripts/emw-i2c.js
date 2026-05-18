'use strict';

var i2c = {
  open: function (opts) {
    opts = opts || {};
    if (opts.hz || opts.frequency) Wire.begin(opts.hz || opts.frequency);
    return {
      scl: opts.scl,
      sda: opts.sda,
      write: function (addr, bytes, writeOpts) { return Wire.write(addr, bytes, writeOpts || opts); },
      read: function (addr, length, readOpts) { return Wire.read(addr, length, readOpts || opts); },
      xfer: function (addr, tx, rxLength, xferOpts) { return Wire.xfer(addr, tx, rxLength, xferOpts || opts); },
      close: function () { return Wire.end(); }
    };
  },
  begin: function (hz, opts) { return Wire.begin(hz, opts); },
  end: function (opts) { return Wire.end(opts); },
  write: function (addr, bytes, opts) { return Wire.write(addr, bytes, opts); },
  read: function (addr, length, opts) { return Wire.read(addr, length, opts); },
  xfer: function (addr, tx, rxLength, opts) { return Wire.xfer(addr, tx, rxLength, opts); }
};

module.exports = { i2c: i2c };
