// Live sampler capture (desktop)
let selectedPin = "0";
let isRecording = false;
let statusText = "";
let bytesInBuffer = 0;
let sessionId = null;
let pollHandle = null;
let supportsTimers = typeof setInterval === "function" && typeof clearInterval === "function";

// Keep STM32 pin labels aligned with the Sampler's STM32 pin list (Desktop/iOS/Android).
const STM32_PIN_LABELS = [
  "PA0 (TIM2 CH1)",
  "PA1 (IR_RX)",
  "PA2 (IR_TX on Infrared Waver / GDO0 on ISM Waver, TIM2 CH3)",
  "PA3 (TIM2 CH4)",
  "PA4",
  "PA5",
  "PA6",
  "PA7",
  "PA13",
  "PA14",
  "PB6",
  "PB7",
];

function stm32PinValueFromLabel(label) {
  const match = String(label).match(/\bP([AB])(\d{1,2})\b/);
  if (!match) return "";
  const bank = match[1];
  const pin = parseInt(match[2], 10);
  if (!Number.isFinite(pin) || pin < 0 || pin > 15) return "";
  return String(bank === "A" ? pin : 16 + pin);
}

const STM32_PINS = STM32_PIN_LABELS
  .map((label) => ({ label, value: stm32PinValueFromLabel(label) }))
  .filter((pin) => pin.value !== "");

selectedPin = (STM32_PINS[0] || { value: "0" }).value;

function getSelectedPinNumber() {
  return Number(selectedPin);
}

async function refreshBufferStats() {
  try {
    bytesInBuffer = Number(await Sampler.buffer.lenBytes());
  } catch (e) {
    // Keep previous value.
  }
  render();
}

function stopPolling() {
  if (pollHandle != null && supportsTimers) {
    clearInterval(pollHandle);
  }
  pollHandle = null;
}

function startPolling() {
  stopPolling();
  if (!supportsTimers) return;
  pollHandle = setInterval(function () {
    void refreshBufferStats();
  }, 250);
}

async function startRecording() {
  if (isRecording) return;
  const pin = getSelectedPinNumber();
  if (!Number.isFinite(pin) || pin < 0) {
    statusText = "Invalid pin";
    render();
    return;
  }

  statusText = "Starting sampler...";
  render();

  try {
    const session = await Sampler.start({ pin: pin, clearBefore: true });
    sessionId = session && session.id ? String(session.id) : null;
    isRecording = true;
    statusText = supportsTimers ? "Recording (live polling on)..." : "Recording (live polling unavailable)...";
    await refreshBufferStats();
    startPolling();
  } catch (e) {
    sessionId = null;
    isRecording = false;
    statusText = "Start failed: " + String(e && e.message ? e.message : e);
    stopPolling();
    render();
  }
}

async function stopRecording() {
  if (!isRecording) return;
  statusText = "Stopping sampler...";
  render();

  stopPolling();
  try {
    await Sampler.stop(sessionId);
    sessionId = null;
    isRecording = false;
    statusText = "Stopped";
    await refreshBufferStats();
  } catch (e) {
    statusText = "Stop failed: " + String(e && e.message ? e.message : e);
    render();
  }
}

function render() {
  const selectedPinEntry = STM32_PINS.find((p) => p.value === String(selectedPin)) || STM32_PINS[0];
  const selectedPinLabel = selectedPinEntry ? selectedPinEntry.label : "Pin " + String(selectedPin);

  UI.render(
    UI.column({
      padding: 16,
      spacing: 14,
      children: [
        UI.text({ text: "Sampler", font: "title2", fontWeight: "semibold" }),

        UI.text({ text: "Pin", fontWeight: "medium" }),
        UI.picker({
          style: "menu",
          selected: String(selectedPin),
          options: STM32_PINS,
          onChange: function (value) {
            selectedPin = String(value);
            render();
          },
        }),

        UI.row({
          spacing: 12,
          children: [
            UI.button({
              label: isRecording ? "Recording..." : "Start",
              backgroundColor: isRecording ? "#334155" : "#059669",
              foregroundColor: "#FFFFFF",
              onTap: startRecording,
            }),
            UI.button({
              label: "Stop",
              backgroundColor: "#DC2626",
              foregroundColor: "#FFFFFF",
              onTap: stopRecording,
            }),
            UI.button({
              label: "Refresh",
              backgroundColor: "#2563EB",
              foregroundColor: "#FFFFFF",
              onTap: refreshBufferStats,
            }),
          ],
        }),

        UI.text({
          text: "Sampler buffer: " + String(bytesInBuffer) + " bytes",
          backgroundColor: "#0B1220",
          foregroundColor: "#E5E7EB",
          padding: { top: 10, bottom: 10, leading: 12, trailing: 12 },
          cornerRadius: 8,
        }),

        statusText
          ? UI.text({
              text: statusText,
              backgroundColor: "#111827",
              foregroundColor: "#FFFFFF",
              padding: { top: 10, bottom: 10, leading: 12, trailing: 12 },
              cornerRadius: 8,
            })
          : null,

        !supportsTimers
          ? UI.text({
              text:
                "Note: Live polling uses timers (setInterval). If this host runtime doesn't expose timers, use Refresh to update the byte count.",
              foregroundColor: "#94A3B8",
            })
          : null,
      ],
    }),
  );
}

render();