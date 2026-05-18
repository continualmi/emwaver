'use strict';

var uart = {
  open: function (opts) {
    opts = opts || {};
    var baud = opts.baud || 115200;
    Serial.begin(baud, opts);
    return {
      tx: opts.tx,
      rx: opts.rx,
      write: function (data, writeOpts) { return Serial.write(data, Object.assign({ baud: baud }, writeOpts || {})); },
      read: function (length, readOpts) { return Serial.read(length, Object.assign({ baud: baud }, readOpts || {})); },
      close: function (closeOpts) { return Serial.end(closeOpts); }
    };
  },
  begin: function (baud, opts) { return Serial.begin(baud, opts); },
  end: function (opts) { return Serial.end(opts); },
  write: function (data, opts) { return Serial.write(data, opts); },
  read: function (length, opts) { return Serial.read(length, opts); }
};

module.exports = { uart: uart };
