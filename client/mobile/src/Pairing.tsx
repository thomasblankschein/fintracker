import { FormEvent, useState } from "react";
import { enroll } from "./api";
import { loadQueue } from "./storage";

export default function Pairing({ onPaired }: { onPaired: (token: string) => void }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const waiting = loadQueue().length;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await enroll(code);
    setBusy(false);
    if (res.ok) return onPaired(res.data.token);
    if (res.status === 400) setError("Code ungültig oder abgelaufen. In der Desktop-App einen neuen erzeugen.");
    else if (res.status === 429) setError("Zu viele Versuche. Bitte in ein paar Minuten erneut versuchen.");
    else setError("Keine Verbindung. Bitte Netz prüfen und erneut versuchen.");
  };

  return (
    <main className="screen">
      <h1>Gerät koppeln</h1>
      <p className="muted">
        Öffne in der Fintracker-Desktop-App <strong>Einstellungen → Mobile Geräte</strong>, füge ein Gerät hinzu und
        tippe den angezeigten Code hier ein. Er gilt 10 Minuten und nur einmal.
      </p>
      {waiting > 0 && <p className="notice">{waiting === 1 ? "1 gespeicherter Eintrag wartet und wird" : `${waiting} gespeicherte Einträge warten und werden`} nach dem Koppeln gesendet.</p>}
      <form onSubmit={submit}>
        <input
          className="code-input"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="XXXX-XXXX"
          maxLength={9}
          autoCapitalize="characters"
          autoCorrect="off"
          autoComplete="off"
          spellCheck={false}
          aria-label="Kopplungscode"
        />
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button className="primary" type="submit" disabled={busy || code.replace(/[^A-Z0-9]/gi, "").length < 8}>
          {busy ? "Koppeln …" : "Koppeln"}
        </button>
      </form>
    </main>
  );
}
