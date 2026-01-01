/**
 * WaveletEngine - JavaScript execution sandbox for running wavelets
 * 
 * Provides:
 * - JavaScript execution in isolated context
 * - UI DSL (UI.column, UI.row, UI.button, etc.)
 * - Native bindings (BLE, CC1101, etc.)
 * - Module loading system
 * - Print/log callbacks
 * - Render callbacks for UI
 */

export type PrintCallback = (message: string) => void;
export type RenderCallback = (tree: WaveletTree) => void;
export type DialogCallback = (title: string, message: string) => void;

export interface WaveletTree {
  type: 'column' | 'row' | 'button' | 'text' | 'logViewer' | 'slider' | 'scroll' | 'textField' | 'textEditor' | 'picker' | 'grid' | 'spacer' | 'divider' | 'progress';
  props?: Record<string, unknown>;
  children?: WaveletTree[];
  handlers?: Record<string, string>;
}

export interface ModuleSource {
  name: string;
  content: string;
}

export interface GlobalBindings {
  [key: string]: unknown;
}

export class WaveletEngine {
  private context: Window | null = null;
  private callbackRegistry: Map<string, Function> = new Map();
  private globalBindings: GlobalBindings = {};
  private moduleSources: Map<string, ModuleSource> = new Map();
  private moduleCache: Map<string, unknown> = new Map();
  private moduleLoadingStack: Set<string> = new Set();
  private bootstrapSource = '';
  
  private printCallback?: PrintCallback;
  private renderCallback?: RenderCallback;
  private dialogCallback?: DialogCallback;
  private initialized = false;

  /**
   * Setup the engine with callbacks and initial bindings
   */
  setup(
    printCallback: PrintCallback,
    renderCallback: RenderCallback,
    dialogCallback?: DialogCallback,
    bindings: GlobalBindings = {}
  ): void {
    this.printCallback = printCallback;
    this.renderCallback = renderCallback;
    this.dialogCallback = dialogCallback;
    this.globalBindings = { ...bindings };

    // Use a simple object as context instead of iframe (works better in Tauri)
    // We'll create a sandboxed environment using a proxy
    const sandbox: Record<string, unknown> = {};
    this.context = sandbox as unknown as Window;
    
    // Setup bridge and shared bootstrap
    this.installBridge();
    this.applyGlobalBindings();
    this.initialized = true;
  }

  setBootstrapSource(source: string): void {
    this.bootstrapSource = String(source ?? "");
  }

  /**
   * Execute a JavaScript script
   */
  execute(script: string, completion?: () => void): void {
    console.log('[WaveletEngine.execute] Called');
    console.log('[WaveletEngine.execute] initialized:', this.initialized);
    console.log('[WaveletEngine.execute] context:', this.context);
    
    if (!this.initialized || !this.context) {
      this.printCallback?.('WaveletEngine not initialized');
      console.log('[WaveletEngine.execute] Early return - not initialized');
      return;
    }

    // Clear previous callbacks
    this.callbackRegistry.clear();
    this.moduleLoadingStack.clear();
    
    console.log('[WaveletEngine.execute] About to inject DSL');

    try {
      // Re-apply bindings for each execution.
      this.applyGlobalBindings();
      
      console.log('[WaveletEngine.execute] DSL injected, about to execute script');

      // Wrap script in IIFE and execute using Function constructor
      // Bind all sandbox variables to the function scope
      const ctx = this.context as any;
      
      // Execute in the sandbox context by passing variables as parameters
      const fullScript = `${this.bootstrapSource}\n${script}`;

      const func = new Function(
        '_waveletPrint',
        '_waveletRender', 
        '_waveletRegisterCallback',
        '_waveletImportModule',
        '_waveletShowDialog',
        '_waveletCreateByteArray',
        'BLEService',
        'DeviceConnection',
        'Utils',
        'SamplerSignals',
        fullScript
      );
      
      console.log('[WaveletEngine.execute] Calling function with context');
      console.log('[WaveletEngine.execute] ctx.UI:', ctx.UI);
      console.log('[WaveletEngine.execute] ctx._waveletRender:', typeof ctx._waveletRender);
      
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
      
      console.log('[WaveletEngine.execute] Function executed successfully');
      completion?.();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[WaveletEngine.execute] Error:', error);
      this.printCallback?.(`Wavelet error: ${message}`);
    }
  }

  /**
   * Invoke a registered callback by token
   */
  invoke(token: string, arguments_: unknown[] = []): void {
    const callback = this.callbackRegistry.get(token);
    if (!callback) {
      this.printCallback?.(`No callback registered for token ${token}`);
      return;
    }

    try {
      const result = callback(...arguments_);
      if (result && typeof (result as any).then === "function") {
        (result as Promise<unknown>).catch((error) => {
          const message = error instanceof Error ? error.message : String(error);
          this.printCallback?.(`Wavelet callback error: ${message}`);
          console.error("Wavelet callback error:", error);
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.printCallback?.(`Wavelet callback error: ${message}`);
      console.error('Wavelet callback error:', error);
    }
  }

  /**
   * Register or update global bindings
   */
  registerGlobalBindings(bindings: GlobalBindings): void {
    this.globalBindings = { ...this.globalBindings, ...bindings };
    this.applyGlobalBindings();
  }

  /**
   * Update module sources for require/import
   */
  updateModuleSources(sources: Record<string, string>): void {
    this.moduleSources.clear();
    for (const [name, content] of Object.entries(sources)) {
      const normalized = this.normalizeModuleName(name);
      if (normalized) {
        this.moduleSources.set(normalized, { name, content });
      }
    }
    this.moduleCache.clear();
    this.moduleLoadingStack.clear();
  }

  /**
   * Shutdown the engine
   */
  shutdown(): void {
    this.context = null;
    this.callbackRegistry.clear();
    this.moduleSources.clear();
    this.moduleCache.clear();
    this.moduleLoadingStack.clear();
    this.initialized = false;
  }

  /**
   * Install bridge functions (_waveletPrint, _waveletRender, etc.)
   */
  private installBridge(): void {
    if (!this.context) return;

    // Print function
    (this.context as any)._waveletPrint = (message: string) => {
      this.printCallback?.(String(message));
    };

    // Render function
    (this.context as any)._waveletRender = (nodeValue: unknown) => {
      try {
        console.log('[_waveletRender] Called with:', nodeValue);
        this.printCallback?.('Render called');
        const tree = this.convertToWaveletTree(nodeValue);
        console.log('[_waveletRender] Converted tree:', tree);
        this.printCallback?.(`Rendering tree type: ${tree.type}`);
        this.renderCallback?.(tree);
        console.log('[_waveletRender] Render callback invoked');
        this.printCallback?.('Render callback completed');
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error('[_waveletRender] Error:', error);
        this.printCallback?.(`Render error: ${message}`);
        this.printCallback?.(`Error stack: ${error instanceof Error ? error.stack : String(error)}`);
      }
    };

    // Callback registration
    (this.context as any)._waveletRegisterCallback = (token: string, callback: Function) => {
      if (token && typeof callback === 'function') {
        this.callbackRegistry.set(token, callback);
      }
    };

    // Module import
    (this.context as any)._waveletImportModule = (moduleName: string): unknown => {
      return this.importModule(moduleName);
    };

    // Dialog function
    (this.context as any)._waveletShowDialog = (title: string, message: string) => {
      this.dialogCallback?.(title, message);
    };

    // Byte array helper (kept as a bridge primitive so the shared bootstrap can call it).
    (this.context as any)._waveletCreateByteArray = (jsArray: unknown) => {
      const ctx = this.context as any;
      if (typeof ctx.createByteArray === "function") {
        return ctx.createByteArray(jsArray);
      }
      if (Array.isArray(jsArray)) {
        return new Uint8Array(jsArray.map((value) => Number(value) & 0xff));
      }
      return new Uint8Array([]);
    };
  }

  /**
   * Apply global bindings to context
   */
  private applyGlobalBindings(): void {
    if (!this.context) return;

    for (const [name, value] of Object.entries(this.globalBindings)) {
      try {
        (this.context as any)[name] = value;
      } catch (error) {
        console.error(`Failed to bind ${name}:`, error);
      }
    }
  }

  /**
   * Import a module by name
   */
  private importModule(moduleName: string): unknown {
    const normalized = this.normalizeModuleName(moduleName);
    if (!normalized) {
      throw new Error(`Invalid module name: ${moduleName}`);
    }

    // Check cache
    if (this.moduleCache.has(normalized)) {
      return this.moduleCache.get(normalized);
    }

    // Check for circular dependencies
    if (this.moduleLoadingStack.has(normalized)) {
      throw new Error(`Circular dependency detected: ${normalized}`);
    }

    // Find module source
    const source = this.moduleSources.get(normalized);
    if (!source) {
      throw new Error(`Module not found: ${moduleName}`);
    }

    // Mark as loading
    this.moduleLoadingStack.add(normalized);

    try {
      // Execute module in context
      if (!this.context) {
        throw new Error('Context not available');
      }

      const wrappedModule = `return (function() {
        const module = { exports: {} };
        ${source.content}
        return module.exports;
      })();`;

      const func = new Function(wrappedModule);
      const exports = func.call(this.context);
      
      // Cache result
      this.moduleCache.set(normalized, exports);
      this.moduleLoadingStack.delete(normalized);
      
      return exports;
    } catch (error) {
      this.moduleLoadingStack.delete(normalized);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to load module ${moduleName}: ${message}`);
    }
  }

  /**
   * Normalize module name (remove .js/.emw extension, handle paths)
   */
  private normalizeModuleName(name: string): string {
    return name
      .replace(/\.(js|emw)$/, '')
      .replace(/^\.\//, '')
      .toLowerCase();
  }

  /**
   * Convert JavaScript object to WaveletTree
   */
  private convertToWaveletTree(value: unknown): WaveletTree {
    if (value === null || value === undefined) {
      throw new Error('Cannot convert null/undefined to WaveletTree');
    }

    // If it's already a WaveletTree-like object
    if (typeof value === 'object' && value !== null) {
      const obj = value as Record<string, unknown>;
      
      if (typeof obj.type === 'string') {
        const children = Array.isArray(obj.children) ? obj.children : [];
        const props =
          typeof obj.props === 'object' && obj.props !== null
            ? { ...(obj.props as Record<string, unknown>) }
            : {};
        const handlers =
          typeof obj.handlers === 'object' && obj.handlers !== null
            ? (obj.handlers as Record<string, string>)
            : undefined;

        const { type, children: _, props: _props, handlers: _handlers, ...restProps } = obj;
        const mergedProps = { ...props, ...restProps };

        const tree: WaveletTree = {
          type: type as WaveletTree['type'],
          props: mergedProps,
        };

        if (handlers && Object.keys(handlers).length > 0) {
          tree.handlers = handlers;
        }

        if (children.length > 0) {
          tree.children = children.map((child) => this.convertToWaveletTree(child));
        }

        return tree;
      }
    }

    throw new Error(`Invalid WaveletTree structure: ${JSON.stringify(value)}`);
  }
}
