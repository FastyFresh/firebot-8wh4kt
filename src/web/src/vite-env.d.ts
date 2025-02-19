/// <reference types="vite/client" /> // vite ^4.4.0

/**
 * Type definitions for environment variables used in the trading dashboard.
 * All variables are prefixed with VITE_ for client-side exposure and contain
 * non-sensitive configuration data only.
 */
interface ImportMetaEnv {
  /** Base URL for the trading dashboard API */
  readonly VITE_API_URL: string;
  /** WebSocket URL for real-time trading data */
  readonly VITE_WS_URL: string;
  /** Application version for the trading dashboard */
  readonly VITE_APP_VERSION: string;
}

/**
 * Augments the import.meta object with strongly-typed environment variables
 */
interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/**
 * Module declarations for various asset types used in the trading dashboard
 */

/**
 * SVG file module declaration
 */
declare module '*.svg' {
  const content: string;
  export default content;
}

/**
 * PNG file module declaration
 */
declare module '*.png' {
  const content: string;
  export default content;
}

/**
 * JPG file module declaration
 */
declare module '*.jpg' {
  const content: string;
  export default content;
}

/**
 * CSS module declaration with type-safe class names
 */
declare module '*.css' {
  const classes: { [key: string]: string };
  export default classes;
}