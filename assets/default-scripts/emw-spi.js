'use strict';

var gpioLib = require('emw-gpio');

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
        return SPI.transfer(bytes, normalizeOptions(merged));
      }
    };
  },
  transfer: function (bytes, opts) {
    return SPI.transfer(bytes, normalizeOptions(opts));
  }
};

module.exports = { spi: spi };
