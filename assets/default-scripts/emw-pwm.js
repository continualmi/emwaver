'use strict';

var gpioLib = require('emw-gpio');

var pwm = {
  write: function (target, value, opts) {
    return analogWrite(gpioLib.gpio.value(target), value, opts);
  },
  resolution: function (bits) {
    return analogWriteResolution(bits);
  }
};

module.exports = { pwm: pwm };
