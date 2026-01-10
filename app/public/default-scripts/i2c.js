// Simple I2C test script for STM32F042 (I2C1 on PB6/PB7)
let hz = "100000";
let addrHex = "3C";
let txHex = "";
let rxLen = 1;
let status = "";
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
  status = "Opening...";
  render();
  var h = parseInt(hz, 10);
  if (!Number.isFinite(h) || h <= 0) {
    status = "Invalid hz: " + String(hz);
    render();
    return;
  }
  var resp = Wire.begin(h);
  if (resp && typeof resp.then === "function") {
    resp.then(function () {
      pushLog("i2c open --hz=" + h);
      status = "Opened @ " + h + " Hz";
      render();
    });
  } else {
    pushLog("i2c open --hz=" + h);
    status = "Opened @ " + h + " Hz";
    render();
  }
}

function closeI2c() {
  status = "Closing...";
  render();
  var resp = Wire.end();
  if (resp && typeof resp.then === "function") {
    resp.then(function () {
      pushLog("i2c close");
      status = "Closed";
      render();
    });
  } else {
    pushLog("i2c close");
    status = "Closed";
    render();
  }
}

function writeI2c() {
  status = "Writing...";
  render();
  var h = parseInt(hz, 10);
  if (!Number.isFinite(h) || h <= 0) h = 100000;
  var a = parseAddr7();
  if (a < 0) {
    status = "Invalid addr: " + String(addrHex);
    render();
    return;
  }
  var resp = Wire.write(a, txHex, { hz: h, timeout: 250 });
  var cmd = "i2c write --addr=0x" + a.toString(16).toUpperCase() + " --tx=" + String(txHex);

  var done = function () {
    pushLog(cmd);
    status = "Write OK";
    render();
  };
  if (resp && typeof resp.then === "function") resp.then(done);
  else done();
}

function readI2c() {
  status = "Reading...";
  render();
  var h = parseInt(hz, 10);
  if (!Number.isFinite(h) || h <= 0) h = 100000;
  var a = parseAddr7();
  if (a < 0) {
    status = "Invalid addr: " + String(addrHex);
    render();
    return;
  }
  var n = Math.max(0, Math.min(63, Number(rxLen) | 0));
  var resp = Wire.read(a, n, { hz: h, timeout: 250 });
  var cmd = "i2c read --addr=0x" + a.toString(16).toUpperCase() + " --n=" + n;

  var done = function (bytes) {
    pushLog(cmd + " -> " + (bytes && bytes.length ? bytes.length : 0) + " byte(s)");
    if (bytes && bytes.length) pushLog("rx: " + fmtBytes(bytes));
    status = bytes && bytes.length ? "Read " + bytes.length + " byte(s)" : "No data";
    render();
  };
  if (resp && typeof resp.then === "function") resp.then(done);
  else done(resp);
}

function xferI2c() {
  status = "Transferring...";
  render();
  var h = parseInt(hz, 10);
  if (!Number.isFinite(h) || h <= 0) h = 100000;
  var a = parseAddr7();
  if (a < 0) {
    status = "Invalid addr: " + String(addrHex);
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
    status = bytes && bytes.length ? "OK" : "OK (no data)";
    render();
  };
  if (resp && typeof resp.then === "function") resp.then(done);
  else done(resp);
}

function scanI2c() {
  status = "Scanning...";
  render();

  var h = parseInt(hz, 10);
  if (!Number.isFinite(h) || h <= 0) h = 100000;

  var found = [];
  var start = 0x03;
  var end = 0x77;
  var addr = start;

  var step = function () {
    if (addr > end) {
      status = "Scan done (" + found.length + " found)";
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
        UI.text({ text: "I2C (PB6/PB7)", font: "title2", fontWeight: "semibold" }),
        UI.text({ text: "Note: PB6/PB7 are shared with USART1; using I2C will switch the pins to I2C1.", foregroundColor: "#9CA3AF" }),

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

        status
          ? UI.text({
              text: status,
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

