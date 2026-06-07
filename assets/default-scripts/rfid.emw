import { JSX, render as renderTree } from "emw-jsx";
import { Button, Picker, Row, Scroll, Text, TextEditor, TextField } from "emw-ui";
import { pin, gpio } from "emw-gpio";
import { spi } from "emw-spi";

const MFRC522_CS = 4; // A4 on the shipping board
const MFRC522_RST = 22; // B6
const MFRC522_IRQ = 23; // B7

const MI_OK = 0;
const MI_NOTAGERR = 1;
const MI_ERR = 2;

const PCD_IDLE = 0x00;
const PCD_AUTHENT = 0x0E;
const PCD_TRANSCEIVE = 0x0C;
const PCD_RESETPHASE = 0x0F;
const PCD_CALCCRC = 0x03;

const PICC_REQIDL = 0x26;
const PICC_ANTICOLL = 0x93;
const PICC_SELECTTAG = 0x93;
const PICC_AUTHENT1A = 0x60;
const PICC_AUTHENT1B = 0x61;
const PICC_READ = 0x30;
const PICC_WRITE = 0xA0;
const PICC_HALT = 0x50;

const CommandReg = 0x01;
const CommIEnReg = 0x02;
const CommIrqReg = 0x04;
const DivIrqReg = 0x05;
const ErrorReg = 0x06;
const Status2Reg = 0x08;
const FIFODataReg = 0x09;
const FIFOLevelReg = 0x0A;
const ControlReg = 0x0C;
const BitFramingReg = 0x0D;
const CollReg = 0x0E;
const ModeReg = 0x11;
const TxControlReg = 0x14;
const TxAutoReg = 0x15;
const CRCResultRegM = 0x21;
const CRCResultRegL = 0x22;
const TModeReg = 0x2A;
const TPrescalerReg = 0x2B;
const TReloadRegH = 0x2C;
const TReloadRegL = 0x2D;
const VersionReg = 0x37;

const MAX_FIFO_READ = 62;

let initialized = false;
let versionText = "--";
let uidText = "--";
let sakText = "--";
let statusText = "Ready";
let keyMode = "A";
let keyHex = "FF FF FF FF FF FF";
let blockText = "4";
let writeHex = "00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00";
var SCRIPT_NAME = "rfid";

function hexByte(value) {
  var v = Number(value) & 0xFF;
  var s = v.toString(16).toUpperCase();
  return s.length < 2 ? ("0" + s) : s;
}

function bytesToHex(bytes) {
  if (!bytes || !bytes.length) return "";
  var out = [];
  for (var i = 0; i < bytes.length; i += 1) out.push(hexByte(bytes[i]));
  return out.join(" ");
}

function parseHexBytes(input, expectedLen) {
  var str = String(input || "").trim();
  if (!str) return [];
  var clean = str.replace(/0x/gi, "").replace(/[^0-9a-fA-F]/g, "");
  if (clean.length % 2 !== 0) throw new Error("Hex must have even number of digits");
  var out = [];
  for (var i = 0; i < clean.length; i += 2) out.push(parseInt(clean.slice(i, i + 2), 16) & 0xFF);
  if (typeof expectedLen === "number" && out.length !== expectedLen) {
    throw new Error("Expected " + String(expectedLen) + " bytes");
  }
  return out;
}

function readReg(reg) {
  var cmd = (((reg & 0xFF) << 1) & 0x7E) | 0x80;
  var resp = spi.transfer([cmd, 0x00], { cs: pin({ port: "A", number: 4 }), rxLength: 2 });
  return resp && resp.length >= 2 ? (resp[1] & 0xFF) : 0;
}

function writeReg(reg, value) {
  var cmd = ((reg & 0xFF) << 1) & 0x7E;
  spi.transfer([cmd, value & 0xFF], { cs: pin({ port: "A", number: 4 }), rxLength: 2 });
}

function setBitMask(reg, mask) {
  writeReg(reg, readReg(reg) | (mask & 0xFF));
}

function clearBitMask(reg, mask) {
  writeReg(reg, readReg(reg) & (~mask));
}

function antennaOn() {
  if ((readReg(TxControlReg) & 0x03) !== 0x03) setBitMask(TxControlReg, 0x03);
}

function stopCrypto1() {
  clearBitMask(Status2Reg, 0x08);
}

function mfrcReset() {
  writeReg(CommandReg, PCD_RESETPHASE);
}

function mfrcInit() {
  gpio.mode(pin({ port: "B", number: 6 }), "output");
  gpio.write(pin({ port: "B", number: 6 }), false);
  delay(2);
  gpio.write(pin({ port: "B", number: 6 }), true);
  gpio.mode(pin({ port: "B", number: 7 }), "input");
  delay(2);

  mfrcReset();
  writeReg(TModeReg, 0x8D);
  writeReg(TPrescalerReg, 0x3E);
  writeReg(TReloadRegL, 30);
  writeReg(TReloadRegH, 0);
  writeReg(TxAutoReg, 0x40);
  writeReg(ModeReg, 0x3D);
  antennaOn();
  versionText = "0x" + hexByte(readReg(VersionReg));
  initialized = true;
}

function calculateCRC(data) {
  clearBitMask(DivIrqReg, 0x04);
  setBitMask(FIFOLevelReg, 0x80);
  for (var i = 0; i < data.length; i += 1) writeReg(FIFODataReg, data[i] & 0xFF);
  writeReg(CommandReg, PCD_CALCCRC);
  var n = 0;
  var wait = 0xFF;
  do {
    n = readReg(DivIrqReg);
    wait -= 1;
  } while (wait > 0 && !(n & 0x04));
  return [readReg(CRCResultRegL), readReg(CRCResultRegM)];
}

function readFifoBytes(count) {
  var n = Number(count) | 0;
  if (n <= 0) return [];
  if (n > MAX_FIFO_READ) n = MAX_FIFO_READ;
  var readCmd = (((FIFODataReg & 0xFF) << 1) & 0x7E) | 0x80;
  var tx = [readCmd];
  var i = 0;
  while (i < (n - 1)) {
    tx.push(readCmd);
    i += 1;
  }
  tx.push(0x00);
  var resp = spi.transfer(tx, { cs: pin({ port: "A", number: 4 }), rxLength: tx.length });
  var out = [];
  for (var k = 1; k < resp.length; k += 1) out.push(resp[k] & 0xFF);
  return out;
}

function toCard(command, sendData) {
  var irqEn = 0x00;
  var waitIRq = 0x00;
  if (command === PCD_AUTHENT) {
    irqEn = 0x12;
    waitIRq = 0x10;
  } else if (command === PCD_TRANSCEIVE) {
    irqEn = 0x77;
    waitIRq = 0x30;
  }

  writeReg(CommIEnReg, irqEn | 0x80);
  clearBitMask(CommIrqReg, 0x80);
  setBitMask(FIFOLevelReg, 0x80);
  writeReg(CommandReg, PCD_IDLE);

  for (var i = 0; i < sendData.length; i += 1) writeReg(FIFODataReg, sendData[i] & 0xFF);
  writeReg(CommandReg, command);
  if (command === PCD_TRANSCEIVE) setBitMask(BitFramingReg, 0x80);

  var n = 0;
  var loops = 2000;
  do {
    n = readReg(CommIrqReg);
    loops -= 1;
  } while (loops > 0 && !(n & 0x01) && !(n & waitIRq));
  clearBitMask(BitFramingReg, 0x80);

  if (loops <= 0) return { status: MI_ERR, backBits: 0, backData: [] };
  if (readReg(ErrorReg) & 0x1B) return { status: MI_ERR, backBits: 0, backData: [] };
  if (n & irqEn & 0x01) return { status: MI_NOTAGERR, backBits: 0, backData: [] };

  var backBits = 0;
  var backData = [];
  if (command === PCD_TRANSCEIVE) {
    var level = readReg(FIFOLevelReg);
    var lastBits = readReg(ControlReg) & 0x07;
    backBits = lastBits ? ((level - 1) * 8 + lastBits) : (level * 8);
    if (level <= 0) level = 1;
    if (level > MAX_FIFO_READ) level = MAX_FIFO_READ;
    backData = readFifoBytes(level);
  }

  return { status: MI_OK, backBits: backBits, backData: backData };
}

function request(reqMode) {
  stopCrypto1();
  writeReg(BitFramingReg, 0x07);
  var result = toCard(PCD_TRANSCEIVE, [reqMode & 0xFF]);
  if (result.status !== MI_OK || result.backBits !== 0x10 || result.backData.length < 2) return null;
  return result.backData.slice(0, 2);
}

function anticoll() {
  clearBitMask(CollReg, 0x80);
  writeReg(BitFramingReg, 0x00);
  var result = toCard(PCD_TRANSCEIVE, [PICC_ANTICOLL, 0x20]);
  if (result.status !== MI_OK || result.backData.length < 5) return null;
  var uid = result.backData.slice(0, 5);
  var bcc = 0;
  for (var i = 0; i < 4; i += 1) bcc ^= uid[i];
  if ((bcc & 0xFF) !== (uid[4] & 0xFF)) return null;
  return uid;
}

function selectTag(uid) {
  if (!uid || uid.length < 5) return 0;
  var frame = [PICC_SELECTTAG, 0x70, uid[0], uid[1], uid[2], uid[3], uid[4]];
  var crc = calculateCRC(frame);
  frame.push(crc[0], crc[1]);
  var result = toCard(PCD_TRANSCEIVE, frame);
  if (result.status === MI_OK && result.backBits === 0x18 && result.backData.length >= 1) return result.backData[0] & 0xFF;
  return 0;
}

function authBlock(blockAddr, keyBytes, uid) {
  if (!uid || uid.length < 4 || !keyBytes || keyBytes.length !== 6) return false;
  var mode = keyMode === "B" ? PICC_AUTHENT1B : PICC_AUTHENT1A;
  var frame = [mode, blockAddr & 0xFF];
  for (var i = 0; i < 6; i += 1) frame.push(keyBytes[i] & 0xFF);
  for (var j = 0; j < 4; j += 1) frame.push(uid[j] & 0xFF);
  var result = toCard(PCD_AUTHENT, frame);
  return result.status === MI_OK && ((readReg(Status2Reg) & 0x08) !== 0);
}

function readBlock(blockAddr) {
  var frame = [PICC_READ, blockAddr & 0xFF];
  var crc = calculateCRC(frame);
  frame.push(crc[0], crc[1]);
  var result = toCard(PCD_TRANSCEIVE, frame);
  if (result.status !== MI_OK || result.backBits !== 0x90 || result.backData.length < 16) return null;
  return result.backData.slice(0, 16);
}

function writeBlock(blockAddr, data16) {
  if (!data16 || data16.length !== 16) return false;
  var head = [PICC_WRITE, blockAddr & 0xFF];
  var crcHead = calculateCRC(head);
  head.push(crcHead[0], crcHead[1]);
  var ack1 = toCard(PCD_TRANSCEIVE, head);
  if (ack1.status !== MI_OK || ack1.backBits !== 4 || ack1.backData.length < 1 || ((ack1.backData[0] & 0x0F) !== 0x0A)) return false;

  var body = data16.slice(0, 16);
  var crcBody = calculateCRC(body);
  body.push(crcBody[0], crcBody[1]);
  var ack2 = toCard(PCD_TRANSCEIVE, body);
  return ack2.status === MI_OK && ack2.backBits === 4 && ack2.backData.length >= 1 && ((ack2.backData[0] & 0x0F) === 0x0A);
}

function halt() {
  var frame = [PICC_HALT, 0x00];
  var crc = calculateCRC(frame);
  frame.push(crc[0], crc[1]);
  toCard(PCD_TRANSCEIVE, frame);
}

function parseBlockAddr() {
  var n = Number(String(blockText || "").trim());
  if (!isFinite(n) || n < 0 || n > 63) throw new Error("Block must be 0..63");
  return n | 0;
}

function detectAndSelect() {
  if (!initialized) mfrcInit();
  var tagType = request(PICC_REQIDL);
  if (!tagType) throw new Error("No card in field");
  var uid = anticoll();
  if (!uid) throw new Error("Anti-collision failed");
  var sak = selectTag(uid);
  if (!sak) throw new Error("Select failed");
  uidText = bytesToHex(uid.slice(0, 4));
  sakText = "0x" + hexByte(sak);
  return { uid: uid, sak: sak, tagType: tagType };
}

function ensureKey() {
  var key = parseHexBytes(keyHex, 6);
  keyHex = bytesToHex(key);
  return key;
}

function actionProbe() {
  try {
    mfrcInit();
    statusText = (versionText === "0x91" || versionText === "0x92") ? "MFRC522 ready" : ("Init OK, Version " + versionText);
  } catch (e) {
    statusText = "Probe failed: " + String(e && e.message ? e.message : e);
  }
  render();
}

function actionScanUid() {
  try {
    var card = detectAndSelect();
    stopCrypto1();
    halt();
    statusText = "UID read OK (ATQA " + bytesToHex(card.tagType) + ")";
  } catch (e) {
    statusText = "Scan failed: " + String(e && e.message ? e.message : e);
  }
  render();
}

function actionReadBlock() {
  try {
    var block = parseBlockAddr();
    var key = ensureKey();
    var card = detectAndSelect();
    if (!authBlock(block, key, card.uid)) throw new Error("Auth failed with Key " + keyMode);
    var data = readBlock(block);
    if (!data) throw new Error("Read failed");
    writeHex = bytesToHex(data);
    statusText = "Read block " + String(block) + " OK";
    stopCrypto1();
    halt();
  } catch (e) {
    statusText = "Read failed: " + String(e && e.message ? e.message : e);
    stopCrypto1();
  }
  render();
}

function actionWriteBlock() {
  try {
    var block = parseBlockAddr();
    var key = ensureKey();
    var data = parseHexBytes(writeHex, 16);
    writeHex = bytesToHex(data);
    var card = detectAndSelect();
    if (!authBlock(block, key, card.uid)) throw new Error("Auth failed with Key " + keyMode);
    if (!writeBlock(block, data)) throw new Error("Write NAK");
    statusText = "Write block " + String(block) + " OK";
    stopCrypto1();
    halt();
  } catch (e) {
    statusText = "Write failed: " + String(e && e.message ? e.message : e);
    stopCrypto1();
  }
  render();
}

function render() {
  renderTree(<App />);
}

function App() {
  return (
    <Scroll padding={16} spacing={10}>
      <Text font="title2" fontWeight="semibold">RFID (MFRC522)</Text>
      <Text>SDA/CS=A4, RST=B6, IRQ=B7</Text>
      <Row spacing={8}>
        <Button onTap={actionProbe}>Probe</Button>
        <Button onTap={actionScanUid}>Scan UID</Button>
      </Row>
      <Text font="caption">{"Version: " + versionText + " | UID: " + uidText + " | SAK: " + sakText}</Text>
      <Row spacing={8}>
        <Picker
          style="segmented"
          selected={keyMode}
          options={[{ label: "Key A (0x60)", value: "A" }, { label: "Key B (0x61)", value: "B" }]}
          onChange={(v) => { keyMode = String(v || "A") === "B" ? "B" : "A"; render(); }}
        />
        <TextField
          value={blockText}
          placeholder="Block (0..63)"
          onChange={(v) => { blockText = String(v || ""); render(); }}
        />
      </Row>
      <TextField
        value={keyHex}
        placeholder="Key (6 bytes hex, default FF FF FF FF FF FF)"
        onChange={(v) => { keyHex = String(v || ""); render(); }}
      />
      <TextEditor
        value={writeHex}
        placeholder="Data (16 bytes hex)"
        minHeight={90}
        onChange={(v) => { writeHex = String(v || ""); render(); }}
      />
      <Row spacing={8}>
        <Button onTap={actionReadBlock}>Read Block</Button>
        <Button onTap={actionWriteBlock}>Write Block</Button>
      </Row>
      <Text>{statusText}</Text>
    </Scroll>
  );
}

render();
