import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";

export const PAGES = ["index", "auth", "dashboard"] as const;
export type PageName = (typeof PAGES)[number];

const cache = new Map<PageName, string>();

async function template(name: PageName): Promise<string> {
  let t = cache.get(name);
  if (!t) {
    t = await readFile(path.join(process.cwd(), "templates", `${name}.html`), "utf8");
    cache.set(name, t);
  }
  return t;
}

// JSON that is safe inside an inline <script>: no "</script>", no HTML comments, no line separators.
export function scriptJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

// Plain split/join: String.replace would interpret "$" sequences inside the data.
export async function render(name: PageName, slots: Record<string, string>): Promise<string> {
  let html = await template(name);
  for (const [token, value] of Object.entries(slots)) html = html.split(token).join(value);
  return html;
}
