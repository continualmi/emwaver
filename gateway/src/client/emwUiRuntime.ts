export type EmwUiNode = {
  type: string;
  props?: Record<string, any>;
  children?: EmwUiNode[];
};

export type EmwUiRenderResult = {
  root: EmwUiNode | null;
  error?: string;
};

function node(type: string, props?: Record<string, any>): EmwUiNode {
  const rawChildren = Array.isArray(props?.children) ? props.children : undefined;
  const children = rawChildren
    ? rawChildren.filter((c) => c !== null && c !== undefined && c !== false)
    : undefined;

  const rest = { ...(props || {}) };
  if (rest.children !== undefined) delete rest.children;
  return { type, props: rest, children };
}

function createUiApi(setRoot: (n: EmwUiNode) => void) {
  return {
    render(n: EmwUiNode) {
      setRoot(n);
    },
    column(props: any) {
      return node("column", props);
    },
    row(props: any) {
      return node("row", props);
    },
    text(props: any) {
      return node("text", props);
    },
    button(props: any) {
      return node("button", props);
    },
    picker(props: any) {
      return node("picker", props);
    },
    slider(props: any) {
      return node("slider", props);
    },
    textField(props: any) {
      return node("textField", props);
    },
    textEditor(props: any) {
      return node("textEditor", props);
    },
    scroll(props: any) {
      return node("scroll", props);
    },
    tile(props: any) {
      return node("tile", props);
    },
    card(props: any) {
      return node("card", props);
    },
    grid(props: any) {
      return node("grid", props);
    },
    divider(props: any) {
      return node("divider", props);
    },
    logViewer(props: any) {
      return node("logViewer", props);
    },
    buffer(props: any) {
      return node("buffer", props);
    },
    plot(props: any) {
      return node("plot", props);
    },
    progress(props: any) {
      return node("progress", props);
    },
    spacer(props: any) {
      return node("spacer", props);
    },
    // More types later: toggle, textInput, list, etc.
  };
}

// UI-only evaluation of an .emw script.
// - Runs in the browser.
// - Stubs hardware APIs so scripts can be evaluated without a device.
// - Captures the last UI.render(root) call.
function ensureBootstrapGlobals() {
  const g: any = globalThis as any;

  const pins = [
    "A0",
    "A1",
    "A2",
    "A3",
    "A4",
    "A5",
    "A6",
    "A7",
    "B6",
    "B7",
    "IR_RX",
    "IR_TX",
    "GDO0",
    "GDO2",
    "NSS",
    "SCK",
    "MISO",
    "MOSI",
    "UART_TX",
    "UART_RX",
    "I2C_SCL",
    "I2C_SDA",
    "CC1101_CS",
  ];

  for (const k of pins) {
    if (g[k] === undefined) g[k] = k;
  }

  // Common constants.
  if (g.LOW === undefined) g.LOW = 0;
  if (g.HIGH === undefined) g.HIGH = 1;
  if (g.INPUT === undefined) g.INPUT = 0;
  if (g.OUTPUT === undefined) g.OUTPUT = 1;
}

function normalizeScriptSource(scriptSource: string): string {
  // Some JS runtimes (notably older Safari) don't support numeric separators (e.g. 26_000_000).
  // Our default scripts use them, so strip them for browser preview.
  return String(scriptSource).replace(/(\d)_(?=\d)/g, "$1");
}

export function evalEmwUi(scriptSource: string): EmwUiRenderResult {
  ensureBootstrapGlobals();
  scriptSource = normalizeScriptSource(scriptSource);

  let root: EmwUiNode | null = null;

  const UI = createUiApi((n) => {
    root = n;
  });

  const Signals = {
    state(initial: any) {
      let v = initial;
      return {
        get() {
          return v;
        },
        set(next: any) {
          v = next;
        },
      };
    },
  };

  // Intentionally no-op timing/hardware helpers for now.
  const every = (_ms: number, _fn: Function) => {
    return { stop() {} };
  };

  const delay = (_ms: number) => {};
  const sleep = (_ms: number) => {};

  // Hardware stubs (no-op / dummy values).
  const pinMode = () => {};
  const digitalWrite = () => {};
  const digitalRead = () => 0;
  const analogRead = () => 0;
  const analogReadTemp = () => 0;
  const analogReadVrefint = () => 0;
  const analogReadVbat = () => 0;

  const i2cOpen = () => {};
  const i2cClose = () => {};
  const i2cWrite = () => {};
  const i2cRead = () => new Uint8Array();

  const uartOpen = () => {};
  const uartClose = () => {};
  const uartWrite = () => {};
  const uartRead = () => new Uint8Array();

  const spiXfer = () => new Uint8Array();

  const samplerStart = () => {};
  const samplerStop = () => {};

  const pwmSetFrequency = () => {};
  const pwmWrite = () => {};
  const pwmStop = () => {};

  const transmitStart = () => {};
  const transmitStop = () => {};

  // Common constants used in scripts.
  const LOW = 0;
  const HIGH = 1;
  const INPUT = 0;
  const OUTPUT = 1;

  try {
    // eslint-disable-next-line no-new-func
    const fn = new Function(
      "UI",
      "Signals",
      "every",
      "delay",
      "sleep",
      "pinMode",
      "digitalWrite",
      "digitalRead",
      "analogRead",
      "analogReadTemp",
      "analogReadVrefint",
      "analogReadVbat",
      "i2cOpen",
      "i2cClose",
      "i2cWrite",
      "i2cRead",
      "uartOpen",
      "uartClose",
      "uartWrite",
      "uartRead",
      "spiXfer",
      "samplerStart",
      "samplerStop",
      "pwmSetFrequency",
      "pwmWrite",
      "pwmStop",
      "transmitStart",
      "transmitStop",
      "LOW",
      "HIGH",
      "INPUT",
      "OUTPUT",
      scriptSource
    );

    fn(
      UI,
      Signals,
      every,
      delay,
      sleep,
      pinMode,
      digitalWrite,
      digitalRead,
      analogRead,
      analogReadTemp,
      analogReadVrefint,
      analogReadVbat,
      i2cOpen,
      i2cClose,
      i2cWrite,
      i2cRead,
      uartOpen,
      uartClose,
      uartWrite,
      uartRead,
      spiXfer,
      samplerStart,
      samplerStop,
      pwmSetFrequency,
      pwmWrite,
      pwmStop,
      transmitStart,
      transmitStop,
      LOW,
      HIGH,
      INPUT,
      OUTPUT
    );

    return { root };
  } catch (e: any) {
    return { root, error: String(e?.message || e) };
  }
}
