import Link from "next/link";

const RELEASE_DOWNLOAD_BASE = "https://github.com/continualmi/emwaver/releases/latest/download";

export default function WindowsFlashingTutorial() {
  return (
    <>
      <h1>Flash ESP32 firmware on Windows</h1>
      <p>
        This tutorial walks through installing the EMWaver Windows app and flashing the managed
        ESP32 firmware onto a supported dev board (ESP32, ESP32-S2, or ESP32-S3) — no ESP-IDF or manual build loop required.
      </p>

      <h2>What you&rsquo;ll need</h2>
      <ul>
        <li>A Windows 11 PC</li>
        <li>An ESP32-family dev board (ESP32, ESP32-S2, or ESP32-S3)</li>
        <li>A USB-C cable that supports data</li>
        <li>The EMWaver Windows app</li>
      </ul>

      <h2>1. Download and install</h2>
      <p>
        Download the latest EMWaver Windows installer or portable package from GitHub Releases:
      </p>
      <div className="mt-3 flex flex-wrap gap-3">
        <a
          href={`${RELEASE_DOWNLOAD_BASE}/EMWaverSetup-windows-x64.exe`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-3 rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface-2)] px-4 py-3 no-underline transition hover:bg-[color:var(--surface-3)]"
        >
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[color:var(--sky-tint-2)] text-[color:var(--sky)]">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M12 3v11m0 0 4-4m-4 4-4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M5 17v2a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </div>
          <div>
            <div className="text-sm font-semibold text-[color:var(--ink)]">Download installer</div>
            <div className="text-xs text-[color:var(--ink-dim)]">.EXE (recommended)</div>
          </div>
        </a>
      </div>
      <p className="mt-3">
        Run the installer. It places the app under the Start menu and creates a desktop shortcut.
        The portable <code>.zip</code> package is also available on the{" "}
        <Link href="/docs/install">install page</Link> if you prefer it.
      </p>

      <h2>2. Open the Device Connection window</h2>
      <p>
        Launch EMWaver, then click the <strong>Device</strong> button in the top-left corner.
        This opens the Device Connection window. Scroll down to the firmware section; this is where
        the <strong>Flash firmware</strong> button appears.
      </p>

      <figure className="my-6 rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] p-3">
        <img
          src="/tutorials/windows-flashing-device-modal.png"
          alt="EMWaver Windows Device Connection window with firmware flashing controls"
          className="w-full rounded-xl border border-[color:var(--line)]"
        />
        <figcaption className="mt-3 text-sm leading-6 text-[color:var(--ink-dim)]">
          Click the Device button in the top-left, then scroll down to the firmware flashing controls.
        </figcaption>
      </figure>

      <h2>3. Put the ESP32 into bootloader mode</h2>
      <p>
        Before flashing, the ESP32 must be in bootloader mode. On a typical ESP32-family dev board:
      </p>
      <ol>
        <li>Hold <strong>BOOT</strong>.</li>
        <li>Press and release <strong>RST</strong> / <strong>RESET</strong>.</li>
        <li>Release <strong>BOOT</strong> after a second.</li>
      </ol>
      <p>
        When bootloader mode is detected, the Device Connection window shows a bootloader status
        near the top-left. If it does not appear, press <strong>Refresh</strong> in the flashing
        section after putting the board into bootloader mode.
      </p>

      <figure className="my-6 rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] p-3">
        <img
          src="/tutorials/windows-flashing-bootloader-modal.png"
          alt="EMWaver Windows firmware flashing window showing ESP32 bootloader detected"
          className="w-full rounded-xl border border-[color:var(--line)]"
        />
        <figcaption className="mt-3 text-sm leading-6 text-[color:var(--ink-dim)]">
          Bootloader detected. Click <strong>Refresh</strong> if needed, then click{" "}
          <strong>Flash firmware</strong>.
        </figcaption>
      </figure>

      <h2>4. Flash firmware</h2>
      <p>
        Click <strong>Flash firmware</strong>. The app uses the bundled ESP32 flashing helper and
        the prebuilt EMWaver ESP32 firmware images that ship inside the app.
      </p>
      <p>
        The flashing process can take around <strong>2 minutes</strong>. Keep the board plugged in
        and do not close the app while the progress log is running.
      </p>

      <figure className="my-6 rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] p-3">
        <img
          src="/tutorials/windows-flashing-progress.png"
          alt="EMWaver Windows firmware flashing progress log"
          className="w-full rounded-xl border border-[color:var(--line)]"
        />
        <figcaption className="mt-3 text-sm leading-6 text-[color:var(--ink-dim)]">
          Firmware flashing in progress. This usually takes about 2 minutes.
        </figcaption>
      </figure>

      <blockquote>
        The Windows app bundles the ESP32 firmware partitions: <code>bootloader.bin</code>,{" "}
        <code>partition-table.bin</code>, <code>ota-data.bin</code>, and <code>app.bin</code>.
        You do not need to download or build anything else.
      </blockquote>

      <h2>5. Reset and verify</h2>
      <p>
        When flashing completes, reset the ESP32 board. Do this by pressing <strong>RST</strong>{" "}
        / <strong>RESET</strong>, or by unplugging and plugging the board back in without holding
        BOOT.
      </p>
      <p>
        The device should now leave bootloader mode and show up in EMWaver as a connected device.
        Verify that the top-left device indicator looks connected, like it did before flashing.
      </p>

      <h2>Run a test script</h2>
      <p>
        Switch to the Scripts view, open one of the built-in scripts, and press <strong>Run</strong>:
      </p>
      <ul>
        <li><code>hello.js</code> — confirms the script engine is working.</li>
        <li><code>blink.js</code> — toggles a GPIO pin.</li>
        <li><code>cc1101.js</code> — controls a CC1101 module over SPI.</li>
      </ul>

      <h2>Troubleshooting</h2>
      <h3>Bootloader not detected</h3>
      <p>
        Hold BOOT, press and release RST, then release BOOT after a second. If it still does
        not appear, click Refresh in the flashing section or try another data-capable USB cable.
      </p>
      <h3>Wrong COM port selected</h3>
      <p>
        Use the port selector in the firmware flashing window. Pick the port that appears when
        the ESP32 is plugged in or enters bootloader mode.
      </p>
      <h3>Device does not reconnect after flashing</h3>
      <p>
        Reset or replug the board without holding BOOT. If it stays in bootloader mode, press
        RST again with BOOT released.
      </p>

      <h2>Next steps</h2>
      <p>With firmware flashed and a working connection:</p>
      <ul>
        <li>
          Try <Link href="/docs/tutorials/windows-cc1101">Windows CC1101 (433 MHz)</Link> to wire
          up a radio module and transmit a 433 MHz carrier.
        </li>
        <li>
          Read the <Link href="/docs/scripts">scripting guide</Link> to learn the JSX UI model
          and device API modules.
        </li>
      </ul>
    </>
  );
}
