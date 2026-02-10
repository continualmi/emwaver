import Link from "next/link";

export default function DaemonDocPage() {
  return (
    <>
      <h1>EMWaver Daemon</h1>
      <p>
        EMWaver Daemon is a headless service that runs the EMWaver runtime on a machine without the
        full EMWaver app UI.
      </p>

      <h2>What it’s for</h2>
      <ul>
        <li>
          Automation: run scripts on a machine that boots and stays online (workstations, servers,
          Raspberry Pi).
        </li>
        <li>
          Headless setups: the daemon owns the device connection and runs scripts without rendering a
          local UI.
        </li>
        <li>
          Remote control (Pro): run scripts headlessly but control the UI remotely from another
          EMWaver client.
        </li>
      </ul>

      <h2>How it behaves</h2>
      <ul>
        <li>
          No local UI: the daemon doesn’t present windows or render UI on the host.
        </li>
        <li>
          Scripts still work: scripts can run fully headless, or generate UI that a remote controller
          can render.
        </li>
        <li>
          Startup service: you can configure it to start automatically when the machine starts.
        </li>
      </ul>

      <h2>Typical flows</h2>
      <ol>
        <li>
          Install EMWaver Daemon on the host machine.
        </li>
        <li>
          Plug the EMWaver device into that host.
        </li>
        <li>
          (Optional) Sign in to enable Pro features like remote control.
        </li>
        <li>
          Run scripts headlessly, or attach remotely from another EMWaver client.
        </li>
      </ol>

      <h2>Notes</h2>
      <ul>
        <li>
          Firmware updates are done from the full EMWaver app (not the daemon).
        </li>
      </ul>

      <p>
        Back to <Link href="/docs">Documentation</Link>.
      </p>
    </>
  );
}
