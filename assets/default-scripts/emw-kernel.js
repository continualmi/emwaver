'use strict';

// Canonical Script bootstrap/runtime.
// This file is intended to be the single source of truth for the EMWaver Script API surface.
//
// Hosts must provide (at minimum) these bridge functions:
// - _scriptRender(jsonString: string): void   (JSON.stringify(rootNode))
// - _scriptRegisterCallback(token: string, fn: Function): void
//
// Device operations are performed by the standard library via:
// - _scriptSendPacket(bytes: Uint8Array, timeoutMs: number): Uint8Array
//
// Hosts may optionally provide:
// - _scriptSleep(ms: number): void
// - _scriptListSignals(): string[]
// - _scriptReadSignal(name: string): any

var __scriptGlobal = (function () {
  try {
    return Function('return this')();
  } catch (e) {
    return {};
  }
})();

// Capture host-only primitives so we can remove them from the public Script API surface.
// Note: This file runs in different JS environments (desktop backend, desktop frontend fallback,
// mobile). Some environments expose these as true globals (not function parameters).
var __host_scriptSendPacket = typeof _scriptSendPacket === 'function' ? _scriptSendPacket : null;

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

function __scriptIsShim(obj) {
  return !!obj && obj.__scriptShim === true;
}

var __scriptHostSamplerSignals =
  typeof SamplerSignals !== 'undefined' && !__scriptIsShim(SamplerSignals) ? SamplerSignals : null;
var __scriptHostSampler = typeof Sampler !== 'undefined' && !__scriptIsShim(Sampler) ? Sampler : null;

function __sendPacket(bytes, timeoutMs) {
  var sender = typeof __host_scriptSendPacket === 'function' ? __host_scriptSendPacket : null;
  if (typeof sender !== 'function') {
    throw new Error('Device send unavailable (missing _scriptSendPacket)');
  }
  var timeout = typeof timeoutMs === 'number' ? timeoutMs : 2000;

  var resp = sender(bytes, timeout);
  // EMWaver script semantics are sync-only: host bridge must not return Promises.
  if (resp && typeof resp.then === 'function') {
    throw new Error('_scriptSendPacket must be synchronous (Promise not supported)');
  }
  return resp;
}

// Binary protocol opcodes/subcommands (must match firmware `emw_proto.h`).
var EMW_OP_VERSION = 0x01;
var EMW_OP_RESET = 0x02;
var EMW_OP_HELP = 0x03;
var EMW_OP_NAME_GET = 0x04;
var EMW_OP_NAME_SET = 0x05;
var EMW_OP_BOARD_GET = 0x09;

var EMW_OP_GPIO = 0x10;
var EMW_GPIO_IN = 0x00;
var EMW_GPIO_OUT = 0x01;
var EMW_GPIO_READ = 0x02;
var EMW_GPIO_HIGH = 0x03;
var EMW_GPIO_LOW = 0x04;
var EMW_GPIO_PULL = 0x05;
var EMW_GPIO_INFO = 0x06;

var EMW_OP_ADC_READ = 0x20;
var EMW_ADC_SRC_PIN = 0x00;
var EMW_ADC_SRC_TEMP = 0x01;
var EMW_ADC_SRC_VREFINT = 0x02;
var EMW_ADC_SRC_VBAT = 0x03;

var EMW_OP_UART = 0x30;
var EMW_UART_OPEN = 0x00;
var EMW_UART_CLOSE = 0x01;
var EMW_UART_WRITE = 0x02;
var EMW_UART_READ = 0x03;

var EMW_OP_I2C = 0x40;
var EMW_I2C_OPEN = 0x00;
var EMW_I2C_CLOSE = 0x01;
var EMW_I2C_WRITE = 0x02;
var EMW_I2C_READ = 0x03;
var EMW_I2C_XFER = 0x04;

var EMW_OP_SPI_XFER = 0x50;

var EMW_OP_SAMPLE = 0x60;
var EMW_SAMPLE_START = 0x00;
var EMW_SAMPLE_STOP = 0x01;

var EMW_OP_PWM = 0x70;
var EMW_PWM_FREQ = 0x00;
var EMW_PWM_WRITE = 0x01;
var EMW_PWM_STOP = 0x02;

var EMW_OP_TRANSMIT = 0x80;
var EMW_TRANSMIT_START = 0x00;
var EMW_TRANSMIT_STOP = 0x01;

function __emwWriteU16LE(out, offset, value) {
  var v = Number(value) >>> 0;
  out[offset] = v & 0xff;
  out[offset + 1] = (v >>> 8) & 0xff;
}

function __emwWriteU32LE(out, offset, value) {
  var v = Number(value) >>> 0;
  out[offset] = v & 0xff;
  out[offset + 1] = (v >>> 8) & 0xff;
  out[offset + 2] = (v >>> 16) & 0xff;
  out[offset + 3] = (v >>> 24) & 0xff;
}

function __emwStatus(resp) {
  return resp && resp.length ? (resp[0] & 0xff) : 0xff;
}

function __emwPayload(resp) {
  // Firmware response is: [status, payload...] (marker is stripped by host).
  if (!resp || resp.length < 1) return new Uint8Array();
  return resp.slice(1);
}

function __emwAssertOk(resp) {
  var st = __emwStatus(resp);
  // Mini-frame protocol: 0x80 = OK, 0x81 = ERR.
  if (st !== 0x80) {
    if (st === 0xff) {
      throw new Error('Device not connected or no response from device (status 255)');
    }
    throw new Error('Device error: ' + st);
  }
  return resp;
}

function __emwSendPacket(packet, timeoutMs) {
  return __emwAssertOk(__sendPacket(packet, timeoutMs));
}

// Best-effort: hide host primitives that are not part of the public Script API.
// (Scripts should use SPI/Wire/Serial/etc, not raw command strings.)
try { __scriptGlobal._scriptSendPacket = undefined; } catch (e) {}
try { __scriptGlobal._manualSendCommand = undefined; } catch (e) {}
try { __scriptGlobal._scriptWrite = undefined; } catch (e) {}
try { __scriptGlobal._scriptImportModule = undefined; } catch (e) {}
try { __scriptGlobal._scriptShowDialog = undefined; } catch (e) {}
try { __scriptGlobal._scriptCreateByteArray = undefined; } catch (e) {}

if (typeof millis === 'undefined') {
  var millis = function () {
    return __scriptClock.millis();
  };
}

if (typeof delay === 'undefined') {
  var delay = function (ms) {
    var durationMs = Math.max(0, Number(ms) || 0);
    if (durationMs <= 0) return;

    if (typeof _scriptSleep === 'function') {
      _scriptSleep(durationMs);
      return;
    }

    // Last-resort fallback: busy wait.
    var start = Date.now();
    while (Date.now() - start < durationMs) {}
  };
}

if (typeof sleep === 'undefined') {
  // Blocking sleep (best-effort; used for tight loops where async timers add too much overhead).
  var sleep = function (ms) {
    var durationMs = Math.max(0, Number(ms) || 0);
    if (durationMs <= 0) return;
    var start = Date.now();
    while (Date.now() - start < durationMs) {}
  };
  __scriptGlobal.sleep = sleep;
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

      if (typeof setTimeout !== 'function') {
        throw new Error('every(): host must provide setTimeout');
      }

      if (mode === 'fixedDelay') {
        timeoutId = setTimeout(runTick, period);
        return;
      }

      var due = startMs + (tick + 1) * period;
      var waitMs = Math.max(0, due - __scriptClock.millis());
      timeoutId = setTimeout(runTick, waitMs);
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

      try {
        fn();
      } catch (error) {
        // No console stream: ignore periodic callback errors by default.
        // Scripts can surface errors by re-rendering UI.
        void error;
      } finally {
        running = false;
        scheduleNext();
      }
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

__scriptGlobal.SamplerSignals = SamplerSignals;
__scriptGlobal.millis = millis;
__scriptGlobal.delay = delay;
__scriptGlobal.every = every;
__scriptGlobal.sleep = sleep;

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

  function __samplerSleep(ms) {
    delay(ms);
  }

  function __samplerReadPacketRange(startPacketIndex, endPacketIndex) {
    var start = Math.max(0, Number(startPacketIndex) || 0);
    var end = Math.max(start, Number(endPacketIndex) || 0);
    var cursor = start;
    var chunks = [];

    while (cursor < end) {
      var remaining = end - cursor;
      var take = Math.max(1, Math.min(256, remaining));
      var resp = Sampler.readPacketsSince({ packetIndex: cursor, maxPackets: take });
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

  Sampler.packetCount = function () {
    if (__scriptHostSampler && __scriptHostSampler.buffer && typeof __scriptHostSampler.buffer.packetCount === 'function') {
      return __scriptHostSampler.buffer.packetCount.call(__scriptHostSampler.buffer);
    }
    if (typeof _scriptSamplerBufferGetPacketCount === 'function') {
      return Number(_scriptSamplerBufferGetPacketCount());
    }
    throw new Error('Sampler.packetCount unavailable on this host');
  };

  Sampler.lenBytes = function () {
    if (__scriptHostSampler && __scriptHostSampler.buffer && typeof __scriptHostSampler.buffer.lenBytes === 'function') {
      return Number(__scriptHostSampler.buffer.lenBytes.call(__scriptHostSampler.buffer));
    }
    if (typeof _scriptSamplerBufferGetLenBytes === 'function') {
      return Number(_scriptSamplerBufferGetLenBytes());
    }
    throw new Error('Sampler.lenBytes unavailable on this host');
  };

  Sampler.getBytes = function () {
    if (__scriptHostSampler && __scriptHostSampler.buffer && typeof __scriptHostSampler.buffer.getBytes === 'function') {
      return __samplerToUint8Array(__scriptHostSampler.buffer.getBytes.call(__scriptHostSampler.buffer));
    }
    if (typeof _scriptSamplerBufferGetBytes === 'function') {
      return __samplerToUint8Array(_scriptSamplerBufferGetBytes());
    }
    throw new Error('Sampler.getBytes unavailable on this host');
  };

  Sampler.clear = function () {
    if (__scriptHostSampler && __scriptHostSampler.buffer && typeof __scriptHostSampler.buffer.clear === 'function') {
      return __scriptHostSampler.buffer.clear.call(__scriptHostSampler.buffer);
    }
    if (typeof _scriptSamplerBufferClear === 'function') {
      return _scriptSamplerBufferClear();
    }
    throw new Error('Sampler.clear unavailable on this host');
  };

  // Sampler.setInvertRx removed (legacy).

  Sampler.readPacketsSince = function (opts) {
    var packetIndex = Math.max(0, Number(opts && opts.packetIndex) || 0);
    var maxPackets = Math.max(1, Number(opts && opts.maxPackets) || 256);

    var resp = null;
    if (__scriptHostSampler && __scriptHostSampler.buffer && typeof __scriptHostSampler.buffer.readPacketsSince === 'function') {
      resp = __scriptHostSampler.buffer.readPacketsSince.call(__scriptHostSampler.buffer, {
        packetIndex: packetIndex,
        maxPackets: maxPackets,
      });
    } else if (typeof _scriptSamplerBufferReadPacketsSince === 'function') {
      resp = _scriptSamplerBufferReadPacketsSince(packetIndex, maxPackets);
    } else {
      throw new Error('Sampler.readPacketsSince unavailable on this host');
    }

    return {
      data: __samplerToUint8Array(resp && resp.data),
      nextPacketIndex: Number(resp && resp.nextPacketIndex),
      availablePackets: Number(resp && resp.availablePackets),
    };
  };

  Sampler.sliceBytes = function (byteStart, byteEnd) {
    var start = Math.max(0, Number(byteStart) || 0);
    var end = Math.max(start, Number(byteEnd) || 0);
    if (end <= start) return new Uint8Array();

    var startPacket = Math.floor(start / PACKET_SIZE);
    var endPacket = Math.ceil(end / PACKET_SIZE);
    var bytes = __samplerReadPacketRange(startPacket, endPacket);
    var offset = start - startPacket * PACKET_SIZE;
    return bytes.slice(offset, offset + (end - start));
  };

  Sampler.firstBytes = function (n) {
    var len = Math.max(0, Number(n) || 0);
    if (len === 0) return new Uint8Array();
    return Sampler.sliceBytes(0, len);
  };

  Sampler.lastBytes = function (n) {
    var len = Math.max(0, Number(n) || 0);
    if (len === 0) return new Uint8Array();
    var total = Sampler.lenBytes();
    var start = Math.max(0, total - len);
    return Sampler.sliceBytes(start, total);
  };

  Sampler.start = function (opts) {
    var pin = Number(opts && opts.pin);
    if (!isFinite(pin) || pin < 0) {
      throw new Error('Sampler.start requires opts.pin (encoded pin number)');
    }
    if (__samplerActiveSession) {
      throw new Error('Sampler already active');
    }

    var periodUs = 0;
    if (opts) {
      // Support a few names; keep it simple and bounded.
      periodUs = Number(opts.periodUs);
      if (!isFinite(periodUs) || periodUs < 0) {
        periodUs = Number(opts.resolutionUs);
      }
      if (!isFinite(periodUs) || periodUs < 0) {
        periodUs = Number(opts.tickUs);
      }
      if (!isFinite(periodUs) || periodUs < 0) {
        periodUs = 0;
      }
    }
    periodUs = Math.floor(periodUs);
    if (periodUs !== 0) {
      if (periodUs < 5) periodUs = 5;
      if (periodUs > 255) periodUs = 255;
    }

    var clearBefore = !!(opts && opts.clearBefore);

    if (clearBefore) {
      Sampler.clear();
    }

    var startPacket = Sampler.packetCount();
    __emwSendPacket(new Uint8Array([EMW_OP_SAMPLE, EMW_SAMPLE_START, pin & 0xff, periodUs & 0xff]), 1500);

    var id = __samplerMakeId();
    __samplerActiveSession = { id: id, pin: pin, startPacket: startPacket, periodUs: periodUs };
    return { id: id, startPacket: startPacket, periodUs: periodUs };
  };

  Sampler.stop = function (id) {
    if (!__samplerActiveSession) return;
    if (id != null && String(id) !== String(__samplerActiveSession.id)) {
      throw new Error('Sampler.stop id mismatch');
    }

    try {
      __emwSendPacket(new Uint8Array([EMW_OP_SAMPLE, EMW_SAMPLE_STOP]), 1500);
    } finally {
      __samplerActiveSession = null;
    }
  };

  Sampler.status = function (id) {
    var active = !!__samplerActiveSession;
    if (id != null && active && String(id) !== String(__samplerActiveSession.id)) {
      active = false;
    }
    return {
      active: active,
      pin: active ? __samplerActiveSession.pin : undefined,
      packetCount: Sampler.packetCount(),
      lenBytes: Sampler.lenBytes(),
    };
  };

  Sampler.capture = function (opts) {
    var pin = Number(opts && opts.pin);
    var durationMs = Math.max(0, Number(opts && opts.durationMs) || 0);
    var clearBefore = opts && typeof opts.clearBefore === 'boolean' ? !!opts.clearBefore : true;

    var session = null;
    try {
      session = Sampler.start({ pin: pin, clearBefore: clearBefore });
      __samplerSleep(durationMs);
    } finally {
      try { Sampler.stop(session && session.id); } catch (e) {}
    }

    var endPacket = Sampler.packetCount();
    var bytes = __samplerReadPacketRange(session ? session.startPacket : 0, endPacket);
    return {
      bytes: bytes,
      startPacket: session ? session.startPacket : 0,
      endPacket: endPacket,
      bufferLenBytes: Sampler.lenBytes(),
    };
  };

  // Desktop-only extensions used by the Sampler UI.
  // These are implemented by the desktop host/runtime (Rust) and are optional.
  Sampler.setBytes = function (bytes) {
    if (typeof _scriptBufferSetBytes !== 'function') {
      throw new Error('Sampler.setBytes unavailable on this host');
    }
    return Number(_scriptBufferSetBytes(bytes));
  };

  Sampler.saveBytesFile = function (path) {
    if (typeof _scriptBufferSaveBytesFile !== 'function') {
      throw new Error('Sampler.saveBytesFile unavailable on this host');
    }
    return _scriptBufferSaveBytesFile(String(path || ''));
  };

  Sampler.buildSignedRawTimings = function (opts) {
    if (typeof _scriptBufferBuildSignedRawTimings !== 'function') {
      throw new Error('Sampler.buildSignedRawTimings unavailable on this host');
    }
    var samplePeriodUs = opts && typeof opts.samplePeriodUs === 'number' ? (opts.samplePeriodUs | 0) : 0;
    return String(_scriptBufferBuildSignedRawTimings(samplePeriodUs) || '');
  };

  Sampler.transmitBufferStart = function (bytes, opts) {
    if (typeof _scriptDeviceTransmitBufferStart !== 'function') {
      throw new Error('Sampler.transmitBufferStart unavailable on this host');
    }
    var options = opts && typeof opts === 'object' ? opts : {};
    var onDone = options.onDone;
    var doneToken = null;
    if (typeof onDone === 'function') {
      doneToken = '__tx_done:' + String(Date.now()) + ':' + Math.random().toString(16).slice(2);
      // Register in the host callback registry so native hosts can invoke by token.
      if (typeof _scriptRegisterCallback === 'function') {
        _scriptRegisterCallback(doneToken, onDone);
      } else if (typeof globalThis.__scriptCallbacks === 'object' && globalThis.__scriptCallbacks) {
        // Fallback for older hosts.
        globalThis.__scriptCallbacks[doneToken] = onDone;
      }
    }

    // Pass TX options through to the host primitive.
    // Hosts may ignore unknown fields.
    var txOpts = {
      pin: options.pin,
      dutyPercent: options.dutyPercent,
      freqHz: options.freqHz,
      tickUs: options.tickUs,
    };

    // Backcompat: hosts that only accept (bytes, doneToken) will ignore extra args.
    return _scriptDeviceTransmitBufferStart(bytes, txOpts, doneToken);
  };

  Sampler.transmitStart = function (opts) {
    var pin = Number(opts && opts.pin);
    if (!isFinite(pin) || pin < 0) {
      throw new Error('Sampler.transmitStart requires opts.pin');
    }
    var duty = Number(opts && opts.dutyPercent);
    if (!isFinite(duty) || duty <= 0) duty = 100;
    if (duty > 100) duty = 100;

    var freqHz = Number(opts && opts.freqHz);
    if (!isFinite(freqHz) || freqHz < 0) freqHz = 0;
    var tickUs = Number(opts && opts.tickUs);
    if (!isFinite(tickUs) || tickUs <= 0) tickUs = 5;
    tickUs = Math.max(5, Math.min(255, Math.trunc(tickUs))) & 0xff;

    var hz = (Math.trunc(freqHz) >>> 0);
    var pkt = new Uint8Array(9);
    pkt[0] = EMW_OP_TRANSMIT & 0xff;
    pkt[1] = EMW_TRANSMIT_START & 0xff;
    pkt[2] = pin & 0xff;
    pkt[3] = (Math.trunc(duty) & 0xff);
    pkt[4] = hz & 0xff;
    pkt[5] = (hz >>> 8) & 0xff;
    pkt[6] = (hz >>> 16) & 0xff;
    pkt[7] = (hz >>> 24) & 0xff;
    pkt[8] = tickUs;
    __emwSendPacket(pkt, 1500);
  };

  Sampler.transmitStop = function () {
    __emwSendPacket(new Uint8Array([EMW_OP_TRANSMIT & 0xff, EMW_TRANSMIT_STOP & 0xff]), 1500);
  };

  Sampler.onDeviceEvent = function (eventName, fn) {
    if (typeof _scriptOnDeviceEvent !== 'function') {
      throw new Error('Sampler.onDeviceEvent unavailable on this host');
    }
    return _scriptOnDeviceEvent(String(eventName || ''), fn);
  };
})();

__scriptGlobal.Sampler = Sampler;

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
     var pkt = new Uint8Array([EMW_OP_VERSION]);
     var resp = __emwSendPacket(pkt, 1500);
     var p = __emwPayload(resp);
     var major = p[0] & 0xff;
     var minor = p[1] & 0xff;
     return String(major) + '.' + String(minor);
   };
}
if (typeof device.reset !== 'function') {
  device.reset = function () {
    var pkt = new Uint8Array([EMW_OP_RESET]);
    __emwSendPacket(pkt, 1500);
    return;
  };
}
if (typeof device.boardType !== 'function') {
  device.boardType = function (opts) {
    var refresh = !!(opts && opts.refresh);
    if (!refresh && typeof __scriptGlobal.__scriptDeviceBoardType === 'string' && __scriptGlobal.__scriptDeviceBoardType.length > 0) {
      return __scriptGlobal.__scriptDeviceBoardType;
    }

    var timeout = opts && typeof opts.timeout === 'number' ? (opts.timeout | 0) : 1500;
    var pkt = new Uint8Array([EMW_OP_BOARD_GET]);
    var resp = __emwSendPacket(pkt, timeout);
    var board = String(__scriptDecodeText(__emwPayload(resp)) || '').trim().toLowerCase();
    if (!board) {
      throw new Error('boardType unavailable');
    }
    __scriptGlobal.__scriptDeviceBoardType = board;
    return board;
  };
}
__scriptGlobal.device = device;

// -----------------------------------------------------------------------------
// Arduino-ish API surface (GPIO + SPI + ADC), implemented as thin wrappers over the
// binary opcode protocol.
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

function __scriptResolvePin(pin) {
  if (typeof pin === 'number') return pin;
  var key = String(pin || '').trim();
  var n = Number(key);
  if (isFinite(n)) return n;
  throw new Error('Invalid pin: ' + String(pin));
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

function __scriptAsciiBytes(text) {
  var s = String(text);
  var out = new Uint8Array(s.length);
  for (var i = 0; i < s.length; i += 1) {
    out[i] = s.charCodeAt(i) & 0xff;
  }
  return out;
}

if (typeof pinMode !== 'function') {
  var pinMode = function (pin, mode) {
    var pinNumber = __scriptResolvePin(pin);
    if (String(mode) === INPUT) {
      return __emwSendPacket(new Uint8Array([EMW_OP_GPIO, EMW_GPIO_IN, pinNumber & 0xff]), 1500);
    }
    if (String(mode) === OUTPUT) {
      return __emwSendPacket(new Uint8Array([EMW_OP_GPIO, EMW_GPIO_OUT, pinNumber & 0xff]), 1500);
    }
    throw new Error('pinMode: unsupported mode ' + String(mode));
  };
  __scriptGlobal.pinMode = pinMode;
}

if (typeof digitalWrite !== 'function') {
  var digitalWrite = function (pin, value) {
    var pinNumber = __scriptResolvePin(pin);
    var level = Number(value) ? 1 : 0;
    return __emwSendPacket(
      new Uint8Array([EMW_OP_GPIO, level ? EMW_GPIO_HIGH : EMW_GPIO_LOW, pinNumber & 0xff]),
      1500,
    );
  };
  __scriptGlobal.digitalWrite = digitalWrite;
}

if (typeof digitalRead !== 'function') {
  var digitalRead = function (pin) {
    var pinNumber = __scriptResolvePin(pin);
    var resp = __emwSendPacket(new Uint8Array([EMW_OP_GPIO, EMW_GPIO_READ, pinNumber & 0xff]), 1500);
    if (resp && typeof resp.then === 'function') {
      return resp.then(function (bytes) {
        return bytes && bytes.length > 1 ? (bytes[1] ? HIGH : LOW) : LOW;
      });
    }
    return resp && resp.length > 1 ? (resp[1] ? HIGH : LOW) : LOW;
  };
  __scriptGlobal.digitalRead = digitalRead;
}

if (typeof SPI === 'undefined') {
  var SPI = {
    transfer: function (txBytes, opts) {
      var cs = opts && typeof opts.cs !== 'undefined' ? __scriptResolvePin(opts.cs) : undefined;
      var rxLength = opts && typeof opts.rxLength === 'number' ? opts.rxLength : undefined;

      var csEnc = typeof cs === 'number' ? (cs & 0xff) : 4;
      var rxLen = typeof rxLength === 'number' ? (rxLength | 0) : 0;
      if (rxLen < 0) rxLen = 0;
      if (rxLen > 62) rxLen = 62;

      var tx = txBytes instanceof Uint8Array ? txBytes : new Uint8Array(txBytes || []);
      var txLen = tx.length;
      if (txLen > 60) txLen = 60;

      var pkt = new Uint8Array(4 + txLen);
      pkt[0] = EMW_OP_SPI_XFER;
      pkt[1] = csEnc;
      pkt[2] = rxLen & 0xff;
      pkt[3] = txLen & 0xff;
      for (var i = 0; i < txLen; i += 1) {
        pkt[4 + i] = tx[i] & 0xff;
      }

      var resp = __emwSendPacket(pkt, 1500);
      var want = rxLen > 0 ? rxLen : txLen;
      if (resp && typeof resp.then === 'function') {
        return resp.then(function (bytes) {
          return bytes.slice(1, 1 + want);
        });
      }
      return resp.slice(1, 1 + want);
    },
  };

  __scriptGlobal.SPI = SPI;
}

if (typeof Serial === 'undefined') {
  var Serial = {
    begin: function (baud, opts) {
      var b = typeof baud === 'number' ? baud | 0 : 115200;
      var timeout = opts && typeof opts.timeout === 'number' ? opts.timeout | 0 : 1500;
      var pkt = new Uint8Array(6);
      pkt[0] = EMW_OP_UART;
      pkt[1] = EMW_UART_OPEN;
      __emwWriteU32LE(pkt, 2, b);
      return __emwSendPacket(pkt, timeout);
    },
    end: function (opts) {
      var timeout = opts && typeof opts.timeout === 'number' ? opts.timeout | 0 : 1500;
      return __emwSendPacket(new Uint8Array([EMW_OP_UART, EMW_UART_CLOSE]), timeout);
    },
    write: function (data, opts) {
      var baud = opts && typeof opts.baud === 'number' ? opts.baud | 0 : undefined;
      var timeout = opts && typeof opts.timeout === 'number' ? opts.timeout | 0 : 1500;
      var tx = typeof data === 'string' ? __scriptAsciiBytes(data) : (data instanceof Uint8Array ? data : new Uint8Array(data || []));
      var txLen = tx.length;
      if (txLen > 54) txLen = 54;
      var pkt = new Uint8Array(9 + txLen);
      pkt[0] = EMW_OP_UART;
      pkt[1] = EMW_UART_WRITE;
      __emwWriteU32LE(pkt, 2, typeof baud === 'number' && isFinite(baud) && baud > 0 ? baud : 0);
      __emwWriteU16LE(pkt, 6, timeout);
      pkt[8] = txLen & 0xff;
      for (var i = 0; i < txLen; i += 1) {
        pkt[9 + i] = tx[i] & 0xff;
      }
      var resp = __emwSendPacket(pkt, timeout);
      if (resp && typeof resp.then === 'function') {
        return resp.then(function (bytes) {
          return bytes.slice(1, 2); // payload[0] = written
        });
      }
      return resp.slice(1, 2);
    },
    read: function (n, opts) {
      var len = Number(n) | 0;
      if (len < 0) len = 0;
      if (len > 63) len = 63;
      var baud = opts && typeof opts.baud === 'number' ? opts.baud | 0 : undefined;
      var timeout = opts && typeof opts.timeout === 'number' ? opts.timeout | 0 : 250;
      var pkt = new Uint8Array(9);
      pkt[0] = EMW_OP_UART;
      pkt[1] = EMW_UART_READ;
      __emwWriteU32LE(pkt, 2, typeof baud === 'number' && isFinite(baud) && baud > 0 ? baud : 0);
      __emwWriteU16LE(pkt, 6, timeout);
      pkt[8] = len & 0xff;
      var resp = __emwSendPacket(pkt, timeout);
      var parse = function (bytes) {
        var got = bytes && bytes.length > 1 ? (bytes[1] & 0xff) : 0;
        return bytes.slice(2, 2 + got);
      };
      if (resp && typeof resp.then === 'function') {
        return resp.then(parse);
      }
      return parse(resp);
    },
  };

  __scriptGlobal.Serial = Serial;
}

if (typeof Wire === 'undefined') {
  var Wire = {
    begin: function (hz, opts) {
      var h = typeof hz === 'number' ? hz | 0 : 100000;
      var timeout = opts && typeof opts.timeout === 'number' ? opts.timeout | 0 : 1500;
      var pkt = new Uint8Array(6);
      pkt[0] = EMW_OP_I2C;
      pkt[1] = EMW_I2C_OPEN;
      __emwWriteU32LE(pkt, 2, h);
      return __emwSendPacket(pkt, timeout);
    },
    end: function (opts) {
      var timeout = opts && typeof opts.timeout === 'number' ? opts.timeout | 0 : 1500;
      return __emwSendPacket(new Uint8Array([EMW_OP_I2C, EMW_I2C_CLOSE]), timeout);
    },
    write: function (addr, data, opts) {
      var a = Number(addr) | 0;
      var hz = opts && typeof opts.hz === 'number' ? opts.hz | 0 : undefined;
      var timeout = opts && typeof opts.timeout === 'number' ? opts.timeout | 0 : 250;
      var tx = data instanceof Uint8Array ? data : new Uint8Array(data || []);
      var txLen = tx.length;
      if (txLen > 52) txLen = 52;

      var pkt = new Uint8Array(11 + txLen);
      pkt[0] = EMW_OP_I2C;
      pkt[1] = EMW_I2C_WRITE;
      __emwWriteU32LE(pkt, 2, typeof hz === 'number' && isFinite(hz) && hz > 0 ? hz : 0);
      __emwWriteU16LE(pkt, 6, timeout);
      pkt[8] = a & 0x7f;
      pkt[9] = txLen & 0xff;
      pkt[10] = 0;
      for (var i = 0; i < txLen; i += 1) {
        pkt[11 + i] = tx[i] & 0xff;
      }
      return __emwSendPacket(pkt, timeout);
    },
    read: function (addr, n, opts) {
      var a = Number(addr) | 0;
      var len = Number(n) | 0;
      if (len < 0) len = 0;
      if (len > 63) len = 63;
      var hz = opts && typeof opts.hz === 'number' ? opts.hz | 0 : undefined;
      var timeout = opts && typeof opts.timeout === 'number' ? opts.timeout | 0 : 250;
      var pkt = new Uint8Array(11);
      pkt[0] = EMW_OP_I2C;
      pkt[1] = EMW_I2C_READ;
      __emwWriteU32LE(pkt, 2, typeof hz === 'number' && isFinite(hz) && hz > 0 ? hz : 0);
      __emwWriteU16LE(pkt, 6, timeout);
      pkt[8] = a & 0x7f;
      pkt[9] = len & 0xff;
      pkt[10] = 0;
      var resp = __emwSendPacket(pkt, timeout);
      var parse = function (bytes) {
        return bytes.slice(1, 1 + len);
      };
      if (resp && typeof resp.then === 'function') {
        return resp.then(parse);
      }
      return parse(resp);
    },
    xfer: function (addr, tx, rxLen, opts) {
      var a = Number(addr) | 0;
      var len = Number(rxLen) | 0;
      if (len < 0) len = 0;
      if (len > 63) len = 63;
      var hz = opts && typeof opts.hz === 'number' ? opts.hz | 0 : undefined;
      var timeout = opts && typeof opts.timeout === 'number' ? opts.timeout | 0 : 250;
      var txBytes = tx instanceof Uint8Array ? tx : new Uint8Array(tx || []);
      var txLen = txBytes.length;
      if (txLen > 51) txLen = 51;
      if (len > 62) len = 62;

      var pkt = new Uint8Array(11 + txLen);
      pkt[0] = EMW_OP_I2C;
      pkt[1] = EMW_I2C_XFER;
      __emwWriteU32LE(pkt, 2, typeof hz === 'number' && isFinite(hz) && hz > 0 ? hz : 0);
      __emwWriteU16LE(pkt, 6, timeout);
      pkt[8] = a & 0x7f;
      pkt[9] = txLen & 0xff;
      pkt[10] = len & 0xff;
      for (var i = 0; i < txLen; i += 1) {
        pkt[11 + i] = txBytes[i] & 0xff;
      }

      var resp = __emwSendPacket(pkt, timeout);
      var parse = function (bytes) {
        return bytes.slice(1, 1 + len);
      };
      if (resp && typeof resp.then === 'function') {
        return resp.then(parse);
      }
      return parse(resp);
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

    var pkt = new Uint8Array([EMW_OP_ADC_READ, EMW_ADC_SRC_PIN, pinNumber & 0xff, samples & 0xff]);
    var resp = __emwSendPacket(pkt, 1500);
    if (resp && typeof resp.then === 'function') {
      return resp.then(function (bytes) {
        return __scriptScaleAnalogRead(__scriptU16FromBytes(__emwPayload(bytes)));
      });
    }
    return __scriptScaleAnalogRead(__scriptU16FromBytes(__emwPayload(resp)));
  };
  __scriptGlobal.analogRead = analogRead;
}

function __scriptAnalogReadInternal(src, opts) {
  var samples = opts && typeof opts.samples === 'number' ? (opts.samples | 0) : 1;
  if (samples < 1) samples = 1;
  if (samples > 64) samples = 64;

  var s = String(src);
  var srcCode = EMW_ADC_SRC_VREFINT;
  if (s === 'temp') srcCode = EMW_ADC_SRC_TEMP;
  else if (s === 'vbat') srcCode = EMW_ADC_SRC_VBAT;
  else if (s === 'vrefint') srcCode = EMW_ADC_SRC_VREFINT;

  var pkt = new Uint8Array([EMW_OP_ADC_READ, srcCode & 0xff, 0, samples & 0xff]);
  var resp = __emwSendPacket(pkt, 1500);
  if (resp && typeof resp.then === 'function') {
    return resp.then(function (bytes) {
      return __scriptScaleAnalogRead(__scriptU16FromBytes(__emwPayload(bytes)));
    });
  }
  return __scriptScaleAnalogRead(__scriptU16FromBytes(__emwPayload(resp)));
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

    var pkt = new Uint8Array(9);
    pkt[0] = EMW_OP_PWM;
    pkt[1] = EMW_PWM_WRITE;
    pkt[2] = pinNumber & 0xff;
    __emwWriteU16LE(pkt, 3, v12);
    __emwWriteU32LE(pkt, 5, typeof hz === 'number' && isFinite(hz) && hz > 0 ? hz : 0);

    return __emwSendPacket(pkt, timeout);
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
      delete assigned.x;
      delete assigned.y;
      delete assigned.left;
      delete assigned.top;
      delete assigned.right;
      delete assigned.bottom;
      if (typeof assigned.position === 'string' && assigned.position.toLowerCase() === 'absolute') {
        delete assigned.position;
      }
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
        // Extended event surface (desktop-only nodes can use these).
        { key: 'onViewportChange', type: 'viewport' },
        { key: 'onSelectRange', type: 'select' },
        { key: 'onCursorMove', type: 'cursor' },
        { key: 'onClose', type: 'close' },
      ];
      events.forEach(function (event) {
        var fn = props[event.key];
        if (typeof fn === 'function') {
          var token = event.type + ':' + id;
          _scriptRegisterCallback(token, fn);
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
      card: function (props) {
        return makeNode('card', props || {});
      },
      text: function (props) {
        return makeNode('text', props || {});
      },
      button: function (props) {
        return makeNode('button', props || {});
      },
      tile: function (props) {
        return makeNode('tile', props || {});
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
        toggle: function (props) {
          return makeNode('toggle', props || {});
        },
        grid: function (props) {
          return makeNode('grid', props || {});
        },
        plot: function (props) {
          return makeNode('plot', props || {});
        },
        modal: function (props) {
          return makeNode('modal', props || {});
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
          return;
        }
        // Host expects JSON string.
        try {
          _scriptRender(JSON.stringify(node));
        } catch (e) {
          // Best-effort fallback.
          _scriptRender('{}');
        }
      },
    };
  })();
}

__scriptGlobal.UI = UI;

// JSX authoring helper.
//
// Native Apple hosts can transpile a small JSX subset to `JSX.h(...)` calls before
// JavaScriptCore evaluates the script. Keep this helper as sugar over the stable
// `UI.*` node API so the native renderers continue to consume the same tree.
if (typeof JSX === 'undefined') {
  var JSX = (function () {
    var tagMap = {
      Column: 'column',
      Row: 'row',
      Card: 'card',
      Text: 'text',
      Button: 'button',
      Tile: 'tile',
      Slider: 'slider',
      LogViewer: 'logViewer',
      Scroll: 'scroll',
      TextField: 'textField',
      TextEditor: 'textEditor',
      Picker: 'picker',
      Toggle: 'toggle',
      Grid: 'grid',
      Plot: 'plot',
      Modal: 'modal',
      Spacer: 'spacer',
      Divider: 'divider',
      Progress: 'progress',
    };

    function flattenChildren(input, out) {
      for (var i = 0; i < input.length; i += 1) {
        var child = input[i];
        if (child === null || child === undefined || child === false) {
          continue;
        }
        if (Array.isArray(child)) {
          flattenChildren(child, out);
          continue;
        }
        out.push(child);
      }
      return out;
    }

    function h(type, props) {
      var assigned = props ? Object.assign({}, props) : {};
      var children = flattenChildren(Array.prototype.slice.call(arguments, 2), []);
      if (children.length) {
        assigned.children = children;
      }

      if (typeof type === 'function') {
        return type(assigned);
      }

      var tag = String(type || '');
      var factoryName = tagMap[tag] || tag;
      var factory = UI && UI[factoryName];
      if (typeof factory !== 'function') {
        throw new Error('Unknown JSX UI tag: ' + tag);
      }

      if (factoryName === 'text' && assigned.text == null && children.length) {
        assigned.text = children.map(function (child) { return String(child); }).join('');
        children = [];
      } else if (factoryName === 'button' && assigned.label == null && children.length) {
        assigned.label = children.map(function (child) { return String(child); }).join('');
        children = [];
      }

      if (children.length) {
        assigned.children = children;
      }
      return factory(assigned);
    }

    return { h: h };
  })();
}

__scriptGlobal.JSX = JSX;

// Primitive tag constants used by the Swift JSX transpiler. These let scripts
// write `<Column>` while still resolving primitives through `JSX.h(...)`.
var Column = 'Column';
var Row = 'Row';
var Card = 'Card';
var Text = 'Text';
var Button = 'Button';
var Tile = 'Tile';
var Slider = 'Slider';
var LogViewer = 'LogViewer';
var Scroll = 'Scroll';
var TextField = 'TextField';
var TextEditor = 'TextEditor';
var Picker = 'Picker';
var Toggle = 'Toggle';
var Grid = 'Grid';
var Plot = 'Plot';
var Modal = 'Modal';
var Spacer = 'Spacer';
var Divider = 'Divider';
var Progress = 'Progress';

// JSX-facing render entry point. `UI.render(...)` remains the stable lower-level
// API for existing scripts.
if (typeof render !== 'function') {
  var render = function (node) {
    return UI.render(node);
  };
  __scriptGlobal.render = render;
}

// Create a native-side plot buffer and return an id.
// This avoids embedding large arrays into the UI tree.
if (__scriptGlobal.UI) {
  __scriptGlobal.UI.buffer = function (bytes) {
    if (typeof _scriptPlotBufferSet !== 'function') {
      throw new Error('UI.buffer unavailable on this host');
    }
    return String(_scriptPlotBufferSet(bytes) || '');
  };
}

// -----------------------------------------------------------------------------
// Desktop host helpers (optional)
// -----------------------------------------------------------------------------

// Minimal filesystem/path helpers.
// Hosts may choose to restrict access; scripts should treat failures as non-fatal.
var FS = {};
FS.__scriptShim = true;

FS.appDataDir = function () {
  if (typeof _scriptAppDataDir === 'function') {
    return String(_scriptAppDataDir() || '');
  }
  return '';
};

FS.join = function () {
  var parts = Array.prototype.slice.call(arguments).map(function (v) {
    return String(v || '');
  });
  if (typeof _scriptPathJoin === 'function') {
    return String(_scriptPathJoin(parts) || parts.join('/'));
  }
  // Best-effort fallback (works on Unix-ish paths).
  return parts
    .filter(Boolean)
    .join('/')
    .replace(/\\/g, '/');
};

FS.ensureDir = function (path) {
  if (typeof _scriptEnsureDir !== 'function') {
    throw new Error('FS.ensureDir unavailable on this host');
  }
  return _scriptEnsureDir(String(path || ''));
};

FS.readDir = function (path) {
  if (typeof _scriptReadDir !== 'function') {
    throw new Error('FS.readDir unavailable on this host');
  }
  return _scriptReadDir(String(path || '')) || [];
};

FS.readText = function (path) {
  if (typeof _scriptReadFileText !== 'function') {
    throw new Error('FS.readText unavailable on this host');
  }
  return String(_scriptReadFileText(String(path || '')) || '');
};

FS.writeText = function (path, content) {
  if (typeof _scriptWriteFileText !== 'function') {
    throw new Error('FS.writeText unavailable on this host');
  }
  return _scriptWriteFileText(String(path || ''), String(content || ''));
};

FS.readBytes = function (path) {
  if (typeof _scriptReadFileBytes !== 'function') {
    throw new Error('FS.readBytes unavailable on this host');
  }
  return _scriptReadFileBytes(String(path || ''));
};

FS.writeBytes = function (path, bytes) {
  if (typeof _scriptWriteFileBytes !== 'function') {
    throw new Error('FS.writeBytes unavailable on this host');
  }
  return _scriptWriteFileBytes(String(path || ''), bytes);
};

FS.remove = function (path) {
  if (typeof _scriptRemovePath !== 'function') {
    throw new Error('FS.remove unavailable on this host');
  }
  return _scriptRemovePath(String(path || ''));
};

FS.rename = function (from, to) {
  if (typeof _scriptRenamePath !== 'function') {
    throw new Error('FS.rename unavailable on this host');
  }
  return _scriptRenamePath(String(from || ''), String(to || ''));
};

FS.reveal = function (path) {
  if (typeof _scriptRevealInFinder !== 'function') {
    throw new Error('FS.reveal unavailable on this host');
  }
  return _scriptRevealInFinder(String(path || ''));
};

__scriptGlobal.FS = FS;
