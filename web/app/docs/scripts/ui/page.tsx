export default function UiWidgetsDocPage() {
  return (
    <>
      <h1>UI widgets</h1>
      <p>
        Current EMWaver UI scripts import components from <code>emw-ui</code>, import
        <code> JSX</code> and <code>render</code> from <code>emw-jsx</code>, then render JSX.
        The JSX is converted to the same serializable UI tree used by the native renderers.
      </p>
      <h2>Imports and render</h2>
      <pre>
        <code className="language-javascript">{`import { JSX, render } from "emw-jsx";
import {
  Button,
  Card,
  Column,
  Divider,
  Grid,
  LogViewer,
  Modal,
  Picker,
  Plot,
  Progress,
  Row,
  Scroll,
  Slider,
  Spacer,
  Text,
  TextEditor,
  TextField,
  Tile,
  Toggle,
} from "emw-ui";

function App() {
  return <Text>Hello from EMWaver</Text>;
}

render(<App />);`}</code>
      </pre>

      <h2>Layout</h2>
      <pre>
        <code className="language-javascript">{`<Column padding={16} spacing={12}>
  <Text>Stacked vertically</Text>
  <Row spacing={8}>
    <Button>Left</Button>
    <Button>Right</Button>
  </Row>
  <Grid columns={3} spacing={8}>
    <Tile title="A" value="1" />
    <Tile title="B" value="2" />
    <Tile title="C" value="3" />
  </Grid>
  <Divider />
  <Spacer minLength={20} />
</Column>

<Scroll padding={16} spacing={14}>
  <Text>Scrollable page content</Text>
</Scroll>`}</code>
      </pre>

      <h2>Card</h2>
      <pre>
        <code className="language-javascript">{`<Card title="GPIO Control" subtitle="Pin A0">
  <Button onTap={toggle}>Toggle</Button>
</Card>`}</code>
      </pre>

      <h2>Text</h2>
      <pre>
        <code className="language-javascript">{`<Text>Hello</Text>
<Text font="title2" fontWeight="semibold">Sampler</Text>
<Text font="caption" foregroundColor="#6B7280">
  Last reading: {String(reading)}
</Text>`}</code>
      </pre>

      <h2>Button</h2>
      <pre>
        <code className="language-javascript">{`<Button id="capture.start" onTap={startCapture}>Start capture</Button>
<Button buttonStyle="borderedProminent" controlSize="large" onTap={save}>
  Save
</Button>`}</code>
      </pre>

      <h2>Tile</h2>
      <pre>
        <code className="language-javascript">{`<Tile
  title="Temperature"
  value={temperatureText}
  monospaceValue={true}
  subtitle="Last reading"
  onTap={refresh}
/>`}</code>
      </pre>

      <h2>Slider</h2>
      <pre>
        <code className="language-javascript">{`<Slider
  id="pwm.duty"
  value={duty}
  min={0}
  max={4095}
  step={1}
  label="Duty cycle"
  onChange={(value) => { duty = Number(value); rerender(); }}
  onSubmit={(value) => { writeDuty(Number(value)); }}
/>`}</code>
      </pre>

      <h2>TextField</h2>
      <pre>
        <code className="language-javascript">{`<TextField
  value={command}
  placeholder="Enter command..."
  onChange={(value) => { command = String(value || ""); }}
  onSubmit={(value) => { sendCommand(String(value || "")); }}
/>

<TextField value={apiKey} secure={true} placeholder="API key" />`}</code>
      </pre>

      <h2>TextEditor</h2>
      <pre>
        <code className="language-javascript">{`<TextEditor
  value={hexData}
  placeholder="Data bytes..."
  minHeight={120}
  onChange={(value) => { hexData = String(value || ""); rerender(); }}
/>`}</code>
      </pre>

      <h2>Picker</h2>
      <pre>
        <code className="language-javascript">{`<Picker
  id="gpio.pin"
  selected={selectedPin}
  options={[
    { label: "A0", value: "0" },
    { label: "A1", value: "1" },
    { label: "GPIO4", value: "4" },
  ]}
  style="menu"
  onChange={(value) => { selectedPin = String(value); rerender(); }}
/>

<Picker
  style="segmented"
  selected={mode}
  options={[{ label: "RX", value: "rx" }, { label: "TX", value: "tx" }]}
/>`}</code>
      </pre>

      <h2>Toggle</h2>
      <pre>
        <code className="language-javascript">{`<Toggle
  label="Enable output"
  value={enabled}
  onChange={(value) => { enabled = Boolean(value); rerender(); }}
/>`}</code>
      </pre>

      <h2>Plot</h2>
      <p>
        <code>Plot</code> can render inline data or a named/buffer-backed source. The sampler UI uses
        <code> source=&quot;samplerBits&quot;</code> with viewport callbacks for pan/zoom.
      </p>
      <pre>
        <code className="language-javascript">{`<Plot
  height={240}
  dataX={[0, 1, 2, 3, 4]}
  dataY={[0, 1, 0, 1, 0]}
/>

<Plot
  height={240}
  source="samplerBits"
  bins={400}
  xMin={xMin}
  xMax={xMax}
  yMin={-10}
  yMax={265}
  errorText={chartErr}
  onViewportChange={(rangeValue) => {
    const range = parseViewportRange(rangeValue);
    if (range) scheduleViewport(range.min, range.max);
  }}
/>

const bufId = buffer(capturedBytes);
<Plot height={240} source={{ kind: "buffer", id: bufId }} />`}</code>
      </pre>

      <h2>LogViewer</h2>
      <pre>
        <code className="language-javascript">{`<LogViewer text={logLines.join("\n")} minHeight={220} />`}</code>
      </pre>

      <h2>Progress</h2>
      <pre>
        <code className="language-javascript">{`<Progress value={42} total={100} label="Flashing..." />
<Progress label="Scanning..." />`}</code>
      </pre>

      <h2>Modal</h2>
      <pre>
        <code className="language-javascript">{`<Modal
  open={showModal}
  title="Confirm"
  subtitle="Are you sure?"
  onClose={() => { showModal = false; rerender(); }}
>
  <Button onTap={confirm}>OK</Button>
</Modal>`}</code>
      </pre>

      <h2>Dynamic children and nulls</h2>
      <p>
        Components ignore <code>null</code>, <code>undefined</code>, and <code>false</code> children, so conditional UI
        can be written naturally.
      </p>
      <pre>
        <code className="language-javascript">{`<Column spacing={10}>
  <Text font="title2">Radio</Text>
  {statusText ? <Text font="caption">{statusText}</Text> : null}
  {items.map((item) => <Tile title={item.name} value={item.value} />)}
</Column>`}</code>
      </pre>

      <h2>Common style props</h2>
      <div className="overflow-hidden rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)]">
        <table className="m-0 w-full text-sm">
          <thead>
            <tr>
              <th className="px-4 py-3 text-left">Prop</th>
              <th className="px-4 py-3 text-left">Type</th>
              <th className="px-4 py-3 text-left">Notes</th>
            </tr>
          </thead>
          <tbody>
            <tr><td className="px-4 py-3"><code>padding</code></td><td className="px-4 py-3">number or edge object</td><td className="px-4 py-3">Use <code>16</code> or <code>&#123; top, bottom, leading, trailing &#125;</code>.</td></tr>
            <tr><td className="px-4 py-3"><code>spacing</code></td><td className="px-4 py-3">number</td><td className="px-4 py-3">Gap between children for layout nodes.</td></tr>
            <tr><td className="px-4 py-3"><code>width</code>, <code>height</code></td><td className="px-4 py-3">number</td><td className="px-4 py-3">Fixed size.</td></tr>
            <tr><td className="px-4 py-3"><code>minWidth</code>, <code>maxWidth</code>, <code>minHeight</code>, <code>maxHeight</code></td><td className="px-4 py-3">number</td><td className="px-4 py-3">Size constraints.</td></tr>
            <tr><td className="px-4 py-3"><code>cornerRadius</code></td><td className="px-4 py-3">number</td><td className="px-4 py-3">Rounded corners.</td></tr>
            <tr><td className="px-4 py-3"><code>backgroundColor</code>, <code>foregroundColor</code></td><td className="px-4 py-3">string</td><td className="px-4 py-3">Native/platform color string.</td></tr>
            <tr><td className="px-4 py-3"><code>fillsWidth</code></td><td className="px-4 py-3">boolean</td><td className="px-4 py-3">Stretch to available width.</td></tr>
            <tr><td className="px-4 py-3"><code>alignment</code></td><td className="px-4 py-3">string</td><td className="px-4 py-3">Common values: <code>leading</code>, <code>center</code>, <code>trailing</code>.</td></tr>
          </tbody>
        </table>
      </div>

      <h2>Event handlers</h2>
      <div className="overflow-hidden rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)]">
        <table className="m-0 w-full text-sm">
          <thead>
            <tr>
              <th className="px-4 py-3 text-left">Prop</th>
              <th className="px-4 py-3 text-left">Used by</th>
              <th className="px-4 py-3 text-left">Payload</th>
            </tr>
          </thead>
          <tbody>
            <tr><td className="px-4 py-3"><code>onTap</code></td><td className="px-4 py-3">Button, Tile</td><td className="px-4 py-3">No payload.</td></tr>
            <tr><td className="px-4 py-3"><code>onChange</code></td><td className="px-4 py-3">Picker, Slider, Toggle, TextField, TextEditor</td><td className="px-4 py-3">New value.</td></tr>
            <tr><td className="px-4 py-3"><code>onSubmit</code></td><td className="px-4 py-3">TextField, Slider</td><td className="px-4 py-3">Committed value.</td></tr>
            <tr><td className="px-4 py-3"><code>onViewportChange</code></td><td className="px-4 py-3">Plot</td><td className="px-4 py-3">Viewport range with <code>min</code> and <code>max</code>.</td></tr>
            <tr><td className="px-4 py-3"><code>onSelectRange</code></td><td className="px-4 py-3">Plot</td><td className="px-4 py-3">Selected range.</td></tr>
            <tr><td className="px-4 py-3"><code>onClose</code></td><td className="px-4 py-3">Modal</td><td className="px-4 py-3">No payload.</td></tr>
          </tbody>
        </table>
      </div>
    </>
  );
}
