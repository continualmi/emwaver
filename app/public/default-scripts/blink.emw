// Minimal "hello world" EMWaver script: blink GDO0 using `every()`.

var periodMs = 250;
var level = LOW;

pinMode(GDO0, OUTPUT);
digitalWrite(GDO0, level);
print("blink.js: blinking GDO0 every " + periodMs + "ms");

every(periodMs, function () {
  level = level === LOW ? HIGH : LOW;
  digitalWrite(GDO0, level);
});
