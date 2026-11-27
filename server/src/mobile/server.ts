import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mobileRouter } from "./api.js";
import { hostGuard, securityHeaders } from "./security.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Zweiter, bewusst minimaler Listener für die iPhone-Erfassung. Er mountet NICHT die Hauptapp-Routen
 * (Konten, Buchungen, Auswertungen …), kein CORS, kein Swagger — nur die Mobile-PWA und /api/m.
 * Nur dieser Port wird über Pangolin veröffentlicht; der Hauptport bleibt privat.
 */
export function createMobileApp(): express.Express {
  const app = express();
  app.disable("x-powered-by");
  // Hops zwischen Client und App (Pangolin/Traefik) für die Client-IP der Rate-Limits; Default: keiner.
  app.set("trust proxy", Number(process.env.TRUST_PROXY) || 0);

  app.use(hostGuard((process.env.MOBILE_ALLOWED_HOST ?? "").split(",")));
  app.use(securityHeaders);

  // Zugriffsprotokoll ohne Header, Body oder Query (Token und Beträge gehören nicht ins Log)
  app.use((req, res, next) => {
    res.on("finish", () => {
      if (req.path.startsWith("/api/")) console.log(`[mobile] ${req.method} ${req.path} ${res.statusCode} ip=${req.ip}`);
    });
    next();
  });

  app.use("/api/m", (req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  app.use("/api/m", express.json({ limit: "8kb" }), mobileRouter);

  const staticDir = path.resolve(__dirname, "../../../client/dist-mobile");
  if (fs.existsSync(staticDir)) {
    app.use(
      express.static(staticDir, {
        index: "index.html",
        setHeaders(res, filePath) {
          const base = path.basename(filePath);
          if (filePath.includes(`${path.sep}assets${path.sep}`)) {
            res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
          } else {
            // Shell, Service Worker und Manifest müssen sich sofort aktualisieren lassen
            res.setHeader("Cache-Control", "no-cache");
          }
          if (base === "manifest.webmanifest") res.setHeader("Content-Type", "application/manifest+json");
        },
      })
    );
  } else {
    console.log("[mobile] client/dist-mobile fehlt — nur die API ist verfügbar (Frontend im Dev-Modus über Port 5174).");
  }

  // Alles andere: knappe 404, kein SPA-Fallback
  app.use((req, res) => {
    res.status(404).json({ error: "Nicht gefunden." });
  });

  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (err?.type === "entity.too.large") return res.status(413).json({ error: "Anfrage zu groß." });
    if (err instanceof SyntaxError) return res.status(400).json({ error: "Ungültiges JSON." });
    console.error("[mobile]", err?.message ?? err);
    res.status(500).json({ error: "Interner Fehler." });
  });

  return app;
}

export function startMobileServer(): void {
  const port = process.env.MOBILE_PORT === undefined ? 3002 : Number(process.env.MOBILE_PORT);
  if (!port) {
    console.log("[mobile] deaktiviert (MOBILE_PORT=0).");
    return;
  }
  createMobileApp().listen(port, () => {
    console.log(`Mobile Erfassung läuft auf http://localhost:${port} (nur dieser Port gehört in Pangolin)`);
  });
}
