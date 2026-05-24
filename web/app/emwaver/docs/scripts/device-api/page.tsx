export default function DeviceApiDocPage() {
  return (
    <>
      <h1>Device API</h1>
      <p>
        Device APIs are imported from local EMWaver modules. Calls are synchronous from the script
        point of view and talk to the connected board through the native app transport.
      </p>
      <blockquote>
        Prefer module imports over legacy globals. The current default scripts use
        <code>{`import { pin, gpio } from "emw-gpio"`}</code>, <code>{`import { spi } from "emw-spi"`}</code>,
        and similar module imports.
      </blockquote>

      <h2>Pins</h2>
      <p>
        Use <code>pin(...)</code> to describe a target pin. ESP boards normally use GPIO numbers;
        STM32F042 examples often use port/number pairs.
      </p>
      <pre>
        <code className="language-javascript">{`import { pin, gpio } from "emw-gpio";

const espGpio4 = pin({ gpio: 4 });
const stmA0 = pin({ port: "A", number: 0 });
const stmB6 = pin({ port: "B", number: 6 });

const encoded = gpio.value(stmA0); // numeric firmware pin value`}</code>
      </pre>

      <h2>GPIO</h2>
      <pre>
        <code className="language-javascript">{`import { pin, gpio } from "emw-gpio";

const led = pin({ gpio: 4 });

gpio.mode(led, "output");
gpio.write(led, true);

gpio.mode(led, "input");
const level = gpio.read(led); // 0 or 1`}</code>
      </pre>

      <h2>ADC</h2>
      <pre>
        <code className="language-javascript">{`import { pin } from "emw-gpio";
import { adc } from "emw-adc";

adc.resolution(12);
const raw = adc.read(pin({ port: "A", number: 0 }));
const avg = adc.read(pin({ port: "A", number: 0 }), { samples: 16 });

const vref = adc.vrefint();
const temp = adc.temp();
const vbat = adc.vbat();`}</code>
      </pre>

      <h2>PWM</h2>
      <pre>
        <code className="language-javascript">{`import { pin } from "emw-gpio";
import { pwm } from "emw-pwm";

pwm.resolution(12);
pwm.write(pin({ gpio: 4 }), 2048);              // ~50% duty
pwm.write(pin({ gpio: 4 }), 1024, { hz: 1000 }); // set frequency too`}</code>
      </pre>

      <h2>SPI</h2>
      <p>
        Transfers are capped to firmware packet sizes, so keep transactions small or split them.
        If <code>rxLength</code> is omitted, the response length follows the transmitted length.
      </p>
      <pre>
        <code className="language-javascript">{`import { pin } from "emw-gpio";
import { spi } from "emw-spi";

const rx = spi.transfer([0x80, 0x00], {
  cs: pin({ port: "A", number: 4 }),
  rxLength: 2,
});

const bus = spi.open({ cs: pin({ gpio: 10 }) });
const version = bus.transfer([0x30, 0x00], { rxLength: 2 });`}</code>
      </pre>

      <h2>I2C</h2>
      <pre>
        <code className="language-javascript">{`import { i2c } from "emw-i2c";

i2c.begin(400000);
i2c.write(0x68, [0x6B, 0x00]);
const data = i2c.read(0x68, 6, { timeout: 250 });
const reg = i2c.xfer(0x68, [0x3B], 6);
i2c.end();

const bus = i2c.open({ hz: 100000 });
bus.write(0x3C, [0x00, 0xAF]);
bus.close();`}</code>
      </pre>

      <h2>UART</h2>
      <pre>
        <code className="language-javascript">{`import { uart } from "emw-uart";

uart.begin(115200);
uart.write("AT\r\n");
const response = uart.read(64, { timeout: 1000 });
uart.end();

const serial = uart.open({ baud: 9600 });
serial.write([0x01, 0x02, 0x03]);
const bytes = serial.read(32);
serial.close();`}</code>
      </pre>

      <h2>Sampler</h2>
      <p>
        The sampler captures digital signals into a host-visible buffer, supports waveform UI plots,
        and can retransmit buffered bytes with carrier/tick settings.
      </p>
      <pre>
        <code className="language-javascript">{`import { pin, gpio } from "emw-gpio";
import { Sampler } from "emw-sampler";

const rxPin = gpio.value(pin({ gpio: 4 }));
const txPin = gpio.value(pin({ gpio: 37 }));

const session = Sampler.start({
  pin: rxPin,
  periodUs: 10,
  maxBytes: 393216,
  clearBefore: true,
});

delay(1000);
Sampler.stop(session.id);

const len = Sampler.lenBytes();
const bytes = Sampler.getBytes();
const first = Sampler.sliceBytes(0, 100);

Sampler.transmitBufferStart(bytes, {
  pin: txPin,
  dutyPercent: 50,
  freqHz: 38000,
  tickUs: 10,
});`}</code>
      </pre>

      <h2>Files</h2>
      <pre>
        <code className="language-javascript">{`import { FS } from "emw-fs";
import { Sampler } from "emw-sampler";

const dir = FS.appDataDir();
const path = FS.join(dir, "signal.raw");

FS.ensureDir(dir);
FS.writeText(FS.join(dir, "notes.txt"), "captured on bench");
const notes = FS.readText(FS.join(dir, "notes.txt"));
const names = FS.readDir(dir);

Sampler.saveBytesFile(path);
Sampler.setBytes(FS.readBytes(path));`}</code>
      </pre>

      <h2>Device info</h2>
      <pre>
        <code className="language-javascript">{`const firmware = device.version();
const board = device.boardType(); // e.g. "stm32f042", "esp32s2", "esp32s3"

device.reset();`}</code>
      </pre>

      <h2>Legacy names to avoid in new docs</h2>
      <p>
        Some older pages and snippets used Arduino-style globals such as <code>pinMode</code>,
        <code> digitalWrite</code>, <code>analogRead</code>, <code>analogWrite</code>, <code>SPI</code>,
        <code> Wire</code>, and <code>Serial</code>. New examples should use imported modules instead.
      </p>
    </>
  );
}
