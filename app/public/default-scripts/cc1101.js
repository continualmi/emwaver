const CC1101_REG_IOCFG2 = 0x00;
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

async function cc1101Strobe(cmdByte) {
  await SPI.transfer([cmdByte & 0xff], { cs: CC1101_CS });
}

async function cc1101Reset() {
  await cc1101Strobe(CC1101_SRES);
}

async function cc1101WriteReg(addr, value) {
  await SPI.transfer([addr & 0x3f, value & 0xff], { cs: CC1101_CS });
}

async function cc1101ReadReg(addr) {
  const isStatus = addr >= 0x30 && addr <= 0x3d;
  const cmd = isStatus ? ((addr & 0x3f) | 0xc0) : ((addr & 0x3f) | 0x80);
  const response = await SPI.transfer([cmd, 0x00], { cs: CC1101_CS, rxLength: 2 });
  return response && response.length >= 2 ? response[1] & 0xff : 0;
}

async function cc1101WriteBurst(addr, data) {
  const tx = [((addr & 0x3f) | 0x40)].concat((data || []).map((v) => v & 0xff));
  await SPI.transfer(tx, { cs: CC1101_CS });
  return true;
}

async function cc1101ApplyDefaults() {
  await cc1101WriteReg(CC1101_REG_FSCTRL1, 0x06);
  await cc1101WriteReg(CC1101_REG_MDMCFG1, 0x02);
  await cc1101WriteReg(CC1101_REG_MDMCFG0, 0xf8);
  await cc1101WriteReg(CC1101_REG_CHANNR, 0x00);
  await cc1101WriteReg(CC1101_REG_DEVIATN, 0x47);
  await cc1101WriteReg(CC1101_REG_MCSM0, 0x18);
  await cc1101WriteReg(CC1101_REG_FOCCFG, 0x16);
  await cc1101WriteReg(CC1101_REG_BSCFG, 0x1c);
  await cc1101WriteReg(CC1101_REG_AGCCTRL2, 0xc7);
  await cc1101WriteReg(CC1101_REG_AGCCTRL1, 0x00);
  await cc1101WriteReg(CC1101_REG_AGCCTRL0, 0xb2);
  await cc1101WriteReg(CC1101_REG_FREND1, 0x56);
  await cc1101WriteReg(CC1101_REG_FSCAL3, 0xe9);
  await cc1101WriteReg(CC1101_REG_FSCAL2, 0x2a);
  await cc1101WriteReg(CC1101_REG_FSCAL1, 0x00);
  await cc1101WriteReg(CC1101_REG_FSCAL0, 0x1f);
  await cc1101WriteReg(CC1101_REG_FSTEST, 0x59);
  await cc1101WriteReg(CC1101_REG_TEST2, 0x81);
  await cc1101WriteReg(CC1101_REG_TEST1, 0x35);
  await cc1101WriteReg(CC1101_REG_TEST0, 0x09);
  await cc1101WriteReg(CC1101_REG_PKTCTRL0, 0x00);
  await cc1101WriteReg(CC1101_REG_PKTCTRL1, 0x04);
  await cc1101WriteReg(CC1101_REG_ADDR, 0x00);
  await cc1101WriteReg(CC1101_REG_PKTLEN, 0xff);
}

async function cc1101SetGdo(gdo2, gdo1, gdo0) {
  await cc1101WriteReg(CC1101_REG_IOCFG2, gdo2);
  await cc1101WriteReg(CC1101_REG_IOCFG1, gdo1);
  await cc1101WriteReg(CC1101_REG_IOCFG0, gdo0);
}

async function cc1101SetFrequencyMHz(frequencyMHz) {
  const word = Math.round((frequencyMHz * 1e6 * Math.pow(2, 16)) / CC1101_F_XTAL_HZ);
  await cc1101WriteReg(CC1101_REG_FREQ2, (word >> 16) & 0xff);
  await cc1101WriteReg(CC1101_REG_FREQ1, (word >> 8) & 0xff);
  await cc1101WriteReg(CC1101_REG_FREQ0, word & 0xff);
}

async function cc1101SetDataRate(bitRate) {
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
  const current = await cc1101ReadReg(CC1101_REG_MDMCFG4);
  const bandwidthPart = current & 0xf0;
  const newMdmcfg4 = (bandwidthPart | (bestE & 0x0f)) & 0xff;
  const newMdmcfg3 = bestM & 0xff;
  await cc1101WriteReg(CC1101_REG_MDMCFG4, newMdmcfg4);
  await cc1101WriteReg(CC1101_REG_MDMCFG3, newMdmcfg3);
}

async function cc1101SetModulationAndPower(modulation, dbm) {
  const powerIndex = CC1101_POWER_LEVELS_DBM.indexOf(dbm);
  if (powerIndex < 0) return;
  const powerSetting = CC1101_POWER_SETTING_433MHZ[powerIndex] & 0xff;

  const currentMdmcfg2 = await cc1101ReadReg(CC1101_REG_MDMCFG2);
  const newMdmcfg2 = ((currentMdmcfg2 & 0x0f) | ((modulation & 0x07) << 4)) & 0xff;
  const frend0 = modulation === CC1101_MOD_ASK ? 0x11 : 0x10;
  await cc1101WriteReg(CC1101_REG_MDMCFG2, newMdmcfg2);
  await cc1101WriteReg(CC1101_REG_FREND0, frend0);
  const paTable = new Array(CC1101_PA_TABLE_SIZE).fill(0);
  if (modulation === CC1101_MOD_ASK) {
    paTable[1] = powerSetting;
  } else {
    paTable[0] = powerSetting;
  }
  await cc1101WriteBurst(CC1101_REG_PATABLE, paTable);
}

async function initRx() {
  statusText = "Initializing RX...";
  render();
  await cc1101Reset();
  await cc1101ApplyDefaults();
  await cc1101WriteReg(CC1101_REG_PKTCTRL0, 0x32);
  await cc1101SetGdo(0x2e, 0x2e, 0x0d);
  await pinMode(GDO0, INPUT);
  await cc1101SetFrequencyMHz(433.92);
  await cc1101SetDataRate(100000);
  await cc1101SetModulationAndPower(CC1101_MOD_ASK, 10);
  await cc1101Strobe(CC1101_SRX);
  statusText = "RX init complete";
  render();
}

async function initTx() {
  statusText = "Initializing TX...";
  render();
  await cc1101Reset();
  await cc1101ApplyDefaults();
  await cc1101WriteReg(CC1101_REG_PKTCTRL0, 0x32);
  await cc1101SetGdo(0x2e, 0x2e, 0x0d);
  // Hold the OOK/data line low so the radio doesn't output a continuous carrier after STX.
  await pinMode(GDO0, OUTPUT);
  await digitalWrite(GDO0, LOW);
  await cc1101SetFrequencyMHz(433.92);
  await cc1101SetDataRate(100000);
  await cc1101SetModulationAndPower(CC1101_MOD_ASK, 10);
  await cc1101Strobe(CC1101_STX);
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

async function packetStrobe(cmdByte) {
  var response = await SPI.transfer([cmdByte & 0xff], { cs: packetCsPin, rxLength: 1 });
  return response && response.length ? response[0] & 0xff : 0;
}

async function packetWriteReg(addr, value) {
  await SPI.transfer([addr & 0x3f, value & 0xff], { cs: packetCsPin });
}

async function packetReadReg(addr) {
  var cmd = 0x80 | (addr & 0x3f);
  var response = await SPI.transfer([cmd, 0x00], { cs: packetCsPin, rxLength: 2 });
  return response && response.length > 1 ? response[1] & 0xff : 0;
}

async function packetWriteBurst(addr, bytes) {
  var cmd = 0x40 | (addr & 0x3f);
  await SPI.transfer([cmd].concat(bytes || []), { cs: packetCsPin });
}

async function packetSetFrequencyMHz(mhz) {
  var word = Math.round((Number(mhz) * 1e6 * Math.pow(2, 16)) / CC1101_F_XTAL_HZ) >>> 0;
  await packetWriteReg(CC1101_REG_FREQ2, (word >> 16) & 0xff);
  await packetWriteReg(CC1101_REG_FREQ1, (word >> 8) & 0xff);
  await packetWriteReg(CC1101_REG_FREQ0, word & 0xff);
}

async function packetSetDataRate(bps) {
  var target = (Number(bps) * Math.pow(2, 28)) / CC1101_F_XTAL_HZ;
  var e = 0;
  while (e < 15 && target > 256 * Math.pow(2, e)) e += 1;
  var mant = Math.max(0, Math.min(255, Math.round(target / Math.pow(2, e) - 256)));

  var cur = await packetReadReg(CC1101_REG_MDMCFG4);
  var mdmcfg4 = (cur & 0xf0) | (e & 0x0f);
  await packetWriteReg(CC1101_REG_MDMCFG4, mdmcfg4);
  await packetWriteReg(CC1101_REG_MDMCFG3, mant & 0xff);
}

async function packetInitFixed() {
  packetStatus = "Initializing...";
  render();

  var bytes = parseHexBytes(packetPayloadHex, 61);

  await packetStrobe(CC1101_SRES);
  await packetStrobe(CC1101_SIDLE);
  await packetStrobe(CC1101_SFTX);

  await packetWriteReg(CC1101_REG_PKTCTRL1, 0x04);
  await packetWriteReg(CC1101_REG_PKTCTRL0, 0x00);
  await packetWriteReg(CC1101_REG_PKTLEN, bytes.length & 0xff);

  var mdmcfg2 = await packetReadReg(CC1101_REG_MDMCFG2);
  await packetWriteReg(CC1101_REG_MDMCFG2, (mdmcfg2 & ~0x70) | 0x30);

  await packetSetFrequencyMHz(packetFreqMHz);
  await packetSetDataRate(packetDataRateBps);

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

async function packetSend() {
  packetStatus = "Sending...";
  render();

  var bytes = parseHexBytes(packetPayloadHex, 61);
  if (!bytes.length) {
    packetStatus = "No payload";
    render();
    return;
  }

  await packetWriteReg(CC1101_REG_PKTLEN, bytes.length & 0xff);
  await packetStrobe(CC1101_SIDLE);
  await packetStrobe(CC1101_SFTX);
  await packetWriteBurst(CC1101_REG_FIFO, bytes);
  var st = await packetStrobe(CC1101_STX);

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
              placeholder: "CS pin (encoded, default 4=PA4)",
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