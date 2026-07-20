import { useEffect, useState } from "react";
import { api, AccountNode, Payee, RecurringTemplate, formatCents } from "../api";
import AccountSelect from "../components/AccountSelect";

function dayOfYear(d: Date): number {
  const start = new Date(d.getFullYear(), 0, 1);
  return Math.floor((d.getTime() - start.getTime()) / 86400000) + 1;
}

function deriveIntervalDay(interval: "weekly" | "monthly" | "yearly", startDate: string): number {
  const [y, m, day] = startDate.split("-").map(Number);
  const d = new Date(y, m - 1, day);
  if (interval === "weekly") return d.getDay();
  if (interval === "monthly") return d.getDate();
  return dayOfYear(d);
}

const INTERVAL_LABELS = { weekly: "wöchentlich", monthly: "monatlich", yearly: "jährlich" };

export default function Recurring() {
  const [templates, setTemplates] = useState<RecurringTemplate[]>([]);
  const [tree, setTree] = useState<AccountNode[]>([]);
  const [payees, setPayees] = useState<Payee[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const [name, setName] = useState("");
  const [payeeName, setPayeeName] = useState("");
  const [fromAccountId, setFromAccountId] = useState<number | "">("");
  const [toAccountId, setToAccountId] = useState<number | "">("");
  const [amount, setAmount] = useState("");
  const [interval, setInterval] = useState<"weekly" | "monthly" | "yearly">("monthly");
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState("");

  const load = () => api.getRecurring().then(setTemplates).catch((e) => setError(e.message));

  useEffect(() => {
    load();
    api.getAccountsTree().then(setTree).catch((e) => setError(e.message));
    api.getPayees().then(setPayees).catch((e) => setError(e.message));
  }, []);

  const resetForm = () => {
    setName("");
    setPayeeName("");
    setFromAccountId("");
    setToAccountId("");
    setAmount("");
    setInterval("monthly");
    setStartDate(new Date().toISOString().slice(0, 10));
    setEndDate("");
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cents = Math.round(Number(amount.replace(",", ".")) * 100);
    if (!name || !fromAccountId || !toAccountId || !cents) {
      setError("Name, Von-Konto, Nach-Konto und Betrag sind erforderlich.");
      return;
    }
    try {
      await api.createRecurring({
        name,
        payeeId: null,
        fromAccountId: fromAccountId as number,
        toAccountId: toAccountId as number,
        amountCents: cents,
        interval,
        intervalDay: deriveIntervalDay(interval, startDate),
        startDate,
        endDate: endDate || null,
      });
      if (payeeName) {
        await api.createPayee(payeeName).catch(() => {});
      }
      resetForm();
      setShowForm(false);
      load();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const toggleActive = async (t: RecurringTemplate) => {
    await api.updateRecurring(t.id, { active: !t.active });
    load();
  };

  const remove = async (id: number) => {
    await api.deleteRecurring(id);
    load();
  };

  const book = async (t: RecurringTemplate) => {
    try {
      await api.bookRecurring(t.id, t.nextDueDate ?? undefined);
      load();
    } catch (err: any) {
      setError(err.message);
    }
  };

  return (
    <div>
      <div className="toolbar">
        <h1>Wiederkehrende Zahlungen</h1>
        <button onClick={() => setShowForm((s) => !s)}>{showForm ? "Abbrechen" : "Vorlage anlegen"}</button>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {showForm && (
        <form className="card" onSubmit={submit}>
          <div className="form-row">
            <label>
              Name
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="z. B. Miete" required />
            </label>
            <label>
              Zahlungsempfänger
              <input value={payeeName} onChange={(e) => setPayeeName(e.target.value)} list="payee-suggestions" />
              <datalist id="payee-suggestions">
                {payees.map((p) => (
                  <option key={p.id} value={p.name} />
                ))}
              </datalist>
            </label>
            <label>
              Betrag (€)
              <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="850,00" required />
            </label>
          </div>
          <div className="form-row">
            <label>
              Von Konto
              <AccountSelect tree={tree} value={fromAccountId} onChange={setFromAccountId} />
            </label>
            <label>
              Nach Konto
              <AccountSelect tree={tree} value={toAccountId} onChange={setToAccountId} />
            </label>
            <label>
              Intervall
              <select value={interval} onChange={(e) => setInterval(e.target.value as any)}>
                <option value="weekly">Wöchentlich</option>
                <option value="monthly">Monatlich</option>
                <option value="yearly">Jährlich</option>
              </select>
            </label>
          </div>
          <div className="form-row">
            <label>
              Start
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required />
            </label>
            <label>
              Ende (optional)
              <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </label>
          </div>
          <button type="submit">Speichern</button>
        </form>
      )}

      <div className="card">
        {templates.length === 0 ? (
          <p className="muted">Noch keine wiederkehrenden Zahlungen.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Von → Nach</th>
                <th>Betrag</th>
                <th>Intervall</th>
                <th>Nächster Termin</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {templates.map((t) => (
                <tr key={t.id} style={{ opacity: t.active ? 1 : 0.5 }}>
                  <td>{t.name}</td>
                  <td>
                    {t.fromAccountName} → {t.toAccountName}
                  </td>
                  <td>{formatCents(t.amountCents)}</td>
                  <td>{INTERVAL_LABELS[t.interval]}</td>
                  <td>{t.active ? t.nextDueDate : "—"}</td>
                  <td>
                    <div className="actions">
                      <button onClick={() => book(t)} disabled={!t.active}>
                        Jetzt buchen
                      </button>
                      <button className="secondary" onClick={() => toggleActive(t)}>
                        {t.active ? "Pausieren" : "Aktivieren"}
                      </button>
                      <button className="danger" onClick={() => remove(t.id)}>
                        Löschen
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
