/**
 * Check if Tauri APIs are available (i.e., running in Tauri context, not browser)
 * In Tauri v2, we check by attempting to access the API
 */
let _tauriAvailable: boolean | null = null;

export function isTauriAvailable(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  
  // Cache only once we have a definitive true. In some Tauri setups the globals
  // may be injected after the first tick; caching false would break detection.
  if (_tauriAvailable === true) {
    return true;
  }
  
  // In Tauri v2, the APIs are injected at runtime
  // Check if we're in a Tauri environment by checking for the IPC bridge
  // The safest way is to check if the window has Tauri-specific properties
  try {
    // Check multiple possible indicators
    const hasTauri = (
      "__TAURI__" in window ||
      "__TAURI_INTERNALS__" in window ||
      (window as any).__TAURI_METADATA__ !== undefined ||
      // Check if we can access Tauri APIs (they're available in Tauri context)
      typeof (window as any).__TAURI__ !== "undefined"
    );
    
    _tauriAvailable = hasTauri;
    return hasTauri;
  } catch {
    _tauriAvailable = false;
    return false;
  }
}

/**
 * Safely invoke a Tauri command, returning null if Tauri is not available
 */
export async function safeInvoke<T>(
  cmd: string,
  args?: Record<string, unknown>,
  options?: { throwOnError?: boolean }
): Promise<T | null> {
  if (!isTauriAvailable()) {
    const error = new Error(`Tauri not available: cannot invoke ${cmd}`);
    if (options?.throwOnError) throw error;
    console.warn(error.message);
    return null;
  }
  
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<T>(cmd, args);
  } catch (error) {
    if (options?.throwOnError) throw error;
    console.error(`Failed to invoke ${cmd}:`, error);
    return null;
  }
}

/**
 * Safely listen to a Tauri event, returning a no-op unlisten function if Tauri is not available
 */
export async function safeListen<TPayload = unknown>(
  event: string,
  handler: (event: { payload: TPayload }) => void
): Promise<() => void> {
  if (!isTauriAvailable()) {
    console.warn(`Tauri not available: cannot listen to ${event}`);
    return () => {}; // Return no-op unlisten function
  }
  
  try {
    const { listen } = await import("@tauri-apps/api/event");
    return await listen<TPayload>(event, handler);
  } catch (error) {
    console.error(`Failed to listen to ${event}:`, error);
    return () => {}; // Return no-op unlisten function
  }
}

/**
 * Safely join path segments using Tauri's path API, or fallback to simple string concatenation
 */
export async function safeJoin(...paths: string[]): Promise<string> {
  if (!isTauriAvailable()) {
    // Fallback to simple path joining for browser mode
    return paths.join("/").replace(/\/+/g, "/");
  }
  
  try {
    const { join } = await import("@tauri-apps/api/path");
    let result = paths[0];
    for (let i = 1; i < paths.length; i++) {
      result = await join(result, paths[i]);
    }
    return result;
  } catch (error) {
    console.error("Failed to join path:", error);
    // Fallback to simple path joining
    return paths.join("/").replace(/\/+/g, "/");
  }
}
