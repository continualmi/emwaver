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
  const children = Array.isArray(props?.children) ? props.children : undefined;
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
    spacer(props: any) {
      return node("spacer", props);
    },
    divider(props: any) {
      return node("divider", props);
    },
    // More types later: toggle, slider, textInput, list, etc.
  };
}

// UI-only evaluation of an .emw script.
// - Runs in the browser.
// - Stubs hardware APIs so scripts can be evaluated without a device.
// - Captures the last UI.render(root) call.
export function evalEmwUi(scriptSource: string): EmwUiRenderResult {
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
    // no-op in UI preview
  };

  const pinMode = () => {};
  const digitalWrite = () => {};
  const digitalRead = () => 0;

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
      "pinMode",
      "digitalWrite",
      "digitalRead",
      "LOW",
      "HIGH",
      "INPUT",
      "OUTPUT",
      // Allow scripts to refer to pin names without crashing (they'll be undefined otherwise).
      // Users can still preview UI even if the rest errors.
      scriptSource
    );

    fn(UI, Signals, every, pinMode, digitalWrite, digitalRead, LOW, HIGH, INPUT, OUTPUT);

    return { root };
  } catch (e: any) {
    return { root, error: String(e?.message || e) };
  }
}
