(function () {
  const vscode = acquireVsCodeApi();

  const previewEl = document.getElementById("preview");

  /** @type {string[]} */
  let consoleLines = [];

  const clearConsole = () => {
    consoleLines = [];
    updateInlineLogViewers();
  };

  const appendConsole = (line) => {
    consoleLines.push(String(line));
    vscode.postMessage({ type: "log", line: String(line) });
    updateInlineLogViewers();
  };

  const updateInlineLogViewers = () => {
    const lines = consoleLines.length ? consoleLines.join("\n") : "No output yet.";
    const viewers = document.querySelectorAll("[data-wavelet-log='1']");
    viewers.forEach((viewer) => {
      const content = viewer.querySelector("[data-wavelet-log-content='1']");
      if (content) content.textContent = lines;
    });
  };

  const applyPadding = (el, value) => {
    if (!value) return;
    if (typeof value === "number") {
      el.style.padding = `${value}px`;
      return;
    }
    if (typeof value !== "object") return;
    const top = Number(value.top ?? 0) || 0;
    const bottom = Number(value.bottom ?? 0) || 0;
    const left = Number(value.left ?? value.leading ?? 0) || 0;
    const right = Number(value.right ?? value.trailing ?? 0) || 0;
    el.style.paddingTop = `${top}px`;
    el.style.paddingBottom = `${bottom}px`;
    el.style.paddingLeft = `${left}px`;
    el.style.paddingRight = `${right}px`;
  };

  class WaveletEngine {
    constructor() {
      this.context = null;
      this.callbackRegistry = new Map();
      this.globalBindings = {};
      this.moduleSources = new Map();
      this.moduleCache = new Map();
      this.moduleLoadingStack = new Set();
      this.bootstrapSource = "";
      this.printCallback = undefined;
      this.renderCallback = undefined;
      this.dialogCallback = undefined;
      this.initialized = false;
    }

    /**
     * @param {(message: string) => void} printCallback
     * @param {(tree: any) => void} renderCallback
     * @param {(title: string, message: string) => void} dialogCallback
     * @param {Record<string, any>} bindings
     */
    setup(printCallback, renderCallback, dialogCallback, bindings) {
      this.printCallback = printCallback;
      this.renderCallback = renderCallback;
      this.dialogCallback = dialogCallback;
      this.globalBindings = Object.assign({}, bindings || {});
      const sandbox = {};
      this.context = sandbox;
      this.installBridge();
      this.applyGlobalBindings();
      this.initialized = true;
    }

    setBootstrapSource(source) {
      this.bootstrapSource = String(source ?? "");
    }

    updateModuleSources(sources) {
      this.moduleSources.clear();
      for (const [name, content] of Object.entries(sources || {})) {
        const normalized = this.normalizeModuleName(name);
        if (normalized) this.moduleSources.set(normalized, { name, content });
      }
      this.moduleCache.clear();
      this.moduleLoadingStack.clear();
    }

    execute(script) {
      if (!this.initialized || !this.context) {
        this.printCallback && this.printCallback("WaveletEngine not initialized");
        return;
      }

      this.callbackRegistry.clear();
      this.moduleLoadingStack.clear();
      this.applyGlobalBindings();

      try {
        const ctx = this.context;
        const fullScript = `${this.bootstrapSource}\n${script || ""}`;
        const func = new Function(
          "_waveletPrint",
          "_waveletRender",
          "_waveletRegisterCallback",
          "_waveletImportModule",
          "_waveletShowDialog",
          "_waveletCreateByteArray",
          "BLEService",
          "DeviceConnection",
          "Utils",
          "SamplerSignals",
          fullScript
        );

        func.call(
          ctx,
          ctx._waveletPrint,
          ctx._waveletRender,
          ctx._waveletRegisterCallback,
          ctx._waveletImportModule,
          ctx._waveletShowDialog,
          ctx._waveletCreateByteArray,
          ctx.BLEService,
          ctx.DeviceConnection,
          ctx.Utils,
          ctx.SamplerSignals
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.printCallback && this.printCallback(`Wavelet error: ${message}`);
      }
    }

    invoke(token, args) {
      const callback = this.callbackRegistry.get(token);
      if (!callback) {
        this.printCallback && this.printCallback(`No callback registered for token ${token}`);
        return;
      }
      try {
        const result = callback(...(args || []));
        if (result && typeof result.then === "function") {
          result.catch((error) => {
            const message = error instanceof Error ? error.message : String(error);
            this.printCallback && this.printCallback(`Wavelet callback error: ${message}`);
          });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.printCallback && this.printCallback(`Wavelet callback error: ${message}`);
      }
    }

    installBridge() {
      if (!this.context) return;

      this.context._waveletPrint = (message) => {
        this.printCallback && this.printCallback(String(message));
      };

      this.context._waveletRender = (nodeValue) => {
        try {
          this.renderCallback && this.renderCallback(this.convertToWaveletTree(nodeValue));
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          this.printCallback && this.printCallback(`Render error: ${message}`);
        }
      };

      this.context._waveletRegisterCallback = (token, callback) => {
        if (token && typeof callback === "function") this.callbackRegistry.set(token, callback);
      };

      this.context._waveletImportModule = (moduleName) => this.importModule(moduleName);

      this.context._waveletShowDialog = (title, message) => {
        if (this.dialogCallback) this.dialogCallback(String(title), String(message));
      };

      this.context._waveletCreateByteArray = (jsArray) => {
        const ctx = this.context;
        if (ctx && typeof ctx.createByteArray === "function") return ctx.createByteArray(jsArray);
        if (Array.isArray(jsArray)) return new Uint8Array(jsArray.map((value) => Number(value) & 0xff));
        return new Uint8Array([]);
      };
    }

    applyGlobalBindings() {
      if (!this.context) return;
      for (const [name, value] of Object.entries(this.globalBindings || {})) {
        try {
          this.context[name] = value;
        } catch {
          // ignore
        }
      }
    }

    importModule(moduleName) {
      const normalized = this.normalizeModuleName(moduleName);
      if (!normalized) throw new Error(`Invalid module name: ${moduleName}`);
      if (this.moduleCache.has(normalized)) return this.moduleCache.get(normalized);
      if (this.moduleLoadingStack.has(normalized)) throw new Error(`Circular dependency detected: ${normalized}`);

      const source = this.moduleSources.get(normalized);
      if (!source) throw new Error(`Module not found: ${moduleName}`);
      this.moduleLoadingStack.add(normalized);

      try {
        if (!this.context) throw new Error("Context not available");
        const wrappedModule = `return (function() {
          const module = { exports: {} };
          ${source.content}
          return module.exports;
        })();`;
        const func = new Function(wrappedModule);
        const exportsValue = func.call(this.context);
        this.moduleCache.set(normalized, exportsValue);
        this.moduleLoadingStack.delete(normalized);
        return exportsValue;
      } catch (error) {
        this.moduleLoadingStack.delete(normalized);
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to load module ${moduleName}: ${message}`);
      }
    }

    normalizeModuleName(name) {
      return String(name || "")
        .replaceAll("\\", "/")
        .replace(/\.(js|emw)$/i, "")
        .replace(/^\.\//, "")
        .trim()
        .toLowerCase();
    }

    convertToWaveletTree(value) {
      if (value === null || value === undefined) throw new Error("Cannot convert null/undefined to WaveletTree");
      if (typeof value === "object") {
        const obj = value;
        if (typeof obj.type === "string") {
          const children = Array.isArray(obj.children) ? obj.children : [];
          const props = typeof obj.props === "object" && obj.props !== null ? Object.assign({}, obj.props) : {};
          const handlers = typeof obj.handlers === "object" && obj.handlers !== null ? obj.handlers : undefined;
          const rest = Object.assign({}, obj);
          delete rest.type;
          delete rest.children;
          delete rest.props;
          delete rest.handlers;

          const tree = {
            type: obj.type,
            props: Object.assign({}, props, rest),
          };
          if (handlers && Object.keys(handlers).length > 0) tree.handlers = handlers;
          if (children.length > 0) tree.children = children.map((c) => this.convertToWaveletTree(c));
          return tree;
        }
      }
      throw new Error(`Invalid WaveletTree structure`);
    }
  }

  /** @type {WaveletEngine | null} */
  let engine = null;

  const renderTree = (node) => {
    if (!node || typeof node !== "object") {
      const el = document.createElement("div");
      el.className = "text";
      el.textContent = "Wavelet returned no UI.";
      return el;
    }

    const type = node.type;
    const props = node.props || {};
    const children = Array.isArray(node.children) ? node.children : [];
    const handlers = node.handlers || {};
    const nodeId = props.id || "node";

    switch (type) {
      case "column": {
        const el = document.createElement("div");
        el.className = "col";
        el.style.gap = `${Number(props.spacing ?? 12) || 12}px`;
        applyPadding(el, props.padding);
        children.forEach((child) => el.appendChild(renderTree(child)));
        return el;
      }
      case "row": {
        const el = document.createElement("div");
        el.className = "row";
        el.style.gap = `${Number(props.spacing ?? 8) || 8}px`;
        applyPadding(el, props.padding);
        children.forEach((child) => el.appendChild(renderTree(child)));
        return el;
      }
      case "text": {
        const el = document.createElement("div");
        el.className = "text";
        el.textContent = String(props.text ?? "");
        if (props.foregroundColor) el.style.color = String(props.foregroundColor);
        if (props.backgroundColor) el.style.backgroundColor = String(props.backgroundColor);
        if (typeof props.cornerRadius === "number") el.style.borderRadius = `${props.cornerRadius}px`;
        applyPadding(el, props.padding);
        return el;
      }
      case "button": {
        const el = document.createElement("button");
        el.className = "btn";
        el.textContent = String(props.label ?? "Button");
        if (props.backgroundColor) el.style.backgroundColor = String(props.backgroundColor);
        if (props.foregroundColor) el.style.color = String(props.foregroundColor);
        if (typeof props.cornerRadius === "number") el.style.borderRadius = `${props.cornerRadius}px`;
        if (props.width) el.style.width = String(props.width);
        applyPadding(el, props.padding);
        el.addEventListener("click", () => {
          if (handlers.tap && engine) engine.invoke(handlers.tap, []);
        });
        return el;
      }
      case "slider": {
        const wrap = document.createElement("div");
        wrap.className = "col";
        wrap.style.gap = "8px";

        if (props.label) {
          const label = document.createElement("div");
          label.className = "label";
          label.textContent = String(props.label);
          wrap.appendChild(label);
        }

        const input = document.createElement("input");
        input.type = "range";
        input.min = String(props.min ?? 0);
        input.max = String(props.max ?? 100);
        input.step = String(props.step ?? 1);
        input.value = String(props.value ?? 0);

        const valueLabel = document.createElement("div");
        valueLabel.className = "label";
        valueLabel.style.marginBottom = "0";
        valueLabel.style.color = "rgba(148,163,184,0.9)";
        valueLabel.textContent = input.value;

        input.addEventListener("input", () => {
          valueLabel.textContent = input.value;
          if (handlers.change && engine) engine.invoke(handlers.change, [Number(input.value)]);
        });

        wrap.appendChild(input);
        wrap.appendChild(valueLabel);
        applyPadding(wrap, props.padding);
        return wrap;
      }
      case "textField": {
        const wrap = document.createElement("div");
        wrap.className = "col";
        wrap.style.gap = "8px";

        if (props.label) {
          const label = document.createElement("div");
          label.className = "label";
          label.textContent = String(props.label);
          wrap.appendChild(label);
        }

        const input = document.createElement("input");
        input.className = "input";
        input.type = "text";
        input.placeholder = String(props.placeholder ?? "");
        input.value = String(props.value ?? "");

        input.addEventListener("input", () => {
          if (handlers.change && engine) engine.invoke(handlers.change, [input.value]);
        });
        input.addEventListener("keydown", (event) => {
          if (event.key === "Enter" && handlers.submit && engine) engine.invoke(handlers.submit, [input.value]);
        });

        wrap.appendChild(input);
        applyPadding(wrap, props.padding);
        return wrap;
      }
      case "textEditor": {
        const wrap = document.createElement("div");
        wrap.className = "col";
        wrap.style.gap = "8px";

        if (props.label) {
          const label = document.createElement("div");
          label.className = "label";
          label.textContent = String(props.label);
          wrap.appendChild(label);
        }

        const textarea = document.createElement("textarea");
        textarea.className = "textarea";
        textarea.rows = Number(props.rows ?? 4) || 4;
        textarea.placeholder = String(props.placeholder ?? "");
        textarea.value = String(props.value ?? "");

        textarea.addEventListener("input", () => {
          if (handlers.change && engine) engine.invoke(handlers.change, [textarea.value]);
        });

        wrap.appendChild(textarea);
        applyPadding(wrap, props.padding);
        return wrap;
      }
      case "logViewer": {
        const wrap = document.createElement("div");
        wrap.setAttribute("data-wavelet-log", "1");
        wrap.style.border = "1px solid rgba(148,163,184,0.12)";
        wrap.style.borderRadius = "10px";
        wrap.style.background = "rgba(2,6,23,0.35)";
        wrap.style.padding = "10px";
        wrap.style.fontFamily =
          'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace';
        wrap.style.fontSize = "12px";

        const header = document.createElement("div");
        header.className = "label";
        header.style.marginBottom = "8px";
        header.textContent = "LOG";
        wrap.appendChild(header);

        const content = document.createElement("div");
        content.setAttribute("data-wavelet-log-content", "1");
        content.textContent = consoleLines.length ? consoleLines.join("\n") : "No output yet.";
        wrap.appendChild(content);
        applyPadding(wrap, props.padding);
        return wrap;
      }
      case "scroll": {
        const el = document.createElement("div");
        el.style.overflowY = "auto";
        el.style.maxHeight = props.height ? String(props.height) : "360px";
        applyPadding(el, props.padding);
        children.forEach((child) => el.appendChild(renderTree(child)));
        return el;
      }
      case "spacer": {
        const el = document.createElement("div");
        el.style.height = `${Number(props.height ?? 12) || 12}px`;
        return el;
      }
      case "divider": {
        const el = document.createElement("div");
        el.className = "divider";
        return el;
      }
      case "progress": {
        const outer = document.createElement("div");
        outer.className = "progressOuter";
        const inner = document.createElement("div");
        inner.className = "progressInner";
        const value = Number(props.value ?? 0);
        const clamped = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
        inner.style.width = `${clamped * 100}%`;
        outer.appendChild(inner);
        applyPadding(outer, props.padding);
        return outer;
      }
      case "picker": {
        const wrap = document.createElement("div");
        wrap.className = "col";
        wrap.style.gap = "8px";

        if (props.label) {
          const label = document.createElement("div");
          label.className = "label";
          label.textContent = String(props.label);
          wrap.appendChild(label);
        }

        const select = document.createElement("select");
        select.className = "select";
        const options = Array.isArray(props.options) ? props.options : [];
        for (const entry of options) {
          const opt = document.createElement("option");
          if (typeof entry === "string") {
            opt.value = entry;
            opt.textContent = entry;
          } else if (entry && typeof entry === "object") {
            opt.value = typeof entry.value === "string" ? entry.value : String(entry.value ?? "");
            opt.textContent = typeof entry.label === "string" ? entry.label : opt.value;
          } else {
            continue;
          }
          select.appendChild(opt);
        }

        if (props.value) select.value = String(props.value);
        select.addEventListener("change", () => {
          if (handlers.change && engine) engine.invoke(handlers.change, [select.value]);
        });
        wrap.appendChild(select);
        applyPadding(wrap, props.padding);
        return wrap;
      }
      case "grid": {
        const el = document.createElement("div");
        el.style.display = "grid";
        const columns = Math.max(1, Number(props.columns ?? 2) || 2);
        const spacing = Number(props.spacing ?? 8) || 8;
        el.style.gridTemplateColumns = `repeat(${columns}, minmax(0, 1fr))`;
        el.style.gap = `${spacing}px`;
        applyPadding(el, props.padding);
        children.forEach((child) => el.appendChild(renderTree(child)));
        return el;
      }
      default: {
        const el = document.createElement("div");
        el.className = "text";
        el.style.border = "1px solid rgba(244,63,94,0.25)";
        el.style.background = "rgba(244,63,94,0.08)";
        el.style.borderRadius = "10px";
        el.style.padding = "10px";
        el.textContent = `Unsupported node type: ${String(type)} (${String(nodeId)})`;
        return el;
      }
    }
  };

  const setPreview = (tree) => {
    if (!previewEl) return;
    previewEl.innerHTML = "";
    previewEl.appendChild(renderTree(tree));
  };

  const ensureEngine = () => {
    if (engine) return engine;
    engine = new WaveletEngine();
    engine.setup(
      (msg) => appendConsole(msg),
      (tree) => setPreview(tree),
      (title, message) => appendConsole(`[dialog] ${title}: ${message}`),
      {
        BLEService: { __waveletShim: true },
        DeviceConnection: { __waveletShim: true },
        Utils: { __waveletShim: true },
        SamplerSignals: { __waveletShim: true },
      }
    );
    return engine;
  };

  window.addEventListener("message", (event) => {
    const message = event.data;
    if (!message || typeof message !== "object") return;

    if (message.type === "load") {
      clearConsole();
      ensureEngine().setBootstrapSource(message.bootstrap || "");
      ensureEngine().updateModuleSources(message.modules || {});
      ensureEngine().execute(message.script || "");
    }
  });

  appendConsole("Wavelet preview ready.");
  vscode.setState({ ready: true });
})();
