import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as api from "./api";
import { formatCents, formatDate, parseAmountToCents, todayLocal } from "./format";
import {
  Boot,
  BootCategory,
  QueuedEntry,
  RecentEntry,
  loadBoot,
  loadQueue,
  newClientId,
  saveBoot,
  saveQueue,
} from "./storage";

const TILE_COUNT = 8;

export default function Capture({
  token,
  onUnauthorized,
  onOpenBasic,
}: {
  token: string;
  onUnauthorized: () => void;
  onOpenBasic: () => void;
}) {
  const [boot, setBoot] = useState<Boot | null>(loadBoot());
  const [queue, setQueue] = useState<QueuedEntry[]>(loadQueue());
  const [recent, setRecent] = useState<RecentEntry[]>(boot?.recent ?? []);
  const [amountText, setAmountText] = useState("");
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [search, setSearch] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const [online, setOnline] = useState(navigator.onLine);
  const [confirmUndo, setConfirmUndo] = useState<string | null>(null);
  const flushing = useRef(false);

  const categories = boot?.categories ?? [];
  const cents = parseAmountToCents(amountText);
  const selected = categories.find((c) => c.id === categoryId) ?? null;
  const tiles = useMemo(() => categories.slice(0, TILE_COUNT), [categories]);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? categories.filter((c) => c.path.toLowerCase().includes(q)) : categories;
  }, [categories, search]);

  const showToast = (text: string) => {
    setToast(text);
    window.setTimeout(() => setToast((t) => (t === text ? null : t)), 3500);
  };

  const flush = useCallback(async () => {
    if (flushing.current) return;
    flushing.current = true;
    try {
      let q = loadQueue();
      for (const item of q.filter((i) => i.state === "pending")) {
        const res = await api.postEntry(token, item);
        if (res.ok) {
          q = q.filter((x) => x.clientId !== item.clientId);
        } else if (res.status === 400) {
          q = q.map((x) => (x.clientId === item.clientId ? { ...x, state: "rejected" as const, error: res.error } : x));
        } else if (res.status === 401) {
          saveQueue(q);
          setQueue(q);
          onUnauthorized();
          return;
        } else {
          break; // offline, Zeitüberschreitung, 429 oder Serverfehler: später erneut
        }
        saveQueue(q);
        setQueue(q);
      }
    } finally {
      flushing.current = false;
    }
  }, [token, onUnauthorized]);

  const refresh = useCallback(async () => {
    await flush();
    const res = await api.bootstrap(token);
    if (res.ok) {
      saveBoot(res.data);
      setBoot(res.data);
      setRecent(res.data.recent);
    } else if (res.status === 401) {
      onUnauthorized();
    }
  }, [token, flush, onUnauthorized]);

  useEffect(() => {
    refresh();
    const onVisible = () => document.visibilityState === "visible" && refresh();
    const onOnline = () => {
      setOnline(true);
      refresh();
    };
    const onOffline = () => setOnline(false);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [refresh]);

  const save = async () => {
    if (cents === null || !selected) return;
    const entry: QueuedEntry = {
      clientId: newClientId(),
      amountCents: cents,
      categoryId: selected.id,
      categoryLabel: selected.path,
      note: note.trim(),
      date: todayLocal(),
      state: "pending",
    };
    // Erst lokal sichern, dann senden: so geht auch bei Verbindungsabbruch nichts verloren
    const q = [...loadQueue(), entry];
    saveQueue(q);
    setQueue(q);
    setAmountText("");
    setCategoryId(null);
    setNote("");
    setShowAll(false);
    setSearch("");
    await flush();
    const stillQueued = loadQueue().some((x) => x.clientId === entry.clientId);
    showToast(
      stillQueued
        ? `Gespeichert, wird gesendet sobald Netz da ist (${formatCents(entry.amountCents)})`
        : `Erfasst: ${formatCents(entry.amountCents)} · ${entry.categoryLabel}`
    );
    if (!stillQueued) {
      const res = await api.recent(token);
      if (res.ok) setRecent(res.data);
    }
  };

  const discard = (clientId: string) => {
    const q = loadQueue().filter((x) => x.clientId !== clientId);
    saveQueue(q);
    setQueue(q);
  };

  const undo = async (clientId: string) => {
    if (confirmUndo !== clientId) {
      setConfirmUndo(clientId);
      window.setTimeout(() => setConfirmUndo((c) => (c === clientId ? null : c)), 3000);
      return;
    }
    setConfirmUndo(null);
    const res = await api.undo(token, clientId);
    if (res.ok) {
      setRecent((r) => r.filter((x) => x.clientId !== clientId));
      showToast("Rückgängig gemacht");
    } else if (res.status === 401) {
      onUnauthorized();
    } else {
      showToast(res.error);
    }
  };

  const pendingCount = queue.filter((q) => q.state === "pending").length;
  const pickCategory = (c: BootCategory) => setCategoryId(c.id);

  return (
    <main className="screen">
      <header className="top">
        <span className="account">{boot?.account.name ?? "Bargeld"}</span>
        <span className={online ? "badge" : "badge warn"}>
          {!online ? "Offline" : pendingCount > 0 ? `${pendingCount} offen` : "Online"}
        </span>
      </header>

      <label className="amount-field">
        <span className="sr-only">Betrag in Euro</span>
        <input
          className="amount"
          inputMode="decimal"
          autoComplete="off"
          placeholder="0,00"
          value={amountText}
          onChange={(e) => setAmountText(e.target.value)}
        />
        <span className="currency">€</span>
      </label>
      {amountText.trim() !== "" && cents === null && <p className="error">Betrag bitte als 12,50 eingeben.</p>}

      {categories.length === 0 ? (
        <p className="muted">Kategorien werden geladen … (beim ersten Start ist eine Verbindung nötig)</p>
      ) : (
        <>
          <div className="tiles" role="group" aria-label="Kategorie">
            {tiles.map((c) => (
              <button
                key={c.id}
                type="button"
                className={c.id === categoryId ? "tile selected" : "tile"}
                onClick={() => pickCategory(c)}
              >
                {c.name}
              </button>
            ))}
          </div>
          {selected && !tiles.some((c) => c.id === selected.id) && <p className="chosen">Gewählt: {selected.path}</p>}
          <button type="button" className="link" onClick={() => setShowAll((s) => !s)}>
            {showAll ? "Weniger anzeigen" : "Weitere Kategorien …"}
          </button>
          {showAll && (
            <div className="all">
              <input
                className="text"
                placeholder="Suchen …"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                autoCapitalize="off"
                autoCorrect="off"
              />
              <ul className="cat-list">
                {filtered.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      className={c.id === categoryId ? "cat selected" : "cat"}
                      onClick={() => {
                        pickCategory(c);
                        setShowAll(false);
                        setSearch("");
                      }}
                    >
                      {c.path}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      <input
        className="text"
        placeholder="Notiz (optional)"
        value={note}
        maxLength={120}
        onChange={(e) => setNote(e.target.value)}
      />

      <button className="primary" type="button" disabled={cents === null || !selected} onClick={save}>
        {cents !== null && selected ? `${formatCents(cents)} speichern` : "Speichern"}
      </button>

      <div className="toast" role="status" aria-live="polite">
        {toast}
      </div>

      {queue.length > 0 && (
        <section>
          <h2>Wartet auf Senden</h2>
          <ul className="list">
            {queue.map((q) => (
              <li key={q.clientId} className={q.state === "rejected" ? "row rejected" : "row"}>
                <div className="what">
                  <strong>{q.categoryLabel}</strong>
                  <span className="muted">
                    {formatDate(q.date)}
                    {q.note ? ` · ${q.note}` : ""}
                  </span>
                  {q.state === "rejected" && <span className="error">Abgelehnt: {q.error}</span>}
                </div>
                <div className="side">
                  <span>{formatCents(q.amountCents)}</span>
                  <button type="button" className="small" onClick={() => discard(q.clientId)}>
                    Verwerfen
                  </button>
                </div>
              </li>
            ))}
          </ul>
          {pendingCount > 0 && (
            <button type="button" className="link" onClick={refresh}>
              Jetzt erneut senden
            </button>
          )}
        </section>
      )}

      {recent.length > 0 && (
        <section>
          <h2>Zuletzt erfasst</h2>
          <ul className="list">
            {recent.map((r) => (
              <li key={r.clientId} className="row">
                <div className="what">
                  <strong>{r.categoryName ?? "—"}</strong>
                  <span className="muted">
                    {formatDate(r.date)}
                    {r.note ? ` · ${r.note}` : ""}
                  </span>
                </div>
                <div className="side">
                  <span>{formatCents(r.amountCents)}</span>
                  {r.canUndo && (
                    <button
                      type="button"
                      className={confirmUndo === r.clientId ? "small danger" : "small"}
                      onClick={() => undo(r.clientId)}
                    >
                      {confirmUndo === r.clientId ? "Wirklich?" : "Rückgängig"}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <button type="button" className="link" onClick={onOpenBasic}>
        Server-Zugangsdaten …
      </button>
    </main>
  );
}
