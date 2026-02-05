// Bundled example scripts for the web dashboard.
// Source-of-truth lives in assets/default-scripts/*.emw.

export type ExampleEmwScript = {
  name: string;
  source: string;
};

export const exampleEmwScripts: ExampleEmwScript[] = [
  {
    name: "adc.emw",
    source: `// Simple ADC (analogRead) test script for STM32F042
let mode = "pin"; // "pin" | "internal"
let selectedPin = "0";
let internalSrc = "vrefint"; // "vrefint" | "temp" | "vbat"
let samples = 1;
let statusText = "";
let lastResponse = "";

const ADC_PINS = [
  { label: "A0 / ADC_IN0", value: "0" },
  { label: "A1 / ADC_IN1", value: "1" },
  { label: "A2 / ADC_IN2", value: "2" },
  { label: "A3 / ADC_IN3", value: "3" },
  { label: "A4 / ADC_IN4", value: "4" },
  { label: "A5 / ADC_IN5", value: "5" },
  { label: "A6 / ADC_IN6", value: "6" },
  { label: "A7 / ADC_IN7", value: "7" },
];

const INTERNAL_SOURCES = [
  { label: "VREFINT (internal reference)", value: "vrefint" },
  { label: "TEMP (die temperature sensor)", value: "temp" },
  { label: "VBAT (battery domain)", value: "vbat" },
];

function readAdc() {
  statusText = "Reading...";
  lastResponse = "";
  render();

  const nSamples = Math.max(1, Math.min(64, Number(samples) | 0));

  let result;
  let cmd;
  if (mode === "internal") {
    cmd = "adc read --src=" + internalSrc + (nSamples !== 1 ? " --samples=" + nSamples : "");
    if (internalSrc === "vrefint") result = analogReadVrefint({ samples: nSamples });
    else if (internalSrc === "temp") result = analogReadTemp({ samples: nSamples });
    else result = analogReadVbat({ samples: nSamples });
  } else {
    cmd = "adc read --pin=" + selectedPin + (nSamples !== 1 ? " --samples=" + nSamples : "");
    result = analogRead(Number(selectedPin), { samples: nSamples });
  }

  const finalize = function (value) {
    statusText = "Value: " + String(value) + " (0..4095)";
    lastResponse = cmd + " -> " + String(value);
    render();
  };

  if (result && typeof result.then === "function") {
    result.then(finalize);
  } else {
    finalize(result);
  }
}

function render() {
  UI.render(
    UI.column({
      padding: 16,
      spacing: 16,
      children: [
        UI.text({ text: "ADC / analogRead", font: "title2", fontWeight: "semibold" }),

        UI.text({ text: "Source", fontWeight: "medium" }),
        UI.picker({
          style: "segmented",
          selected: mode,
          options: [
            { label: "Pin", value: "pin" },
            { label: "Internal", value: "internal" },
          ],
          onChange: function (value) {
            mode = value;
            render();
          },
        }),

        mode === "pin"
          ? UI.column({
              spacing: 8,
              children: [
                UI.text({ text: "ADC Pin", fontWeight: "medium" }),
                UI.picker({
                  style: "menu",
                  selected: String(selectedPin),
                  options: ADC_PINS,
                  onChange: function (value) {
                    selectedPin = value;
                  },
                }),
              ],
            })
          : UI.column({
              spacing: 8,
              children: [
                UI.text({ text: "Internal Channel", fontWeight: "medium" }),
                UI.picker({
                  style: "menu",
                  selected: String(internalSrc),
                  options: INTERNAL_SOURCES,
                  onChange: function (value) {
                    internalSrc = value;
                  },
                }),
              ],
            }),

        UI.text({ text: "Samples (averaged)", fontWeight: "medium" }),
        UI.slider({
          min: 1,
          max: 32,
          step: 1,
          value: samples,
          onChange: function (v) {
            samples = v;
          },
        }),

        UI.button({
          label: "Read",
          backgroundColor: "#2563EB",
          foregroundColor: "#FFFFFF",
          onTap: readAdc,
        }),

        statusText
          ? UI.text({
              text: statusText,
              backgroundColor: "#111827",
              foregroundColor: "#FFFFFF",
              padding: { top: 12, bottom: 12, leading: 12, trailing: 12 },
              cornerRadius: 8,
            })
          : null,

        lastResponse
          ? UI.text({
              text: lastResponse,
              backgroundColor: "#0B1220",
              foregroundColor: "#E5E7EB",
              padding: { top: 12, bottom: 12, leading: 12, trailing: 12 },
              cornerRadius: 8,
            })
          : null,
      ],
    }),
  );
}

render();
`,
  },
  {
    name: "blink.emw",
    source: `// Blink a pin using timers (setTimeout) + \`every()\`.

let selectedPin = GDO0;
let periodMs = 250;
let isBlinking = false;
let level = LOW;
let loopHandle = null;

const PINS = [
  { label: "GDO0 (A2)", value: GDO0 },
  { label: "GDO2 (A3)", value: GDO2 },
  { label: "IR_RX (A0)", value: IR_RX },
  { label: "IR_TX (A1)", value: IR_TX },
  { label: "NSS (A4)", value: NSS },
  { label: "SCK (A5)", value: SCK },
  { label: "MISO (A6)", value: MISO },
  { label: "MOSI (A7)", value: MOSI },
  { label: "SWCLK (A13)", value: SWCLK },
  { label: "SWDIO (A14)", value: SWDIO },
  { label: "UART_TX (B6)", value: UART_TX },
  { label: "UART_RX (B7)", value: UART_RX },
];

function stopBlink() {
  if (loopHandle && typeof loopHandle.stop === "function") {
    loopHandle.stop();
  }
  loopHandle = null;
  isBlinking = false;
  render();
}

function startBlink() {
  stopBlink();

  const period = Math.max(1, Math.floor(Number(periodMs) || 1));
  periodMs = period;
  level = LOW;
  pinMode(selectedPin, OUTPUT);
  digitalWrite(selectedPin, level);

  isBlinking = true;
  render();

  loopHandle = every(periodMs, function () {
    level = level === LOW ? HIGH : LOW;
    digitalWrite(selectedPin, level);
  });
}

function toggleBlink() {
  if (isBlinking) {
    stopBlink();
    return;
  }
  startBlink();
}

function render() {
  UI.render(
    UI.column({
      padding: 16,
      spacing: 14,
      children: [
        UI.text({ text: "Blink", font: "title2", fontWeight: "semibold" }),

        UI.picker({
          id: "blink.pin",
          style: "menu",
          selected: String(selectedPin),
          options: PINS,
          onChange: function (value) {
            selectedPin = String(value);
            if (isBlinking) {
              void startBlink();
            } else {
              render();
            }
          },
        }),

        UI.slider({
          id: "blink.period",
          value: Number(periodMs),
          min: 1,
          max: 2000,
          step: 1,
          onSubmit: function (value) {
            periodMs = Math.max(1, Math.floor(Number(value) || 1));
            if (isBlinking) {
              void startBlink();
            } else {
              render();
            }
          },
        }),

        UI.button({
          id: "blink.toggle",
          label: isBlinking ? "Stop" : "Start",
          backgroundColor: isBlinking ? "rgba(244, 63, 94, 0.18)" : "rgba(16, 185, 129, 0.18)",
          foregroundColor: isBlinking ? "#FFE4E6" : "#D1FAE5",
          onTap: toggleBlink,
        }),
      ],
    }),
  );
}

render();
`,
  },
  {
    name: "cc1101.emw",
    source: `const CC1101_REG_IOCFG2 = 0x00;
const CC1101_REG_IOCFG1 = 0x01;
const CC1101_REG_IOCFG0 = 0x02;
const CC1101_REG_PKTLEN = 0x06;
const CC1101_REG_PKTCTRL1 = 0x07;
const CC1101_REG_PKTCTRL0 = 0x08;
const CC1101_REG_ADDR = 0x09;
const CC1101_REG_CHANNR = 0x0a;
const CC1101_REG_FSCTRL1 = 0x0b;
const CC1101_REG_FREQ2 = 0x0d;
const CC1101_REG_FREQ1 = 0x0e;
const CC1101_REG_FREQ0 = 0x0f;
const CC1101_REG_MDMCFG4 = 0x10;
const CC1101_REG_MDMCFG3 = 0x11;
const CC1101_REG_MDMCFG2 = 0x12;
const CC1101_REG_MDMCFG1 = 0x13;
const CC1101_REG_MDMCFG0 = 0x14;
const CC1101_REG_DEVIATN = 0x15;
const CC1101_REG_MCSM0 = 0x18;
const CC1101_REG_FOCCFG = 0x19;
const CC1101_REG_BSCFG = 0x1a;
const CC1101_REG_AGCCTRL2 = 0x1b;
const CC1101_REG_AGCCTRL1 = 0x1c;
const CC1101_REG_AGCCTRL0 = 0x1d;
const CC1101_REG_FREND1 = 0x21;
const CC1101_REG_FREND0 = 0x22;
const CC1101_REG_FSCAL3 = 0x23;
const CC1101_REG_FSCAL2 = 0x24;
const CC1101_REG_FSCAL1 = 0x25;
const CC1101_REG_FSCAL0 = 0x26;
const CC1101_REG_FSTEST = 0x29;
const CC1101_REG_TEST2 = 0x2c;
const CC1101_REG_TEST1 = 0x2d;
const CC1101_REG_TEST0 = 0x2e;
const CC1101_REG_PATABLE = 0x3e;
const CC1101_REG_FIFO = 0x3f;

const CC1101_SRES = 0x30;
const CC1101_SRX = 0x34;
const CC1101_STX = 0x35;
const CC1101_SIDLE = 0x36;
const CC1101_SFTX = 0x3b;

const CC1101_F_XTAL_HZ = 26_000_000.0;
const CC1101_PA_TABLE_SIZE = 8;
const CC1101_MOD_ASK = 3;

const CC1101_POWER_LEVELS_DBM = [-30, -20, -15, -10, 0, 5, 7, 10];
const CC1101_POWER_SETTING_433MHZ = [0x12, 0x0e, 0x1d, 0x34, 0x60, 0x84, 0xc8, 0xc0];

function cc1101Strobe(cmdByte) {
  SPI.transfer([cmdByte & 0xff], { cs: CC1101_CS });
}

function cc1101Reset() {
  cc1101Strobe(CC1101_SRES);
}

function cc1101WriteReg(addr, value) {
  SPI.transfer([addr & 0x3f, value & 0xff], { cs: CC1101_CS });
}

function cc1101ReadReg(addr) {
  const isStatus = addr >= 0x30 && addr <= 0x3d;
  const cmd = isStatus ? ((addr & 0x3f) | 0xc0) : ((addr & 0x3f) | 0x80);
  const response = SPI.transfer([cmd, 0x00], { cs: CC1101_CS, rxLength: 2 });
  return response && response.length >= 2 ? response[1] & 0xff : 0;
}

function cc1101WriteBurst(addr, data) {
  const tx = [((addr & 0x3f) | 0x40)].concat((data || []).map((v) => v & 0xff));
  SPI.transfer(tx, { cs: CC1101_CS });
  return true;
}

function cc1101ApplyDefaults() {
  cc1101WriteReg(CC1101_REG_FSCTRL1, 0x06);
  cc1101WriteReg(CC1101_REG_MDMCFG1, 0x02);
  cc1101WriteReg(CC1101_REG_MDMCFG0, 0xf8);
  cc1101WriteReg(CC1101_REG_CHANNR, 0x00);
  cc1101WriteReg(CC1101_REG_DEVIATN, 0x47);
  cc1101WriteReg(CC1101_REG_MCSM0, 0x18);
  cc1101WriteReg(CC1101_REG_FOCCFG, 0x16);
  cc1101WriteReg(CC1101_REG_BSCFG, 0x1c);
  cc1101WriteReg(CC1101_REG_AGCCTRL2, 0xc7);
  cc1101WriteReg(CC1101_REG_AGCCTRL1, 0x00);
  cc1101WriteReg(CC1101_REG_AGCCTRL0, 0xb2);
  cc1101WriteReg(CC1101_REG_FREND1, 0x56);
  cc1101WriteReg(CC1101_REG_FSCAL3, 0xe9);
  cc1101WriteReg(CC1101_REG_FSCAL2, 0x2a);
  cc1101WriteReg(CC1101_REG_FSCAL1, 0x00);
  cc1101WriteReg(CC1101_REG_FSCAL0, 0x1f);
  cc1101WriteReg(CC1101_REG_FSTEST, 0x59);
  cc1101WriteReg(CC1101_REG_TEST2, 0x81);
  cc1101WriteReg(CC1101_REG_TEST1, 0x35);
  cc1101WriteReg(CC1101_REG_TEST0, 0x09);
  cc1101WriteReg(CC1101_REG_PKTCTRL0, 0x00);
  cc1101WriteReg(CC1101_REG_PKTCTRL1, 0x04);
  cc1101WriteReg(CC1101_REG_ADDR, 0x00);
  cc1101WriteReg(CC1101_REG_PKTLEN, 0xff);
}

function cc1101SetGdo(gdo2, gdo1, gdo0) {
  cc1101WriteReg(CC1101_REG_IOCFG2, gdo2);
  cc1101WriteReg(CC1101_REG_IOCFG1, gdo1);
  cc1101WriteReg(CC1101_REG_IOCFG0, gdo0);
}

function cc1101SetFrequencyMHz(frequencyMHz) {
  const word = Math.round((frequencyMHz * 1e6 * Math.pow(2, 16)) / CC1101_F_XTAL_HZ);
  cc1101WriteReg(CC1101_REG_FREQ2, (word >> 16) & 0xff);
  cc1101WriteReg(CC1101_REG_FREQ1, (word >> 8) & 0xff);
  cc1101WriteReg(CC1101_REG_FREQ0, word & 0xff);
}

function cc1101SetDataRate(bitRate) {
  if (!bitRate || bitRate <= 0) return;
  const target = (bitRate * Math.pow(2, 28)) / CC1101_F_XTAL_HZ;
  let bestM = 0;
  let bestE = 0;
  let bestDiff = Number.MAX_VALUE;
  for (let e = 0; e <= 15; e += 1) {
    for (let m = 0; m <= 255; m += 1) {
      const current = (256 + m) * Math.pow(2, e);
      const diff = Math.abs(current - target);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestM = m;
        bestE = e;
      }
    }
  }
  const current = cc1101ReadReg(CC1101_REG_MDMCFG4);
  const bandwidthPart = current & 0xf0;
  const newMdmcfg4 = (bandwidthPart | (bestE & 0x0f)) & 0xff;
  const newMdmcfg3 = bestM & 0xff;
  cc1101WriteReg(CC1101_REG_MDMCFG4, newMdmcfg4);
  cc1101WriteReg(CC1101_REG_MDMCFG3, newMdmcfg3);
}

function cc1101SetModulationAndPower(modulation, dbm) {
  const powerIndex = CC1101_POWER_LEVELS_DBM.indexOf(dbm);
  if (powerIndex < 0) return;
  const powerSetting = CC1101_POWER_SETTING_433MHZ[powerIndex] & 0xff;

  const currentMdmcfg2 = cc1101ReadReg(CC1101_REG_MDMCFG2);
  const newMdmcfg2 = ((currentMdmcfg2 & 0x0f) | ((modulation & 0x07) << 4)) & 0xff;
  const frend0 = modulation === CC1101_MOD_ASK ? 0x11 : 0x10;
  cc1101WriteReg(CC1101_REG_MDMCFG2, newMdmcfg2);
  cc1101WriteReg(CC1101_REG_FREND0, frend0);
  const paTable = new Array(CC1101_PA_TABLE_SIZE).fill(0);
  if (modulation === CC1101_MOD_ASK) {
    paTable[1] = powerSetting;
  } else {
    paTable[0] = powerSetting;
  }
  cc1101WriteBurst(CC1101_REG_PATABLE, paTable);
}

function initRx() {
  statusText = "Initializing RX...";
  render();
  cc1101Reset();
  cc1101ApplyDefaults();
  cc1101WriteReg(CC1101_REG_PKTCTRL0, 0x32);
  cc1101SetGdo(0x2e, 0x2e, 0x0d);
  pinMode(GDO0, INPUT);
  cc1101SetFrequencyMHz(433.92);
  cc1101SetDataRate(100000);
  cc1101SetModulationAndPower(CC1101_MOD_ASK, 10);
  cc1101Strobe(CC1101_SRX);
  statusText = "RX init complete";
  render();
}

function initTx() {
  statusText = "Initializing TX...";
  render();
  cc1101Reset();
  cc1101ApplyDefaults();
  cc1101WriteReg(CC1101_REG_PKTCTRL0, 0x32);
  cc1101SetGdo(0x2e, 0x2e, 0x0d);
  // Hold the OOK/data line low so the radio doesn't output a continuous carrier after STX.
  pinMode(GDO0, OUTPUT);
  digitalWrite(GDO0, LOW);
  cc1101SetFrequencyMHz(433.92);
  cc1101SetDataRate(100000);
  cc1101SetModulationAndPower(CC1101_MOD_ASK, 10);
  cc1101Strobe(CC1101_STX);
  statusText = "TX init complete";
  render();
}

var statusText = "Ready";

var packetCsPin = typeof CC1101_CS !== "undefined" ? CC1101_CS : 4;
var packetFreqMHz = 433.92;
var packetDataRateBps = 100000;
var packetPayloadHex = "01 02 03 04";
var packetStatus = "";
var packetLogLines = [];

function packetPushLog(line) {
  packetLogLines.push(String(line));
  if (packetLogLines.length > 400) packetLogLines = packetLogLines.slice(packetLogLines.length - 400);
}

function toHexByte(n) {
  var v = Number(n) & 0xff;
  var s = v.toString(16).toUpperCase();
  return s.length === 1 ? "0" + s : s;
}

function parseHexBytes(text, maxLen) {
  var s = String(text || "")
    .replace(/^0x/i, "")
    .replace(/[^0-9a-f]/gi, "");
  var out = [];
  for (var i = 0; i + 1 < s.length; i += 2) {
    if (out.length >= maxLen) break;
    out.push(parseInt(s.slice(i, i + 2), 16) & 0xff);
  }
  return out;
}

function packetStrobe(cmdByte) {
  var response = SPI.transfer([cmdByte & 0xff], { cs: packetCsPin, rxLength: 1 });
  return response && response.length ? response[0] & 0xff : 0;
}

function packetWriteReg(addr, value) {
  SPI.transfer([addr & 0x3f, value & 0xff], { cs: packetCsPin });
}

function packetReadReg(addr) {
  var cmd = 0x80 | (addr & 0x3f);
  var response = SPI.transfer([cmd, 0x00], { cs: packetCsPin, rxLength: 2 });
  return response && response.length > 1 ? response[1] & 0xff : 0;
}

function packetWriteBurst(addr, bytes) {
  var cmd = 0x40 | (addr & 0x3f);
  SPI.transfer([cmd].concat(bytes || []), { cs: packetCsPin });
}

function packetSetFrequencyMHz(mhz) {
  var word = Math.round((Number(mhz) * 1e6 * Math.pow(2, 16)) / CC1101_F_XTAL_HZ) >>> 0;
  packetWriteReg(CC1101_REG_FREQ2, (word >> 16) & 0xff);
  packetWriteReg(CC1101_REG_FREQ1, (word >> 8) & 0xff);
  packetWriteReg(CC1101_REG_FREQ0, word & 0xff);
}

function packetSetDataRate(bps) {
  var target = (Number(bps) * Math.pow(2, 28)) / CC1101_F_XTAL_HZ;
  var e = 0;
  while (e < 15 && target > 256 * Math.pow(2, e)) e += 1;
  var mant = Math.max(0, Math.min(255, Math.round(target / Math.pow(2, e) - 256)));

  var cur = packetReadReg(CC1101_REG_MDMCFG4);
  var mdmcfg4 = (cur & 0xf0) | (e & 0x0f);
  packetWriteReg(CC1101_REG_MDMCFG4, mdmcfg4);
  packetWriteReg(CC1101_REG_MDMCFG3, mant & 0xff);
}

function packetInitFixed() {
  packetStatus = "Initializing...";
  render();

  var bytes = parseHexBytes(packetPayloadHex, 61);

  packetStrobe(CC1101_SRES);
  packetStrobe(CC1101_SIDLE);
  packetStrobe(CC1101_SFTX);

  packetWriteReg(CC1101_REG_PKTCTRL1, 0x04);
  packetWriteReg(CC1101_REG_PKTCTRL0, 0x00);
  packetWriteReg(CC1101_REG_PKTLEN, bytes.length & 0xff);

  var mdmcfg2 = packetReadReg(CC1101_REG_MDMCFG2);
  packetWriteReg(CC1101_REG_MDMCFG2, (mdmcfg2 & ~0x70) | 0x30);

  packetSetFrequencyMHz(packetFreqMHz);
  packetSetDataRate(packetDataRateBps);

  packetPushLog(
    "init packet mode fixed: len=" +
      String(bytes.length) +
      " freq=" +
      String(packetFreqMHz) +
      "MHz dr=" +
      String(packetDataRateBps),
  );
  packetStatus = "Initialized";
  render();
}

function packetSend() {
  packetStatus = "Sending...";
  render();

  var bytes = parseHexBytes(packetPayloadHex, 61);
  if (!bytes.length) {
    packetStatus = "No payload";
    render();
    return;
  }

  packetWriteReg(CC1101_REG_PKTLEN, bytes.length & 0xff);
  packetStrobe(CC1101_SIDLE);
  packetStrobe(CC1101_SFTX);
  packetWriteBurst(CC1101_REG_FIFO, bytes);
  var st = packetStrobe(CC1101_STX);

  packetPushLog("tx " + String(bytes.length) + "B: " + bytes.map(toHexByte).join(" ") + " (st=0x" + toHexByte(st) + ")");
  packetStatus = "TX strobe sent";
  render();
}

function render() {
  UI.render(
    UI.scroll({
      padding: 16,
      spacing: 16,
      children: [
        UI.text({ text: "CC1101", font: "title2", fontWeight: "semibold" }),
        UI.row({
          spacing: 12,
          children: [
            UI.button({ label: "InitRx", backgroundColor: "#2563EB", foregroundColor: "#FFFFFF", onTap: initRx }),
            UI.button({ label: "InitTx", backgroundColor: "#DC2626", foregroundColor: "#FFFFFF", onTap: initTx }),
          ],
        }),
        UI.text({ text: statusText, fontWeight: "medium" }),

        UI.text({ text: "Packet Mode", fontWeight: "semibold" }),
        UI.row({
          spacing: 12,
          children: [
            UI.textField({
              value: String(packetCsPin),
              placeholder: "CS pin (encoded, default 4=A4)",
              onChange: function (v) {
                var n = parseInt(String(v), 10);
                packetCsPin = Number.isFinite(n) ? n : String(v);
                render();
              },
            }),
            UI.button({
              label: "Init",
              backgroundColor: "#2563EB",
              foregroundColor: "#FFFFFF",
              onTap: function () {
                packetInitFixed();
              },
            }),
            UI.button({
              label: "Send",
              backgroundColor: "#059669",
              foregroundColor: "#FFFFFF",
              onTap: function () {
                packetSend();
              },
            }),
          ],
        }),
        UI.row({
          spacing: 12,
          children: [
            UI.textField({
              value: String(packetFreqMHz),
              placeholder: "Freq MHz (433.92)",
              onChange: function (v) {
                var n = parseFloat(String(v));
                if (Number.isFinite(n)) packetFreqMHz = n;
                render();
              },
            }),
            UI.textField({
              value: String(packetDataRateBps),
              placeholder: "Data rate bps (100000)",
              onChange: function (v) {
                var n = parseInt(String(v), 10);
                if (Number.isFinite(n)) packetDataRateBps = n;
                render();
              },
            }),
          ],
        }),
        UI.text({ text: "Payload (hex, up to 61 bytes)", fontWeight: "medium" }),
        UI.textEditor({
          value: packetPayloadHex,
          placeholder: "01 02 03 ...",
          onChange: function (v) {
            packetPayloadHex = String(v);
            render();
          },
          minHeight: 72,
        }),
        packetStatus
          ? UI.text({
              text: packetStatus,
              backgroundColor: "#111827",
              foregroundColor: "#FFFFFF",
              padding: { top: 12, bottom: 12, leading: 12, trailing: 12 },
              cornerRadius: 8,
            })
          : null,
        UI.row({
          spacing: 12,
          children: [
            UI.button({
              label: "Clear Log",
              onTap: function () {
                packetLogLines = [];
                render();
              },
            }),
          ],
        }),
        UI.logViewer({ text: packetLogLines.join("\n"), minHeight: 240 }),
      ],
    }),
  );
}

render();
`,
  },
  {
    name: "chart.emw",
    source: `'use strict';

// Synthetic chart debug script.
// Generates a large square wave and renders it via UI.plot.
// The plot component performs viewport compression internally.

function i(v, d) {
  var n = parseInt(String(v || '').trim(), 10);
  return isFinite(n) ? n : d;
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function __parseViewportRange(r) {
  if (!r) return null;
  // Some hosts may pass \`[ {min,max} ]\`.
  if (Array.isArray(r) && r.length) {
    r = r[0];
  }
  if (!r || typeof r !== 'object') return null;
  var min = r.min != null ? Number(r.min) : NaN;
  var max = r.max != null ? Number(r.max) : NaN;
  if (!isFinite(min) || !isFinite(max)) return null;
  return { min: min, max: max };
}

var sampleCountText = '200000';
var periodText = '200';
var binsText = '900';

var bufLen = 0;
var plotBufId = '';
var xMin = 0;
var xMax = 10000;
var err = '';

var __pendingViewport = null;
var __viewportTimer = null;

function __applyViewport(min, max) {
  var maxBits = Math.max(0, bufLen * 8);
  if (maxBits <= 0) return;

  var lo = clamp(Math.round(Number(min) || 0), 0, maxBits);
  var hi = clamp(Math.round(Number(max) || 0), 0, maxBits);
  if (hi <= lo) return;

  xMin = lo;
  xMax = hi;
  render();
}

function __scheduleViewport(min, max) {
  __pendingViewport = { min: min, max: max };
  if (__viewportTimer) return;

  if (typeof setTimeout !== 'function') {
    var p0 = __pendingViewport;
    __pendingViewport = null;
    __applyViewport(p0.min, p0.max);
    return;
  }

  __viewportTimer = setTimeout(function () {
    __viewportTimer = null;
    var p = __pendingViewport;
    __pendingViewport = null;
    if (!p) return;
    __applyViewport(p.min, p.max);
  }, 60);
}

function __makeSquareWaveBytes(bitCount, periodBits) {
  var bits = Math.max(0, Number(bitCount) || 0);
  var period = Math.max(2, Number(periodBits) || 2);
  var half = Math.max(1, Math.floor(period / 2));

  var out = new Uint8Array(Math.ceil(bits / 8));
  for (var b = 0; b < bits; b += 1) {
    if ((b % period) < half) {
      out[b >> 3] |= 1 << (b & 7);
    }
  }
  return out;
}

function generate() {
  err = '';
  try {
    if (!UI || typeof UI.buffer !== 'function') {
      throw new Error('UI.buffer unavailable on this host');
    }

    var bitCount = clamp(i(sampleCountText, 200000), 1, 2000000);
    var period = clamp(i(periodText, 200), 2, 100000);
    var bytes = __makeSquareWaveBytes(bitCount, period);

    plotBufId = String(UI.buffer(bytes) || '');
    bufLen = bytes.length;
    xMin = 0;
    xMax = Math.min(10000, bufLen * 8);
  } catch (e) {
    err = String(e && e.message ? e.message : e);
    bufLen = 0;
    plotBufId = '';
  }
}

function render() {
  UI.render(
    UI.scroll({
      padding: 16,
      spacing: 12,
      children: [
        UI.column({
          spacing: 4,
          children: [
            UI.text({ text: 'Chart Debug', font: 'title2', fontWeight: 'semibold' }),
            UI.text({
              text:
                'Bits: ' + String(bufLen * 8) +
                ' • Period: ' + String(periodText) +
                ' • View: ' + String(xMin) + '…' + String(xMax),
              font: 'caption',
            }),
          ],
        }),

        UI.plot({
          height: 320,
          source: { kind: 'buffer', id: plotBufId },
          bins: clamp(i(binsText, 900), 64, 12000),
          xMin: xMin,
          xMax: xMax,
          yMin: 0,
          yMax: 255,
          errorText: err,
          onViewportChange: function (r) {
            var range = __parseViewportRange(r);
            if (!range) return;
            __scheduleViewport(range.min, range.max);
          },
        }),

        UI.row({
          spacing: 10,
          children: [
            UI.button({
              label: 'Reset view',
              onTap: function () {
                xMin = 0;
                xMax = Math.min(10000, bufLen * 8);
                render();
              },
            }),
            UI.button({
              label: 'Regenerate',
              onTap: function () {
                generate();
                render();
              },
            }),
          ],
        }),

        UI.row({
          spacing: 10,
          children: [
            UI.textField({
              value: sampleCountText,
              placeholder: 'Samples (e.g. 200000)',
              onChange: function (v) { sampleCountText = String(v); },
              onSubmit: function () { generate(); render(); },
            }),
            UI.textField({
              value: periodText,
              placeholder: 'Period (e.g. 200)',
              onChange: function (v) { periodText = String(v); },
              onSubmit: function () { generate(); render(); },
            }),
            UI.textField({
              value: binsText,
              placeholder: 'Bins (e.g. 900)',
              onChange: function (v) { binsText = String(v); },
              onSubmit: function () { render(); },
            }),
          ],
        }),
      ],
    })
  );
}

generate();
render();
`,
  },
  {
    name: "gpio.emw",
    source: `const PINS = [
    { label: "A0 (IR_RX)", value: A0 },
    { label: "A1 (IR_TX)", value: A1 },
    { label: "A2 (GDO0)", value: A2 },
    { label: "A3 (GDO2)", value: A3 },
    { label: "A4 (NSS)", value: A4 },
    { label: "A5 (SCK)", value: A5 },
    { label: "A6 (MISO)", value: A6 },
    { label: "A7 (MOSI)", value: A7 },
    { label: "A13 (SWCLK)", value: A13 },
    { label: "A14 (SWDIO)", value: A14 },
    { label: "B6 (UART TX / I2C SCL)", value: B6 },
    { label: "B7 (UART RX / I2C SDA)", value: B7 },
];

let pin = PINS[0].value;

function writeHigh() {
    pinMode(pin, OUTPUT);
    digitalWrite(pin, HIGH);
}

function writeLow() {
    pinMode(pin, OUTPUT);
    digitalWrite(pin, LOW);
}

UI.render(UI.column({
    padding: 16,
    spacing: 12,
    children: [
        UI.picker({
            style: "menu",
            selected: pin,
            options: PINS,
            onChange: function (value) {
                pin = value;
            },
        }),
        UI.row({
            spacing: 12,
            children: [
                UI.button({ label: "High", onTap: writeHigh }),
                UI.button({ label: "Low", onTap: writeLow }),
            ],
        }),
    ],
}));
`,
  },
  {
    name: "hello.emw",
    source: `UI.render(
  UI.column({
    padding: 16,
    spacing: 12,
    children: [
      UI.text({
        text: "hello",
        foregroundColor: "#E2E8F0",
      }),
    ],
  })
);

let level = LOW;
pinMode(GDO0, OUTPUT);
digitalWrite(GDO0, level);

every(250, function () {
  level = level === LOW ? HIGH : LOW;
  digitalWrite(GDO0, level);
});
`,
  },
  {
    name: "i2c.emw",
    source: `// Simple I2C test script for STM32F042 (I2C1 on B6/B7)
let hz = "100000";
let addrHex = "3C";
let txHex = "";
let rxLen = 1;
let statusText = "";
let logLines = [];

function pushLog(line) {
  logLines.push(String(line));
  if (logLines.length > 400) logLines = logLines.slice(logLines.length - 400);
}

function parseAddr7() {
  var s = String(addrHex).trim();
  if (!s) return -1;
  if (s.startsWith("0x") || s.startsWith("0X")) s = s.slice(2);
  var n = parseInt(s, 16);
  if (!Number.isFinite(n) || n < 0 || n > 0x7f) return -1;
  return n;
}

function fmtBytes(bytes) {
  if (!bytes || !bytes.length) return "";
  var out = [];
  for (var i = 0; i < bytes.length; i += 1) {
    out.push((bytes[i] & 0xff).toString(16).toUpperCase().padStart(2, "0"));
  }
  return out.join(" ");
}

function openI2c() {
  statusText = "Opening...";
  render();
  var h = parseInt(hz, 10);
  if (!Number.isFinite(h) || h <= 0) {
    statusText = "Invalid hz: " + String(hz);
    render();
    return;
  }
  var resp = Wire.begin(h);
  if (resp && typeof resp.then === "function") {
    resp.then(function () {
      pushLog("i2c open --hz=" + h);
      statusText = "Opened @ " + h + " Hz";
      render();
    });
  } else {
    pushLog("i2c open --hz=" + h);
    statusText = "Opened @ " + h + " Hz";
    render();
  }
}

function closeI2c() {
  statusText = "Closing...";
  render();
  var resp = Wire.end();
  if (resp && typeof resp.then === "function") {
    resp.then(function () {
      pushLog("i2c close");
      statusText = "Closed";
      render();
    });
  } else {
    pushLog("i2c close");
    statusText = "Closed";
    render();
  }
}

function writeI2c() {
  statusText = "Writing...";
  render();
  var h = parseInt(hz, 10);
  if (!Number.isFinite(h) || h <= 0) h = 100000;
  var a = parseAddr7();
  if (a < 0) {
    statusText = "Invalid addr: " + String(addrHex);
    render();
    return;
  }
  var resp = Wire.write(a, txHex, { hz: h, timeout: 250 });
  var cmd = "i2c write --addr=0x" + a.toString(16).toUpperCase() + " --tx=" + String(txHex);

  var done = function () {
    pushLog(cmd);
    statusText = "Write OK";
    render();
  };
  if (resp && typeof resp.then === "function") resp.then(done);
  else done();
}

function readI2c() {
  statusText = "Reading...";
  render();
  var h = parseInt(hz, 10);
  if (!Number.isFinite(h) || h <= 0) h = 100000;
  var a = parseAddr7();
  if (a < 0) {
    statusText = "Invalid addr: " + String(addrHex);
    render();
    return;
  }
  var n = Math.max(0, Math.min(63, Number(rxLen) | 0));
  var resp = Wire.read(a, n, { hz: h, timeout: 250 });
  var cmd = "i2c read --addr=0x" + a.toString(16).toUpperCase() + " --n=" + n;

  var done = function (bytes) {
    pushLog(cmd + " -> " + (bytes && bytes.length ? bytes.length : 0) + " byte(s)");
    if (bytes && bytes.length) pushLog("rx: " + fmtBytes(bytes));
    statusText = bytes && bytes.length ? "Read " + bytes.length + " byte(s)" : "No data";
    render();
  };
  if (resp && typeof resp.then === "function") resp.then(done);
  else done(resp);
}

function xferI2c() {
  statusText = "Transferring...";
  render();
  var h = parseInt(hz, 10);
  if (!Number.isFinite(h) || h <= 0) h = 100000;
  var a = parseAddr7();
  if (a < 0) {
    statusText = "Invalid addr: " + String(addrHex);
    render();
    return;
  }
  var n = Math.max(0, Math.min(63, Number(rxLen) | 0));
  var resp = Wire.xfer(a, txHex, n, { hz: h, timeout: 250 });
  var cmd =
    "i2c xfer --addr=0x" +
    a.toString(16).toUpperCase() +
    " --tx=" +
    String(txHex) +
    " --rx=" +
    String(n);

  var done = function (bytes) {
    pushLog(cmd + " -> " + (bytes && bytes.length ? bytes.length : 0) + " byte(s)");
    if (bytes && bytes.length) pushLog("rx: " + fmtBytes(bytes));
    statusText = bytes && bytes.length ? "OK" : "OK (no data)";
    render();
  };
  if (resp && typeof resp.then === "function") resp.then(done);
  else done(resp);
}

function scanI2c() {
  statusText = "Scanning...";
  render();

  var h = parseInt(hz, 10);
  if (!Number.isFinite(h) || h <= 0) h = 100000;

  var found = [];
  var start = 0x03;
  var end = 0x77;
  var addr = start;

  var step = function () {
    if (addr > end) {
      statusText = "Scan done (" + found.length + " found)";
      pushLog("scan: " + (found.length ? found.map(function (a) { return "0x" + a.toString(16).toUpperCase().padStart(2, "0"); }).join(" ") : "(none)"));
      render();
      return;
    }

    // Probe by trying to read 1 byte; success implies ACK.
    var resp = Wire.read(addr, 1, { hz: h, timeout: 25 });
    var check = function (bytes) {
      if (bytes && bytes.length) {
        found.push(addr);
      }
      addr += 1;
      // Keep UI responsive: schedule next step.
      setTimeout(step, 0);
    };

    if (resp && typeof resp.then === "function") resp.then(check);
    else {
      check(resp);
    }
  };

  pushLog("i2c scan --hz=" + h + " (0x03..0x77)");
  step();
}

function render() {
  UI.render(
    UI.scroll({
      padding: 16,
      spacing: 12,
      children: [
        UI.text({ text: "I2C (B6/B7)", font: "title2", fontWeight: "semibold" }),
        UI.text({ text: "Note: B6/B7 are shared with USART1; using I2C will switch the pins to I2C1.", foregroundColor: "#9CA3AF" }),

        UI.row({
          spacing: 12,
          children: [
            UI.textField({
              value: String(hz),
              placeholder: "Hz (100000)",
              onChange: function (v) {
                hz = String(v).replace(/[^0-9]/g, "");
                render();
              },
            }),
            UI.button({ label: "Open", backgroundColor: "#2563EB", foregroundColor: "#FFFFFF", onTap: openI2c }),
            UI.button({ label: "Close", onTap: closeI2c }),
          ],
        }),

        UI.row({
          spacing: 12,
          children: [
            UI.button({ label: "Scan 0x03..0x77", onTap: scanI2c }),
            UI.button({
              label: "Clear Log",
              onTap: function () {
                logLines = [];
                render();
              },
            }),
          ],
        }),

        UI.text({ text: "Transfer", fontWeight: "medium" }),
        UI.row({
          spacing: 12,
          children: [
            UI.textField({
              value: String(addrHex),
              placeholder: "Addr (7-bit hex, e.g. 3C)",
              onChange: function (v) {
                addrHex = String(v).replace(/[^0-9a-fA-FxX]/g, "");
              },
            }),
            UI.slider({
              min: 0,
              max: 63,
              step: 1,
              value: rxLen,
              onChange: function (v) {
                rxLen = v;
                render();
              },
            }),
            UI.text({ text: String(rxLen) + " rx", foregroundColor: "#9CA3AF" }),
          ],
        }),
        UI.textField({
          value: txHex,
          placeholder: "TX hex bytes (optional)",
          onChange: function (v) {
            txHex = String(v);
          },
        }),
        UI.row({
          spacing: 12,
          children: [
            UI.button({ label: "Write", backgroundColor: "#059669", foregroundColor: "#FFFFFF", onTap: writeI2c }),
            UI.button({ label: "Read", backgroundColor: "#2563EB", foregroundColor: "#FFFFFF", onTap: readI2c }),
            UI.button({ label: "Xfer", backgroundColor: "#7C3AED", foregroundColor: "#FFFFFF", onTap: xferI2c }),
          ],
        }),

        statusText
          ? UI.text({
              text: statusText,
              backgroundColor: "#111827",
              foregroundColor: "#FFFFFF",
              padding: { top: 12, bottom: 12, leading: 12, trailing: 12 },
              cornerRadius: 8,
            })
          : null,

        UI.logViewer({ text: logLines.join("\n"), minHeight: 260 }),
      ],
    }),
  );
}

render();
`,
  },
  {
    name: "ism.emw",
    source: `// ISM (CC1101) - Script implementation of the ISM fragment UI.
// Desktop scripts are sync-only; long operations are chunked via setTimeout.

var DEFAULT_CC1101_CS = 4;

var RF_PARAMETER_STEPS = 6;
var CC1101_PA_TABLE_SIZE = 8;
var CC1101_PATABLE_ADDR = 0x3e;

var CC1101_F_XTAL_HZ = 26000000.0;
var CC1101_REG_FREQ2 = 0x0d;
var CC1101_REG_FREQ1 = 0x0e;
var CC1101_REG_FREQ0 = 0x0f;
var CC1101_REG_MDMCFG4 = 0x10;
var CC1101_REG_MDMCFG3 = 0x11;
var CC1101_REG_MDMCFG2 = 0x12;
var CC1101_REG_DEVIATN = 0x15;
var CC1101_REG_FREND0 = 0x22;

var CC1101_MOD_2FSK = 0;
var CC1101_MOD_GFSK = 1;
var CC1101_MOD_ASK = 3;
var CC1101_MOD_4FSK = 4;
var CC1101_MOD_MSK = 7;

var CC1101_POWER_LEVELS_DBM = [-30, -20, -15, -10, 0, 5, 7, 10];
var CC1101_POWER_SETTING_315MHZ = [0x12, 0x0d, 0x1c, 0x34, 0x51, 0x85, 0xcb, 0xc2];
var CC1101_POWER_SETTING_433MHZ = [0x12, 0x0e, 0x1d, 0x34, 0x60, 0x84, 0xc8, 0xc0];
var CC1101_POWER_SETTING_868MHZ = [0x03, 0x0f, 0x1e, 0x27, 0x50, 0x81, 0xcb, 0xc2];
var CC1101_POWER_SETTING_915MHZ = [0x03, 0x0e, 0x1e, 0x27, 0x8e, 0xcd, 0xc7, 0xc0];

var CC1101_CONFIG_REGISTERS = [
  "IOCFG2",
  "IOCFG1",
  "IOCFG0",
  "FIFOTHR",
  "SYNC1",
  "SYNC0",
  "PKTLEN",
  "PKTCTRL1",
  "PKTCTRL0",
  "ADDR",
  "CHANNR",
  "FSCTRL1",
  "FSCTRL0",
  "FREQ2",
  "FREQ1",
  "FREQ0",
  "MDMCFG4",
  "MDMCFG3",
  "MDMCFG2",
  "MDMCFG1",
  "MDMCFG0",
  "DEVIATN",
  "MCSM2",
  "MCSM1",
  "MCSM0",
  "FOCCFG",
  "BSCFG",
  "AGCCTRL2",
  "AGCCTRL1",
  "AGCCTRL0",
  "WOREVT1",
  "WOREVT0",
  "WORCTRL",
  "FREND1",
  "FREND0",
  "FSCAL3",
  "FSCAL2",
  "FSCAL1",
  "FSCAL0",
  "RCCTRL1",
  "RCCTRL0",
  "FSTEST",
  "PTEST",
  "AGCTEST",
  "TEST2",
  "TEST1",
  "TEST0",
];

var CC1101_STATUS_REGISTERS = [
  "PARTNUM",
  "VERSION",
  "FREQEST",
  "LQI",
  "RSSI",
  "MARCSTATE",
  "WORTIME1",
  "WORTIME0",
  "PKTSTATUS",
  "VCO_VC_DAC",
  "TXBYTES",
  "RXBYTES",
  "RCCTRL1_STATUS",
  "RCCTRL0_STATUS",
];

var CC1101_REGISTER_MAP = {
  IOCFG2: 0x00,
  IOCFG1: 0x01,
  IOCFG0: 0x02,
  FIFOTHR: 0x03,
  SYNC1: 0x04,
  SYNC0: 0x05,
  PKTLEN: 0x06,
  PKTCTRL1: 0x07,
  PKTCTRL0: 0x08,
  ADDR: 0x09,
  CHANNR: 0x0a,
  FSCTRL1: 0x0b,
  FSCTRL0: 0x0c,
  FREQ2: 0x0d,
  FREQ1: 0x0e,
  FREQ0: 0x0f,
  MDMCFG4: 0x10,
  MDMCFG3: 0x11,
  MDMCFG2: 0x12,
  MDMCFG1: 0x13,
  MDMCFG0: 0x14,
  DEVIATN: 0x15,
  MCSM2: 0x16,
  MCSM1: 0x17,
  MCSM0: 0x18,
  FOCCFG: 0x19,
  BSCFG: 0x1a,
  AGCCTRL2: 0x1b,
  AGCCTRL1: 0x1c,
  AGCCTRL0: 0x1d,
  WOREVT1: 0x1e,
  WOREVT0: 0x1f,
  WORCTRL: 0x20,
  FREND1: 0x21,
  FREND0: 0x22,
  FSCAL3: 0x23,
  FSCAL2: 0x24,
  FSCAL1: 0x25,
  FSCAL0: 0x26,
  RCCTRL1: 0x27,
  RCCTRL0: 0x28,
  FSTEST: 0x29,
  PTEST: 0x2a,
  AGCTEST: 0x2b,
  TEST2: 0x2c,
  TEST1: 0x2d,
  TEST0: 0x2e,
  PARTNUM: 0x30,
  VERSION: 0x31,
  FREQEST: 0x32,
  LQI: 0x33,
  RSSI: 0x34,
  MARCSTATE: 0x35,
  WORTIME1: 0x36,
  WORTIME0: 0x37,
  PKTSTATUS: 0x38,
  VCO_VC_DAC: 0x39,
  TXBYTES: 0x3a,
  RXBYTES: 0x3b,
  RCCTRL1_STATUS: 0x3c,
  RCCTRL0_STATUS: 0x3d,
};

var CC1101_MODULATION_OPTIONS = [
  { label: "2-FSK", value: String(CC1101_MOD_2FSK) },
  { label: "GFSK", value: String(CC1101_MOD_GFSK) },
  { label: "ASK/OOK", value: String(CC1101_MOD_ASK) },
  { label: "4-FSK", value: String(CC1101_MOD_4FSK) },
  { label: "MSK", value: String(CC1101_MOD_MSK) },
];

function toHexByte(n) {
  var v = Number(n) & 0xff;
  var s = v.toString(16).toUpperCase();
  return s.length === 1 ? "0" + s : s;
}

function isFiniteNumber(n) {
  return typeof n === "number" && isFinite(n);
}

function getRegisterAddress(name) {
  return CC1101_REGISTER_MAP[String(name)] || 0;
}

function cc1101SpiXfer(tx, opts) {
  var options = opts || {};
  var cs = typeof options.cs !== "undefined" ? options.cs : DEFAULT_CC1101_CS;
  var rxLength = typeof options.rxLength === "number" ? options.rxLength : undefined;
  return SPI.transfer(tx, { cs: cs, rxLength: rxLength });
}

function readReg(addr) {
  var a = Number(addr) & 0xff;
  var isStatus = a >= 0x30 && a <= 0x3d;
  var cmd = ((a & 0x3f) | (isStatus ? 0xc0 : 0x80)) & 0xff;
  var response = cc1101SpiXfer([cmd, 0x00], { rxLength: 2 });
  return response && response.length >= 2 ? response[1] & 0xff : 0;
}

function writeReg(addr, value) {
  var a = Number(addr) & 0xff;
  cc1101SpiXfer([a & 0x3f, Number(value) & 0xff]);
}

function cc1101ReadBurstReg(addr, len) {
  var requested = Math.max(0, Math.min(13, Number(len) | 0));
  var cmd = ((Number(addr) & 0x3f) | 0xc0) & 0xff;
  var tx = [cmd];
  for (var i = 0; i < requested; i += 1) tx.push(0);
  var response = cc1101SpiXfer(tx);
  if (!response || response.length < 1) return new Uint8Array(0);
  return response.slice(1, 1 + requested);
}

function cc1101WriteBurstReg(addr, data) {
  var bytes = (data || []).slice(0, 13).map(function (v) {
    return Number(v) & 0xff;
  });
  var cmd = ((Number(addr) & 0x3f) | 0x40) & 0xff;
  var tx = [cmd].concat(bytes);
  cc1101SpiXfer(tx);
  return true;
}

function ensureCc1101Init() {
  // Probe VERSION register via SNOP+read.
  var response = cc1101SpiXfer([0xf1, 0x00], { rxLength: 2 });
  if (response && response.length >= 2 && (response[1] & 0xff) === 0x14) {
    return true;
  }
  if (!response || response.length === 0) {
    statusMessage = "CC1101 probe failed: no response.";
    return false;
  }
  statusMessage = "CC1101 probe failed: unexpected response.";
  return false;
}

function cc1101Strobe(cmd) {
  cc1101SpiXfer([Number(cmd) & 0xff]);
}

function cc1101GetFrequencyMHz() {
  var freq2 = readReg(CC1101_REG_FREQ2);
  var freq1 = readReg(CC1101_REG_FREQ1);
  var freq0 = readReg(CC1101_REG_FREQ0);
  var word = ((freq2 & 0xff) << 16) | ((freq1 & 0xff) << 8) | (freq0 & 0xff);
  return (word * (CC1101_F_XTAL_HZ / Math.pow(2, 16))) / 1000000.0;
}

function cc1101SetFrequencyMHz(frequencyMHz) {
  var mhz = Number(frequencyMHz);
  if (!isFiniteNumber(mhz) || mhz <= 0) return false;
  var word = Math.round((mhz * 1e6 * Math.pow(2, 16)) / CC1101_F_XTAL_HZ);
  writeReg(CC1101_REG_FREQ2, (word >> 16) & 0xff);
  writeReg(CC1101_REG_FREQ1, (word >> 8) & 0xff);
  writeReg(CC1101_REG_FREQ0, word & 0xff);
  cc1101Strobe(54);
  cc1101Strobe(51);
  var confirm = cc1101GetFrequencyMHz();
  return Math.abs(confirm - mhz) < 0.001;
}

function cc1101GetDataRate() {
  var mdmcfg4 = readReg(CC1101_REG_MDMCFG4);
  var drateE = mdmcfg4 & 0x0f;
  var drateM = readReg(CC1101_REG_MDMCFG3);
  var bitRate = ((256 + drateM) * Math.pow(2, drateE) * CC1101_F_XTAL_HZ) / Math.pow(2, 28);
  return Math.round(bitRate);
}

function cc1101SetDataRate(bitRate) {
  var bps = Math.round(Number(bitRate));
  if (!isFiniteNumber(bps) || bps <= 0) return false;
  var target = (bps * Math.pow(2, 28)) / CC1101_F_XTAL_HZ;
  var bestM = 0;
  var bestE = 0;
  var bestDiff = Number.MAX_VALUE;
  for (var e = 0; e <= 15; e += 1) {
    for (var m = 0; m <= 255; m += 1) {
      var current = (256 + m) * Math.pow(2, e);
      var diff = Math.abs(current - target);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestM = m;
        bestE = e;
      }
    }
  }
  var cur = readReg(CC1101_REG_MDMCFG4);
  var bandwidthPart = cur & 0xf0;
  var newMdmcfg4 = (bandwidthPart | (bestE & 0x0f)) & 0xff;
  var newMdmcfg3 = bestM & 0xff;
  cc1101WriteBurstReg(CC1101_REG_MDMCFG4, [newMdmcfg4, newMdmcfg3]);
  var confirm = cc1101ReadBurstReg(CC1101_REG_MDMCFG4, 2);
  return confirm.length === 2 && confirm[0] === newMdmcfg4 && confirm[1] === newMdmcfg3;
}

function cc1101GetBandwidthKHz() {
  var v = readReg(CC1101_REG_MDMCFG4);
  var bwExp = (v >> 6) & 0x03;
  var bwMant = (v >> 4) & 0x03;
  var bandwidthHz = CC1101_F_XTAL_HZ / (8.0 * (4.0 + bwMant) * Math.pow(2, bwExp));
  return bandwidthHz / 1000.0;
}

function cc1101SetBandwidth(bandwidthKHz) {
  var khz = Number(bandwidthKHz);
  if (!isFiniteNumber(khz) || khz <= 0) return false;
  var targetHz = khz * 1000.0;
  var bestExp = 0;
  var bestMant = 0;
  var bestDiff = Number.MAX_VALUE;
  for (var exp = 0; exp <= 3; exp += 1) {
    for (var mant = 0; mant <= 3; mant += 1) {
      var bwHz = CC1101_F_XTAL_HZ / (8.0 * (4.0 + mant) * Math.pow(2, exp));
      var diff = Math.abs(bwHz - targetHz);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestExp = exp;
        bestMant = mant;
      }
    }
  }
  var current = readReg(CC1101_REG_MDMCFG4);
  var drateE = current & 0x0f;
  var newMdmcfg4 = ((bestExp << 6) | (bestMant << 4) | drateE) & 0xff;
  writeReg(CC1101_REG_MDMCFG4, newMdmcfg4);
  var confirm = readReg(CC1101_REG_MDMCFG4);
  return confirm === newMdmcfg4;
}

function cc1101GetDeviation() {
  var v = readReg(CC1101_REG_DEVIATN);
  var deviationM = v & 0x07;
  var deviationE = (v >> 4) & 0x07;
  var deviationHz = (8 + deviationM) * Math.pow(2, deviationE) * (CC1101_F_XTAL_HZ / Math.pow(2, 17));
  return Math.round(deviationHz);
}

function cc1101SetDeviation(deviationHz) {
  var hz = Math.round(Number(deviationHz));
  if (!isFiniteNumber(hz) || hz <= 0) return false;
  var bestE = 0;
  var bestM = 0;
  var bestDiff = Number.MAX_VALUE;
  for (var e = 0; e <= 7; e += 1) {
    for (var m = 0; m <= 7; m += 1) {
      var current = (8 + m) * Math.pow(2, e) * (CC1101_F_XTAL_HZ / Math.pow(2, 17));
      var diff = Math.abs(current - hz);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestE = e;
        bestM = m;
      }
    }
  }
  var value = ((bestE << 4) | (bestM & 0x07)) & 0xff;
  writeReg(CC1101_REG_DEVIATN, value);
  var confirm = readReg(CC1101_REG_DEVIATN);
  return confirm === value;
}

function cc1101GetModulation() {
  var mdmcfg2 = readReg(CC1101_REG_MDMCFG2);
  return (mdmcfg2 >> 4) & 0x07;
}

function cc1101GetPowerLevel() {
  var frequencyMHz = cc1101GetFrequencyMHz();
  var powerSettings = null;
  if (frequencyMHz >= 300 && frequencyMHz <= 348) powerSettings = CC1101_POWER_SETTING_315MHZ;
  else if (frequencyMHz >= 378 && frequencyMHz <= 464) powerSettings = CC1101_POWER_SETTING_433MHZ;
  else if (frequencyMHz >= 779 && frequencyMHz <= 899.99) powerSettings = CC1101_POWER_SETTING_868MHZ;
  else if (frequencyMHz >= 900 && frequencyMHz <= 928) powerSettings = CC1101_POWER_SETTING_915MHZ;
  else return 0;

  var modulation = cc1101GetModulation();
  var pa = cc1101ReadBurstReg(CC1101_PATABLE_ADDR, 2);
  if (!pa || pa.length < 2) return 0;
  var current = (modulation === CC1101_MOD_ASK ? pa[1] : pa[0]) & 0xff;
  for (var i = 0; i < powerSettings.length && i < CC1101_POWER_LEVELS_DBM.length; i += 1) {
    if ((powerSettings[i] & 0xff) === current) return CC1101_POWER_LEVELS_DBM[i];
  }
  var closestIndex = 0;
  var smallest = Number.MAX_VALUE;
  for (var j = 0; j < powerSettings.length && j < CC1101_POWER_LEVELS_DBM.length; j += 1) {
    var d = Math.abs((powerSettings[j] & 0xff) - current);
    if (d < smallest) {
      smallest = d;
      closestIndex = j;
    }
  }
  return CC1101_POWER_LEVELS_DBM[closestIndex];
}

function cc1101SetModulationAndPower(modulation, dbm) {
  var frequencyMHz = cc1101GetFrequencyMHz();
  var powerIndex = CC1101_POWER_LEVELS_DBM.indexOf(Number(dbm));
  if (powerIndex < 0) return false;

  var powerSetting = null;
  if (frequencyMHz >= 300 && frequencyMHz <= 348) powerSetting = CC1101_POWER_SETTING_315MHZ[powerIndex];
  else if (frequencyMHz >= 378 && frequencyMHz <= 464) powerSetting = CC1101_POWER_SETTING_433MHZ[powerIndex];
  else if (frequencyMHz >= 779 && frequencyMHz <= 899.99) powerSetting = CC1101_POWER_SETTING_868MHZ[powerIndex];
  else if (frequencyMHz >= 900 && frequencyMHz <= 928) powerSetting = CC1101_POWER_SETTING_915MHZ[powerIndex];
  else return false;

  var currentMdmcfg2 = readReg(CC1101_REG_MDMCFG2);
  var newMdmcfg2 = ((currentMdmcfg2 & 0x0f) | ((Number(modulation) & 0x07) << 4)) & 0xff;
  var frend0 = Number(modulation) === CC1101_MOD_ASK ? 0x11 : 0x10;
  writeReg(CC1101_REG_MDMCFG2, newMdmcfg2);
  writeReg(CC1101_REG_FREND0, frend0);

  var paTable = [];
  for (var i = 0; i < CC1101_PA_TABLE_SIZE; i += 1) paTable.push(0);
  if (Number(modulation) === CC1101_MOD_ASK) paTable[1] = powerSetting;
  else paTable[0] = powerSetting;
  cc1101WriteBurstReg(CC1101_PATABLE_ADDR, paTable);

  var confirmMdmcfg2 = readReg(CC1101_REG_MDMCFG2);
  var confirmFrend0 = readReg(CC1101_REG_FREND0);
  return confirmMdmcfg2 === newMdmcfg2 && confirmFrend0 === frend0;
}

// -----------------------------------------------------------------------------
// UI state
// -----------------------------------------------------------------------------

var statusMessage = "";
var registers = {};
var rfParams = null; // { frequencyMHz, dataRate, bandwidth, deviation, modulation, txPower }

var isLoading = false;
var loadingProgress = 0;
var totalLoadSteps = 0;
var currentCommand = "";
var abortRequested = false;
var loadJob = null;

var editDialog = null; // { kind, title, key, mode, allowDecimal }
var editValue = "";

function stopLoading(msg) {
  isLoading = false;
  abortRequested = false;
  loadJob = null;
  currentCommand = "";
  if (msg) statusMessage = String(msg);
  render();
}

function startRefresh() {
  if (isLoading) return;
  statusMessage = "";
  abortRequested = false;
  isLoading = true;
  loadingProgress = 0;
  currentCommand = "";

  totalLoadSteps =
    CC1101_CONFIG_REGISTERS.length + CC1101_STATUS_REGISTERS.length + CC1101_PA_TABLE_SIZE + RF_PARAMETER_STEPS;

  loadJob = null;
  render();
  runLoadAll();
}

function runLoadAll() {
  if (!isLoading) return;
  try {
    currentCommand = "Probing CC1101...";
    render();
    var ok = ensureCc1101Init();
    if (!ok) {
      stopLoading(statusMessage || "CC1101 init failed.");
      return;
    }

    var nextRegs = {};

    // Render between register reads so progress updates are visible.
    for (var i = 0; i < CC1101_CONFIG_REGISTERS.length; i += 1) {
      currentCommand = "Reading " + CC1101_CONFIG_REGISTERS[i] + "...";
      var addr = getRegisterAddress(CC1101_CONFIG_REGISTERS[i]);
      nextRegs[CC1101_CONFIG_REGISTERS[i]] = toHexByte(readReg(addr));
      loadingProgress += 1;
      render();
    }

    for (var j = 0; j < CC1101_STATUS_REGISTERS.length; j += 1) {
      currentCommand = "Reading " + CC1101_STATUS_REGISTERS[j] + "...";
      var saddr = getRegisterAddress(CC1101_STATUS_REGISTERS[j]);
      nextRegs[CC1101_STATUS_REGISTERS[j]] = toHexByte(readReg(saddr));
      loadingProgress += 1;
      render();
    }

    currentCommand = "Reading PA_TABLE...";
    render();
    var paTable = cc1101ReadBurstReg(CC1101_PATABLE_ADDR, CC1101_PA_TABLE_SIZE);
    for (var k = 0; k < Math.min(paTable.length, CC1101_PA_TABLE_SIZE); k += 1) {
      nextRegs["PA_TABLE" + String(k)] = toHexByte(paTable[k]);
    }
    loadingProgress += CC1101_PA_TABLE_SIZE;
    render();

    currentCommand = "Reading RF parameters...";
    render();
    var nextRf = {
      frequencyMHz: cc1101GetFrequencyMHz(),
      dataRate: cc1101GetDataRate(),
      bandwidth: cc1101GetBandwidthKHz(),
      deviation: cc1101GetDeviation(),
      modulation: cc1101GetModulation(),
      txPower: cc1101GetPowerLevel(),
    };
    loadingProgress += RF_PARAMETER_STEPS;

    registers = nextRegs;
    rfParams = nextRf;
    isLoading = false;
    currentCommand = "";
    render();
  } catch (e) {
    stopLoading("Load failed: " + String(e && e.message ? e.message : e));
  }
}

function openRegisterEdit(name) {
  editDialog = {
    kind: "reg",
    title: "Edit " + String(name),
    key: String(name),
    mode: "hex",
    allowDecimal: false,
  };
  editValue = String(registers[String(name)] || "");
  render();
}

function openRfEdit(paramKey, title, allowDecimal) {
  if (!rfParams) return;
  editDialog = {
    kind: "rf",
    title: String(title),
    key: String(paramKey),
    mode: "number",
    allowDecimal: !!allowDecimal,
  };
  editValue = String(rfParams[String(paramKey)]);
  render();
}

function cancelEdit() {
  editDialog = null;
  editValue = "";
  render();
}

function applyEdit() {
  if (!editDialog) return;
  var value = String(editValue || "").trim();

  if (editDialog.mode === "hex") {
    if (!/^[0-9a-fA-F]+$/.test(value)) {
      statusMessage = "Invalid hexadecimal value.";
      render();
      return;
    }
    var parsed = parseInt(value, 16);
    if (!isFiniteNumber(parsed)) {
      statusMessage = "Invalid hexadecimal value.";
      render();
      return;
    }

    try {
      var key = editDialog.key;
      if (key.indexOf("PA_TABLE") === 0) {
        var index = parseInt(key.replace("PA_TABLE", ""), 10);
        if (!isFiniteNumber(index) || index < 0 || index >= CC1101_PA_TABLE_SIZE) {
          statusMessage = "Invalid PA table index.";
          render();
          return;
        }
        var table = cc1101ReadBurstReg(CC1101_PATABLE_ADDR, CC1101_PA_TABLE_SIZE);
        if (!table || table.length < CC1101_PA_TABLE_SIZE) {
          statusMessage = "Failed to read PA table.";
          render();
          return;
        }
        table[index] = parsed & 0xff;
        cc1101WriteBurstReg(CC1101_PATABLE_ADDR, Array.prototype.slice.call(table));
        var verify = cc1101ReadBurstReg(CC1101_PATABLE_ADDR, CC1101_PA_TABLE_SIZE);
        if (verify && verify.length >= CC1101_PA_TABLE_SIZE) {
          for (var i = 0; i < CC1101_PA_TABLE_SIZE; i += 1) {
            registers["PA_TABLE" + String(i)] = toHexByte(verify[i]);
          }
        }
      } else {
        writeReg(getRegisterAddress(key), parsed);
        var confirm = readReg(getRegisterAddress(key));
        registers[key] = toHexByte(confirm);
      }
      statusMessage = "";
      editDialog = null;
      render();
    } catch (e) {
      statusMessage = "Write failed: " + String(e && e.message ? e.message : e);
      render();
    }
    return;
  }

  if (editDialog.mode === "number") {
    var numberOk = editDialog.allowDecimal ? /^[0-9]+(\.[0-9]+)?$/.test(value) : /^[0-9]+$/.test(value);
    if (!numberOk) {
      statusMessage = "Invalid number value.";
      render();
      return;
    }
    var n = parseFloat(value);
    if (!isFiniteNumber(n)) {
      statusMessage = "Invalid value.";
      render();
      return;
    }

    try {
      var key2 = editDialog.key;
      var ok2 = true;
      var appliedValue = n;
      if (key2 === "frequencyMHz") {
        ok2 = cc1101SetFrequencyMHz(n);
      } else if (key2 === "dataRate") {
        appliedValue = Math.round(n);
        ok2 = cc1101SetDataRate(appliedValue);
      } else if (key2 === "bandwidth") {
        ok2 = cc1101SetBandwidth(n);
      } else if (key2 === "deviation") {
        appliedValue = Math.round(n);
        ok2 = cc1101SetDeviation(appliedValue);
      }
      if (!ok2) {
        statusMessage = "Failed to set " + String(editDialog.title).toLowerCase() + ".";
        render();
        return;
      }
      if (rfParams) {
        rfParams[key2] = appliedValue;
      }
      statusMessage = "";
      editDialog = null;
      render();
    } catch (e2) {
      statusMessage = "Update failed: " + String(e2 && e2.message ? e2.message : e2);
      render();
    }
    return;
  }
}

function formatFrequency(mhz) {
  var v = Number(mhz);
  if (!isFiniteNumber(v)) return "--";
  return v.toFixed(6);
}

function formatBandwidth(khz) {
  var v = Number(khz);
  if (!isFiniteNumber(v)) return "--";
  return v.toFixed(1);
}

function render() {
  var progressValue = totalLoadSteps > 0 ? loadingProgress / totalLoadSteps : 0;
  if (!isFiniteNumber(progressValue)) progressValue = 0;
  if (progressValue < 0) progressValue = 0;
  if (progressValue > 1) progressValue = 1;

  UI.render(
    UI.scroll({
      padding: 16,
      spacing: 16,
      children: [
        UI.column({
          spacing: 4,
          children: [
            UI.text({ text: "ISM", font: "title2", fontWeight: "semibold" }),
            UI.text({ text: "CC1101 control and registers", foregroundColor: "#94A3B8", font: "caption" }),
          ],
        }),

        isLoading
          ? UI.card({
              title: "Initializing CC1101",
              subtitle: currentCommand || "Preparing...",
              children: [
                UI.progress({ value: progressValue }),
                UI.text({
                  text: String(loadingProgress) + " / " + String(totalLoadSteps),
                  foregroundColor: "#94A3B8",
                  font: "caption",
                }),
                UI.button({
                  label: "Cancel",
                  backgroundColor: "#1F2937",
                  foregroundColor: "#CBD5E1",
                  onTap: function () {
                    abortRequested = true;
                    render();
                  },
                }),
              ],
            })
          : null,

        editDialog
          ? UI.card({
              title: editDialog.title,
              subtitle: editDialog.mode === "hex" ? "Hex byte (00..FF)" : "Numeric value",
              children: [
                UI.textField({
                  id: "edit_value",
                  value: editValue,
                  placeholder: editDialog.mode === "hex" ? "00" : "0",
                  onChange: function (v) {
                    editValue = String(v);
                    render();
                  },
                  onSubmit: function () {
                    applyEdit();
                  },
                }),
                UI.row({
                  spacing: 12,
                  children: [
                    UI.button({
                      label: "Cancel",
                      backgroundColor: "#111827",
                      foregroundColor: "#CBD5E1",
                      onTap: cancelEdit,
                    }),
                    UI.button({
                      label: "OK",
                      backgroundColor: "#2563EB",
                      foregroundColor: "#FFFFFF",
                      onTap: applyEdit,
                    }),
                  ],
                }),
              ],
            })
          : null,

        UI.grid({
          minColumnWidth: 420,
          spacing: 16,
          children: [
            UI.column({
              spacing: 16,
              children: [
                UI.card({
                  title: "Device",
                  children: [
                    UI.button({
                      label: "Initialize & Read",
                      backgroundColor: "#2563EB",
                      foregroundColor: "#FFFFFF",
                      onTap: startRefresh,
                    }),
                    UI.text({
                      text: "TX power updates PATABLE[0] and PATABLE[1] for ASK/OOK.",
                      foregroundColor: "#94A3B8",
                      font: "caption",
                    }),
                    statusMessage ? UI.text({ text: statusMessage, foregroundColor: "#FBBF24", font: "caption" }) : null,
                  ],
                }),

                UI.card({
                  title: "RF Parameters",
                  children: [
                    UI.grid({
                      minColumnWidth: 220,
                      spacing: 10,
                      children: [
                        UI.tile({
                          title: "Frequency (MHz)",
                          value: rfParams ? formatFrequency(rfParams.frequencyMHz) : "--",
                          monospaceValue: true,
                          disabled: !rfParams,
                          onTap: function () {
                            openRfEdit("frequencyMHz", "Frequency (MHz)", true);
                          },
                        }),
                        UI.tile({
                          title: "Data Rate (bps)",
                          value: rfParams ? String(rfParams.dataRate) : "--",
                          monospaceValue: true,
                          disabled: !rfParams,
                          onTap: function () {
                            openRfEdit("dataRate", "Data Rate (bps)", false);
                          },
                        }),
                        UI.tile({
                          title: "Bandwidth (kHz)",
                          value: rfParams ? formatBandwidth(rfParams.bandwidth) : "--",
                          monospaceValue: true,
                          disabled: !rfParams,
                          onTap: function () {
                            openRfEdit("bandwidth", "Bandwidth", true);
                          },
                        }),
                        UI.tile({
                          title: "Deviation (Hz)",
                          value: rfParams ? String(rfParams.deviation) : "--",
                          monospaceValue: true,
                          disabled: !rfParams,
                          onTap: function () {
                            openRfEdit("deviation", "Deviation (Hz)", false);
                          },
                        }),
                      ],
                    }),

                    UI.picker({
                      id: "modulation",
                      label: "Modulation",
                      selected: rfParams ? String(rfParams.modulation) : String(CC1101_MOD_2FSK),
                      options: CC1101_MODULATION_OPTIONS,
                      onChange: function (value) {
                        if (!rfParams) return;
                        var m = parseInt(String(value), 10);
                        var ok = cc1101SetModulationAndPower(m, rfParams.txPower);
                        if (!ok) {
                          statusMessage = "Failed to update CC1101 modulation/power.";
                          render();
                          return;
                        }
                        rfParams.modulation = m;
                        statusMessage = "";
                        render();
                      },
                    }),

                    UI.picker({
                      id: "tx_power",
                      label: "TX Power (dBm)",
                      selected: rfParams ? String(rfParams.txPower) : String(CC1101_POWER_LEVELS_DBM[0]),
                      options: CC1101_POWER_LEVELS_DBM.map(function (v) {
                        return { label: String(v), value: String(v) };
                      }),
                      onChange: function (value) {
                        if (!rfParams) return;
                        var p = parseInt(String(value), 10);
                        var ok = cc1101SetModulationAndPower(rfParams.modulation, p);
                        if (!ok) {
                          statusMessage = "Failed to update CC1101 modulation/power.";
                          render();
                          return;
                        }
                        rfParams.txPower = p;
                        statusMessage = "";
                        render();
                      },
                    }),
                  ],
                }),
              ],
            }),

            UI.card({
              title: "Registers",
              children: [
                UI.text({ text: "CONFIG", foregroundColor: "#94A3B8", font: "caption", fontWeight: "semibold" }),
                UI.grid({
                  minColumnWidth: 150,
                  spacing: 8,
                  children: CC1101_CONFIG_REGISTERS.map(function (name) {
                    return UI.tile({
                      title: name,
                      value: registers[name] || "--",
                      monospaceValue: true,
                      onTap: function () {
                        openRegisterEdit(name);
                      },
                    });
                  }),
                }),

                UI.divider({}),

                UI.text({ text: "STATUS", foregroundColor: "#94A3B8", font: "caption", fontWeight: "semibold" }),
                UI.grid({
                  minColumnWidth: 150,
                  spacing: 8,
                  children: CC1101_STATUS_REGISTERS.map(function (name) {
                    return UI.tile({
                      title: name,
                      value: registers[name] || "--",
                      monospaceValue: true,
                      onTap: function () {
                        openRegisterEdit(name);
                      },
                    });
                  }),
                }),

                UI.divider({}),

                UI.text({ text: "PA TABLE", foregroundColor: "#94A3B8", font: "caption", fontWeight: "semibold" }),
                UI.grid({
                  minColumnWidth: 150,
                  spacing: 8,
                  children: (function () {
                    var out = [];
                    for (var i = 0; i < CC1101_PA_TABLE_SIZE; i += 1) {
                      var key = "PA_TABLE" + String(i);
                      out.push(
                        UI.tile({
                          title: key,
                          value: registers[key] || "--",
                          monospaceValue: true,
                          onTap: (function (k) {
                            return function () {
                              openRegisterEdit(k);
                            };
                          })(key),
                        }),
                      );
                    }
                    return out;
                  })(),
                }),
              ],
            }),
          ],
        }),
      ],
    }),
  );
}

render();
`,
  },
  {
    name: "pwm.emw",
    source: `// Simple PWM (analogWrite) test script for STM32F042
// Firmware support: \`pwm write --pin=<encoded> --value=<0..4095> [--hz=<freq>]\`
let selectedPin = "0"; // A0..A3 (PA0..PA3) only
let hzText = "1000";
let resolutionBits = 12;
let dutyU12 = 0;
let statusText = "";
let lastAction = "";
let logLines = [];
let sweeping = false;

const PWM_PINS = [
  { label: "A0 / TIM2_CH1 (pin 0)", value: "0" },
  { label: "A1 / TIM2_CH2 (pin 1)", value: "1" },
  { label: "A2 / TIM2_CH3 (pin 2)", value: "2" },
  { label: "A3 / TIM2_CH4 (pin 3)", value: "3" },
];

const RESOLUTIONS = [
  { label: "8-bit (0..255)", value: "8" },
  { label: "10-bit (0..1023)", value: "10" },
  { label: "12-bit (0..4095)", value: "12" },
];

function clampInt(v, min, max) {
  const n = Number(v) | 0;
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

function pushLog(line) {
  logLines.push(line);
  if (logLines.length > 80) logLines = logLines.slice(-80);
}

function parsedHz() {
  const h = clampInt(hzText, 1, 200000);
  return h;
}

function currentMaxValue() {
  const bits = clampInt(resolutionBits, 1, 16);
  if (bits >= 31) return 0x7fffffff;
  return (1 << bits) - 1;
}

function setResolution(bits) {
  resolutionBits = clampInt(bits, 1, 16);
  analogWriteResolution(resolutionBits);
  const max = currentMaxValue();
  dutyU12 = clampInt(dutyU12, 0, max);
}

function dutyAsPercent() {
  const max = currentMaxValue();
  if (max <= 0) return 0;
  return Math.round((1000 * dutyU12) / max) / 10;
}

function applyWrite(value, opts) {
  const pin = Number(selectedPin) | 0;
  const hz = parsedHz();
  const max = currentMaxValue();
  const v = clampInt(value, 0, max);
  dutyU12 = v;

  lastAction = "analogWrite(" + String(pin) + ", " + String(v) + ", { hz: " + String(hz) + " })";
  pushLog(lastAction);

  statusText = "Writing...";
  render();

  const timeout =
    opts && typeof opts.timeout === "number" && isFinite(opts.timeout) && opts.timeout > 0
      ? (opts.timeout | 0)
      : 1500;
  const res = analogWrite(pin, v, { hz: hz, timeout: timeout });
  const done = function () {
    statusText = "OK (" + dutyAsPercent() + "% @ " + hz + " Hz)";
    render();
  };
  const fail = function (e) {
    statusText = "Error: " + String(e && e.message ? e.message : e);
    render();
  };
  if (res && typeof res.then === "function") {
    res.then(done).catch(fail);
  } else {
    done();
  }
}

function sweep() {
  if (sweeping) {
    sweeping = false;
    statusText = "Stopping sweep...";
    render();
    return;
  }

  sweeping = true;
  statusText = "Sweeping...";
  render();

  const max = currentMaxValue();
  const steps = Math.max(32, Math.min(256, (max / 16) | 0));

  while (sweeping) {
    for (let i = 0; i <= steps && sweeping; i += 1) {
      const v = Math.round((i * max) / steps);
      applyWrite(v);
      sleep(8);
    }
    for (let i = steps; i >= 0 && sweeping; i -= 1) {
      const v = Math.round((i * max) / steps);
      applyWrite(v);
      sleep(8);
    }
  }

  statusText = "Sweep stopped";
  render();
}

function render() {
  const max = currentMaxValue();
  const hz = parsedHz();

  UI.render(
    UI.scroll({
      padding: 16,
      spacing: 16,
      children: [
        UI.text({ text: "PWM / analogWrite", font: "title2", fontWeight: "semibold" }),
        UI.text({ text: "Firmware PWM pins: A0..A3 only (TIM2 channels).", foregroundColor: "#6B7280" }),

        UI.text({ text: "Pin", fontWeight: "medium" }),
        UI.picker({
          style: "menu",
          selected: String(selectedPin),
          options: PWM_PINS,
          onChange: function (v) {
            selectedPin = v;
            render();
          },
        }),

        UI.text({ text: "Frequency (Hz)", fontWeight: "medium" }),
        UI.row({
          spacing: 8,
          children: [
            UI.textField({
              value: hzText,
              placeholder: "1000",
              onChange: function (v) {
                hzText = v;
              },
              onSubmit: function () {
                render();
              },
            }),
            UI.button({
              label: "1k",
              onTap: function () {
                hzText = "1000";
                render();
              },
            }),
            UI.button({
              label: "10k",
              onTap: function () {
                hzText = "10000";
                render();
              },
            }),
            UI.button({
              label: "38k",
              onTap: function () {
                hzText = "38000";
                render();
              },
            }),
          ],
        }),
        UI.text({ text: "Using: " + hz + " Hz", foregroundColor: "#6B7280" }),

        UI.text({ text: "Resolution", fontWeight: "medium" }),
        UI.picker({
          style: "segmented",
          selected: String(resolutionBits),
          options: RESOLUTIONS,
          onChange: function (v) {
            setResolution(Number(v) | 0);
            render();
          },
        }),

        UI.text({ text: "Value (" + dutyU12 + " / " + max + ")  =  " + dutyAsPercent() + "%", fontWeight: "medium" }),
        UI.slider({
          min: 0,
          max: max,
          step: Math.max(1, (max / 255) | 0),
          value: dutyU12,
          onChange: function (v) {
            dutyU12 = clampInt(v, 0, max);
            render();
          },
        }),

        UI.grid({
          columns: 2,
          spacing: 8,
          children: [
            UI.button({
              label: "Write",
              backgroundColor: "#2563EB",
              foregroundColor: "#FFFFFF",
              onTap: function () {
                applyWrite(dutyU12);
              },
            }),
            UI.button({
              label: "Off",
              onTap: function () {
                applyWrite(0);
              },
            }),
            UI.button({
              label: "50%",
              onTap: function () {
                applyWrite(Math.round(max / 2));
              },
            }),
            UI.button({
              label: "Full",
              onTap: function () {
                applyWrite(max);
              },
            }),
          ],
        }),

        UI.button({
          label: sweeping ? "Stop sweep" : "Sweep",
          backgroundColor: sweeping ? "#991B1B" : "#111827",
          foregroundColor: "#FFFFFF",
          onTap: sweep,
        }),

        statusText
          ? UI.text({
              text: statusText,
              backgroundColor: "#0B1220",
              foregroundColor: "#E5E7EB",
              padding: { top: 12, bottom: 12, leading: 12, trailing: 12 },
              cornerRadius: 8,
            })
          : null,

        lastAction
          ? UI.text({
              text: lastAction,
              backgroundColor: "#111827",
              foregroundColor: "#FFFFFF",
              padding: { top: 12, bottom: 12, leading: 12, trailing: 12 },
              cornerRadius: 8,
            })
          : null,

        UI.text({ text: "Log", fontWeight: "medium" }),
        UI.logViewer({ text: logLines.join("\n"), minHeight: 160 }),
      ],
    }),
  );
}

setResolution(12);
render();
`,
  },
  {
    name: "sampler.emw",
    source: `'use strict';

var PINS = [
  { label: 'A0 (IR_RX)', value: '0' },
  { label: 'A1 (IR_TX)', value: '1' },
  { label: 'A2 (GDO0)', value: '2' },
  { label: 'A3 (GDO2)', value: '3' },
  { label: 'A4 (NSS)', value: '4' },
  { label: 'A5 (SCK)', value: '5' },
  { label: 'A6 (MISO)', value: '6' },
  { label: 'A7 (MOSI)', value: '7' },
  { label: 'A13 (SWCLK)', value: '13' },
  { label: 'A14 (SWDIO)', value: '14' },
  { label: 'B6 (UART TX / I2C SCL)', value: String(16 + 6) },
  { label: 'B7 (UART RX / I2C SDA)', value: String(16 + 7) },
];

function i(v, d) {
  var n = parseInt(String(v || '').trim(), 10);
  return isFinite(n) ? n : d;
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function ends(s, suf) {
  return String(s || '').toLowerCase().endsWith(String(suf || '').toLowerCase());
}

function baseName(s) {
  var name = String(s || '').trim();
  if (!name) return 'signal1';
  name = name.replace(/[\\/]/g, '_').replace(/\s+/g, '_');
  return name.replace(/\.(raw|txt)$/i, '');
}

function signalsDir() {
  var root = FS.appDataDir();
  return root ? FS.join(root, 'signals') : '';
}

var status = '';
var rxPin = '0';
var recording = false;
var recordId = null;

var samplePeriodUsText = '10';
var maxBytesText = '393216';
var binsText = '400';

var bufLen = 0;
var xMin = 0;
var xMax = 10000;
var chartErr = '';

var __pendingViewport = null;
var __viewportTimer = null;

function __parseViewportRange(r) {
  if (!r) return null;
  // Some hosts may pass \`[ {min,max} ]\`.
  if (Array.isArray(r) && r.length) {
    r = r[0];
  }
  if (!r || typeof r !== 'object') return null;
  var min = r.min != null ? Number(r.min) : NaN;
  var max = r.max != null ? Number(r.max) : NaN;
  if (!isFinite(min) || !isFinite(max)) return null;
  return { min: min, max: max };
}

function __applyViewportRange(min, max) {
  var maxBits = Math.max(0, bufLen * 8);
  if (maxBits <= 0) return;

  var lo = clamp(Math.round(Number(min) || 0), 0, maxBits);
  var hi = clamp(Math.round(Number(max) || 0), 0, maxBits);
  if (hi <= lo) return;

  xMin = lo;
  xMax = hi;
  render();
}

function __scheduleViewport(min, max) {
  __pendingViewport = { min: min, max: max };

  // Avoid doing a full recompress+render on every pixel of pan/zoom.
  if (__viewportTimer) return;

  if (typeof setTimeout !== 'function') {
    var p0 = __pendingViewport;
    __pendingViewport = null;
    __applyViewportRange(p0.min, p0.max);
    return;
  }

  __viewportTimer = setTimeout(function () {
    __viewportTimer = null;
    var p = __pendingViewport;
    __pendingViewport = null;
    if (!p) return;
    __applyViewportRange(p.min, p.max);
  }, 60);
}

var files = [];
var selectedFile = '';
var saveName = 'signal1.raw';

function listFiles() {
  files = [];
  selectedFile = selectedFile || '';
  var dir = signalsDir();
  if (!dir) return;
  try { FS.ensureDir(dir); } catch (e) {}
  try {
    var names = FS.readDir(dir) || [];
    files = names
      .map(function (n) { return String(n || ''); })
      .filter(function (n) { return ends(n, '.raw') || ends(n, '.txt'); })
      .sort();
    if (files.length && !selectedFile) selectedFile = files[0];
  } catch (e2) {}
}

function refreshPlot() {
  chartErr = '';
  try {
    bufLen = Sampler.lenBytes();
    var maxBits = Math.max(0, bufLen * 8);
    if (maxBits <= 0) return;
    var start = clamp(i(xMin, 0), 0, maxBits);
    var end = clamp(i(xMax, 10000), 0, maxBits);
    if (end <= start) {
      start = 0;
      end = Math.min(10000, maxBits);
    }

    xMin = start;
    xMax = end;
  } catch (e) {
    chartErr = String(e && e.message ? e.message : e);
  }
}

function start() {
  chartErr = '';
  status = '';
  try {
    var periodUs = clamp(i(samplePeriodUsText, 10), 1, 255);
    var maxBytes = clamp(i(maxBytesText, 393216), 256, 1024 * 1024);
    var s = Sampler.start({ pin: Number(rxPin), clearBefore: true, periodUs: periodUs, maxBytes: maxBytes });
    recordId = s && s.id != null ? String(s.id) : null;
    recording = true;
    status = 'Recording…';
  } catch (e) {
    status = String(e && e.message ? e.message : e);
  }
  render();
}

function stop() {
  try { Sampler.stop(recordId); } catch (e) {}
  recording = false;
  recordId = null;
  refreshPlot();
  render();
}

function clearBuffer() {
  status = '';
  chartErr = '';
  try {
    // If we're currently sampling, stop first to avoid immediately refilling.
    try { Sampler.stop(recordId); } catch (e0) {}
    recording = false;
    recordId = null;

    Sampler.clear();

    bufLen = 0;
    xMin = 0;
    xMax = 10000;
    status = 'Cleared';
  } catch (e) {
    status = String(e && e.message ? e.message : e);
  }
  render();
}

function parseTimings(text) {
  return String(text || '')
    .split(/[\s,]+/g)
    .map(function (t) { return parseInt(t, 10); })
    .filter(function (n) { return isFinite(n) && n !== 0; });
}

function timingsToBytes(pulsesUs, periodUs, maxBytes) {
  var maxBits = maxBytes * 8;
  var total = 0;
  for (var i0 = 0; i0 < pulsesUs.length; i0 += 1) {
    total += Math.max(0, Math.round(Math.abs(pulsesUs[i0]) / periodUs));
    if (total >= maxBits) { total = maxBits; break; }
  }
  var out = new Uint8Array(Math.ceil(total / 8));
  var bit = 0;
  for (var i1 = 0; i1 < pulsesUs.length && bit < total; i1 += 1) {
    var us = pulsesUs[i1];
    var high = us > 0;
    var run = Math.max(0, Math.round(Math.abs(us) / periodUs));
    run = Math.min(run, total - bit);
    if (high) {
      for (var j = 0; j < run; j += 1) {
        var idx = bit + j;
        out[idx >> 3] |= 1 << (idx & 7);
      }
    }
    bit += run;
  }
  return out;
}

function loadSelected() {
  status = '';
  chartErr = '';
  var name = String(selectedFile || '');
  if (!name) return render();
  var dir = signalsDir();
  var path = dir ? FS.join(dir, name) : '';
  if (!path) return render();

  try {
    if (ends(name, '.raw')) {
      Sampler.setBytes(FS.readBytes(path));
      saveName = baseName(name) + '.raw';
    } else {
      var periodUs = clamp(i(samplePeriodUsText, 10), 1, 255);
      var maxBytes = clamp(i(maxBytesText, 393216), 256, 1024 * 1024);
      var pulses = parseTimings(FS.readText(path));
      Sampler.setBytes(timingsToBytes(pulses, periodUs, maxBytes));
      saveName = baseName(name) + '.raw';
    }
    refreshPlot();

    // After loading from disk, default to a full-range view of the entire signal.
    var maxBits = Math.max(0, bufLen * 8);
    xMin = 0;
    xMax = maxBits > 0 ? maxBits : 10000;

    status = 'Loaded ' + name;
  } catch (e) {
    status = String(e && e.message ? e.message : e);
  }
  render();
}

function saveRaw() {
  status = '';
  var dir = signalsDir();
  if (!dir) return render();
  var name = baseName(saveName) + '.raw';
  var path = FS.join(dir, name);
  try {
    FS.ensureDir(dir);
    Sampler.saveBytesFile(path);
    listFiles();
    selectedFile = name;
    status = 'Saved ' + name;
  } catch (e) {
    status = String(e && e.message ? e.message : e);
  }
  render();
}

function saveTimings() {
  status = '';
  var dir = signalsDir();
  if (!dir) return render();
  var name = baseName(saveName) + '.txt';
  var path = FS.join(dir, name);
  try {
    FS.ensureDir(dir);
    var periodUs = clamp(i(samplePeriodUsText, 10), 1, 255);
    FS.writeText(path, Sampler.buildSignedRawTimings({ samplePeriodUs: periodUs }));
    listFiles();
    selectedFile = name;
    status = 'Saved ' + name;
  } catch (e) {
    status = String(e && e.message ? e.message : e);
  }
  render();
}

function removeSelected() {
  status = '';
  var name = String(selectedFile || '');
  if (!name) return render();
  var dir = signalsDir();
  var path = dir ? FS.join(dir, name) : '';
  if (!path) return render();
  try {
    FS.remove(path);
    listFiles();
    status = 'Deleted ' + name;
  } catch (e) {
    status = String(e && e.message ? e.message : e);
  }
  render();
}

function render() {
  var maxBits = Math.max(0, bufLen * 8);
  var picker = [{ label: '(none)', value: '' }].concat(
    files.map(function (n) { return { label: n, value: n }; })
  );

  UI.render(
    UI.scroll({
      padding: 16,
      spacing: 14,
      children: [
        UI.column({
          spacing: 4,
          children: [
            UI.text({ text: 'Sampler', font: 'title2', fontWeight: 'semibold' }),
            status ? UI.text({ text: status, font: 'caption' }) : null,
          ],
        }),

        UI.divider({}),

        UI.text({
          text:
            'Bytes: ' + String(bufLen) +
            (maxBits ? ' • Samples: ' + String(maxBits) : '') +
            ' • View: ' + String(xMin) + '…' + String(xMax),
          font: 'caption',
        }),
        UI.plot({
          height: 240,
          source: 'samplerBits',
          bins: clamp(i(binsText, 900), 64, 6000),
          xMin: xMin,
          xMax: xMax,
          yMin: 0,
          yMax: 255,
          errorText: chartErr,
          onViewportChange: function (r) {
            var range = __parseViewportRange(r);
            if (!range) return;
            __scheduleViewport(range.min, range.max);
          },
        }),


        // Controls directly below the chart (primary workflow).
        UI.text({ text: 'Capture', fontWeight: 'semibold' }),

        UI.row({
          spacing: 10,
          children: [
            UI.button({ label: recording ? 'Recording…' : 'Record', onTap: start }),
            UI.button({ label: 'Stop', onTap: stop }),
            UI.button({ label: 'Clear', onTap: clearBuffer }),
            UI.button({ label: 'Refresh', onTap: function () { refreshPlot(); render(); } }),
          ],
        }),

        // Make the core pickers horizontal: Pin + Signal side-by-side.
        UI.row({
          spacing: 12,
          children: [
            UI.column({
              spacing: 6,
              children: [
                UI.picker({
                  style: 'menu',
                  label: 'Pin',
                  selected: String(rxPin),
                  options: PINS,
                  onChange: function (v) { rxPin = String(v); render(); },
                }),
              ],
            }),
            UI.column({
              spacing: 6,
              children: [
                UI.picker({
                  style: 'menu',
                  label: 'Signal',
                  selected: String(selectedFile || ''),
                  options: picker,
                  onChange: function (v) {
                    selectedFile = String(v || '');
                    loadSelected();
                  },
                }),
              ],
            }),
          ],
        }),

        UI.row({
          spacing: 10,
          children: [
            UI.column({
              spacing: 6,
              children: [
                UI.text({ text: 'Sample period (µs)', font: 'caption', fontWeight: 'medium' }),
                UI.textField({
                  value: samplePeriodUsText,
                  placeholder: '10',
                  onChange: function (v) { samplePeriodUsText = String(v); },
                  onSubmit: function () { render(); },
                }),
              ],
            }),
            UI.column({
              spacing: 6,
              children: [
                UI.text({ text: 'Max capture bytes', font: 'caption', fontWeight: 'medium' }),
                UI.textField({
                  value: maxBytesText,
                  placeholder: '393216',
                  onChange: function (v) { maxBytesText = String(v); },
                  onSubmit: function () { render(); },
                }),
              ],
            }),
            UI.column({
              spacing: 6,
              children: [
                UI.text({ text: 'Plot bins (resolution)', font: 'caption', fontWeight: 'medium' }),
                UI.textField({
                  value: binsText,
                  placeholder: '400',
                  onChange: function (v) { binsText = String(v); },
                  onSubmit: function () { refreshPlot(); render(); },
                }),
              ],
            }),
          ],
        }),

        UI.divider({}),

        UI.text({ text: 'Files', fontWeight: 'semibold' }),
        UI.row({
          spacing: 10,
          children: [
            UI.button({ label: 'Delete', onTap: removeSelected }),
            UI.button({
              label: 'Refresh list',
              onTap: function () {
                listFiles();
                render();
              },
            }),
          ],
        }),
        UI.textField({
          value: saveName,
          placeholder: 'signal1.raw',
          onChange: function (v) { saveName = String(v); },
          onSubmit: function () { render(); },
        }),
        UI.row({
          spacing: 10,
          children: [
            UI.button({ label: 'Save .raw', onTap: saveRaw }),
            UI.button({ label: 'Save .txt', onTap: saveTimings }),
          ],
        }),
      ],
    })
  );
}

listFiles();

// Auto-load the default (first) signal on startup so the plot is immediately populated.
if (selectedFile) {
  loadSelected();
} else {
  refreshPlot();
  render();
}
`,
  },
  {
    name: "uart.emw",
    source: `// Simple UART test script for STM32F042 (USART1 on B6/B7)
let baud = "115200";
let readLen = 16;
let writeMode = "text"; // "text" | "hex"
let writeText = "hello\n";
let writeHex = "48 65 6C 6C 6F 0A";
let statusText = "";
let logLines = [];

function pushLog(line) {
  logLines.push(String(line));
  if (logLines.length > 200) logLines = logLines.slice(logLines.length - 200);
}

function fmtBytes(bytes) {
  if (!bytes || !bytes.length) return "";
  var out = [];
  for (var i = 0; i < bytes.length; i += 1) {
    out.push((bytes[i] & 0xff).toString(16).toUpperCase().padStart(2, "0"));
  }
  return out.join(" ");
}

function fmtAscii(bytes) {
  if (!bytes || !bytes.length) return "";
  var s = "";
  for (var i = 0; i < bytes.length; i += 1) {
    var c = bytes[i] & 0xff;
    s += c >= 32 && c <= 126 ? String.fromCharCode(c) : ".";
  }
  return s;
}

function openUart() {
  statusText = "Opening...";
  render();
  var b = parseInt(baud, 10);
  if (!Number.isFinite(b) || b <= 0) {
    statusText = "Invalid baud: " + String(baud);
    render();
    return;
  }
  var resp = Serial.begin(b);
  if (resp && typeof resp.then === "function") {
    resp.then(function () {
      pushLog("uart open --baud=" + b);
      statusText = "Opened @ " + b + " baud";
      render();
    });
  } else {
    pushLog("uart open --baud=" + b);
    statusText = "Opened @ " + b + " baud";
    render();
  }
}

function closeUart() {
  statusText = "Closing...";
  render();
  var resp = Serial.end();
  if (resp && typeof resp.then === "function") {
    resp.then(function () {
      pushLog("uart close");
      statusText = "Closed";
      render();
    });
  } else {
    pushLog("uart close");
    statusText = "Closed";
    render();
  }
}

function writeUart() {
  statusText = "Writing...";
  render();

  var b = parseInt(baud, 10);
  if (!Number.isFinite(b) || b <= 0) b = 115200;

  var payload = writeMode === "hex" ? writeHex : writeText;
  var resp = Serial.write(payload, { baud: b });
  var cmd = "uart write" + " --baud=" + b + (writeMode === "hex" ? " --tx=" + String(writeHex) : " (text)");

  var done = function (bytes) {
    var n = bytes && bytes.length ? bytes[0] : 0;
    pushLog(cmd + " -> " + String(n) + " bytes");
    statusText = "Wrote " + String(n) + " byte(s)";
    render();
  };

  if (resp && typeof resp.then === "function") resp.then(done);
  else done(resp);
}

function readUart() {
  statusText = "Reading...";
  render();

  var b = parseInt(baud, 10);
  if (!Number.isFinite(b) || b <= 0) b = 115200;
  var n = Math.max(0, Math.min(63, Number(readLen) | 0));

  var resp = Serial.read(n, { baud: b, timeout: 250 });
  var cmd = "uart read --n=" + n + " --baud=" + b;

  var done = function (bytes) {
    pushLog(cmd + " -> " + (bytes && bytes.length ? bytes.length : 0) + " byte(s)");
    if (!bytes || !bytes.length) {
      statusText = "No data";
      render();
      return;
    }
    pushLog("rx hex: " + fmtBytes(bytes));
    pushLog("rx txt: " + fmtAscii(bytes));
    statusText = "Read " + bytes.length + " byte(s)";
    render();
  };

  if (resp && typeof resp.then === "function") resp.then(done);
  else done(resp);
}

function render() {
  UI.render(
    UI.scroll({
      padding: 16,
      spacing: 12,
      children: [
        UI.text({ text: "UART (B6/B7)", font: "title2", fontWeight: "semibold" }),
        UI.text({ text: "Note: B6/B7 are shared with I2C1; using UART will switch the pins to USART1.", foregroundColor: "#9CA3AF" }),

        UI.row({
          spacing: 12,
          children: [
            UI.textField({
              value: String(baud),
              placeholder: "Baud (115200)",
              onChange: function (v) {
                baud = String(v).replace(/[^0-9]/g, "");
                render();
              },
            }),
            UI.button({ label: "Open", backgroundColor: "#2563EB", foregroundColor: "#FFFFFF", onTap: openUart }),
            UI.button({ label: "Close", onTap: closeUart }),
          ],
        }),

        UI.text({ text: "Write", fontWeight: "medium" }),
        UI.picker({
          style: "segmented",
          selected: writeMode,
          options: [
            { label: "Text", value: "text" },
            { label: "Hex", value: "hex" },
          ],
          onChange: function (v) {
            writeMode = v === "hex" ? "hex" : "text";
            render();
          },
        }),
        writeMode === "hex"
          ? UI.textField({
              value: writeHex,
              placeholder: "Hex bytes (e.g. 01 02 FF)",
              onChange: function (v) {
                writeHex = String(v);
              },
            })
          : UI.textField({
              value: writeText,
              placeholder: "Text to send",
              onChange: function (v) {
                writeText = String(v);
              },
            }),
        UI.button({ label: "Write", backgroundColor: "#059669", foregroundColor: "#FFFFFF", onTap: writeUart }),

        UI.text({ text: "Read", fontWeight: "medium" }),
        UI.row({
          spacing: 12,
          children: [
            UI.slider({
              min: 0,
              max: 63,
              step: 1,
              value: readLen,
              onChange: function (v) {
                readLen = v;
                render();
              },
            }),
            UI.text({ text: String(readLen) + " bytes", foregroundColor: "#9CA3AF" }),
            UI.button({ label: "Read", backgroundColor: "#2563EB", foregroundColor: "#FFFFFF", onTap: readUart }),
          ],
        }),

        statusText
          ? UI.text({
              text: statusText,
              backgroundColor: "#111827",
              foregroundColor: "#FFFFFF",
              padding: { top: 12, bottom: 12, leading: 12, trailing: 12 },
              cornerRadius: 8,
            })
          : null,

        UI.row({
          spacing: 12,
          children: [
            UI.button({
              label: "Clear Log",
              onTap: function () {
                logLines = [];
                render();
              },
            }),
          ],
        }),
        UI.logViewer({ text: logLines.join("\n"), minHeight: 240 }),
      ],
    }),
  );
}

render();
`,
  },
];
