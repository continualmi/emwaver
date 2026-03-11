import Link from "next/link";

export default function DeviceRecoveryDocPage() {
  return (
    <>
      <h1>Recover device identity</h1>
      <p>
        If your EMWaver device ever shows as <b>Not secure</b> (or identity missing) after an update,
        you can recover its identity directly from the app.
      </p>

      <h2>Before you start</h2>
      <ul>
        <li>You must be signed in.</li>
        <li>Keep the device plugged in (unless the app tells you to replug it).</li>
      </ul>

      <h2>Steps (macOS / desktop)</h2>
      <ol>
        <li>Open <b>Device</b>.</li>
        <li>Click <b>Update firmware…</b>.</li>
        <li>
          If prompted, click <b>Enter Update Mode</b>.
        </li>
        <li>
          <b>Unplug and plug the device back in</b> (this step is required after entering Update
          Mode).
        </li>
        <li>
          When <b>Update Mode</b> is detected, click <b>Recover identity</b>.
        </li>
        <li>
          When recovery completes, reconnect the device and try the firmware update again.
        </li>
      </ol>

      <h2>If it still doesn’t work</h2>
      <ul>
        <li>Try a different USB cable/port.</li>
        <li>Close and reopen EMWaver, then retry the steps above.</li>
        <li>
          If you’re still stuck, contact support and include a screenshot of the update screen.
        </li>
      </ul>

      <p>
        Back to <Link href="/docs">Documentation</Link>.
      </p>
    </>
  );
}
