import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = path.resolve(__dirname, "../src/migrations");
const dest = path.resolve(__dirname, "../dist/migrations");

fs.cpSync(src, dest, { recursive: true });
console.log(`Migrationen kopiert: ${src} -> ${dest}`);
