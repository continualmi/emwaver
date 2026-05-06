export default function DeviceApiDocPage() {
  return (
    <>
      <h1>Device API</h1>
      <p>
        All device functions are synchronous — they block until the board responds over USB.
        The API surface uses Arduino-style naming where applicable.
      </p>

      <h2>GPIO</h2>
      <pre>
        <code className="language-javascript">{`pinMode(pin, INPUT);       // or OUTPUT
digitalWrite(pin, HIGH);   // or LOW
const val = digitalRead(pin); // returns HIGH or LOW`}</code>
      </pre>

      <h2>ADC</h2>
      <pre>
        <code className="language-javascript">{`const raw = analogRead(pin);             // 12-bit (0..4095)
const avg = analogRead(pin, { samples: 16 }); // averaged

analogReadResolution(10);  // scale result to 10-bit

// Internal sources
analogReadVrefint();       // internal voltage reference
analogReadTemp();          // die temperature
analogReadVbat();          // battery domain`}</code>
      </pre>

      <h2>PWM</h2>
      <pre>
        <code className="language-javascript">{`analogWrite(pin, 2048);              // 50% duty, default freq
analogWrite(pin, 1024, { hz: 1000 }); // 25% at 1 kHz

analogWriteResolution(8); // scale input to 8-bit (0..255)`}</code>
      </pre>

      <h2>SPI</h2>
      <pre>
        <code className="language-javascript">{`// Full-duplex transfer with chip select
const rx = SPI.transfer([0x80, 0x00], {
  cs: NSS,        // chip-select pin
  rxLength: 2,    // bytes to read back
});
// rx is an array of received bytes`}</code>
      </pre>

      <h2>I2C (Wire)</h2>
      <pre>
        <code className="language-javascript">{`Wire.begin();            // open I2C1 on B6/B7
Wire.begin(400000);      // 400 kHz

Wire.write(0x68, [0x6B, 0x00]);            // write to address
const data = Wire.read(0x68, 6);           // read 6 bytes
const reg = Wire.xfer(0x68, [0x3B], 6);    // write-then-read

Wire.end();`}</code>
      </pre>

      <h2>UART (Serial)</h2>
      <pre>
        <code className="language-javascript">{`Serial.begin(115200);

Serial.write("AT\\r\\n");
Serial.write([0x01, 0x02, 0x03]);

const response = Serial.read(64, {
  timeout: 1000,  // ms
});

Serial.end();`}</code>
      </pre>

      <h2>Sampler</h2>
      <p>
        The sampler captures digital signals by sampling a pin at a configurable rate using
        firmware-side ISR-driven bit packing.
      </p>
      <pre>
        <code className="language-javascript">{`// Blocking capture
Sampler.capture({ pin: IR_RX, durationMs: 5000 });

// ISR-driven background capture
const id = Sampler.start({
  pin: IR_RX,
  periodUs: 10,        // sample period in microseconds
  clearBefore: true,
});
delay(3000);
Sampler.stop(id);

// Access buffer
const len = Sampler.lenBytes();
const bytes = Sampler.getBytes();
const slice = Sampler.sliceBytes(0, 100);

// Save/load
Sampler.saveBytesFile(FS.join(FS.appDataDir(), "signal.bin"));
Sampler.setBytes(FS.readBytes("signal.bin"));

// Retransmit
Sampler.transmitBufferStart(bytes, {
  pin: IR_TX,
  dutyPercent: 33,
  freqHz: 38000,       // carrier frequency
  tickUs: 10,          // bit period
});`}</code>
      </pre>

      <h2>Device info</h2>
      <pre>
        <code className="language-javascript">{`device.version();    // firmware version, e.g. "1.0"
device.boardType();  // "stm32f042", "esp32s3"
device.reset();      // reset the MCU`}</code>
      </pre>
    </>
  );
}
