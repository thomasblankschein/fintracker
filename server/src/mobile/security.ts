import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";

/** SHA-256-Hex. Für Token/Kopplungscodes mit hoher Entropie reicht ein schneller Hash (kein Passwort-Hash nötig). */
export function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function generateDeviceToken(): string {
  return "fmt_" + crypto.randomBytes(32).toString("base64url");
}

// 32 Zeichen ohne verwechselbare (0/O, 1/I): 5 Bit pro Zeichen, 8 Zeichen = 40 Bit.
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function generateEnrollCode(): string {
  let code = "";
  for (let i = 0; i < 8; i++) code += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
  return code;
}

export function formatEnrollCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

/** Eingabe tolerant normalisieren: Groß-/Kleinschreibung, Bindestrich und Leerzeichen egal. */
export function normalizeEnrollCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/**
 * Gleitendes Zeitfenster pro Schlüssel. Wird für Fehlversuche (Authentifizierung, Kopplung)
 * und für Schreibzugriffe pro Gerät genutzt. Bewusst im Speicher: eine Instanz, Neustart setzt zurück.
 */
export class WindowLimiter {
  private hits = new Map<string, number[]>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number
  ) {
    setInterval(() => this.sweep(), 5 * 60 * 1000).unref();
  }

  private current(key: string): number[] {
    const now = Date.now();
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (recent.length > 0) this.hits.set(key, recent);
    else this.hits.delete(key);
    return recent;
  }

  /** Sekunden bis wieder erlaubt, 0 wenn das Limit nicht erreicht ist. */
  retryAfterSeconds(key: string): number {
    const recent = this.current(key);
    if (recent.length < this.max) return 0;
    return Math.max(1, Math.ceil((recent[0] + this.windowMs - Date.now()) / 1000));
  }

  record(key: string): void {
    const recent = this.current(key);
    recent.push(Date.now());
    this.hits.set(key, recent);
  }

  private sweep(): void {
    for (const key of [...this.hits.keys()]) this.current(key);
  }
}

/** Antwort-Header für den gesamten Mobile-Listener (API und statische Dateien). */
export function securityHeaders(req: Request, res: Response, next: NextFunction): void {
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; " +
      "manifest-src 'self'; worker-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
  );
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  // Nur über HTTPS (hinter Pangolin) setzen, sonst würde ein HTTP-Zugriff im LAN den Browser festnageln.
  if (req.secure) res.setHeader("Strict-Transport-Security", "max-age=15552000");
  next();
}

/** Optional: nur bestimmte Host-Header zulassen (MOBILE_ALLOWED_HOST, kommagetrennt). */
export function hostGuard(allowed: string[]) {
  const set = new Set(allowed.map((h) => h.trim().toLowerCase()).filter(Boolean));
  return (req: Request, res: Response, next: NextFunction): void => {
    if (set.size === 0) return next();
    const host = (req.headers.host ?? "").toLowerCase();
    if (!set.has(host)) {
      res.status(421).json({ error: "Unbekannter Host." });
      return;
    }
    next();
  };
}
