// Simple PWM (analogWrite) test script for STM32F042
// Firmware support: `pwm write --pin=<encoded> --value=<0..4095> [--hz=<freq>]`
let selectedPin = "0"; // PA0..PA3 only
let hzText = "1000";
let resolutionBits = 12;
let dutyU12 = 0;
let status = "";
let lastAction = "";
let logLines = [];
let sweeping = false;

const PWM_PINS = [
  { label: "PA0 / TIM2_CH1 (pin 0)", value: "0" },
  { label: "PA1 / TIM2_CH2 (pin 1)", value: "1" },
  { label: "PA2 / TIM2_CH3 (pin 2)", value: "2" },
  { label: "PA3 / TIM2_CH4 (pin 3)", value: "3" },
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

  status = "Writing...";
  render();

  const timeout =
    opts && typeof opts.timeout === "number" && isFinite(opts.timeout) && opts.timeout > 0
      ? (opts.timeout | 0)
      : 1500;
  const res = analogWrite(pin, v, { hz: hz, timeout: timeout });
  const done = function () {
    status = "OK (" + dutyAsPercent() + "% @ " + hz + " Hz)";
    render();
  };
  const fail = function (e) {
    status = "Error: " + String(e && e.message ? e.message : e);
    render();
  };
  if (res && typeof res.then === "function") {
    res.then(done).catch(fail);
  } else {
    done();
  }
}

async function sweep() {
  if (sweeping) {
    sweeping = false;
    status = "Stopping sweep...";
    render();
    return;
  }

  sweeping = true;
  status = "Sweeping...";
  render();

  const max = currentMaxValue();
  const steps = Math.max(32, Math.min(256, (max / 16) | 0));

  while (sweeping) {
    for (let i = 0; i <= steps && sweeping; i += 1) {
      const v = Math.round((i * max) / steps);
      applyWrite(v);
      Utils.delay(8);
    }
    for (let i = steps; i >= 0 && sweeping; i -= 1) {
      const v = Math.round((i * max) / steps);
      applyWrite(v);
      Utils.delay(8);
    }
  }

  status = "Sweep stopped";
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
        UI.text({ text: "Firmware PWM pins: PA0..PA3 only (TIM2 channels).", foregroundColor: "#6B7280" }),

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

        status
          ? UI.text({
              text: status,
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
