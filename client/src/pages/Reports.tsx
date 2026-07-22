import { useEffect, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer, Cell } from "recharts";
import { api, CategoryReportRow, PayeeReportRow, formatCents } from "../api";

const COLORS = ["#2563eb", "#16a34a", "#f59e0b", "#dc2626", "#9333ea", "#0891b2", "#65a30d", "#db2777"];

function firstOfMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

export default function Reports() {
  const [from, setFrom] = useState(firstOfMonth());
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const [byCategory, setByCategory] = useState<CategoryReportRow[]>([]);
  const [byPayee, setByPayee] = useState<PayeeReportRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.getReportByCategory(from, to), api.getReportByPayee(from, to)])
      .then(([cat, payee]) => {
        setByCategory(cat);
        setByPayee(payee);
      })
      .catch((e) => setError(e.message));
  }, [from, to]);

  // Jede Zeile enthält bereits die Summe aller Unterkonten (Rollup, wie im Kontenrahmen).
  // Für Gesamtsumme und Balkendiagramm daher nur die oberste Kategorie-Ebene verwenden —
  // sonst würden z.B. "Freizeit & Hobby" und sein Unterkonto "Urlaube & Trips" doppelt gezählt.
  const topExpenseRows = byCategory.filter((r) => r.accountType === "expense" && r.depth === 1 && r.totalCents > 0);
  const topIncomeRows = byCategory.filter((r) => r.accountType === "income" && r.depth === 1 && r.totalCents > 0);
  const totalExpense = topExpenseRows.reduce((s, r) => s + r.totalCents, 0);
  const totalIncome = topIncomeRows.reduce((s, r) => s + r.totalCents, 0);
  const allExpenseRows = byCategory.filter((r) => r.accountType === "expense" && r.totalCents > 0);

  return (
    <div>
      <h1>Auswertungen</h1>
      {error && <div className="error-banner">{error}</div>}

      <div className="card form-row">
        <label>
          Von
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label>
          Bis
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
      </div>

      <div className="card">
        <div className="grid grid-3">
          <div className="stat">
            <span className="label">Einnahmen</span>
            <span className="value amount-positive">{formatCents(totalIncome)}</span>
          </div>
          <div className="stat">
            <span className="label">Ausgaben</span>
            <span className="value amount-negative">{formatCents(totalExpense)}</span>
          </div>
          <div className="stat">
            <span className="label">Saldo</span>
            <span className="value">{formatCents(totalIncome - totalExpense)}</span>
          </div>
        </div>
      </div>

      <div className="card">
        <h2>Ausgaben nach Kategorie</h2>
        {topExpenseRows.length === 0 ? (
          <p className="muted">Keine Ausgaben im Zeitraum.</p>
        ) : (
          <ResponsiveContainer width="100%" height={Math.max(200, topExpenseRows.length * 40)}>
            <BarChart data={topExpenseRows} layout="vertical" margin={{ left: 40 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
              <XAxis type="number" tickFormatter={(v) => formatCents(v as number)} />
              <YAxis type="category" dataKey="accountName" width={140} />
              <Tooltip formatter={(v: number) => formatCents(v)} />
              <Bar dataKey="totalCents">
                {topExpenseRows.map((_, i) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
        <p className="muted" style={{ fontSize: "0.85rem", marginTop: "0.5rem" }}>
          Jeder Balken enthält bereits alle Unterkategorien. Details je Ebene siehe Tabelle unten.
        </p>
      </div>

      <div className="card">
        <h2>Ausgaben — alle Ebenen</h2>
        {allExpenseRows.length === 0 ? (
          <p className="muted">Keine Ausgaben im Zeitraum.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Kategorie</th>
                <th>Summe (inkl. Unterkonten)</th>
              </tr>
            </thead>
            <tbody>
              {allExpenseRows.map((r) => (
                <tr key={r.accountId}>
                  <td style={{ paddingLeft: `${(r.depth - 1) * 1.25}rem` }}>{r.accountName}</td>
                  <td>{formatCents(r.totalCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h2>Nach Zahlungsempfänger</h2>
        {byPayee.filter((p) => p.expenseTotalCents > 0 || p.incomeTotalCents > 0).length === 0 ? (
          <p className="muted">Keine Daten im Zeitraum.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Zahlungsempfänger</th>
                <th>Ausgaben</th>
                <th>Einnahmen</th>
              </tr>
            </thead>
            <tbody>
              {byPayee
                .filter((p) => p.expenseTotalCents > 0 || p.incomeTotalCents > 0)
                .map((p) => (
                  <tr key={p.payeeId}>
                    <td>{p.payeeName}</td>
                    <td>{p.expenseTotalCents > 0 ? formatCents(p.expenseTotalCents) : "—"}</td>
                    <td>{p.incomeTotalCents > 0 ? formatCents(p.incomeTotalCents) : "—"}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
