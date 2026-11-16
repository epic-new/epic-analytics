declare const __EPIC_ANALYTICS_VERSION__: string | undefined;

/** This package's version, stamped in at build time (`0.0.0-dev` when run from source). */
export const VERSION: string =
  typeof __EPIC_ANALYTICS_VERSION__ === "string" ? __EPIC_ANALYTICS_VERSION__ : "0.0.0-dev";
