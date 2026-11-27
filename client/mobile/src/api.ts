import type { Boot, QueuedEntry, RecentEntry } from "./storage";

export type ApiResult<T> = { ok: true; status: number; data: T } | { ok: false; status: number; error: string };

const TIMEOUT_MS = 10_000;

async function call<T>(method: string, path: string, token: string | null, body?: unknown): Promise<ApiResult<T>> {
  const controller = new AbortController();
  // Bei schlechtem Empfang hängen Anfragen oft ewig — nach 10 s abbrechen, damit die Warteschlange weiterarbeitet.
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(path, {
      method,
      signal: controller.signal,
      headers: {
        ...(token ? { "X-Device-Token": token } : {}),
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => null);
    if (res.ok) return { ok: true, status: res.status, data: json as T };
    return { ok: false, status: res.status, error: json?.error ?? `Fehler ${res.status}` };
  } catch {
    return { ok: false, status: 0, error: "Keine Verbindung" };
  } finally {
    clearTimeout(timer);
  }
}

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
