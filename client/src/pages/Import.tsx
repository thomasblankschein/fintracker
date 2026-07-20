import { useEffect, useState } from "react";
import { api, AccountNode, formatCents } from "../api";
import AccountSelect from "../components/AccountSelect";

interface PreviewRow {
  rowIndex: number;
  date: string | null;
  rawDate: string;
  amountCents: number | null;
  description: string;
  payeeName: string | null;
  categoryAccountId: number | "";
  valid: boolean;
}

export default function Import() {
  const [step, setStep] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [tree, setTree] = useState<AccountNode[]>([]);

  const [csvText, setCsvText] = useState("");
  const [delimiter, setDelimiter] = useState(",");
  const [headers, setHeaders] = useState<string[]>([]);
  const [hasHeader, setHasHeader] = useState(true);

  const [dateCol, setDateCol] = useState<number | "">("");
  const [amountCol, setAmountCol] = useState<number | "">("");
  const [descriptionCol, setDescriptionCol] = useState<number | "">("");
  const [payeeCol, setPayeeCol] = useState<number | "">("");

  const [rows, setRows] = useState<PreviewRow[]>([]);
  const [defaultAccountId, setDefaultAccountId] = useState<number | "">("");
  const [result, setResult] = useState<number | null>(null);

  useEffect(() => {
    api.getAccountsTree().then(setTree).catch((e) => setError(e.message));
  }, []);

  const onFile = async (file: File) => {
    const text = await file.text();
    setCsvText(text);
    try {
      const parsed = await api.importParse(text);
      setDelimiter(parsed.delimiter);
      setHeaders(parsed.headers);
      setStep(2);
      setError(null);
    } catch (e: any) {
      setError(e.message);
    }
  };

  const goPreview = async () => {
    if (dateCol === "" || amountCol === "") {
      setError("Datum- und Betrag-Spalte sind erforderlich.");
      return;
    }
    try {
      const mapping: any = { date: dateCol, amount: amountCol };
      if (descriptionCol !== "") mapping.description = descriptionCol;
      if (payeeCol !== "") mapping.payee = payeeCol;
      const res = await api.importPreview({ csvText, delimiter, hasHeader, mapping });
      setRows(
        res.rows.map((r) => ({
          ...r,
          categoryAccountId: r.suggestedCategoryAccountId ?? "",
        }))
      );
      setStep(3);
      setError(null);
    } catch (e: any) {
      setError(e.message);
    }
  };

  const updateRowCategory = (rowIndex: number, categoryAccountId: number) => {
    setRows((rs) => rs.map((r) => (r.rowIndex === rowIndex ? { ...r, categoryAccountId } : r)));
  };

  const commit = async () => {
    if (!defaultAccountId) {
      setError("Bitte das Konto wählen, zu dem diese CSV gehört.");
      return;
    }
    const validRows = rows.filter((r) => r.valid && r.categoryAccountId !== "" && r.date && r.amountCents !== null);
    try {
      const res = await api.importCommit({
        defaultAccountId: defaultAccountId as number,
        rows: validRows.map((r) => ({
          date: r.date as string,
          amountCents: r.amountCents as number,
          description: r.description,
          payeeName: r.payeeName,
          categoryAccountId: r.categoryAccountId as number,
        })),
      });
      setResult(res.created);
      setError(null);
    } catch (e: any) {
      setError(e.message);
    }
  };

  const reset = () => {
    setStep(1);
    setCsvText("");
    setHeaders([]);
    setRows([]);
    setResult(null);
    setDateCol("");
    setAmountCol("");
    setDescriptionCol("");
    setPayeeCol("");
    setDefaultAccountId("");
  };

  const columnOptions = headers.map((h, i) => ({ index: i, label: hasHeader ? h : `Spalte ${i + 1}` }));

  return (
    <div>
      <h1>CSV-Import</h1>
      {error && <div className="error-banner">{error}</div>}

      {step === 1 && (
        <div className="card">
          <h2>1. Datei wählen</h2>
          <input
            type="file"
            accept=".csv,.txt"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onFile(file);
            }}
          />
        </div>
      )}

      {step === 2 && (
        <div className="card">
          <h2>2. Spalten zuordnen</h2>
          <div className="form-row">
            <label>
              <input type="checkbox" checked={hasHeader} onChange={(e) => setHasHeader(e.target.checked)} />
              {" "}Erste Zeile ist Überschrift
            </label>
          </div>
          <div className="form-row">
            <label>
              Datum-Spalte
              <select value={dateCol} onChange={(e) => setDateCol(Number(e.target.value))}>
                <option value="" disabled>
                  wählen…
                </option>
                {columnOptions.map((c) => (
                  <option key={c.index} value={c.index}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Betrag-Spalte
              <select value={amountCol} onChange={(e) => setAmountCol(Number(e.target.value))}>
                <option value="" disabled>
                  wählen…
                </option>
                {columnOptions.map((c) => (
                  <option key={c.index} value={c.index}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Beschreibung-Spalte (optional)
              <select value={descriptionCol} onChange={(e) => setDescriptionCol(e.target.value === "" ? "" : Number(e.target.value))}>
                <option value="">— keine —</option>
                {columnOptions.map((c) => (
                  <option key={c.index} value={c.index}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Zahlungsempfänger-Spalte (optional)
              <select value={payeeCol} onChange={(e) => setPayeeCol(e.target.value === "" ? "" : Number(e.target.value))}>
                <option value="">— keine —</option>
                {columnOptions.map((c) => (
                  <option key={c.index} value={c.index}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="actions">
            <button className="secondary" onClick={reset}>
              Zurück
            </button>
            <button onClick={goPreview}>Weiter</button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div>
          <div className="card">
            <h2>3. Konto & Kategorien</h2>
            <label>
              Ziel-Konto (zu dem diese CSV gehört)
              <AccountSelect tree={tree} value={defaultAccountId} onChange={setDefaultAccountId} filterType={["asset", "liability"]} />
            </label>
          </div>
          <div className="card import-table">
            <table>
              <thead>
                <tr>
                  <th>Datum</th>
                  <th>Betrag</th>
                  <th>Beschreibung</th>
                  <th>Zahlungsempfänger</th>
                  <th>Kategorie</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.rowIndex} style={{ opacity: r.valid ? 1 : 0.4 }}>
                    <td>{r.date ?? `ungültig: ${r.rawDate}`}</td>
                    <td>{r.amountCents !== null ? formatCents(r.amountCents) : "ungültig"}</td>
                    <td>{r.description}</td>
                    <td>{r.payeeName ?? "—"}</td>
                    <td>
                      <AccountSelect
                        tree={tree}
                        value={r.categoryAccountId}
                        onChange={(id) => updateRowCategory(r.rowIndex, id)}
                        filterType={["expense", "income"]}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="actions">
            <button className="secondary" onClick={reset}>
              Abbrechen
            </button>
            <button onClick={commit}>{rows.length} Buchungen importieren</button>
          </div>
          {result !== null && <p>{result} Buchungen wurden importiert. <button className="secondary" onClick={reset}>Neuer Import</button></p>}
        </div>
      )}
    </div>
  );
}
