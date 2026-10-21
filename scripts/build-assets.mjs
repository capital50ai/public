// Splits each page in templates/ into a small HTML shell (templates/dist/) plus long-cacheable files
// in public/assets/ (styles, scripts, images), named by content hash. The page's code and design are
// unchanged; phones just stop re-downloading ~0.5-1 MB on every visit.
// Runs automatically before `next build` and `next dev`.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";

const OUT = "public/assets", DIST = "templates/dist";
rmSync(OUT, { recursive: true, force: true });
rmSync(DIST, { recursive: true, force: true });
mkdirSync(`${OUT}/img`, { recursive: true });
mkdirSync(DIST, { recursive: true });

const hash = (s) => createHash("sha256").update(s).digest("hex").slice(0, 12);
const EXT = { "image/webp": "webp", "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/svg+xml": "svg" };
const report = [];
const PRELOAD = { index: 0, auth: 1, dashboard: 2 };

for (const name of ["index", "auth", "dashboard"]) {
  let html = readFileSync(`templates/${name}.html`, "utf8");
  const before = html.length;

  // <img src="data:..."> -> /assets/img/<hash>.<ext>
  html = html.replace(/(<img\b[^>]*?\bsrc=")data:(image\/[a-z+]+);base64,([A-Za-z0-9+/=]+)(")/g, (_, a, mime, b64, z) => {
    const buf = Buffer.from(b64, "base64"), file = `${hash(buf)}.${EXT[mime] ?? "bin"}`;
    writeFileSync(`${OUT}/img/${file}`, buf);
    return `${a}/assets/img/${file}${z}`;
  });

  // <noscript> content only applies without JavaScript: leave it exactly where it is
  const noscript = [];
  html = html.replace(/<noscript>[\s\S]*?<\/noscript>/g, (m) => (noscript.push(m), `\u0000NOSCRIPT${noscript.length - 1}\u0000`));

  // all <style> blocks -> one stylesheet, linked where the first block was
  const styles = [];
  html = html.replace(/<style>([\s\S]*?)<\/style>/g, (_, css) => (styles.push(css), styles.length === 1 ? "\u0000STYLE\u0000" : ""));
  if (styles.length) {
    const css = styles.join("\n"), file = `${name}.${hash(css)}.css`;
    writeFileSync(`${OUT}/${file}`, css);
    html = html.replace("\u0000STYLE\u0000", `<link rel="stylesheet" href="/assets/${file}">`);
  }

  // large inline scripts -> external files at the same position. Per-request data (REAL, ME, ACCOUNT)
  // stays inline in a tiny script the server fills in.
  html = html.replace(/<script>([\s\S]*?)<\/script>/g, (whole, js) => {
    if (js.length < 4096) return whole;
    const tokens = [];
    js = js.replace(/const (REAL|ME|ACCOUNT)=(__C50_[A-Z]+__);/g, (_, v, t) => (tokens.push([v, t]), `const ${v}=window.__C50.${v};`));
    // images embedded as strings in the code ("data:image/...") -> cacheable files, same <img> use.
    // Not on the home page: its 3D ring and reels re-lay-out the page each time an image arrives, so
    // there the art stays inside the (cached) script and is ready on first layout, as designed.
    if (name !== "index") js = js.replace(/(["'`])data:(image\/[a-z+]+);base64,([A-Za-z0-9+/=]+)\1/g, (_, q, mime, b64) => {
      const buf = Buffer.from(b64, "base64"), img = `${hash(buf)}.${EXT[mime] ?? "bin"}`;
      writeFileSync(`${OUT}/img/${img}`, buf);
      return `${q}/assets/img/${img}${q}`;
    });
    const file = `${name}.${hash(js)}.js`;
    writeFileSync(`${OUT}/${file}`, js);
    const data = tokens.length ? `<script>window.__C50={${tokens.map(([v, t]) => `${v}:${t}`).join(",")}}</script>` : "";
    return `${data}<script src="/assets/${file}"></script>`;
  });

  html = html.replace(/\u0000NOSCRIPT(\d+)\u0000/g, (_, i) => noscript[Number(i)]);

  // Ask for the first on-screen images straight away (they're the largest thing painted on first load).
  const first = [...html.matchAll(/<img\b(?![^>]*loading="lazy")[^>]*src="(\/assets\/img\/[^"]+)"/g)].slice(0, PRELOAD[name]).map((m) => m[1]);
  if (first.length) html = html.replace("<link rel=\"stylesheet\"", first.map((h) => `<link rel="preload" as="image" href="${h}">`).join("") + "<link rel=\"stylesheet\"");
  writeFileSync(`${DIST}/${name}.html`, html);
  report.push(`${name}: ${Math.round(before / 1024)} KB -> ${Math.round(html.length / 1024)} KB per visit`);
}
console.log("assets built. " + report.join(", "));
