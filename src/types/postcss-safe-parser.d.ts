declare module "postcss-safe-parser" {
  import type { Root } from "postcss";
  /** Fault-tolerant CSS parser — recovers from the syntax errors real template packages ship. */
  export default function safeParse(css: string, opts?: { from?: string; map?: unknown }): Root;
}
