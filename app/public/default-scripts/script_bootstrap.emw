'use strict';

// Canonical Script bootstrap/runtime.
// This file is intended to be the single source of truth for the JS-side Script API surface.
//
// Hosts must provide (at minimum) these bridge functions:
// - _scriptPrint(message: string): void
// - _scriptRender(node: object): void
// - _scriptRegisterCallback(token: string, fn: Function): void
// - _scriptImportModule(name: string): any
// - _scriptShowDialog(title: string, message: string): void
// - _scriptCreateByteArray(jsArray: any): any
//
// Hosts may optionally provide:
// - _scriptSendCommandString(command: string, timeoutMs: number): any
// - _scriptSendPacket(bytes: any, timeoutMs: number): any
// - _scriptWrite(bytes: any): void
// - _scriptConnectionStatus(): string
// - _scriptListSignals(): string[]
// - _scriptReadSignal(name: string): any

var __scriptGlobal = (function () {
  try {
    return Function('return this')();
  } catch (e) {
    return {};
  }
})();

var ScriptBridge = typeof ScriptBridge !== 'undefined' ? ScriptBridge : {
  render: function (node) {
    _scriptRender(node);
  },
  registerCallback: function (token, fn) {
    if (typeof fn === 'function') {
      _scriptRegisterCallback(token, fn);
    }
  },
  log: function (message) {
    _scriptPrint(String(message));
  },
};

function _scriptJoinArgs(args) {
  var parts = [];
  for (var i = 0; i < args.length; i += 1) {
    var arg = args[i];
    if (typeof arg === 'string') {
      parts.push(arg);
    } else {
      try {
        parts.push(JSON.stringify(arg));
      } catch (e) {
        parts.push(String(arg));
      }
    }
  }
  return parts.join(' ');
}

if (typeof print === 'undefined') {
  var print = function () {
    ScriptBridge.log(_scriptJoinArgs(arguments));
  };
}

if (typeof console === 'undefined') {
  var console = {};
}
if (typeof console.log !== 'function') {
  console.log = function () {
    print.apply(null, arguments);
  };
}
if (typeof console.warn !== 'function') {
  console.warn = function () {
    print.apply(null, arguments);
  };
}
if (typeof console.error !== 'function') {
  console.error = function () {
    print.apply(null, arguments);
  };
}

if (typeof dialog === 'undefined') {
  var dialog = function (title, message) {
    if (typeof _scriptShowDialog !== 'function') {
      throw new Error('dialog unavailable (missing _scriptShowDialog)');
    }
    _scriptShowDialog(String(title || ''), String(message || ''));
  };
}

if (typeof createByteArray === 'undefined') {
  var createByteArray = function (jsArray) {
    if (typeof _scriptCreateByteArray !== 'function') {
      throw new Error('createByteArray unavailable (missing _scriptCreateByteArray)');
    }
    return _scriptCreateByteArray(jsArray);
  };
}

if (typeof ScriptModules === 'undefined') {
  var ScriptModules = (function () {
    var cache = {};
    var normalize = function (name) {
      return String(name || '').trim();
    };
    return {
      import: function (name) {
        if (typeof _scriptImportModule !== 'function') {
          throw new Error('Module loader unavailable (missing _scriptImportModule)');
        }
        var key = normalize(name);
        if (!key) {
          throw new Error('Module name is required');
        }
        if (!Object.prototype.hasOwnProperty.call(cache, key)) {
          cache[key] = _scriptImportModule(key);
        }
        return cache[key];
      },
      clear: function () {
        cache = {};
      },
    };
  })();
}

if (typeof require !== 'function') {
  var require = function (name) {
    return ScriptModules.import(name);
  };
}

function __scriptIsShim(obj) {
  return !!obj && obj.__scriptShim === true;
}

var __scriptHostDeviceConnection =
  typeof DeviceConnection !== 'undefined' && !__scriptIsShim(DeviceConnection) ? DeviceConnection : null;
var __scriptHostUtils = typeof Utils !== 'undefined' && !__scriptIsShim(Utils) ? Utils : null;
var __scriptHostSamplerSignals =
  typeof SamplerSignals !== 'undefined' && !__scriptIsShim(SamplerSignals) ? SamplerSignals : null;

var DeviceConnection = {};
DeviceConnection.__scriptShim = true;
DeviceConnection.sendCommandString = function (command, timeoutMs) {
  var timeout = typeof timeoutMs === 'number' ? timeoutMs : 2000;
  var framed = String(command || '');
  if (framed.length > 0 && !/\n$/.test(framed)) {
    framed += '\n';
  }

  if (__scriptHostDeviceConnection && typeof __scriptHostDeviceConnection.sendCommandString === 'function') {
    return __scriptHostDeviceConnection.sendCommandString.call(__scriptHostDeviceConnection, framed, timeout);
  }

  if (typeof _scriptSendCommandString === 'function') {
    return _scriptSendCommandString(framed, timeout);
  }

  throw new Error('DeviceConnection.sendCommandString unavailable on this host');
};

DeviceConnection.sendPacket = function (bytes, timeoutMs) {
  var timeout = typeof timeoutMs === 'number' ? timeoutMs : 2000;

  if (__scriptHostDeviceConnection) {
    if (typeof __scriptHostDeviceConnection.sendPacket === 'function') {
      return __scriptHostDeviceConnection.sendPacket.call(__scriptHostDeviceConnection, bytes, timeout);
    }
    if (typeof __scriptHostDeviceConnection.sendCommand === 'function') {
      return __scriptHostDeviceConnection.sendCommand.call(__scriptHostDeviceConnection, bytes, timeout);
    }
  }

  if (typeof _scriptSendPacket === 'function') {
    return _scriptSendPacket(bytes, timeout);
  }

  // iOS host compatibility: some surfaces expose only `_manualSendCommand` which accepts (bytes, timeoutMs).
  if (typeof _manualSendCommand === 'function') {
    return _manualSendCommand(bytes, timeout);
  }

  throw new Error('DeviceConnection.sendPacket unavailable on this host');
};

DeviceConnection.write = function (bytes) {
  if (__scriptHostDeviceConnection && typeof __scriptHostDeviceConnection.write === 'function') {
    return __scriptHostDeviceConnection.write.call(__scriptHostDeviceConnection, bytes);
  }
  if (typeof _scriptWrite === 'function') {
    return _scriptWrite(bytes);
  }
};

DeviceConnection.connectionStatus = function () {
  if (__scriptHostDeviceConnection && typeof __scriptHostDeviceConnection.connectionStatus === 'function') {
    return String(__scriptHostDeviceConnection.connectionStatus.call(__scriptHostDeviceConnection));
  }
  if (typeof _scriptConnectionStatus === 'function') {
    return String(_scriptConnectionStatus());
  }
  return 'unknown';
};

var Utils = {};
Utils.__scriptShim = true;
Utils.delay = function (ms) {
  if (__scriptHostUtils && typeof __scriptHostUtils.delay === 'function') {
    return __scriptHostUtils.delay.call(__scriptHostUtils, ms);
  }
  var durationMs = Math.max(0, Number(ms) || 0);
  var start = Date.now();
  while (Date.now() - start < durationMs) {
    // busy-wait for parity with mobile hosts
  }
};

Utils.sleep = function (ms) {
  if (__scriptHostUtils && typeof __scriptHostUtils.sleep === 'function') {
    return __scriptHostUtils.sleep.call(__scriptHostUtils, ms);
  }
  return Utils.delay(ms);
};

var SamplerSignals = {};
SamplerSignals.__scriptShim = true;
SamplerSignals.listSignals = function () {
  if (__scriptHostSamplerSignals && typeof __scriptHostSamplerSignals.listSignals === 'function') {
    return __scriptHostSamplerSignals.listSignals.call(__scriptHostSamplerSignals) || [];
  }
  if (typeof _scriptListSignals === 'function') {
    return _scriptListSignals() || [];
  }
  return [];
};

SamplerSignals.listSignalsCsv = function () {
  if (__scriptHostSamplerSignals && typeof __scriptHostSamplerSignals.listSignalsCsv === 'function') {
    return String(__scriptHostSamplerSignals.listSignalsCsv.call(__scriptHostSamplerSignals) || '');
  }
  var names = SamplerSignals.listSignals();
  return (names || []).join('\n');
};

SamplerSignals.readSignal = function (name) {
  if (__scriptHostSamplerSignals && typeof __scriptHostSamplerSignals.readSignal === 'function') {
    return __scriptHostSamplerSignals.readSignal.call(__scriptHostSamplerSignals, String(name || ''));
  }
  if (typeof _scriptReadSignal === 'function') {
    return _scriptReadSignal(String(name || ''));
  }
  return null;
};

__scriptGlobal.DeviceConnection = DeviceConnection;
__scriptGlobal.Utils = Utils;
__scriptGlobal.SamplerSignals = SamplerSignals;

var emw = typeof emw !== 'undefined' ? emw : {};
if (typeof emw.send !== 'function') {
  emw.send = function (command, timeoutMs) {
    return DeviceConnection.sendCommandString(command, timeoutMs);
  };
}
if (typeof emw.sendPacket !== 'function') {
  emw.sendPacket = function (bytes, timeoutMs) {
    return DeviceConnection.sendPacket(bytes, timeoutMs);
  };
}
__scriptGlobal.emw = emw;

// -----------------------------------------------------------------------------
// Arduino-ish API surface (GPIO + SPI), implemented as thin wrappers over the
// canonical, observable ASCII command protocol (e.g. `gpio ...`, `spi xfer ...`).
// -----------------------------------------------------------------------------

if (typeof LOW === 'undefined') {
  var LOW = 0;
  __scriptGlobal.LOW = LOW;
}
if (typeof HIGH === 'undefined') {
  var HIGH = 1;
  __scriptGlobal.HIGH = HIGH;
}

if (typeof INPUT === 'undefined') {
  var INPUT = 'INPUT';
  __scriptGlobal.INPUT = INPUT;
}
if (typeof OUTPUT === 'undefined') {
  var OUTPUT = 'OUTPUT';
  __scriptGlobal.OUTPUT = OUTPUT;
}

// Logical board pins (avoid leaking MCU pin names into scripts).
var __scriptBoardPins = __scriptGlobal.__scriptBoardPins || {
  CC1101_CS: 4,
  GDO0: 2,
};
__scriptGlobal.__scriptBoardPins = __scriptBoardPins;

function __scriptResolvePin(pin) {
  if (typeof pin === 'number') return pin;
  var key = String(pin || '').trim();
  if (Object.prototype.hasOwnProperty.call(__scriptBoardPins, key)) {
    return __scriptBoardPins[key];
  }
  var n = Number(key);
  if (isFinite(n)) return n;
  throw new Error('Invalid pin: ' + String(pin));
}

if (typeof CC1101_CS === 'undefined') {
  var CC1101_CS = 'CC1101_CS';
  __scriptGlobal.CC1101_CS = CC1101_CS;
}
if (typeof GDO0 === 'undefined') {
  var GDO0 = 'GDO0';
  __scriptGlobal.GDO0 = GDO0;
}

function __scriptHexBytes(values) {
  if (typeof values === 'string') {
    return values.replace(/^0x/i, '').replace(/[^0-9a-f]/gi, '').toUpperCase();
  }
  var hex = '';
  var len = values && typeof values.length === 'number' ? values.length : 0;
  for (var i = 0; i < len; i += 1) {
    var v = Number(values[i]) & 0xff;
    var part = v.toString(16).toUpperCase();
    if (part.length < 2) part = '0' + part;
    hex += part;
  }
  return hex;
}

if (typeof pinMode !== 'function') {
  var pinMode = function (pin, mode) {
    var pinNumber = __scriptResolvePin(pin);
    if (String(mode) === INPUT) {
      return emw.send('gpio in --pin=' + pinNumber);
    }
    if (String(mode) === OUTPUT) {
      return emw.send('gpio out --pin=' + pinNumber);
    }
    throw new Error('pinMode: unsupported mode ' + String(mode));
  };
  __scriptGlobal.pinMode = pinMode;
}

if (typeof digitalWrite !== 'function') {
  var digitalWrite = function (pin, value) {
    var pinNumber = __scriptResolvePin(pin);
    var level = Number(value) ? 1 : 0;
    return emw.send(level ? 'gpio high --pin=' + pinNumber : 'gpio low --pin=' + pinNumber);
  };
  __scriptGlobal.digitalWrite = digitalWrite;
}

if (typeof digitalRead !== 'function') {
  var digitalRead = function (pin) {
    var pinNumber = __scriptResolvePin(pin);
    var resp = emw.send('gpio read --pin=' + pinNumber);
    if (resp && typeof resp.then === 'function') {
      return resp.then(function (bytes) {
        return bytes && bytes.length ? (bytes[0] ? HIGH : LOW) : LOW;
      });
    }
    return resp && resp.length ? (resp[0] ? HIGH : LOW) : LOW;
  };
  __scriptGlobal.digitalRead = digitalRead;
}

if (typeof SPI === 'undefined') {
  var SPI = {
    transfer: function (txBytes, opts) {
      var cs = opts && typeof opts.cs !== 'undefined' ? __scriptResolvePin(opts.cs) : undefined;
      var rxLength = opts && typeof opts.rxLength === 'number' ? opts.rxLength : undefined;

      var cmd = 'spi xfer';
      if (typeof cs === 'number') cmd += ' --cs=' + cs;

      var txHex = __scriptHexBytes(txBytes);
      if (txHex) cmd += ' --tx=' + txHex;
      if (typeof rxLength === 'number') cmd += ' --rx=' + rxLength;

      return emw.send(cmd, 1500);
    },
  };

  __scriptGlobal.SPI = SPI;
}

if (typeof UI === 'undefined') {
  var UI = (function () {
    var idCounter = 0;

    var ensureId = function (type, props) {
      if (props && typeof props.id === 'string' && props.id.length > 0) {
        return props.id;
      }
      idCounter += 1;
      return type + '_' + idCounter;
    };

    var normalizeProps = function (type, props) {
      var assigned = props ? Object.assign({}, props) : {};
      var children = Array.isArray(assigned.children) ? assigned.children : [];
      delete assigned.children;
      var id = ensureId(type, assigned);
      assigned.id = id;

      var cleanedChildren = [];
      for (var i = 0; i < children.length; i += 1) {
        var child = children[i];
        if (child !== null && child !== undefined) {
          cleanedChildren.push(child);
        }
      }

      return { id: id, props: assigned, children: cleanedChildren };
    };

    var collectHandlers = function (id, props) {
      var handlers = {};
      var events = [
        { key: 'onTap', type: 'tap' },
        { key: 'onChange', type: 'change' },
        { key: 'onSubmit', type: 'submit' },
      ];
      events.forEach(function (event) {
        var fn = props[event.key];
        if (typeof fn === 'function') {
          var token = id + ':' + event.type;
          ScriptBridge.registerCallback(token, fn);
          handlers[event.type] = token;
        }
        if (Object.prototype.hasOwnProperty.call(props, event.key)) {
          delete props[event.key];
        }
      });
      return handlers;
    };

    var makeNode = function (type, props) {
      var normalized = normalizeProps(type, props);
      var handlerTokens = collectHandlers(normalized.id, normalized.props);
      return {
        type: type,
        id: normalized.id,
        props: normalized.props,
        children: normalized.children,
        handlers: handlerTokens,
      };
    };

    return {
      column: function (props) {
        return makeNode('column', props || {});
      },
      row: function (props) {
        return makeNode('row', props || {});
      },
      text: function (props) {
        return makeNode('text', props || {});
      },
      button: function (props) {
        return makeNode('button', props || {});
      },
      slider: function (props) {
        return makeNode('slider', props || {});
      },
      logViewer: function (props) {
        return makeNode('logViewer', props || {});
      },
      scroll: function (props) {
        return makeNode('scroll', props || {});
      },
      textField: function (props) {
        return makeNode('textField', props || {});
      },
      textEditor: function (props) {
        return makeNode('textEditor', props || {});
      },
      picker: function (props) {
        return makeNode('picker', props || {});
      },
      grid: function (props) {
        return makeNode('grid', props || {});
      },
      spacer: function (props) {
        return makeNode('spacer', props || {});
      },
      divider: function (props) {
        return makeNode('divider', props || {});
      },
      progress: function (props) {
        return makeNode('progress', props || {});
      },
      render: function (node) {
        if (!node || typeof node !== 'object') {
          ScriptBridge.log('UI.render called with invalid node');
          return;
        }
        ScriptBridge.render(node);
      },
    };
  })();
}

__scriptGlobal.ScriptBridge = ScriptBridge;
__scriptGlobal.ScriptModules = ScriptModules;
__scriptGlobal.UI = UI;
__scriptGlobal.print = print;
__scriptGlobal.dialog = dialog;
__scriptGlobal.createByteArray = createByteArray;
