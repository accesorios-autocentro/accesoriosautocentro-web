import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, "dist");

const PUBLIC_FILES = [
  "index.html",
  "control.html",
  "admin.html",
  "styles.css",
  "app.js",
  "control.js",
  "supabase-client.js",
  "erp-logic.mjs",
  "erp-mappers.mjs",
  "IMG_1752.jpg",
  "_headers"
];

fs.rmSync(OUT_DIR, { recursive: true, force: true });
fs.mkdirSync(OUT_DIR, { recursive: true });

for (const file of PUBLIC_FILES) {
  const src = path.join(ROOT, file);
  const dest = path.join(OUT_DIR, file);
  if (!fs.existsSync(src)) {
    throw new Error(`Falta archivo público requerido: ${file}`);
  }
  fs.copyFileSync(src, dest);
}

console.log(`Cloudflare Pages build listo en ./dist (${PUBLIC_FILES.length} archivos públicos).`);
