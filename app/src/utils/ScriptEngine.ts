/*
 * EMWaver
 * Copyright (c) 2026 Luís Marnoto
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * ScriptEngine - EMWaver script execution sandbox
 *
 * Provides:
 * - Script execution in isolated context
 * - UI DSL (UI.column, UI.row, UI.button, etc.)
 * - Native bindings (transport + hardware helpers)
 * - Print/log callbacks
 * - Render callbacks for UI
 */

export type PrintCallback = (message: string) => void;
export type RenderCallback = (tree: ScriptTree) => void;

export interface ScriptTree {
  type: 'column' | 'row' | 'button' | 'text' | 'logViewer' | 'slider' | 'scroll' | 'textField' | 'textEditor' | 'picker' | 'grid' | 'spacer' | 'divider' | 'progress';
  props?: Record<string, unknown>;
  children?: ScriptTree[];
  handlers?: Record<string, string>;
}

export interface GlobalBindings {
  [key: string]: unknown;
}

export class ScriptEngine {
  private context: Window | null = null;
  private callbackRegistry: Map<string, Function> = new Map();
  private globalBindings: GlobalBindings = {};
  private bootstrapSource = '';
  
  private printCallback?: PrintCallback;
  private renderCallback?: RenderCallback;
  private initialized = false;

  /**
   * Setup the engine with callbacks and initial bindings
   */
  setup(
    printCallback: PrintCallback,
    renderCallback: RenderCallback,
    bindings: GlobalBindings = {}
  ): void {
    this.printCallback = printCallback;
    this.renderCallback = renderCallback;
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
   * Execute an EMWaver script
   */
  execute(script: string, completion?: () => void): void {
    console.log('[ScriptEngine.execute] Called');
    console.log('[ScriptEngine.execute] initialized:', this.initialized);
    console.log('[ScriptEngine.execute] context:', this.context);
    
    if (!this.initialized || !this.context) {
      this.printCallback?.('ScriptEngine not initialized');
      console.log('[ScriptEngine.execute] Early return - not initialized');
      return;
    }

    // Clear previous callbacks
    this.callbackRegistry.clear();
    
    
    console.log('[ScriptEngine.execute] About to inject DSL');

    try {
      // Re-apply bindings for each execution.
      this.applyGlobalBindings();
      
      console.log('[ScriptEngine.execute] DSL injected, about to execute script');

      // Wrap script in IIFE and execute using Function constructor
      // Bind all sandbox variables to the function scope
      const ctx = this.context as any;
      
      // Execute in the sandbox context by passing variables as parameters
      const fullScript = `${this.bootstrapSource}\n${script}`;

      const func = new Function(
        '_scriptPrint',
        '_scriptRender',
        '_scriptRegisterCallback',
        '_scriptSendCommandString',
        '_scriptSendPacket',
        '_scriptSleep',
        fullScript,
      );
      
      console.log('[ScriptEngine.execute] Calling function with context');
      console.log('[ScriptEngine.execute] ctx.UI:', ctx.UI);
      console.log('[ScriptEngine.execute] ctx._scriptRender:', typeof ctx._scriptRender);
      
      func.call(
        ctx,
        ctx._scriptPrint,
        ctx._scriptRender,
        ctx._scriptRegisterCallback,
        ctx._scriptSendCommandString,
        (ctx as any)._scriptSendPacket,
        ctx._scriptSleep,
      );
      
      console.log('[ScriptEngine.execute] Function executed successfully');
      completion?.();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[ScriptEngine.execute] Error:', error);
      this.printCallback?.(`Script error: ${message}`);
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
          this.printCallback?.(`Script callback error: ${message}`);
          console.error("Script callback error:", error);
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.printCallback?.(`Script callback error: ${message}`);
      console.error('Script callback error:', error);
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
   * Shutdown the engine
   */
  shutdown(): void {
    this.context = null;
    this.callbackRegistry.clear();
    this.initialized = false;
  }

  /**
   * Install bridge functions (_scriptPrint, _scriptRender, etc.)
   */
  private installBridge(): void {
    if (!this.context) return;

    // Print function
    (this.context as any)._scriptPrint = (message: string) => {
      this.printCallback?.(String(message));
    };

    // Render function
    (this.context as any)._scriptRender = (nodeValue: unknown) => {
      try {
        console.log('[_scriptRender] Called with:', nodeValue);
        const tree = this.convertToScriptTree(nodeValue);
        console.log('[_scriptRender] Converted tree:', tree);
        this.renderCallback?.(tree);
        console.log('[_scriptRender] Render callback invoked');
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error('[_scriptRender] Error:', error);
        this.printCallback?.(`Render error: ${message}`);
      }
    };

    // Callback registration
    (this.context as any)._scriptRegisterCallback = (token: string, callback: Function) => {
      if (token && typeof callback === 'function') {
        this.callbackRegistry.set(token, callback);
      }
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
   * Convert script object to ScriptTree
   */
  private convertToScriptTree(value: unknown): ScriptTree {
    if (value === null || value === undefined) {
      throw new Error('Cannot convert null/undefined to ScriptTree');
    }

    // If it's already a ScriptTree-like object
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

        const tree: ScriptTree = {
          type: type as ScriptTree['type'],
          props: mergedProps,
        };

        if (handlers && Object.keys(handlers).length > 0) {
          tree.handlers = handlers;
        }

        if (children.length > 0) {
          tree.children = children.map((child) => this.convertToScriptTree(child));
        }

        return tree;
      }
    }

    throw new Error(`Invalid ScriptTree structure: ${JSON.stringify(value)}`);
  }
}
