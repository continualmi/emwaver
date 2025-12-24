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
    
    // Setup bridge and DSL
    this.installBridge();
    this.injectDSL();
    this.applyGlobalBindings();
    this.initialized = true;
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
      // Re-inject DSL and bindings for each execution
      this.injectDSL();
      this.applyGlobalBindings();
      
      console.log('[WaveletEngine.execute] DSL injected, about to execute script');

      // Wrap script in IIFE and execute using Function constructor
      // Bind all sandbox variables to the function scope
      const ctx = this.context as any;
      
      // Execute in the sandbox context by passing variables as parameters
      const func = new Function(
        '_waveletPrint',
        '_waveletRender', 
        '_waveletRegisterCallback',
        '_waveletImportModule',
        '_waveletShowDialog',
        'UI',
        'print',
        'require',
        'BLEService',
        script
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
        ctx.UI,
        ctx.print,
        ctx.require,
        ctx.BLEService
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
      callback(...arguments_);
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
  }

  /**
   * Inject UI DSL into context
   */
  private injectDSL(): void {
    if (!this.context) return;

    // Create callback counter in the context
    (this.context as any)._callbackCounter = 0;
    (this.context as any)._nodeCounter = 0;
    
    // Store reference to context for use in closures
    const ctx = this.context as any;
    
    // Create UI object directly in the context
    ctx.UI = {
      column: (props: any) => ctx._waveletMakeNode('column', props || {}),
      row: (props: any) => ctx._waveletMakeNode('row', props || {}),
      text: (props: any) => ctx._waveletMakeNode('text', props || {}),
      button: (props: any) => ctx._waveletMakeNode('button', props || {}),
      slider: (props: any) => ctx._waveletMakeNode('slider', props || {}),
      logViewer: (props: any) => ctx._waveletMakeNode('logViewer', props || {}),
      scroll: (props: any) => ctx._waveletMakeNode('scroll', props || {}),
      textField: (props: any) => ctx._waveletMakeNode('textField', props || {}),
      textEditor: (props: any) => ctx._waveletMakeNode('textEditor', props || {}),
      picker: (props: any) => ctx._waveletMakeNode('picker', props || {}),
      grid: (props: any) => ctx._waveletMakeNode('grid', props || {}),
      spacer: (props: any) => ctx._waveletMakeNode('spacer', props || {}),
      divider: (props: any) => ctx._waveletMakeNode('divider', props || {}),
      progress: (props: any) => ctx._waveletMakeNode('progress', props || {}),
      render: (tree: any) => {
        console.log('[UI.render] Called with tree:', tree);
        const renderFn = ctx._waveletRender;
        console.log('[UI.render] renderFn type:', typeof renderFn);
        if (typeof renderFn === 'function') {
          console.log('[UI.render] Calling _waveletRender');
          renderFn(tree);
        } else {
          // Fallback: try to print error
          console.error('[UI.render] _waveletRender is not a function!');
          const printFn = ctx._waveletPrint;
          if (typeof printFn === 'function') {
            printFn('ERROR: _waveletRender is not a function. Type: ' + typeof renderFn);
          }
        }
      }
    };

    // Create print function
    (this.context as any).print = (message: string) => {
      if (typeof (this.context as any)._waveletPrint === 'function') {
        (this.context as any)._waveletPrint(String(message));
      }
    };

    // Create dialog function
    (this.context as any).dialog = (title: string, message: string) => {
      if (typeof (this.context as any)._waveletShowDialog === 'function') {
        (this.context as any)._waveletShowDialog(String(title || ''), String(message || ''));
      }
    };

    // Create require function
    (this.context as any).require = (moduleName: string) => {
      if (typeof (this.context as any)._waveletImportModule === 'function') {
        return (this.context as any)._waveletImportModule(moduleName);
      }
      throw new Error('Module loading not available');
    };

    (this.context as any)._waveletNormalizeProps = (type: string, props: any) => {
      const raw = props || {};
      const children = Array.isArray(raw.children) ? raw.children : [];
      const id = raw.id ? String(raw.id) : `${type}_${++ctx._nodeCounter}`;
      const { children: _children, id: _id, ...rest } = raw;
      return { id, props: rest, children };
    };

    (this.context as any)._waveletCollectHandlers = (id: string, props: any) => {
      const handlers: Record<string, string> = {};
      const events = [
        { key: 'onTap', type: 'tap' },
        { key: 'onChange', type: 'change' },
        { key: 'onSubmit', type: 'submit' },
      ];
      events.forEach((event) => {
        const fn = props[event.key];
        if (typeof fn === 'function') {
          const token = `${id}:${event.type}`;
          if (typeof ctx._waveletRegisterCallback === 'function') {
            ctx._waveletRegisterCallback(token, fn);
          }
          handlers[event.type] = token;
        }
        if (Object.prototype.hasOwnProperty.call(props, event.key)) {
          delete props[event.key];
        }
      });
      return handlers;
    };

    (this.context as any)._waveletMakeNode = (type: string, props: any) => {
      const normalized = ctx._waveletNormalizeProps(type, props || {});
      const handlerTokens = ctx._waveletCollectHandlers(normalized.id, normalized.props);
      return {
        type,
        id: normalized.id,
        props: normalized.props,
        children: normalized.children,
        handlers: handlerTokens,
      };
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
   * Normalize module name (remove .js extension, handle paths)
   */
  private normalizeModuleName(name: string): string {
    return name
      .replace(/\.js$/, '')
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
