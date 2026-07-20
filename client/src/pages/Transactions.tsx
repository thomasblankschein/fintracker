import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, AccountNode, Payee, Transaction, flattenAccounts, formatCents } from "../api";
import AccountSelect from "../components/AccountSelect";

function parseEuroToCents(input: string): number | null {
  const normalized = input.trim().replace(",", ".");
  const value = Number(normalized);
  if (!Number.isFinite(value) || normalized === "") return null;
  return Math.round(value * 100);
}

interface SplitRow {
  accountId: number | "";
  amountEuro: string;
}

export default function Transactions() {
  const [params, setParams] = useSearchParams();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [tree, setTree] = useState<AccountNode[]>([]);
  const [payees, setPayees] = useState<Payee[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);

  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [description, setDescription] = useState("");
  const [payeeName, setPayeeName] = useState("");
  const [splitMode, setSplitMode] = useState(false);
  const [amount, setAmount] = useState("");
  const [fromAccountId, setFromAccountId] = useState<number | "">("");
  const [toAccountId, setToAccountId] = useState<number | "">("");
  const [rows, setRows] = useState<SplitRow[]>([
    { accountId: "", amountEuro: "" },
    { accountId: "", amountEuro: "" },
  ]);

  const filterAccount = params.get("account") ?? "";
  const filterPayee = params.get("payee") ?? "";
  const filterFrom = params.get("from") ?? "";
  const filterTo = params.get("to") ?? "";
  const filterDescription = params.get("description") ?? "";
  const hasActiveFilter = Boolean(filterAccount || filterPayee || filterFrom || filterTo || filterDescription);

  const setFilter = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  const load = () => {
    api
      .getTransactions({
        account: filterAccount ? Number(filterAccount) : undefined,
        payee: filterPayee ? Number(filterPayee) : undefined,
        from: filterFrom || undefined,
        to: filterTo || undefined,
        description: filterDescription || undefined,
      })
      .then(setTransactions)
      .catch((e) => setError(e.message));
  };

  useEffect(() => {
    load();
  }, [filterAccount, filterPayee, filterFrom, filterTo, filterDescription]);

  useEffect(() => {
    api.getAccountsTree().then(setTree).catch((e) => setError(e.message));
    api.getPayees().then(setPayees).catch((e) => setError(e.message));
  }, []);

  const flatAccounts = useMemo(() => flattenAccounts(tree), [tree]);

  const resetForm = () => {
    setEditingId(null);
    setDate(new Date().toISOString().slice(0, 10));
    setDescription("");
    setPayeeName("");
    setAmount("");
    setFromAccountId("");
    setToAccountId("");
    setRows([{ accountId: "", amountEuro: "" }, { accountId: "", amountEuro: "" }]);
    setSplitMode(false);
  };

  const startEdit = (t: Transaction) => {
    setEditingId(t.id);
    setDate(t.date);
    setDescription(t.description ?? "");
    setPayeeName(t.payeeName ?? "");
    setSplitMode(true);
    setRows(t.postings.map((p) => ({ accountId: p.accountId, amountEuro: (p.amountCents / 100).toFixed(2) })));
    setShowForm(true);
  };

  const splitSum = rows.reduce((s, r) => s + (parseEuroToCents(r.amountEuro) ?? 0), 0);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      let postings: { accountId: number; amountCents: number }[];
      if (splitMode) {
        postings = rows
          .filter((r) => r.accountId !== "" && r.amountEuro.trim() !== "")
          .map((r) => ({ accountId: r.accountId as number, amountCents: parseEuroToCents(r.amountEuro) ?? 0 }));
      } else {
        const cents = parseEuroToCents(amount);
        if (!cents || !fromAccountId || !toAccountId) {
          setError("Betrag, Von-Konto und Nach-Konto sind erforderlich.");
          return;
        }
        postings = [
          { accountId: toAccountId as number, amountCents: cents },
          { accountId: fromAccountId as number, amountCents: -cents },
        ];
      }

      const payload = { date, description, payeeName: payeeName || null, postings };
      if (editingId) {
        await api.updateTransaction(editingId, payload);
      } else {
        await api.createTransaction(payload);
      }
      resetForm();
      setShowForm(false);
      load();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const remove = async (id: number) => {
    await api.deleteTransaction(id);
    load();
  };

  const updateRow = (index: number, patch: Partial<SplitRow>) => {
    setRows((rs) => rs.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  };

  return (
    <div>
      <div className="toolbar">
        <h1>Buchungen</h1>
        <button
          onClick={() => {
            resetForm();
            setShowForm((s) => !s);
          }}
        >
          {showForm ? "Abbrechen" : "Buchung erfassen"}
        </button>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="card">
        <div className="form-row">
          <label>
            Von
            <input type="date" value={filterFrom} onChange={(e) => setFilter("from", e.target.value)} />
          </label>
          <label>
            Bis
            <input type="date" value={filterTo} onChange={(e) => setFilter("to", e.target.value)} />
          </label>
          <label>
            Zahlungsempfänger
            <select value={filterPayee} onChange={(e) => setFilter("payee", e.target.value)}>
              <option value="">Alle</option>
              {payees.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Konto
            <select value={filterAccount} onChange={(e) => setFilter("account", e.target.value)}>
              <option value="">Alle</option>
              {flatAccounts.map(({ node, depth }) => (
                <option key={node.id} value={node.id}>
                  {"  ".repeat(depth)}
                  {node.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Beschreibung
            <input
              value={filterDescription}
              onChange={(e) => setFilter("description", e.target.value)}
              placeholder="Suche…"
            />
          </label>
        </div>
        {hasActiveFilter && (
          <button className="secondary" onClick={() => setParams({})}>
            Filter zurücksetzen
          </button>
        )}
      </div>

      {showForm && (
        <form className="card" onSubmit={submit}>
          <div className="form-row">
            <label>
              Datum
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
            </label>
            <label>
              Zahlungsempfänger
              <input
                value={payeeName}
                onChange={(e) => setPayeeName(e.target.value)}
                list="payee-suggestions"
                placeholder="z. B. REWE"
              />
              <datalist id="payee-suggestions">
                {payees.map((p) => (
                  <option key={p.id} value={p.name} />
                ))}
              </datalist>
            </label>
            <label>
              Beschreibung
              <input value={description} onChange={(e) => setDescription(e.target.value)} />
            </label>
          </div>

          <div className="form-row">
            <button type="button" className="secondary" onClick={() => setSplitMode((s) => !s)}>
              {splitMode ? "Einfacher Modus" : "Aufteilen (mehrere Konten)"}
            </button>
          </div>

          {!splitMode ? (
            <div className="form-row">
              <label>
                Betrag (€)
                <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="12,50" required />
              </label>
              <label>
                Von Konto
                <AccountSelect tree={tree} value={fromAccountId} onChange={setFromAccountId} placeholder="Von…" />
              </label>
              <label>
                Nach Konto
                <AccountSelect tree={tree} value={toAccountId} onChange={setToAccountId} placeholder="Nach…" />
              </label>
            </div>
          ) : (
            <div>
              {rows.map((row, i) => (
                <div className="posting-row" key={i}>
                  <label>
                    Konto
                    <AccountSelect tree={tree} value={row.accountId} onChange={(id) => updateRow(i, { accountId: id })} />
                  </label>
                  <label>
                    Betrag (€, +/-)
                    <input value={row.amountEuro} onChange={(e) => updateRow(i, { amountEuro: e.target.value })} placeholder="-12,50" />
                  </label>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => setRows((rs) => rs.filter((_, idx) => idx !== i))}
                    disabled={rows.length <= 2}
                  >
                    Entfernen
                  </button>
                </div>
              ))}
              <div className="form-row">
                <button type="button" className="secondary" onClick={() => setRows((rs) => [...rs, { accountId: "", amountEuro: "" }])}>
                  Zeile hinzufügen
                </button>
                <span className={splitSum === 0 ? "muted" : "balance-warning"}>
                  Summe: {formatCents(splitSum)} {splitSum !== 0 && "— muss 0 sein"}
                </span>
              </div>
            </div>
          )}

          <button type="submit">{editingId ? "Aktualisieren" : "Buchen"}</button>
        </form>
      )}

      <div className="card">
        {transactions.length === 0 ? (
          <p className="muted">Keine Buchungen gefunden.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Datum</th>
                <th>Zahlungsempfänger</th>
                <th>Beschreibung</th>
                <th>Konten</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((t) => (
                <tr key={t.id}>
                  <td>{t.date}</td>
                  <td>{t.payeeName ?? "—"}</td>
                  <td>{t.description ?? "—"}</td>
                  <td>
                    {t.postings.map((p, i) => (
                      <div key={i}>
                        {p.accountName}{" "}
                        <span className={p.amountCents >= 0 ? "amount-positive" : "amount-negative"}>
                          {formatCents(p.amountCents)}
                        </span>
                      </div>
                    ))}
                  </td>
                  <td>
                    <div className="actions">
                      <button className="secondary" onClick={() => startEdit(t)}>
                        Bearbeiten
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
