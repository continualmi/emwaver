// Minimal "hello world" EMWaver script: blink the GDO0 pin using `every()`.

let periodMs = 250;
let running = false;
let level = LOW;
let ticker = null;
let statusText = "";

async function setLevel(next) {
  level = next ? HIGH : LOW;
  await Promise.resolve(digitalWrite(GDO0, level));
}

async function start() {
  if (running) return;
  running = true;
  statusText = "Starting…";
  render();

  await Promise.resolve(pinMode(GDO0, OUTPUT));
  await setLevel(LOW);

  print("blink.js: blinking GDO0 every " + periodMs + "ms");
  statusText = "Blinking GDO0 (" + periodMs + "ms)";

  ticker = every(periodMs, async function () {
    await setLevel(level === LOW ? HIGH : LOW);
    render();
  });

  render();
}

function stop() {
  if (!running) return;
  running = false;
  statusText = "Stopped";
  try {
    if (ticker) ticker.stop();
  } finally {
    ticker = null;
  }

  Promise.resolve(setLevel(LOW)).catch(function () {});
  render();
}

function toggle() {
  if (running) return stop();
  return start();
}

function render() {
  UI.render(
    UI.column({
      padding: 16,
      spacing: 12,
      children: [
        UI.text({ text: "Blink (GDO0)", font: "title2", fontWeight: "semibold" }),
        UI.text({ text: statusText || "Tap Start to blink GDO0.", foregroundColor: "#6B7280" }),
        UI.row({
          spacing: 12,
          children: [
            UI.button({
              label: running ? "Stop" : "Start",
              backgroundColor: running ? "#DC2626" : "#2563EB",
              foregroundColor: "#FFFFFF",
              onTap: toggle,
            }),
            UI.text({
              text: "Level: " + (level === HIGH ? "HIGH" : "LOW"),
              fontWeight: "medium",
            }),
          ],
        }),
      ],
    })
  );
}

render();
