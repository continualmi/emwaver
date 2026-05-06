import Link from "next/link";

function PreviewDownloads() {
  return (
    <div className="grid gap-3 md:grid-cols-3">
      <a
        href="/emwaver/downloads/EMWaver-linux-x64.tar.gz"
        className="no-underline rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] p-5 hover:bg-[color:var(--surface-2)]"
      >
        <div className="text-xs font-semibold text-[color:var(--ink-dim)]">Linux</div>
        <div className="pt-2 text-lg font-semibold text-[color:var(--ink)]">CLI + Gateway</div>
        <div className="pt-2 text-sm text-[color:var(--ink-dim)]">Primary Linux method for browser rendering and daemon hardware transport.</div>
      </a>

      <a
        href="/emwaver/downloads/EMWaver-macos-cli.tar.gz"
        className="no-underline rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] p-5 hover:bg-[color:var(--surface-2)]"
      >
        <div className="text-xs font-semibold text-[color:var(--ink-dim)]">macOS</div>
        <div className="pt-2 text-lg font-semibold text-[color:var(--ink)]">CLI + Gateway</div>
        <div className="pt-2 text-sm text-[color:var(--ink-dim)]">Command-line gateway and daemon package.</div>
      </a>

      <a
        href="/emwaver/downloads/EMWaver-android.apk"
        className="no-underline rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] p-5 hover:bg-[color:var(--surface-2)]"
      >
        <div className="text-xs font-semibold text-[color:var(--ink-dim)]">Android</div>
        <div className="pt-2 text-lg font-semibold text-[color:var(--ink)]">APK</div>
        <div className="pt-2 text-sm text-[color:var(--ink-dim)]">Direct preview build.</div>
      </a>

      <a
        href="/emwaver/downloads/EMWaver-macos.dmg"
        className="no-underline rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] p-5 hover:bg-[color:var(--surface-2)]"
      >
        <div className="text-xs font-semibold text-[color:var(--ink-dim)]">macOS</div>
        <div className="pt-2 text-lg font-semibold text-[color:var(--ink)]">DMG</div>
        <div className="pt-2 text-sm text-[color:var(--ink-dim)]">Desktop preview build.</div>
      </a>

      <a
        href="/emwaver/downloads/EMWaverSetup-windows-x64.exe"
        className="no-underline rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] p-5 hover:bg-[color:var(--surface-2)]"
      >
        <div className="text-xs font-semibold text-[color:var(--ink-dim)]">Windows</div>
        <div className="pt-2 text-lg font-semibold text-[color:var(--ink)]">Installer EXE</div>
        <div className="pt-2 text-sm text-[color:var(--ink-dim)]">Recommended Windows x64 installer.</div>
      </a>

      <a
        href="/emwaver/downloads/EMWaver-windows-x64.zip"
        className="no-underline rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] p-5 hover:bg-[color:var(--surface-2)]"
      >
        <div className="text-xs font-semibold text-[color:var(--ink-dim)]">Windows</div>
        <div className="pt-2 text-lg font-semibold text-[color:var(--ink)]">ZIP with EXE</div>
        <div className="pt-2 text-sm text-[color:var(--ink-dim)]">Portable Windows x64 package.</div>
      </a>
    </div>
  );
}

function MobileStoreBadges() {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {[
        ["iOS", "App Store", "iPhone and iPad coming soon."],
        ["Android", "Google Play", "Store listing coming soon. APK is also available."],
      ].map(([platform, store, description]) => (
        <div
          key={platform}
          className="rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] p-5"
        >
          <div className="text-xs font-semibold text-[color:var(--ink-dim)]">{platform}</div>
          <div className="pt-2 text-lg font-semibold text-[color:var(--ink)]">{store}</div>
          <div className="pt-2 text-sm text-[color:var(--ink-dim)]">{description}</div>
          <div className="pt-4 text-sm font-semibold text-[color:var(--ink-dim)]">Coming soon</div>
        </div>
      ))}
    </div>
  );
}


export default function InstallDocPage() {
  return (
    <>
      <h1>Install and run locally</h1>
      <p>
        Get the EMWaver app or CLI, connect your board, and start running scripts.
      </p>

      <h2>1. Install the app or CLI</h2>
      <p>
        Linux is CLI-first: use the CLI/gateway tarball to start the local browser experience and
        daemon-backed hardware runtime. macOS can use either the native DMG or CLI package. Windows
        currently uses the installer EXE or portable ZIP, with CLI parity planned.
      </p>
      <PreviewDownloads />

      <h3>Mobile stores</h3>
      <MobileStoreBadges />

      <h2>2. Get a supported board</h2>
      <p>
        You can build one from our{" "}
        <Link href="/emwaver/docs/hardware">open-source hardware repos</Link> or use a compatible
        off-the-shelf board:
      </p>
      <ul>
        <li>
          <strong>ESP32-S3 dev board</strong> — supported directly by EMWaver, so you can get
          started without building anything from the lineup.
        </li>
        <li>
          <strong>EMWaver Shield</strong> (ESP32-S3) — a shield-style carrier for an ESP32-S3
          dev module, with IR TX/RX, radio-module support, and expanded headers.{" "}
          <a href="https://github.com/continualmi/emwaver-shield" target="_blank" rel="noreferrer">
            Build files on GitHub
          </a>
          .
        </li>
        <li>
          <strong>EMWaver lineup</strong> — optional custom EMWaver devices and modules are listed in the{" "}
          <Link href="/emwaver/docs/hardware">hardware docs</Link> and on the{" "}
          <Link href="/emwaver/build">Build page</Link>.
        </li>
      </ul>

      <h2>3. Connect</h2>
      <ul>
        <li>Plug the board into your phone (USB-C) or desktop (USB).</li>
        <li>Open the EMWaver app — the device should appear automatically.</li>
      </ul>
      <blockquote>
        The board communicates over USB MIDI SysEx. No drivers needed — it enumerates as a
        standard USB MIDI device.
      </blockquote>

      <h2>4. Run local scripts</h2>
      <p>
        Open the Scripts view in the app, pick a built-in script or create your own <code>.emw</code> file,
        and press Run. Local script execution should not require sign-in, cloud activation, or a hosted relay.
      </p>

      <h2>5. Use the localhost gateway</h2>
      <p>
        On Linux, the CLI is the primary desktop/server method. It starts the localhost browser
        gateway for rendering the full script UI and connects it to a local daemon that owns
        USB MIDI/SysEx or ESP32 BLE transport underneath:
      </p>
      <pre><code>{`emwaver start
emwaver start --ble
emwaver start --device 0`}</code></pre>
      <p>
        Then open <code>http://127.0.0.1:3921</code>. The gateway renders the script UI in the browser;
        the daemon handles script execution, UI events, and local BLE/USB transport using the shared
        EMWaver protocol. The same command-line path also works for macOS CLI workflows.
      </p>
      <p>
        Advanced users can split the stack when they want the daemon to run separately from the browser gateway:
      </p>
      <pre><code>{`emwaver gateway --daemon-fallback --ble
emwaver daemon start --ble
emwaver service install --ble`}</code></pre>
      <p>
        A running native desktop app can still connect to the same gateway and take priority as the
        runtime owner. Otherwise the daemon is the fallback runtime owner for headless Linux and CLI use.
      </p>

      <h2>6. Optional Agent key</h2>
      <p>
        The paid Agent can use an API key to help write and debug scripts, but that key should not be required
        for ordinary local hardware control. See the{" "}
        <Link href="/emwaver/docs/scripts">scripting guide</Link> for script details.
      </p>

      <h2>7. CLI reference</h2>
      <p>
        The <code>emwaver</code> binary is the single entry point for the local stack. Run{" "}
        <code>emwaver --help</code> or <code>emwaver &lt;command&gt; --help</code> to see all options.
        The sections below cover the current command surface.
      </p>

      <h3>Top-level commands</h3>
      <pre><code>{`emwaver start         # bring up the gateway + daemon stack (the common path)
emwaver gateway       # only the localhost browser gateway
emwaver web           # alias for \`gateway\`
emwaver run <script>  # run a .emw via gateway/native bridge, or --direct headless
emwaver daemon ...    # manage the headless host daemon
emwaver service ...   # install/manage the Linux user service
emwaver devices       # list MIDI ports and highlight likely EMWaver devices
emwaver doctor        # check CLI, gateway, and device prerequisites
emwaver tui           # terminal UI for daemon + device status
emwaver agent <text>  # ask the paid EMWaver Agent for script help
emwaver paths         # print state dir, pidfile, and log file locations`}</code></pre>

      <h3>Common transport flags</h3>
      <p>
        Most commands that own hardware accept the same set of transport flags. Pick at most one
        transport per invocation; defaults to USB MIDI/SysEx auto-detection.
      </p>
      <ul>
        <li><code>--device &lt;id&gt;</code> — MIDI input port id from <code>emwaver devices</code>.</li>
        <li><code>--ble</code> — use ESP32 BLE transport instead of USB MIDI/SysEx.</li>
        <li><code>--no-device</code> — start with a no-op hardware bridge for UI-only scripts.</li>
        <li><code>--sim-device</code> — use the shared mock EMWaver device simulator.</li>
        <li><code>--bootstrap-path &lt;path&gt;</code> — override the default bootstrap script.</li>
        <li><code>--port &lt;n&gt;</code> — local gateway port (defaults to <code>3921</code>).</li>
      </ul>

      <h3>emwaver start</h3>
      <p>
        Convenience command for the typical Linux/macOS workflow: spawns the daemon in the
        background (if one isn&apos;t already running) and starts the localhost gateway in the
        foreground. When <code>start</code> exits, any daemon it spawned itself is stopped again.
      </p>
      <pre><code>{`emwaver start
emwaver start --ble
emwaver start --device 0
emwaver start --sim-device       # no real hardware, mock device
emwaver start --no-device        # UI-only scripts, no hardware bridge
emwaver start --port 4000`}</code></pre>

      <h3>emwaver gateway / emwaver web</h3>
      <p>
        Starts only the localhost browser gateway. Use this when a native desktop app or an
        already-running daemon owns the runtime, or when you want to point a custom daemon at
        the gateway. <code>emwaver web</code> is an alias for <code>emwaver gateway</code>.
      </p>
      <pre><code>{`emwaver gateway
emwaver gateway --port 4000
emwaver gateway --daemon-fallback --ble`}</code></pre>
      <p>
        Without <code>--daemon-fallback</code>, transport flags (<code>--device</code>,
        <code>--ble</code>, <code>--no-device</code>, <code>--sim-device</code>,
        <code>--bootstrap-path</code>) are rejected, since the gateway alone does not own the runtime.
        With <code>--daemon-fallback</code>, the CLI brings up a daemon underneath as the fallback
        runtime owner, the same way <code>emwaver start</code> does.
      </p>

      <h3>emwaver run</h3>
      <p>
        Runs a <code>.emw</code> script. By default it submits the script to the gateway (so a
        running native app or daemon can execute it) and waits briefly for{" "}
        <code>script.started</code>, <code>script.error</code>, or <code>host.error</code>:
      </p>
      <pre><code>{`emwaver run path/to/script.emw
emwaver run script.emw --name "My script"
emwaver run script.emw --gateway-url http://127.0.0.1:4000
emwaver run script.emw --timeout-ms 10000
emwaver run script.emw --no-wait`}</code></pre>
      <p>
        Use <code>--direct</code> to bypass the gateway and execute the script in a local
        headless Rust runtime instead. Direct mode accepts the standard transport flags:
      </p>
      <pre><code>{`emwaver run script.emw --direct --sim-device
emwaver run script.emw --direct --ble
emwaver run script.emw --direct --device 0`}</code></pre>

      <h3>emwaver daemon</h3>
      <p>Manages the headless host daemon — the background process that owns hardware transport and script execution.</p>
      <ul>
        <li><code>emwaver daemon start</code> — start the daemon detached, writing its log to the state dir. Accepts the common transport flags plus <code>--port</code>, <code>--gateway-url</code>, and <code>--bootstrap-path</code>.</li>
        <li><code>emwaver daemon serve</code> — same flags as <code>start</code>, but runs in the foreground (used internally by <code>start</code> and the systemd unit).</li>
        <li><code>emwaver daemon stop</code> — best-effort SIGTERM to the running daemon.</li>
        <li><code>emwaver daemon status</code> — print whether the daemon is running and report autostart configuration.</li>
        <li><code>emwaver daemon autostart</code> — print autostart status only (macOS launchd / Linux systemd).</li>
      </ul>
      <pre><code>{`emwaver daemon start --ble
emwaver daemon start --sim-device --port 4000
emwaver daemon serve --gateway-url ws://127.0.0.1:3921/host
emwaver daemon status
emwaver daemon stop`}</code></pre>

      <h3>emwaver service (Linux)</h3>
      <p>
        Installs and manages a per-user systemd unit so the daemon comes up automatically with
        your login session. The unit is written to{" "}
        <code>~/.config/systemd/user/emwaver-daemon.service</code>.
      </p>
      <ul>
        <li><code>emwaver service install</code> — write the unit using the supplied transport flags. Pass <code>--now</code> to also enable and start it.</li>
        <li><code>emwaver service print-unit</code> — print the unit file to stdout without installing it (useful for review or copying into a system-level location).</li>
        <li><code>emwaver service start</code> / <code>stop</code> — <code>systemctl --user start|stop emwaver-daemon.service</code>.</li>
        <li><code>emwaver service status</code> — show the systemd unit status.</li>
        <li><code>emwaver service uninstall</code> — disable, stop, and remove the unit.</li>
      </ul>
      <pre><code>{`emwaver service install --ble --now
emwaver service install --sim-device --port 4000 --now
emwaver service print-unit --device 0
emwaver service status
emwaver service uninstall`}</code></pre>

      <h3>emwaver devices, doctor, tui, paths</h3>
      <ul>
        <li>
          <code>emwaver devices</code> — list MIDI input ports and highlight likely EMWaver
          devices. The id printed here is what <code>--device</code> expects.
        </li>
        <li>
          <code>emwaver doctor</code> — check that the gateway package, <code>node</code>,{" "}
          <code>npm</code>, <code>cargo</code>, and <code>rustc</code> are available and that
          MIDI enumeration works. Set <code>EMWAVER_DOCTOR_ALLOW_MIDI_UNAVAILABLE=1</code> to
          skip the device check on hosts without MIDI (CI, containers).
        </li>
        <li>
          <code>emwaver tui</code> — small terminal UI showing daemon and device status without
          opening the browser gateway.
        </li>
        <li>
          <code>emwaver paths</code> — print the state dir, pidfile, and daemon log path so you
          can tail logs or clean up state. Override the state dir with the{" "}
          <code>EMWAVER_STATE_DIR</code> environment variable.
        </li>
      </ul>

      <h3>emwaver agent</h3>
      <p>
        Sends a prompt to the paid EMWaver Agent for script help. Requires{" "}
        <code>EMWAVER_AGENT_API_KEY</code> and either <code>EMWAVER_AGENT_ENDPOINT</code> or{" "}
        <code>CONTINUAL_AGENT_ENDPOINT</code> in the environment; <code>--endpoint</code>{" "}
        overrides the endpoint for one call.
      </p>
      <pre><code>{`emwaver agent "write a script that toggles GPIO 5 every second"
emwaver agent --mode debug --error "ENOENT: rfid.emw" "why does this fail?"
emwaver agent --mode patch --script script.emw "add a stop button"
emwaver agent --endpoint https://agent.example.com "explain this script" --script script.emw`}</code></pre>
      <p>
        Modes are <code>write</code> (default), <code>debug</code>, <code>explain</code>, and{" "}
        <code>patch</code>. The Agent key is never required for ordinary local hardware control.
      </p>
    </>
  );
}
