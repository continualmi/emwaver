function detectBoardType() {
  try {
    if (typeof device !== "undefined" && device && typeof device.boardType === "function") {
      const value = String(device.boardType() || "").trim().toLowerCase();
      if (value === "esp32s2") return "esp32s2";
      if (value === "esp32s3") return "esp32s3";
    }
  } catch (e) {}
  return "stm32f042";
}

const boardType = detectBoardType();
const blinkPin = boardType === "esp32s2" || boardType === "esp32s3" ? 4 : 2;
const SCRIPT_NAME = "hello.js";

var blinkTick = 0;

UI.render(
  UI.column({
    padding: 16,
    spacing: 12,
    children: [
      UI.text({
        text: "hello",
      }),
    ],
  })
);

let level = LOW;
pinMode(blinkPin, OUTPUT);
digitalWrite(blinkPin, level);

every(250, function () {
  blinkTick += 1;
  if (blinkTick === 1 || blinkTick % 20 === 0) {
  }
  level = level === LOW ? HIGH : LOW;
  digitalWrite(blinkPin, level);
});
