'use strict';

var gpioLib = require('emw-gpio');

var adc = {
  read: function (target, opts) {
    return analogRead(gpioLib.gpio.value(target), opts);
  },
  resolution: function (bits) {
    return analogReadResolution(bits);
  },
  vrefint: function (opts) {
    return analogReadVrefint(opts);
  },
  temp: function (opts) {
    return analogReadTemp(opts);
  },
  vbat: function (opts) {
    return analogReadVbat(opts);
  }
};

module.exports = { adc: adc };
