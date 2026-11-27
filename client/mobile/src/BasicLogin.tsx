import { FormEvent, useState } from "react";
import { checkBasic } from "./api";
import { clearBasic, getBasic, loadQueue, saveBasic } from "./storage";

/**
 * Server-Zugangsdaten (HTTP Basic), z. B. die „Basic Header Auth" einer Pangolin-Resource. Sie werden nur auf diesem
 * Gerät gespeichert und bei jeder Anfrage als Authorization-Header mitgesendet. Mit dem Gerätetoken hat das nichts zu tun.
 */
export default function BasicLogin({
  forced,
  onDone,
  onCancel,
}: {
  /** true: der Server hat gerade mit 401 abgelehnt, die App kommt ohne Zugangsdaten nicht weiter */
  forced: boolean;
  onDone: () => void;
  onCancel?: () => void;
}) {
  const saved = getBasic();
  const [user, setUser] = useState(saved?.user ?? "");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const waiting = loadQueue().length;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!user.trim() || !password) return;
    setBusy(true);
    setError(null);
    const creds = { user: user.trim(), password };
    // Prüfen, bevor gespeichert wird: so überschreibt ein Tippfehler keine funktionierenden Zugangsdaten
    const res = await checkBasic(creds);
    setBusy(false);
    if (res.ok) {
      await saveBasic(creds);
      onDone();
    } else if ("authRequired" in res && res.authRequired) {
      setError("Benutzername oder Passwort wurden vom Server abgelehnt.");
    } else {
      setError("Keine Verbindung. Bitte Netz prüfen und erneut versuchen.");
    }
  };

  const remove = async () => {
    await clearBasic();
    setPassword("");
    setError(null);
    // Ohne gespeicherte Zugangsdaten gibt es hier nichts mehr zu tun, es sei denn der Server verlangt sie
    if (!forced) onDone();
    else setUser("");
  };

  return (
    <main className="screen">
      <h1>Server-Zugangsdaten</h1>
      <p className="muted">
        Verlangt der Server vor der App einen Benutzernamen und ein Passwort (Basic-Auth, z. B. von Pangolin), trägst du
        sie hier einmal ein. Sie bleiben nur auf diesem iPhone gespeichert und werden bei jeder Anfrage mitgesendet.
      </p>
      {forced && (
        <p className="notice">
          Der Server hat die Anfrage abgelehnt (401). Bitte Zugangsdaten eingeben
          {waiting > 0 ? ` — ${waiting === 1 ? "1 Eintrag wartet" : `${waiting} Einträge warten`} und ${waiting === 1 ? "wird" : "werden"} danach gesendet` : ""}.
        </p>
      )}
      {saved && !forced && <p className="notice">Gespeichert für Benutzer „{saved.user}".</p>}
      <form onSubmit={submit}>
        <label className="field">
          <span className="sr-only">Benutzername</span>
          <input
            value={user}
            onChange={(e) => setUser(e.target.value)}
            placeholder="Benutzername"
            autoComplete="username"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
          />
        </label>
        <label className="field">
          <span className="sr-only">Passwort</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={saved ? "Neues Passwort" : "Passwort"}
            autoComplete="current-password"
          />
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button className="primary" type="submit" disabled={busy || !user.trim() || !password}>
          {busy ? "Prüfe …" : "Speichern"}
        </button>
      </form>
      {saved && (
        <button type="button" className="link" onClick={remove}>
          Gespeicherte Zugangsdaten entfernen
        </button>
      )}
      {onCancel && !forced && (
        <button type="button" className="link" onClick={onCancel}>
          Zurück
        </button>
      )}
    </main>
  );
}
