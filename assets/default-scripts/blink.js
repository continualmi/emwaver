// Blink a pin using timers (setTimeout) + `every()`.

function normalizeBoardType(value) {
  var board = String(value || "").trim().toLowerCase();
  if (board === "esp32s2") return "esp32s2";
  if (board === "esp32s3") return "esp32s3";
  return "stm32f042";
}

function detectBoardType() {
  try {
    if (typeof device !== "undefined" && device && typeof device.boardType === "function") {
      return normalizeBoardType(device.boardType());
    }
  } catch (e) {}
  return "stm32f042";
}

function espPinLabel(pin) {
  if (pin === 4) return "GPIO4 (IR_TX default)";
  if (pin === 10) return "GPIO10 (SPI CS default)";
  if (pin === 11) return "GPIO11 (SPI MOSI default)";
  if (pin === 12) return "GPIO12 (SPI SCK default)";
  if (pin === 13) return "GPIO13 (SPI MISO default)";
  if (pin === 37) return "GPIO37 (IR_TX shield)";
  return "GPIO" + String(pin);
}

function buildEspPins() {
  var out = [];
  for (var pin = 0; pin <= 48; pin += 1) {
    out.push({ label: espPinLabel(pin), value: String(pin) });
  }
  return out;
}

function firstEnabledPin(options) {
  for (var i = 0; i < options.length; i += 1) {
    if (!options[i].disabled) return String(options[i].value);
  }
  return options.length ? String(options[0].value) : "0";
}

const PINS_BY_BOARD = {
  stm32f042: [
    { label: "GDO0 (A2)", value: 2 },
    { label: "GDO2 (A3)", value: 3 },
    { label: "IR_RX (A0)", value: 0 },
    { label: "IR_TX (A1)", value: 1 },
    { label: "NSS (A4)", value: 4 },
    { label: "SCK (A5)", value: 5 },
    { label: "MISO (A6)", value: 6 },
    { label: "MOSI (A7)", value: 7 },
    { label: "UART_TX (B6)", value: 22 },
    { label: "UART_RX (B7)", value: 23 },
  ],
  esp32s2: buildEspPins(),
  esp32s3: buildEspPins(),
};

const boardType = detectBoardType();
let selectedPin = firstEnabledPin(PINS_BY_BOARD[boardType]);
let periodMs = 250;
let isBlinking = false;
let level = LOW;
let loopHandle = null;
const SCRIPT_NAME = "blink.js";

function boardPins() {
  return PINS_BY_BOARD[boardType] || PINS_BY_BOARD.stm32f042;
}

function stopBlink(silent) {
  if (!silent) {
  }
  if (loopHandle && typeof loopHandle.stop === "function") {
    loopHandle.stop();
  }
  loopHandle = null;
  isBlinking = false;
  render();
}

function startBlink(logAction) {
  if (logAction) {
  }
  stopBlink(true);

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
  startBlink(true);
}

function render() {
  UI.render(
    UI.column({
      padding: 16,
      spacing: 14,
      children: [
        UI.text({ text: "Blink", font: "title2", fontWeight: "semibold" }),
        UI.text({ text: boardType === "esp32s2" ? "Detected MCU: ESP32-S2" : boardType === "esp32s3" ? "Detected MCU: ESP32-S3" : "Detected MCU: STM32F042", font: "caption" }),

        UI.picker({
          id: "blink.pin",
          style: "menu",
          selected: String(selectedPin),
          options: boardPins(),
          onChange: function (value) {
            selectedPin = String(value);
            if (isBlinking) {
              void startBlink(false);
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
              void startBlink(false);
            } else {
              render();
            }
          },
        }),

        UI.button({
          id: "blink.toggle",
          label: isBlinking ? "Stop" : "Start",
          onTap: toggleBlink,
        }),
      ],
    }),
  );
}

render();
