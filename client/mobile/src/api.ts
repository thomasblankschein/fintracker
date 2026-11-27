import { basicHeader, getBasic } from "./storage";
import type { BasicCreds, Boot, QueuedEntry, RecentEntry } from "./storage";

export type ApiResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; error: string; authRequired?: true };

// Wird aufgerufen, wenn der Server (bzw. ein Proxy davor, z. B. Pangolin) die Zugangsdaten verlangt oder ablehnt.
let onAuthRequired: (() => void) | null = null;
export function setAuthRequiredHandler(fn: (() => void) | null): void {
  onAuthRequired = fn;
}

const TIMEOUT_MS = 10_000;

interface CallOptions {
  /** Zugangsdaten zum Ausprobieren statt der gespeicherten; löst nie den globalen Handler aus */
  basic?: BasicCreds;
}

async function call<T>(
  method: string,
  path: string,
  token: string | null,
  body?: unknown,
  options: CallOptions = {}
): Promise<ApiResult<T>> {
  const basic = options.basic ?? getBasic();
  const controller = new AbortController();
  // Bei schlechtem Empfang hängen Anfragen oft ewig — nach 10 s abbrechen, damit die Warteschlange weiterarbeitet.
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(path, {
      method,
      signal: controller.signal,
      // Mit eigenen Zugangsdaten: ausdrücklich mitsenden und keine zwischengespeicherten Browser-Zugangsdaten (kein Systemdialog)
      credentials: basic ? "omit" : "same-origin",
      headers: {
        ...(basic ? { Authorization: basicHeader(basic) } : {}),
        ...(token ? { "X-Device-Token": token } : {}),
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => null);
    // 401 heißt nur dann „Gerät widerrufen", wenn es vom Gerätetoken-Check kommt. Ein 401 des Servers/Proxys davor
    // (Basic-Auth) darf den Token nicht löschen — dafür gibt es die Zugangsdaten-Maske.
    if (res.status === 401 && json?.code !== "device_unauthorized") {
      if (!options.basic) onAuthRequired?.();
      return { ok: false, status: 0, error: "Zugangsdaten erforderlich", authRequired: true };
    }
    // Eine Login-Seite eines Proxys wäre 200 mit HTML statt JSON
    if (res.ok && json === null) {
      if (!options.basic) onAuthRequired?.();
      return { ok: false, status: 0, error: "Unerwartete Antwort (Anmeldung am Proxy?)", authRequired: true };
    }
    if (res.ok) return { ok: true, status: res.status, data: json as T };
    return { ok: false, status: res.status, error: json?.error ?? `Fehler ${res.status}` };
  } catch {
    return { ok: false, status: 0, error: "Keine Verbindung" };
  } finally {
    clearTimeout(timer);
  }
}

/** Prüft, ob der Server die Zugangsdaten akzeptiert (ohne Token, ohne Daten, ohne Kopplungsversuch zu verbrauchen). */
export const checkBasic = (creds: BasicCreds) =>
  call<{ ok: true }>("GET", "/api/m/health", null, undefined, { basic: creds });
export const enroll = (code: string) => call<{ token: string }>("POST", "/api/m/enroll", null, { code });
export const bootstrap = (token: string) => call<Boot>("GET", "/api/m/bootstrap", token);
export const recent = (token: string) => call<RecentEntry[]>("GET", "/api/m/entries/recent", token);
export const undo = (token: string, clientId: string) =>
  call<{ ok: true }>("DELETE", `/api/m/entries/${encodeURIComponent(clientId)}`, token);
export const postEntry = (token: string, e: QueuedEntry) =>
  call<{ ok: true; duplicate: boolean }>("POST", "/api/m/entries", token, {
    clientId: e.clientId,
    amountCents: e.amountCents,
    categoryId: e.categoryId,
    note: e.note,
    date: e.date,
  });
