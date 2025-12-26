/// <reference types="vite/client" />

declare global {
  interface Window {
    __emwaverSplash?: {
      setProgress?: (progress: number) => void;
      hide?: () => void;
    };
  }
}

export {};
