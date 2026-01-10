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

var __scriptClock = (function () {
  var hasPerformanceNow = typeof performance !== 'undefined' && performance && typeof performance.now === 'function';
  var origin = hasPerformanceNow ? performance.now() : Date.now();
  var now = function () {
    return hasPerformanceNow ? performance.now() : Date.now();
  };
  return {
    millis: function () {
      return Math.floor(now() - origin);
    },
  };
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
  __scriptGlobal.print = print;
}

// -----------------------------------------------------------------------------
// Console API (Arduino Serial Monitor-ish)
// -----------------------------------------------------------------------------

if (typeof Console === 'undefined') {
  var Console = (function () {
    var rxLines = [];
    var pendingLineResolvers = [];

    function enqueueLine(line) {
      var text = String(line == null ? '' : line);
      if (pendingLineResolvers.length > 0) {
        var resolve = pendingLineResolvers.shift();
        try {
          resolve(text);
        } catch (e) {}
        return;
      }
      rxLines.push(text);
    }

    function readNow() {
      if (rxLines.length === 0) return null;
      return rxLines.shift();
    }

    function peekNow() {
      if (rxLines.length === 0) return null;
      return rxLines[0];
    }

    function readLine() {
      if (rxLines.length > 0) {
        return Promise.resolve(rxLines.shift());
      }
      return new Promise(function (resolve) {
        pendingLineResolvers.push(resolve);
      });
    }

    // Host-delivered console input.
    ScriptBridge.registerCallback('__emw_console_input', function (payload) {
      if (typeof payload === 'string') {
        enqueueLine(payload);
        return;
      }
      if (payload && typeof payload === 'object' && typeof payload.line !== 'undefined') {
        enqueueLine(payload.line);
        return;
      }
      enqueueLine(payload);
    });

    return {
      // Output (print/println are line-oriented in EMWaver today).
      print: function () {
        print.apply(null, arguments);
      },
      println: function () {
        print.apply(null, arguments);
      },

      // Input (line-oriented).
      available: function () {
        return rxLines.length;
      },
      read: function () {
        return readNow();
      },
      peek: function () {
        return peekNow();
      },
      readLine: readLine,

      // Internal/testing.
      _enqueueLine: enqueueLine,
    };
  })();
  __scriptGlobal.Console = Console;
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
var __scriptHostSampler = typeof Sampler !== 'undefined' && !__scriptIsShim(Sampler) ? Sampler : null;

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

if (typeof millis === 'undefined') {
  var millis = function () {
    return __scriptClock.millis();
  };
}

if (typeof delay === 'undefined') {
  var delay = function (ms) {
    var durationMs = Math.max(0, Number(ms) || 0);
    if (durationMs <= 0) {
      return Promise.resolve();
    }

    if (typeof setTimeout === 'function') {
      return new Promise(function (resolve) {
        setTimeout(resolve, durationMs);
      });
    }

    if (typeof _scriptSleep === 'function') {
      _scriptSleep(durationMs);
      return Promise.resolve();
    }

    if (Utils && typeof Utils.delay === 'function') {
      Utils.delay(durationMs);
      return Promise.resolve();
    }

    return new Promise(function (resolve) {
      var start = Date.now();
      while (Date.now() - start < durationMs) {}
      resolve();
    });
  };
}

if (typeof every === 'undefined') {
  var every = function (periodMs, fn, opts) {
    var period = Math.max(0, Number(periodMs) || 0);
    if (!isFinite(period) || period <= 0) {
      throw new Error('every(periodMs, fn): periodMs must be > 0');
    }
    if (typeof fn !== 'function') {
      throw new Error('every(periodMs, fn): fn must be a function');
    }

    var options = opts && typeof opts === 'object' ? opts : {};
    var mode = options.mode === 'fixedDelay' ? 'fixedDelay' : 'fixedRate';

    var stopped = false;
    var running = false;
    var startMs = __scriptClock.millis();
    var tick = 0;
    var timeoutId = null;

    function stop() {
      stopped = true;
      if (timeoutId !== null && typeof clearTimeout === 'function') {
        clearTimeout(timeoutId);
      }
      timeoutId = null;
    }

    function scheduleNext() {
      if (stopped) return;

      if (mode === 'fixedDelay') {
        timeoutId = typeof setTimeout === 'function' ? setTimeout(runTick, period) : null;
        if (timeoutId === null) {
          (async function () {
            await delay(period);
            runTick();
          })();
        }
        return;
      }

      var due = startMs + (tick + 1) * period;
      var waitMs = Math.max(0, due - __scriptClock.millis());
      timeoutId = typeof setTimeout === 'function' ? setTimeout(runTick, waitMs) : null;
      if (timeoutId === null) {
        (async function () {
          await delay(waitMs);
          runTick();
        })();
      }
    }

    function runTick() {
      if (stopped) return;

      if (running) {
        tick += 1;
        scheduleNext();
        return;
      }

      running = true;
      tick += 1;

      Promise.resolve()
        .then(function () {
          return fn();
        })
        .catch(function (error) {
          try {
            console.error('every() tick error:', error);
          } catch (e) {}
        })
        .then(function () {
          running = false;
          scheduleNext();
        });
    }

    scheduleNext();
    return { stop: stop };
  };
}

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
__scriptGlobal.millis = millis;
__scriptGlobal.delay = delay;
__scriptGlobal.every = every;

// -----------------------------------------------------------------------------
// Sampler API (live capture)
// -----------------------------------------------------------------------------

var Sampler = {};
Sampler.__scriptShim = true;

(function () {
  var PACKET_SIZE = 64;
  var __samplerActiveSession = null; // { id, pin, startPacket }

  function __samplerMakeId() {
    return String(Date.now()) + '-' + Math.random().toString(16).slice(2);
  }

  function __samplerToUint8Array(data) {
    if (!data) return new Uint8Array();
    if (data instanceof Uint8Array) return data;
    if (Array.isArray(data)) {
      return new Uint8Array(data.map(function (v) { return Number(v) & 0xff; }));
    }
    return data;
  }

  async function __samplerSleep(ms) {
    var durationMs = Math.max(0, Number(ms) || 0);
    if (durationMs <= 0) return;

    if (typeof _scriptSleep === 'function') {
      _scriptSleep(durationMs);
      return;
    }

    if (typeof setTimeout === 'function') {
      await new Promise(function (resolve) {
        setTimeout(resolve, durationMs);
      });
      return;
    }

    if (Utils && typeof Utils.delay === 'function') {
      Utils.delay(durationMs);
      return;
    }

    var start = Date.now();
    while (Date.now() - start < durationMs) {}
  }

  async function __samplerReadPacketRange(startPacketIndex, endPacketIndex) {
    var start = Math.max(0, Number(startPacketIndex) || 0);
    var end = Math.max(start, Number(endPacketIndex) || 0);
    var cursor = start;
    var chunks = [];

    while (cursor < end) {
      var remaining = end - cursor;
      var take = Math.max(1, Math.min(256, remaining));
      var resp = await Sampler.buffer.readPacketsSince({ packetIndex: cursor, maxPackets: take });
      if (!resp || !resp.data || resp.data.length === 0) break;
      chunks.push(resp.data);
      var next = Number(resp.nextPacketIndex);
      if (!isFinite(next) || next <= cursor) break;
      cursor = next;
    }

    var totalLen = 0;
    for (var i = 0; i < chunks.length; i++) totalLen += chunks[i].length;
    var out = new Uint8Array(totalLen);
    var offset = 0;
    for (var j = 0; j < chunks.length; j++) {
      out.set(chunks[j], offset);
      offset += chunks[j].length;
    }
    return out;
  }

  Sampler.buffer = {};

  Sampler.buffer.packetCount = async function () {
    if (__scriptHostSampler && __scriptHostSampler.buffer && typeof __scriptHostSampler.buffer.packetCount === 'function') {
      return await __scriptHostSampler.buffer.packetCount.call(__scriptHostSampler.buffer);
    }
    if (typeof _scriptSamplerBufferGetPacketCount === 'function') {
      return Number(await _scriptSamplerBufferGetPacketCount());
    }
    throw new Error('Sampler.buffer.packetCount unavailable on this host');
  };

  Sampler.buffer.lenBytes = async function () {
    if (__scriptHostSampler && __scriptHostSampler.buffer && typeof __scriptHostSampler.buffer.lenBytes === 'function') {
      return Number(await __scriptHostSampler.buffer.lenBytes.call(__scriptHostSampler.buffer));
    }
    if (typeof _scriptSamplerBufferGetLenBytes === 'function') {
      return Number(await _scriptSamplerBufferGetLenBytes());
    }
    throw new Error('Sampler.buffer.lenBytes unavailable on this host');
  };

  Sampler.buffer.getBytes = async function () {
    if (__scriptHostSampler && __scriptHostSampler.buffer && typeof __scriptHostSampler.buffer.getBytes === 'function') {
      return __samplerToUint8Array(await __scriptHostSampler.buffer.getBytes.call(__scriptHostSampler.buffer));
    }
    if (typeof _scriptSamplerBufferGetBytes === 'function') {
      return __samplerToUint8Array(await _scriptSamplerBufferGetBytes());
    }
    throw new Error('Sampler.buffer.getBytes unavailable on this host');
  };

  Sampler.buffer.clear = async function () {
    if (__scriptHostSampler && __scriptHostSampler.buffer && typeof __scriptHostSampler.buffer.clear === 'function') {
      return await __scriptHostSampler.buffer.clear.call(__scriptHostSampler.buffer);
    }
    if (typeof _scriptSamplerBufferClear === 'function') {
      return await _scriptSamplerBufferClear();
    }
    throw new Error('Sampler.buffer.clear unavailable on this host');
  };

  Sampler.buffer.setInvertRx = async function (enabled) {
    var flag = !!enabled;
    if (__scriptHostSampler && __scriptHostSampler.buffer && typeof __scriptHostSampler.buffer.setInvertRx === 'function') {
      return await __scriptHostSampler.buffer.setInvertRx.call(__scriptHostSampler.buffer, flag);
    }
    if (typeof _scriptSamplerBufferSetInvertRx === 'function') {
      return await _scriptSamplerBufferSetInvertRx(flag);
    }
    throw new Error('Sampler.buffer.setInvertRx unavailable on this host');
  };

  Sampler.buffer.readPacketsSince = async function (opts) {
    var packetIndex = Math.max(0, Number(opts && opts.packetIndex) || 0);
    var maxPackets = Math.max(1, Number(opts && opts.maxPackets) || 256);

    var resp = null;
    if (__scriptHostSampler && __scriptHostSampler.buffer && typeof __scriptHostSampler.buffer.readPacketsSince === 'function') {
      resp = await __scriptHostSampler.buffer.readPacketsSince.call(__scriptHostSampler.buffer, {
        packetIndex: packetIndex,
        maxPackets: maxPackets,
      });
    } else if (typeof _scriptSamplerBufferReadPacketsSince === 'function') {
      resp = await _scriptSamplerBufferReadPacketsSince(packetIndex, maxPackets);
    } else {
      throw new Error('Sampler.buffer.readPacketsSince unavailable on this host');
    }

    return {
      data: __samplerToUint8Array(resp && resp.data),
      nextPacketIndex: Number(resp && resp.nextPacketIndex),
      availablePackets: Number(resp && resp.availablePackets),
    };
  };

  Sampler.buffer.compressViewport = async function (opts) {
    var startBit = Math.max(0, Number(opts && opts.startBit) || 0);
    var endBit = Math.max(0, Number(opts && opts.endBit) || 0);
    var bins = Math.max(0, Number(opts && opts.bins) || 0);

    var resp = null;
    if (__scriptHostSampler && __scriptHostSampler.buffer && typeof __scriptHostSampler.buffer.compressViewport === 'function') {
      resp = await __scriptHostSampler.buffer.compressViewport.call(__scriptHostSampler.buffer, {
        startBit: startBit,
        endBit: endBit,
        bins: bins,
      });
    } else if (typeof _scriptSamplerBufferCompressViewport === 'function') {
      resp = await _scriptSamplerBufferCompressViewport(startBit, endBit, bins);
    } else {
      throw new Error('Sampler.buffer.compressViewport unavailable on this host');
    }

    return {
      bufferLenBytes: Number(resp && (resp.bufferLenBytes != null ? resp.bufferLenBytes : resp.buffer_len_bytes)),
      timeValues: (resp && (resp.timeValues || resp.time_values)) || [],
      dataValues: (resp && (resp.dataValues || resp.data_values)) || [],
    };
  };

  Sampler.buffer.sliceBytes = async function (byteStart, byteEnd) {
    var start = Math.max(0, Number(byteStart) || 0);
    var end = Math.max(start, Number(byteEnd) || 0);
    if (end <= start) return new Uint8Array();

    var startPacket = Math.floor(start / PACKET_SIZE);
    var endPacket = Math.ceil(end / PACKET_SIZE);
    var bytes = await __samplerReadPacketRange(startPacket, endPacket);
    var offset = start - startPacket * PACKET_SIZE;
    return bytes.slice(offset, offset + (end - start));
  };

  Sampler.buffer.firstBytes = async function (n) {
    var len = Math.max(0, Number(n) || 0);
    if (len === 0) return new Uint8Array();
    return await Sampler.buffer.sliceBytes(0, len);
  };

  Sampler.buffer.lastBytes = async function (n) {
    var len = Math.max(0, Number(n) || 0);
    if (len === 0) return new Uint8Array();
    var total = await Sampler.buffer.lenBytes();
    var start = Math.max(0, total - len);
    return await Sampler.buffer.sliceBytes(start, total);
  };

  Sampler.start = async function (opts) {
    var pin = Number(opts && opts.pin);
    if (!isFinite(pin) || pin < 0) {
      throw new Error('Sampler.start requires opts.pin (encoded pin number)');
    }
    if (__samplerActiveSession) {
      throw new Error('Sampler already active');
    }

    var clearBefore = !!(opts && opts.clearBefore);
    var invert = !!(opts && opts.invert);

    if (clearBefore) {
      await Sampler.buffer.clear();
    }
    await Sampler.buffer.setInvertRx(invert);

    var startPacket = await Sampler.buffer.packetCount();
    await emw.send('sample start --pin=' + pin);

    var id = __samplerMakeId();
    __samplerActiveSession = { id: id, pin: pin, startPacket: startPacket };
    return { id: id, startPacket: startPacket };
  };

  Sampler.stop = async function (id) {
    if (!__samplerActiveSession) return;
    if (id != null && String(id) !== String(__samplerActiveSession.id)) {
      throw new Error('Sampler.stop id mismatch');
    }

    try {
      await emw.send('sample stop');
    } finally {
      try { await Sampler.buffer.setInvertRx(false); } catch (e) {}
      __samplerActiveSession = null;
    }
  };

  Sampler.status = async function (id) {
    var active = !!__samplerActiveSession;
    if (id != null && active && String(id) !== String(__samplerActiveSession.id)) {
      active = false;
    }
    return {
      active: active,
      pin: active ? __samplerActiveSession.pin : undefined,
      packetCount: await Sampler.buffer.packetCount(),
      lenBytes: await Sampler.buffer.lenBytes(),
    };
  };

  Sampler.capture = async function (opts) {
    var pin = Number(opts && opts.pin);
    var durationMs = Math.max(0, Number(opts && opts.durationMs) || 0);
    var clearBefore = opts && typeof opts.clearBefore === 'boolean' ? !!opts.clearBefore : true;
    var invert = !!(opts && opts.invert);

    var session = null;
    try {
      session = await Sampler.start({ pin: pin, clearBefore: clearBefore, invert: invert });
      await __samplerSleep(durationMs);
    } finally {
      try { await Sampler.stop(session && session.id); } catch (e) {}
    }

    var endPacket = await Sampler.buffer.packetCount();
    var bytes = await __samplerReadPacketRange(session ? session.startPacket : 0, endPacket);
    return {
      bytes: bytes,
      startPacket: session ? session.startPacket : 0,
      endPacket: endPacket,
      bufferLenBytes: await Sampler.buffer.lenBytes(),
    };
  };
})();

__scriptGlobal.Sampler = Sampler;

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

function __scriptDecodeText(bytes) {
  if (!bytes) return '';
  if (typeof bytes === 'string') return bytes;
  try {
    if (typeof TextDecoder === 'function') {
      return new TextDecoder('utf-8').decode(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
    }
  } catch (e) {}
  try {
    var arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    var out = '';
    for (var i = 0; i < arr.length; i += 1) {
      var c = arr[i] & 0xff;
      if (c === 0) break;
      out += String.fromCharCode(c);
    }
    return out;
  } catch (e2) {
    return String(bytes);
  }
}

var device = typeof device !== 'undefined' ? device : {};
if (typeof device.version !== 'function') {
  device.version = function () {
    return Promise.resolve(emw.send('version', 1500)).then(function (resp) {
      return __scriptDecodeText(resp).trim();
    });
  };
}
if (typeof device.reset !== 'function') {
  device.reset = function () {
    return Promise.resolve(emw.send('reset', 1500)).then(function () {
      return;
    });
  };
}
__scriptGlobal.device = device;

// -----------------------------------------------------------------------------
// Arduino-ish API surface (GPIO + SPI + ADC), implemented as thin wrappers over the
// canonical, observable ASCII command protocol (e.g. `gpio ...`, `spi xfer ...`,
// `adc read ...`).
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

function __scriptAsciiHex(text) {
  var s = String(text);
  var hex = '';
  for (var i = 0; i < s.length; i += 1) {
    var v = s.charCodeAt(i) & 0xff;
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

if (typeof Serial === 'undefined') {
  var Serial = {
    begin: function (baud, opts) {
      var b = typeof baud === 'number' ? baud | 0 : 115200;
      var timeout = opts && typeof opts.timeout === 'number' ? opts.timeout | 0 : 1500;
      return emw.send('uart open --baud=' + b, timeout);
    },
    end: function (opts) {
      var timeout = opts && typeof opts.timeout === 'number' ? opts.timeout | 0 : 1500;
      return emw.send('uart close', timeout);
    },
    write: function (data, opts) {
      var baud = opts && typeof opts.baud === 'number' ? opts.baud | 0 : undefined;
      var timeout = opts && typeof opts.timeout === 'number' ? opts.timeout | 0 : 1500;
      var hex = typeof data === 'string' ? __scriptAsciiHex(data) : __scriptHexBytes(data);
      var cmd = 'uart write';
      if (typeof baud === 'number' && isFinite(baud) && baud > 0) cmd += ' --baud=' + baud;
      if (hex) cmd += ' --tx=' + hex;
      return emw.send(cmd, timeout);
    },
    read: function (n, opts) {
      var len = Number(n) | 0;
      if (len < 0) len = 0;
      if (len > 63) len = 63;
      var baud = opts && typeof opts.baud === 'number' ? opts.baud | 0 : undefined;
      var timeout = opts && typeof opts.timeout === 'number' ? opts.timeout | 0 : 250;
      var cmd = 'uart read --n=' + len;
      if (typeof baud === 'number' && isFinite(baud) && baud > 0) cmd += ' --baud=' + baud;
      return emw.send(cmd, timeout);
    },
  };

  __scriptGlobal.Serial = Serial;
}

if (typeof Wire === 'undefined') {
  var Wire = {
    begin: function (hz, opts) {
      var h = typeof hz === 'number' ? hz | 0 : 100000;
      var timeout = opts && typeof opts.timeout === 'number' ? opts.timeout | 0 : 1500;
      return emw.send('i2c open --hz=' + h, timeout);
    },
    end: function (opts) {
      var timeout = opts && typeof opts.timeout === 'number' ? opts.timeout | 0 : 1500;
      return emw.send('i2c close', timeout);
    },
    write: function (addr, data, opts) {
      var a = Number(addr) | 0;
      var hz = opts && typeof opts.hz === 'number' ? opts.hz | 0 : undefined;
      var timeout = opts && typeof opts.timeout === 'number' ? opts.timeout | 0 : 250;
      var hex = __scriptHexBytes(data);
      var cmd = 'i2c write --addr=' + a;
      if (typeof hz === 'number' && isFinite(hz) && hz > 0) cmd += ' --hz=' + hz;
      if (hex) cmd += ' --tx=' + hex;
      return emw.send(cmd, timeout);
    },
    read: function (addr, n, opts) {
      var a = Number(addr) | 0;
      var len = Number(n) | 0;
      if (len < 0) len = 0;
      if (len > 63) len = 63;
      var hz = opts && typeof opts.hz === 'number' ? opts.hz | 0 : undefined;
      var timeout = opts && typeof opts.timeout === 'number' ? opts.timeout | 0 : 250;
      var cmd = 'i2c read --addr=' + a + ' --n=' + len;
      if (typeof hz === 'number' && isFinite(hz) && hz > 0) cmd += ' --hz=' + hz;
      return emw.send(cmd, timeout);
    },
    xfer: function (addr, tx, rxLen, opts) {
      var a = Number(addr) | 0;
      var len = Number(rxLen) | 0;
      if (len < 0) len = 0;
      if (len > 63) len = 63;
      var hz = opts && typeof opts.hz === 'number' ? opts.hz | 0 : undefined;
      var timeout = opts && typeof opts.timeout === 'number' ? opts.timeout | 0 : 250;
      var hex = __scriptHexBytes(tx);
      var cmd = 'i2c xfer --addr=' + a + ' --rx=' + len;
      if (typeof hz === 'number' && isFinite(hz) && hz > 0) cmd += ' --hz=' + hz;
      if (hex) cmd += ' --tx=' + hex;
      return emw.send(cmd, timeout);
    },
  };

  __scriptGlobal.Wire = Wire;
}

if (typeof analogReadResolution !== 'function') {
  var analogReadResolution = function (bits) {
    var n = Number(bits);
    if (!isFinite(n) || n < 1 || n > 16) {
      throw new Error('analogReadResolution: invalid bits ' + String(bits));
    }
    __scriptGlobal.__scriptAnalogReadResolution = n | 0;
  };
  __scriptGlobal.analogReadResolution = analogReadResolution;
}

function __scriptU16FromBytes(bytes) {
  if (!bytes || bytes.length < 2) return 0;
  var lo = bytes[0] & 0xff;
  var hi = bytes[1] & 0xff;
  return (hi << 8) | lo;
}

function __scriptScaleAnalogRead(value12) {
  var bits = __scriptGlobal.__scriptAnalogReadResolution;
  if (typeof bits !== 'number' || !isFinite(bits) || bits <= 0) bits = 12;

  var v = Number(value12) | 0;
  if (bits === 12) return v;
  if (bits > 12) return v << (bits - 12);
  return v >> (12 - bits);
}

if (typeof analogRead !== 'function') {
  var analogRead = function (pin, opts) {
    var pinNumber = __scriptResolvePin(pin);
    var samples = opts && typeof opts.samples === 'number' ? (opts.samples | 0) : 1;
    if (samples < 1) samples = 1;
    if (samples > 64) samples = 64;

    var cmd = 'adc read --pin=' + pinNumber;
    if (samples !== 1) cmd += ' --samples=' + samples;

    var resp = emw.send(cmd, 1500);
    if (resp && typeof resp.then === 'function') {
      return resp.then(function (bytes) {
        return __scriptScaleAnalogRead(__scriptU16FromBytes(bytes));
      });
    }
    return __scriptScaleAnalogRead(__scriptU16FromBytes(resp));
  };
  __scriptGlobal.analogRead = analogRead;
}

function __scriptAnalogReadInternal(src, opts) {
  var samples = opts && typeof opts.samples === 'number' ? (opts.samples | 0) : 1;
  if (samples < 1) samples = 1;
  if (samples > 64) samples = 64;

  var cmd = 'adc read --src=' + String(src);
  if (samples !== 1) cmd += ' --samples=' + samples;

  var resp = emw.send(cmd, 1500);
  if (resp && typeof resp.then === 'function') {
    return resp.then(function (bytes) {
      return __scriptScaleAnalogRead(__scriptU16FromBytes(bytes));
    });
  }
  return __scriptScaleAnalogRead(__scriptU16FromBytes(resp));
}

if (typeof analogReadVrefint !== 'function') {
  var analogReadVrefint = function (opts) {
    return __scriptAnalogReadInternal('vrefint', opts);
  };
  __scriptGlobal.analogReadVrefint = analogReadVrefint;
}

if (typeof analogReadTemp !== 'function') {
  var analogReadTemp = function (opts) {
    return __scriptAnalogReadInternal('temp', opts);
  };
  __scriptGlobal.analogReadTemp = analogReadTemp;
}

if (typeof analogReadVbat !== 'function') {
  var analogReadVbat = function (opts) {
    return __scriptAnalogReadInternal('vbat', opts);
  };
  __scriptGlobal.analogReadVbat = analogReadVbat;
}

if (typeof analogWriteResolution !== 'function') {
  var analogWriteResolution = function (bits) {
    var n = Number(bits);
    if (!isFinite(n) || n < 1 || n > 16) {
      throw new Error('analogWriteResolution: invalid bits ' + String(bits));
    }
    __scriptGlobal.__scriptAnalogWriteResolution = n | 0;
  };
  __scriptGlobal.analogWriteResolution = analogWriteResolution;
}

function __scriptScaleAnalogWrite(value) {
  var bits = __scriptGlobal.__scriptAnalogWriteResolution;
  if (typeof bits !== 'number' || !isFinite(bits) || bits <= 0) bits = 12;

  var v = Number(value) | 0;
  if (v < 0) v = 0;

  var max = bits >= 31 ? 0x7fffffff : (1 << bits) - 1;
  if (v > max) v = max;

  if (bits === 12) return v;
  if (bits > 12) return v >> (bits - 12);
  return v << (12 - bits);
}

if (typeof analogWrite !== 'function') {
  var analogWrite = function (pin, value, opts) {
    var pinNumber = __scriptResolvePin(pin);
    var v12 = __scriptScaleAnalogWrite(value);

    var hz = opts && typeof opts.hz === 'number' ? (opts.hz | 0) : undefined;
    var timeout = opts && typeof opts.timeout === 'number' ? (opts.timeout | 0) : 1500;

    var cmd = 'pwm write --pin=' + pinNumber + ' --value=' + v12;
    if (typeof hz === 'number' && isFinite(hz) && hz > 0) cmd += ' --hz=' + hz;

    return emw.send(cmd, timeout);
  };
  __scriptGlobal.analogWrite = analogWrite;
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
