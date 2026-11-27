export interface BootCategory {
  id: number;
  name: string;
  path: string;
  uses: number;
}

export interface RecentEntry {
  clientId: string;
  date: string;
  note: string | null;
  amountCents: number;
  categoryName: string | null;
  canUndo: boolean;
}

export interface Boot {
  account: { name: string };
  deviceName: string;
  categories: BootCategory[];
  recent: RecentEntry[];
}

export interface QueuedEntry {
  clientId: string;
  amountCents: number;
  categoryId: number;
  categoryLabel: string;
  note: string;
  date: string;
  state: "pending" | "rejected";
  error?: string;
}

const TOKEN_KEY = "fm.token";
const BOOT_KEY = "fm.boot";
const QUEUE_KEY = "fm.queue";
const BASIC_KEY = "fm.basic";
// Der Service Worker kann localStorage nicht lesen; die Cache-API teilen sich Seite und Service Worker.
const CREDS_CACHE = "fintracker-mobile-creds";
const CREDS_URL = "/__creds";

// localStorage kann in privaten Fenstern oder bei voller Quote werfen — die App soll dann nicht abstürzen.
function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignorieren
  }
}

export const getToken = (): string | null => read<string | null>(TOKEN_KEY, null);
export const saveToken = (token: string): void => write(TOKEN_KEY, token);
export const clearToken = (): void => {
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(BOOT_KEY);
  } catch {
    // ignorieren
  }
};

export const loadBoot = (): Boot | null => read<Boot | null>(BOOT_KEY, null);
export const saveBoot = (boot: Boot): void => write(BOOT_KEY, boot);

export const loadQueue = (): QueuedEntry[] => read<QueuedEntry[]>(QUEUE_KEY, []);
export const saveQueue = (queue: QueuedEntry[]): void => write(QUEUE_KEY, queue);

export interface BasicCreds {
  user: string;
  password: string;
}

export const getBasic = (): BasicCreds | null => read<BasicCreds | null>(BASIC_KEY, null);

/** Wert für den Authorization-Header (UTF-8-sicher, damit auch Umlaute im Passwort funktionieren). */
export function basicHeader(c: BasicCreds): string {
  let bin = "";
  new TextEncoder().encode(`${c.user}:${c.password}`).forEach((b) => (bin += String.fromCharCode(b)));
  return "Basic " + btoa(bin);
}

/** Spiegelt die Zugangsdaten für den Service Worker (nur in sicheren Kontexten, sonst gibt es keinen Service Worker). */
export async function syncBasicToCache(creds: BasicCreds | null = getBasic()): Promise<void> {
  try {
    if (typeof caches === "undefined") return;
    const cache = await caches.open(CREDS_CACHE);
    if (creds) await cache.put(CREDS_URL, new Response(JSON.stringify(creds)));
    else await cache.delete(CREDS_URL);
  } catch {
    // ignorieren
  }
}

export async function saveBasic(creds: BasicCreds): Promise<void> {
  write(BASIC_KEY, creds);
  await syncBasicToCache(creds);
}

export async function clearBasic(): Promise<void> {
  try {
    localStorage.removeItem(BASIC_KEY);
  } catch {
    // ignorieren
  }
  await syncBasicToCache(null);
}

/** UUID auch in unsicheren Kontexten (HTTP im LAN), wo crypto.randomUUID fehlt. */
export function newClientId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
