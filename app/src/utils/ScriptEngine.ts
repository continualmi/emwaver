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

export type RenderCallback = (tree: ScriptTree) => void;
export type ErrorCallback = (message: string) => void;

export interface ScriptTree {
  type:
    | 'column'
    | 'row'
    | 'button'
    | 'tile'
    | 'card'
    | 'text'
    | 'logViewer'
    | 'slider'
    | 'scroll'
    | 'textField'
    | 'textEditor'
    | 'picker'
    | 'grid'
    | 'spacer'
    | 'divider'
    | 'progress';
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
  
  private renderCallback?: RenderCallback;
  private errorCallback?: ErrorCallback;
  private initialized = false;

  /**
   * Setup the engine with callbacks and initial bindings
   */
  setup(
    renderCallback: RenderCallback,
    bindings: GlobalBindings = {},
    errorCallback?: ErrorCallback,
  ): void {
    this.renderCallback = renderCallback;
    this.globalBindings = { ...bindings };
    this.errorCallback = errorCallback;

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
    if (!this.initialized || !this.context) {
      this.errorCallback?.('ScriptEngine not initialized');
      return;
    }

    // Clear previous callbacks
    this.callbackRegistry.clear();
    
    
    try {
      // Re-apply bindings for each execution.
      this.applyGlobalBindings();

      // Wrap script in IIFE and execute using Function constructor
      // Bind all sandbox variables to the function scope
      const ctx = this.context as any;
      
      // Execute in the sandbox context by passing variables as parameters
      const fullScript = `${this.bootstrapSource}\n${script}`;

      const func = new Function(
        '_scriptRender',
        '_scriptRegisterCallback',
        '_scriptSendPacket',
        '_scriptSleep',
        fullScript,
      );

      func.call(
        ctx,
        ctx._scriptRender,
        ctx._scriptRegisterCallback,
        (ctx as any)._scriptSendPacket,
        ctx._scriptSleep,
      );
      completion?.();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.errorCallback?.(`Script error: ${message}`);
    }
  }

  /**
   * Invoke a registered callback by token
   */
  invoke(token: string, arguments_: unknown[] = []): void {
    const callback = this.callbackRegistry.get(token);
    if (!callback) {
      this.errorCallback?.(`No callback registered for token ${token}`);
      return;
    }

    try {
      const result = callback(...arguments_);
      if (result && typeof (result as any).then === "function") {
        (result as Promise<unknown>).catch((error) => {
          const message = error instanceof Error ? error.message : String(error);
          this.errorCallback?.(`Script callback error: ${message}`);
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.errorCallback?.(`Script callback error: ${message}`);
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
    * Install bridge functions (_scriptRender, _scriptRegisterCallback, etc.)
    */
  private installBridge(): void {
    if (!this.context) return;

    // Render function
    (this.context as any)._scriptRender = (nodeValue: unknown) => {
      try {
        const tree = this.convertToScriptTree(nodeValue);
        this.renderCallback?.(tree);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.errorCallback?.(`Render error: ${message}`);
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
