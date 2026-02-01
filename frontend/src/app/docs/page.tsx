import Link from "next/link";

export default function DocsIndex() {
  return (
    <>
      <h1>Documentation</h1>
      <p>Everything you need to install, connect, and run scripts.</p>

      <h2>Start here</h2>
      <ol>
        <li>
          <Link href="/docs/install">Install & connect</Link>: get the apps and connect over USB.
        </li>
        <li>
          <Link href="/docs/scripts">Run scripts</Link>: start from default scripts or write your own.
        </li>
      </ol>

      <h2>Hardware</h2>
      <ul>
        <li>
          <Link href="/docs/hardware/device">Current board</Link>: what ships today and what it is
          optimized for.
        </li>
        <li>
          <Link href="/docs/hardware/pinout">Pinout</Link>: headers, GPIO numbering, and key pins.
        </li>
      </ul>
    </>
  );
}
