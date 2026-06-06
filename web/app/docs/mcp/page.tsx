import Link from "next/link";

const TOOLS = [
  ["list_scripts", "List local scripts the desktop app can run."],
  ["read_script", "Read a script source file."],
  ["write_script", "Create or update a local script file."],
  ["run_script", "Run JavaScript through the app runtime."],
  ["stop_script", "Stop an MCP-started script run."],
  ["device_state", "Inspect the selected board and transport state."],
  ["spi_transfer", "Send an SPI transfer through the connected board."],
  ["gpio_read", "Read a GPIO pin."],
  ["gpio_write", "Write a GPIO pin."],
  ["analog_read", "Read an analog input."],
];

export default function McpDocsPage() {
  return (
    <>
      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[color:var(--sky)]">
        Desktop MCP
      </div>
      <h1>Connect an MCP client to EMWaver.</h1>
      <p>
        macOS, Windows, and Linux desktop apps can expose a local MCP server while
        the app is running. This lets an MCP-capable client inspect the connected
        board, manage local scripts, run JavaScript, and call hardware primitives
        through the same app-owned runtime used by the UI.
      </p>

      <h2>How to enable it</h2>
      <ol>
        <li>Open the EMWaver desktop app.</li>
        <li>Click the <strong>MCP</strong> button in the app toolbar.</li>
        <li>Enable the local MCP server.</li>
        <li>Copy the endpoint and bearer token from the modal.</li>
        <li>Add those values to an MCP client that supports local Streamable HTTP servers.</li>
      </ol>

      <blockquote>
        The server is local to your machine. It binds to loopback at <code>127.0.0.1</code>,
        requires the bearer token shown by the app, and stops when the desktop app exits.
      </blockquote>

      <h2>Endpoint</h2>
      <p>
        The default endpoint is:
      </p>
      <pre><code>http://127.0.0.1:3923/mcp</code></pre>
      <p>
        Send the token as an authorization header:
      </p>
      <pre><code>Authorization: Bearer YOUR_EMWAVER_MCP_TOKEN</code></pre>

      <h2>Available tools</h2>
      <div className="mt-4 overflow-hidden rounded-2xl border border-[color:var(--line)]">
        <table className="w-full border-collapse text-left text-sm">
          <thead className="bg-[color:var(--surface-2)] text-[color:var(--ink)]">
            <tr>
              <th className="px-4 py-3 font-semibold">Tool</th>
              <th className="px-4 py-3 font-semibold">Use</th>
            </tr>
          </thead>
          <tbody>
            {TOOLS.map(([tool, use], i) => (
              <tr key={tool} className={i > 0 ? "border-t border-[color:var(--line)]" : ""}>
                <td className="px-4 py-3 font-mono text-[color:var(--sky)]">{tool}</td>
                <td className="px-4 py-3 text-[color:var(--ink-dim)]">{use}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Platform behavior</h2>
      <ul>
        <li><strong>macOS, Windows, Linux:</strong> host the MCP server inside the running desktop app.</li>
        <li><strong>iOS and Android:</strong> run local scripts but do not host an MCP endpoint.</li>
        <li><strong>Local core:</strong> scripts and hardware access still work without MCP enabled.</li>
      </ul>

      <h2>Related docs</h2>
      <ul>
        <li><Link href="/docs/scripts">EMWaver scripting model</Link></li>
        <li><Link href="/docs/install">Install and run locally</Link></li>
        <li>
          <a href="https://modelcontextprotocol.io/docs/getting-started/intro" target="_blank" rel="noreferrer">
            Official MCP documentation
          </a>
        </li>
      </ul>
    </>
  );
}
