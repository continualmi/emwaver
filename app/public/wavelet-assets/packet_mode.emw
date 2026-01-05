'use strict';

var logLines = [];
var statusText = '';
var statusIsError = false;
var isBusy = false;

var frequencyMHz = '433.92';
var dataRateBps = '2500';
var powerDbm = '10';
var modulation = 'ASK'; // ASK | 2FSK
var syncWord = 'CB 8A';
var syncMode = '16/16 bits';
var preambleBytes = '3';
var manchester = 'off'; // off | on
var deviationHz = '';
var payloadHex =
  '32 CC CC CB 4D 2D 4A D3 4C AB 4B 15 96 65 99 99 96 9A 5A 95 A6 99 56 96 2B 2C CB 33 33 2D 34 B5 2B 4D 32 AD 28';
var txDelayMs = '300';

var CC1101_F_XTAL_HZ = 26000000.0;

function appendLog(line) {
  var text = String(line || '');
  if (!text) return;
  logLines.push(text);
  if (logLines.length > 400) {
    logLines = logLines.slice(logLines.length - 400);
  }
}

function setStatus(text, isError) {
  statusText = String(text || '');
  statusIsError = !!isError;
}

function toHexByte(n) {
  var v = Number(n) & 0xff;
  var s = v.toString(16).toUpperCase();
  return s.length === 1 ? '0' + s : s;
}

function bytesLikeToArray(bytesLike) {
  if (!bytesLike) return [];
  if (Array.isArray(bytesLike)) {
    return bytesLike.map(function (v) {
      return Number(v) & 0xff;
    });
  }
  var out = [];
  var len = typeof bytesLike.length === 'number' ? bytesLike.length : 0;
  for (var i = 0; i < len; i += 1) {
    out.push(Number(bytesLike[i]) & 0xff);
  }
  return out;
}

function bytesToHex(bytes) {
  var parts = [];
  for (var i = 0; i < bytes.length; i += 1) parts.push(toHexByte(bytes[i]));
  return parts.join(' ');
}

function normalizeHexPairs(input, expectedPairs) {
  var cleaned = String(input || '')
    .replace(/[^0-9a-fA-F]/g, '')
    .toUpperCase();
  if (expectedPairs && cleaned.length > expectedPairs * 2) cleaned = cleaned.slice(0, expectedPairs * 2);
  var parts = [];
  for (var i = 0; i < cleaned.length; i += 2) {
    var pair = cleaned.slice(i, i + 2);
    if (pair.length === 1) pair = '0' + pair;
    if (pair.length === 2) parts.push(pair);
  }
  return parts;
}

function parseHexBytes(input) {
  var pairs = normalizeHexPairs(input, 0);
  return pairs.map(function (p) {
    return parseInt(p, 16) & 0xff;
  });
}

function isAckOk(responseBytes) {
  return responseBytes.length === 1 && (responseBytes[0] & 0xff) === 0x00;
}

function sendCmd(cmd, timeoutMs) {
  appendLog('TX: ' + cmd);
  return bytesLikeToArray(emw.send(cmd, timeoutMs || 1000));
}

function strobe(cmdByte) {
  sendCmd('cc1101 strobe --cmd=0x' + toHexByte(cmdByte), 1000);
}

function writeReg(addr, val) {
  sendCmd('cc1101 write --reg=0x' + toHexByte(addr) + ' --val=0x' + toHexByte(val), 1000);
}

function readReg(addr) {
  var resp = sendCmd('cc1101 read --reg=0x' + toHexByte(addr), 1000);
  return resp.length ? resp[0] & 0xff : 0;
}

function writeBurst(addr, bytes) {
  if (!bytes || bytes.length === 0) return;
  var parts = [];
  for (var i = 0; i < bytes.length; i += 1) parts.push('0x' + toHexByte(bytes[i]));
  sendCmd('cc1101 write_burst --reg=0x' + toHexByte(addr) + ' --data=' + parts.join(','), 1000);
}

function readBurst(addr, len) {
  var resp = sendCmd('cc1101 read_burst --reg=0x' + toHexByte(addr) + ' --len=' + String(len), 1000);
  return resp.length === len ? resp : null;
}

function setFrequencyMHz(value) {
  var mhz = Number(value);
  if (!isFinite(mhz) || mhz <= 0) throw new Error('Invalid frequency (MHz)');
  var word = Math.round(mhz * 1e6 * Math.pow(2, 16) / CC1101_F_XTAL_HZ);
  writeReg(0x0d, (word >> 16) & 0xff);
  writeReg(0x0e, (word >> 8) & 0xff);
  writeReg(0x0f, word & 0xff);
  strobe(0x36); // SIDLE
  strobe(0x33); // SCAL
}

function setDataRate(bpsValue) {
  var bitRate = parseInt(String(bpsValue || '').trim(), 10);
  if (!isFinite(bitRate) || bitRate <= 0) throw new Error('Invalid data rate (bps)');

  var fOsc = CC1101_F_XTAL_HZ;
  var target = bitRate * Math.pow(2, 28) / fOsc;
  var minDifference = 1e100;
  var bestM = 0;
  var bestE = 0;
  for (var e = 0; e <= 15; e += 1) {
    for (var m = 0; m <= 255; m += 1) {
      var currentValue = (256 + m) * Math.pow(2, e);
      var difference = Math.abs(currentValue - target);
      if (difference < minDifference) {
        minDifference = difference;
        bestM = m;
        bestE = e;
      }
    }
  }

  var mdmcfg4Current = readReg(0x10);
  var bandwidthPart = mdmcfg4Current & 0xf0;
  var combinedE = bandwidthPart | (bestE & 0x0f);
  writeBurst(0x10, [combinedE & 0xff, bestM & 0xff]);
  var confirm = readBurst(0x10, 2);
  if (!confirm || confirm[0] !== (combinedE & 0xff) || confirm[1] !== (bestM & 0xff)) {
    throw new Error('Failed to set data rate');
  }
}

function setModulationAndPower(modStr, dbmStr) {
  var mod = modStr === '2FSK' ? 0 : 3;
  var dbm = parseInt(String(dbmStr || '').trim(), 10);
  if (!isFinite(dbm)) dbm = 10;
  var resp = sendCmd('cc1101 set_mod_power --mod=' + String(mod) + ' --dbm=' + String(dbm), 1000);
  if (!isAckOk(resp)) throw new Error('Failed to set modulation/power');
}

function setManchesterEncoding(on) {
  var mdmcfg2 = readReg(0x12);
  if (on) mdmcfg2 = mdmcfg2 | 0x08;
  else mdmcfg2 = mdmcfg2 & 0xf7;
  writeReg(0x12, mdmcfg2);
}

function syncModeValue(label) {
  if (label === 'No preamble/sync word') return 0;
  if (label === '15/16 bits') return 1;
  if (label === '16/16 bits') return 2;
  if (label === '30/32 bits') return 3;
  if (label === 'No preamble/sync + carrier sense above threshold') return 4;
  if (label === '15/16 + carrier sense above threshold') return 5;
  if (label === '16/16 + carrier sense above threshold') return 6;
  if (label === '30/32 + carrier sense above threshold') return 7;
  return 2;
}

function setSyncMode(label) {
  var mdmcfg2 = readReg(0x12);
  mdmcfg2 = (mdmcfg2 & 0xf8) | (syncModeValue(label) & 0x07);
  writeReg(0x12, mdmcfg2);
}

function preambleIndex(value) {
  var options = ['2', '3', '4', '6', '8', '12', '16', '24'];
  var idx = options.indexOf(String(value));
  return idx >= 0 ? idx : 1;
}

function setNumPreambleBytes(value) {
  var idx = preambleIndex(value) & 0x07;
  var mdmcfg1 = readReg(0x13);
  mdmcfg1 = (mdmcfg1 & 0x8f) | ((idx & 0x07) << 4);
  writeReg(0x13, mdmcfg1);
}

function setSyncWordBytes(wordBytes) {
  if (!wordBytes || wordBytes.length !== 2) throw new Error('Sync word must be 2 bytes');
  writeReg(0x04, wordBytes[0]);
  writeReg(0x05, wordBytes[1]);
}

function setDeviationHz(value) {
  var deviation = parseInt(String(value || '').trim(), 10);
  if (!isFinite(deviation) || deviation <= 0) return;

  var fOsc = CC1101_F_XTAL_HZ;
  var target = deviation * Math.pow(2, 17) / fOsc;
  var minDifference = 1e100;
  var bestM = 0;
  var bestE = 0;
  for (var e = 0; e <= 7; e += 1) {
    for (var m = 0; m <= 7; m += 1) {
      var currentValue = (8 + m) * Math.pow(2, e);
      var difference = Math.abs(currentValue - target);
      if (difference < minDifference) {
        minDifference = difference;
        bestM = m;
        bestE = e;
      }
    }
  }
  var deviatn = ((bestE & 0x07) << 4) | (bestM & 0x07);
  writeReg(0x15, deviatn & 0xff);
}

function applyConfiguration() {
  setFrequencyMHz(frequencyMHz);
  setDataRate(dataRateBps);
  setModulationAndPower(modulation, powerDbm);

  var syncPairs = normalizeHexPairs(syncWord, 2);
  if (syncPairs.length !== 2) throw new Error('Sync word must be 2 bytes hex');
  setSyncWordBytes([parseInt(syncPairs[0], 16) & 0xff, parseInt(syncPairs[1], 16) & 0xff]);

  setSyncMode(syncMode);
  setNumPreambleBytes(preambleBytes);
  setManchesterEncoding(manchester === 'on');
  if (String(deviationHz || '').trim()) setDeviationHz(deviationHz);

  // Packet mode baseline.
  writeReg(0x08, 0x00); // PKTCTRL0 fixed-length packet mode
}

function runBusy(label, fn) {
  try {
    isBusy = true;
    setStatus(label + '…', false);
    render();
    fn();
    setStatus(label + ' OK', false);
  } catch (e) {
    var message = e && e.message ? e.message : String(e);
    setStatus(message, true);
    appendLog('ERR: ' + message);
  } finally {
    isBusy = false;
    render();
  }
}

function initRadio() {
  runBusy('Init', function () {
    sendCmd('cc1101 init', 1500);
    strobe(0x30); // SRES
    sendCmd('cc1101 apply_defaults', 1500);
    applyConfiguration();
    strobe(0x36); // SIDLE
    strobe(0x3b); // SFTX
  });
}

function startRx() {
  runBusy('Start RX', function () {
    initRadio();
    strobe(0x3a); // SFRX
    strobe(0x34); // SRX
  });
}

function pollRx() {
  runBusy('Poll RX', function () {
    var rxBytes = readReg(0x3b); // RXBYTES
    var count = rxBytes & 0x7f;
    if (count <= 0) {
      appendLog('[RX] No data');
      return;
    }
    var data = readBurst(0x3f, count);
    strobe(0x3a); // SFRX
    strobe(0x34); // SRX
    if (data) appendLog('[RX] ' + bytesToHex(data));
  });
}

function sendTx() {
  runBusy('Send TX', function () {
    sendCmd('cc1101 init', 1500);
    sendCmd('cc1101 apply_defaults', 1500);
    applyConfiguration();

    var bytes = parseHexBytes(payloadHex);
    if (!bytes.length) throw new Error('Invalid payload hex');

    // Convenience: if payload includes AA AA AA + sync + payload, strip preamble+sync.
    if (bytes.length >= 5 && bytes[0] === 0xaa && bytes[1] === 0xaa && bytes[2] === 0xaa) {
      setSyncWordBytes([bytes[3], bytes[4]]);
      bytes = bytes.slice(5);
    }

    writeReg(0x08, 0x00); // PKTCTRL0 fixed-length
    writeReg(0x06, bytes.length & 0xff); // PKTLEN

    strobe(0x36); // SIDLE
    strobe(0x3b); // SFTX
    writeBurst(0x3f, bytes); // TXFIFO
    strobe(0x35); // STX

    var delay = parseInt(String(txDelayMs || '').trim(), 10);
    if (!isFinite(delay) || delay < 0) delay = 300;
    Utils.delay(delay);

    strobe(0x36); // SIDLE
    strobe(0x3b); // SFTX
    appendLog('[TX] sent ' + String(bytes.length) + ' bytes');
  });
}

function render() {
  UI.render(
    UI.scroll({
      padding: 16,
      spacing: 12,
      children: [
        UI.text({ text: 'Packet Mode', font: 'title2', fontWeight: 'semibold' }),
        UI.text({ text: 'CC1101 fixed-length packet workflow', fontWeight: 'medium' }),
        statusText
          ? UI.text({
              text: statusText,
              foregroundColor: statusIsError ? '#FCA5A5' : '#86EFAC',
            })
          : null,
        isBusy ? UI.progress({}) : null,
        UI.text({ text: 'Radio', fontWeight: 'semibold' }),
        UI.row({
          spacing: 8,
          children: [
            UI.textField({
              value: frequencyMHz,
              placeholder: '433.92',
              onChange: function (v) {
                frequencyMHz = String(v || '');
                render();
              },
            }),
            UI.textField({
              value: dataRateBps,
              placeholder: '2500',
              onChange: function (v) {
                dataRateBps = String(v || '');
                render();
              },
            }),
          ],
        }),
        UI.row({
          spacing: 8,
          children: [
            UI.picker({
              style: 'menu',
              selected: modulation,
              options: [
                { label: 'ASK', value: 'ASK' },
                { label: '2FSK', value: '2FSK' },
              ],
              onChange: function (v) {
                modulation = v === '2FSK' ? '2FSK' : 'ASK';
                render();
              },
            }),
            UI.textField({
              value: powerDbm,
              placeholder: '10',
              onChange: function (v) {
                powerDbm = String(v || '');
                render();
              },
            }),
          ],
        }),
        UI.text({ text: 'Packet', fontWeight: 'semibold' }),
        UI.row({
          spacing: 8,
          children: [
            UI.textField({
              value: syncWord,
              placeholder: 'CB 8A',
              onChange: function (v) {
                var pairs = normalizeHexPairs(v, 2);
                syncWord = pairs.join(' ');
                render();
              },
            }),
            UI.picker({
              style: 'menu',
              selected: syncMode,
              options: [
                { label: 'No preamble/sync word', value: 'No preamble/sync word' },
                { label: '15/16 bits', value: '15/16 bits' },
                { label: '16/16 bits', value: '16/16 bits' },
                { label: '30/32 bits', value: '30/32 bits' },
                { label: 'No preamble/sync + carrier sense above threshold', value: 'No preamble/sync + carrier sense above threshold' },
                { label: '15/16 + carrier sense above threshold', value: '15/16 + carrier sense above threshold' },
                { label: '16/16 + carrier sense above threshold', value: '16/16 + carrier sense above threshold' },
                { label: '30/32 + carrier sense above threshold', value: '30/32 + carrier sense above threshold' },
              ],
              onChange: function (v) {
                syncMode = String(v || '16/16 bits');
                render();
              },
            }),
          ],
        }),
        UI.row({
          spacing: 8,
          children: [
            UI.picker({
              style: 'menu',
              selected: preambleBytes,
              options: [
                { label: '2', value: '2' },
                { label: '3', value: '3' },
                { label: '4', value: '4' },
                { label: '6', value: '6' },
                { label: '8', value: '8' },
                { label: '12', value: '12' },
                { label: '16', value: '16' },
                { label: '24', value: '24' },
              ],
              onChange: function (v) {
                preambleBytes = String(v || '3');
                render();
              },
            }),
            UI.picker({
              style: 'segmented',
              selected: manchester,
              options: [
                { label: 'Manchester Off', value: 'off' },
                { label: 'Manchester On', value: 'on' },
              ],
              onChange: function (v) {
                manchester = v === 'on' ? 'on' : 'off';
                render();
              },
            }),
          ],
        }),
        UI.row({
          spacing: 8,
          children: [
            UI.textField({
              value: deviationHz,
              placeholder: 'Deviation (Hz) optional',
              onChange: function (v) {
                deviationHz = String(v || '');
                render();
              },
            }),
            UI.textField({
              value: txDelayMs,
              placeholder: 'TX delay ms',
              onChange: function (v) {
                txDelayMs = String(v || '');
                render();
              },
            }),
          ],
        }),
        UI.textEditor({
          value: payloadHex,
          placeholder: 'TX payload hex',
          minHeight: 120,
          onChange: function (v) {
            payloadHex = String(v || '');
            render();
          },
        }),
        UI.row({
          spacing: 10,
          children: [
            UI.button({ label: 'Init', onTap: initRadio, backgroundColor: '#334155', foregroundColor: '#FFFFFF' }),
            UI.button({ label: 'Start RX', onTap: startRx, backgroundColor: '#2563EB', foregroundColor: '#FFFFFF' }),
            UI.button({ label: 'Poll RX', onTap: pollRx }),
          ],
        }),
        UI.row({
          spacing: 10,
          children: [
            UI.button({ label: 'Send TX', onTap: sendTx, backgroundColor: '#DC2626', foregroundColor: '#FFFFFF' }),
            UI.button({
              label: 'Clear Log',
              onTap: function () {
                logLines = [];
                render();
              },
            }),
          ],
        }),
        UI.logViewer({ text: logLines.join('\n'), minHeight: 200 }),
      ],
    }),
  );
}

render();

