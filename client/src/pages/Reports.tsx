import { useEffect, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer, Cell } from "recharts";
import {
  api,
  AccountNode,
  CategoryReportRow,
  MoneyUsageBucket,
  MoneyUsageReport,
  PayeeReportRow,
  ReportAccountConfig,
  flattenAccounts,
  formatCents,
} from "../api";

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

      <MoneyUsageSection from={from} to={to} />

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

const BUCKET_LABELS: Record<MoneyUsageBucket, string> = {
  einnahmen: "Einnahmen",
  vermoegensaufloesung: "Vermögensauflösung",
  kreditaufnahme: "Kreditaufnahme",
  konsum: "Konsum (Aufwendungen)",
  vermoegensbildung: "Vermögensbildung (Sparen/Vorsorge)",
  tilgung: "Schuldentilgung",
  eigenkapital: "Eigenkapital",
};

const HERKUNFT_ORDER: MoneyUsageBucket[] = ["einnahmen", "vermoegensaufloesung", "kreditaufnahme", "eigenkapital"];
const VERWENDUNG_ORDER: MoneyUsageBucket[] = ["konsum", "vermoegensbildung", "tilgung", "eigenkapital"];

const LIQUID_STORAGE_KEY = "fintracker.moneyUsage.liquidAccounts";

function MoneyUsageSection({ from, to }: { from: string; to: string }) {
  const [liquidRoots, setLiquidRoots] = useState<AccountNode[]>([]);
  const [selected, setSelected] = useState<number[]>(() => {
    try {
      const raw = localStorage.getItem(LIQUID_STORAGE_KEY);
      return raw ? (JSON.parse(raw) as number[]) : [];
    } catch {
      return [];
    }
  });
  const [configs, setConfigs] = useState<ReportAccountConfig[]>([]);
  const [configName, setConfigName] = useState("");
  const [report, setReport] = useState<MoneyUsageReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadConfigs = () => api.getReportConfigs().then(setConfigs).catch((e) => setError(e.message));

  useEffect(() => {
    api
      .getAccountsTree()
      .then((tree) => setLiquidRoots(tree.filter((n) => n.type === "asset" || n.type === "liability")))
      .catch((e) => setError(e.message));
    loadConfigs();
  }, []);

  useEffect(() => {
    localStorage.setItem(LIQUID_STORAGE_KEY, JSON.stringify(selected));
  }, [selected]);

  useEffect(() => {
    if (selected.length === 0) {
      setReport(null);
      return;
    }
    api
      .getMoneyUsage(selected, from, to)
      .then(setReport)
      .catch((e) => setError(e.message));
  }, [selected, from, to]);

  const toggle = (id: number) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const treeRows = liquidRoots.flatMap((root) => flattenAccounts([root]));

  const saveConfig = async () => {
    if (!configName.trim()) {
      setError("Bitte einen Namen für die Konfiguration angeben.");
      return;
    }
    if (selected.length === 0) {
      setError("Bitte zuerst liquide Konten markieren.");
      return;
    }
    try {
      await api.createReportConfig({ name: configName.trim(), accountIds: selected });
      setConfigName("");
      setError(null);
      loadConfigs();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const loadConfig = (id: number) => {
    const cfg = configs.find((c) => c.id === id);
    if (cfg) setSelected(cfg.accountIds);
  };

  const removeConfig = async (id: number) => {
    await api.deleteReportConfig(id);
    loadConfigs();
  };

  const herkunft = report?.rows.filter((r) => r.direction === "herkunft") ?? [];
  const verwendung = report?.rows.filter((r) => r.direction === "verwendung") ?? [];
  const totalHerkunft = herkunft.reduce((s, r) => s + r.amountCents, 0);
  const totalVerwendung = verwendung.reduce((s, r) => s + r.amountCents, 0);

  const groupByBucket = (rows: typeof herkunft, order: MoneyUsageBucket[]) =>
    order
      .map((bucket) => ({
        bucket,
        rows: rows.filter((r) => r.bucket === bucket),
      }))
      .filter((g) => g.rows.length > 0)
      .map((g) => ({ ...g, total: g.rows.reduce((s, r) => s + r.amountCents, 0) }));

  const herkunftGroups = groupByBucket(herkunft, HERKUNFT_ORDER);
  const verwendungGroups = groupByBucket(verwendung, VERWENDUNG_ORDER);

  return (
    <div className="card">
      <h2>Geldverwendung — Wohin fließt mein Geld?</h2>
      <p className="muted" style={{ fontSize: "0.85rem" }}>
        Geldfluss über die gewählten liquiden Konten. Anders als „Ausgaben nach Kategorie" (nur echter Verbrauch)
        erfasst diese Auswertung sämtliche Abflüsse — auch Vermögensbildung (Sparen/Vorsorge) und Schuldentilgung,
        die das Geld nicht verbrauchen, sondern nur umschichten bzw. Verbindlichkeiten abbauen.
      </p>

      {error && <div className="error-banner">{error}</div>}

      {configs.length > 0 && (
        <div className="form-row" style={{ alignItems: "end" }}>
          <label>
            Konfiguration laden
            <select value="" onChange={(e) => e.target.value && loadConfig(Number(e.target.value))}>
              <option value="">wählen…</option>
              {configs.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem", alignItems: "end", paddingBottom: "0.2rem" }}>
            {configs.map((c) => (
              <span key={c.id} className="pill" style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem" }}>
                {c.name}
                <button
                  type="button"
                  className="secondary"
                  onClick={() => removeConfig(c.id)}
                  style={{ padding: "0 0.35rem", fontSize: "0.7rem", lineHeight: 1.4 }}
                  title="Konfiguration löschen"
                >
                  ✕
                </button>
              </span>
            ))}
          </div>
        </div>
      )}

      <div style={{ margin: "0.75rem 0" }}>
        <div style={{ fontSize: "0.85rem", color: "var(--muted)", marginBottom: "0.35rem" }}>
          Liquide Konten (ein markiertes Konto schließt seine Unterkonten mit ein)
        </div>
        {treeRows.length === 0 ? (
          <span className="muted">Keine Aktiva-/Passiva-Konten vorhanden.</span>
        ) : (
          <div>
            {treeRows.map(({ node, depth }) => (
              <label
                key={node.id}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: "0.4rem",
                  color: "var(--text)",
                  padding: "0.15rem 0",
                  paddingLeft: `${depth * 1.25}rem`,
                }}
              >
                <input type="checkbox" checked={selected.includes(node.id)} onChange={() => toggle(node.id)} />
                {node.name}
              </label>
            ))}
          </div>
        )}
      </div>

      <div className="form-row" style={{ alignItems: "end" }}>
        <label>
          Auswahl als Konfiguration speichern
          <input value={configName} onChange={(e) => setConfigName(e.target.value)} placeholder="z. B. Liquide Mittel" />
        </label>
        <button type="button" className="secondary" style={{ alignSelf: "end" }} onClick={saveConfig}>
          Auswahl speichern
        </button>
      </div>

      {selected.length === 0 ? (
        <p className="muted">Bitte liquide Konten wählen (z. B. Girokonto, Kreditkarte, PayPal, Bargeld).</p>
      ) : !report || report.rows.length === 0 ? (
        <p className="muted">Keine Geldbewegungen im Zeitraum.</p>
      ) : (
        <>
          <table>
            <tbody>
              <tr>
                <td colSpan={2} style={{ fontWeight: 600 }}>Mittelherkunft (Zuflüsse)</td>
              </tr>
              {herkunftGroups.map((g) => (
                <MoneyUsageBucketRows key={g.bucket} bucket={g.bucket} total={g.total} rows={g.rows} />
              ))}
              <tr>
                <td style={{ fontWeight: 600 }}>Summe Zuflüsse</td>
                <td style={{ fontWeight: 600 }} className="amount-positive">{formatCents(totalHerkunft)}</td>
              </tr>

              <tr>
                <td colSpan={2} style={{ fontWeight: 600, paddingTop: "1rem" }}>Mittelverwendung (Abflüsse)</td>
              </tr>
              {verwendungGroups.map((g) => (
                <MoneyUsageBucketRows key={g.bucket} bucket={g.bucket} total={g.total} rows={g.rows} />
              ))}
              <tr>
                <td style={{ fontWeight: 600 }}>Summe Abflüsse</td>
                <td style={{ fontWeight: 600 }} className="amount-negative">{formatCents(totalVerwendung)}</td>
              </tr>

              <tr>
                <td style={{ fontWeight: 700, paddingTop: "1rem" }}>Netto-Veränderung liquider Bestand</td>
                <td style={{ fontWeight: 700, paddingTop: "1rem" }}>{formatCents(report.netChangeCents)}</td>
              </tr>
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

function MoneyUsageBucketRows({
  bucket,
  total,
  rows,
}: {
  bucket: MoneyUsageBucket;
  total: number;
  rows: { accountId: number; accountName: string; amountCents: number }[];
}) {
  return (
    <>
      <tr>
        <td style={{ paddingLeft: "1.25rem" }}>{BUCKET_LABELS[bucket]}</td>
        <td>{formatCents(total)}</td>
      </tr>
      {rows.map((r) => (
        <tr key={r.accountId}>
          <td style={{ paddingLeft: "2.75rem" }} className="muted">{r.accountName}</td>
          <td className="muted">{formatCents(r.amountCents)}</td>
        </tr>
      ))}
    </>
  );
}
