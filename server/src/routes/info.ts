import { Router } from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const infoRouter = Router();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../package.json"), "utf-8"));

infoRouter.get("/", (req, res) => {
  res.json({ version: pkg.version });
});
