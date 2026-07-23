import { useEffect, useState } from "react";
import { api, AccountNode, ImportFieldMapping, ImportTemplate, ImportTemplateMapping, flattenAccounts, formatCents } from "../api";
import AccountSelect from "../components/AccountSelect";

interface PreviewRow {
  rowIndex: number;
  date: string | null;
  rawDate: string;
  amountCents: number | null;
  description: string;
  payeeName: string | null;
  categoryAccountId: number | "";
  suggestionSource: "payee" | "similarBooking" | null;
  similarBookingOf: { transactionId: number; date: string; description: string | null } | null;
  possibleDuplicate: boolean;
  duplicateOf: { transactionId: number; date: string; description: string | null } | null;
  valid: boolean;
}

export default function Import() {
  const [step, setStep] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [tree, setTree] = useState<AccountNode[]>([]);
  const [templates, setTemplates] = useState<ImportTemplate[]>([]);

  const [csvText, setCsvText] = useState("");
  const [delimiter, setDelimiter] = useState(",");
  const [headers, setHeaders] = useState<string[]>([]);
  const [hasHeader, setHasHeader] = useState(true);
  const [skipRows, setSkipRows] = useState(0);

  const [dateCol, setDateCol] = useState<number | "">("");
  const [amountCol, setAmountCol] = useState<number | "">("");
  const [descriptionCol, setDescriptionCol] = useState<number | "">("");
  const [payeeCol, setPayeeCol] = useState<number | "">("");
  const [selectedTemplateId, setSelectedTemplateId] = useState<number | "">("");
  const [templateName, setTemplateName] = useState("");

  const [rows, setRows] = useState<PreviewRow[]>([]);
  const [defaultAccountId, setDefaultAccountId] = useState<number | "">("");
  const [result, setResult] = useState<number | null>(null);

  useEffect(() => {
    api.getAccountsTree().then(setTree).catch((e) => setError(e.message));
    api.getImportTemplates().then(setTemplates).catch((e) => setError(e.message));
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

  const applyTemplate = (template: ImportTemplate, fileHeaders: string[]) => {
    const resolve = (fm: ImportFieldMapping | undefined): number | "" => {
      if (!fm) return "";
      if (template.hasHeader && fm.header) {
        const idx = fileHeaders.findIndex((h) => h.trim().toLowerCase() === fm.header!.trim().toLowerCase());
        if (idx !== -1) return idx;
      }
      return fm.index < fileHeaders.length ? fm.index : "";
    };
    setDelimiter(template.delimiter);
    setHasHeader(template.hasHeader);
    setSkipRows(template.skipRows);
    setDateCol(resolve(template.mapping.date));
    setAmountCol(resolve(template.mapping.amount));
    setDescriptionCol(resolve(template.mapping.description));
    setPayeeCol(resolve(template.mapping.payee));
    if (template.defaultAccountId) setDefaultAccountId(template.defaultAccountId);
  };

  const onSelectTemplate = async (id: number) => {
    setSelectedTemplateId(id);
    const template = templates.find((t) => t.id === id);
    if (!template) return;
    try {
      const parsed = await api.importParse(csvText, template.skipRows);
      setHeaders(parsed.headers);
      applyTemplate(template, parsed.headers);
      setError(null);
    } catch (e: any) {
      setError(e.message);
    }
  };

  const updateSkipRows = async (displayValue: number) => {
    const newSkip = Math.max(0, Math.round(displayValue) - 1);
    setSkipRows(newSkip);
    try {
      const parsed = await api.importParse(csvText, newSkip);
      setDelimiter(parsed.delimiter);
      setHeaders(parsed.headers);
      setError(null);
    } catch (e: any) {
      setError(e.message);
    }
  };

  const removeTemplate = async (id: number) => {
    await api.deleteImportTemplate(id);
    setTemplates((ts) => ts.filter((t) => t.id !== id));
    if (selectedTemplateId === id) setSelectedTemplateId("");
  };

  const goPreview = async () => {
    if (dateCol === "" || amountCol === "") {
      setError("Datum- und Betrag-Spalte sind erforderlich.");
      return;
    }
    if (!defaultAccountId) {
      setError("Bitte das Konto wählen, zu dem diese CSV gehört.");
      return;
    }
    try {
      const mapping: any = { date: dateCol, amount: amountCol };
      if (descriptionCol !== "") mapping.description = descriptionCol;
      if (payeeCol !== "") mapping.payee = payeeCol;
      const res = await api.importPreview({ csvText, delimiter, hasHeader, mapping, defaultAccountId, skipRows });
      setRows(
        res.rows.map((r) => ({
          ...r,
          categoryAccountId: r.possibleDuplicate ? "" : r.suggestedCategoryAccountId ?? "",
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
    if (validRows.length === 0) {
      setError("Keine Zeilen zum Importieren ausgewählt — allen Zeilen fehlt eine Kategorie (ggf. wurden sie als mögliches Duplikat übersprungen).");
      return;
    }
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

  const saveTemplate = async () => {
    if (!templateName.trim()) {
      setError("Bitte einen Namen für die Vorlage angeben.");
      return;
    }
    const fieldMapping = (col: number | ""): ImportFieldMapping | undefined => {
      if (col === "") return undefined;
      return { index: col, header: hasHeader ? columnOptions[col]?.label ?? null : null };
    };
    const mapping: ImportTemplateMapping = {
      date: fieldMapping(dateCol)!,
      amount: fieldMapping(amountCol)!,
      description: fieldMapping(descriptionCol),
      payee: fieldMapping(payeeCol),
    };
    try {
      await api.createImportTemplate({
        name: templateName.trim(),
        delimiter,
        hasHeader,
        skipRows,
        mapping,
        defaultAccountId: defaultAccountId || null,
      });
      setTemplateName("");
      setTemplates(await api.getImportTemplates());
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
    setSkipRows(0);
    setDefaultAccountId("");
    setSelectedTemplateId("");
    setTemplateName("");
  };

  const columnOptions = headers.map((h, i) => ({ index: i, label: hasHeader ? h : `Spalte ${i + 1}` }));
  const flatAccounts = flattenAccounts(tree);
  const accountName = (id: number) => flatAccounts.find((a) => a.node.id === id)?.node.name ?? "?";
  const validRowCount = rows.filter((r) => r.valid && r.categoryAccountId !== "").length;

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
          <h2>2. Konto & Spalten zuordnen</h2>

          <div className="form-row">
            <label>
              Ziel-Konto (zu dem diese CSV gehört)
              <AccountSelect tree={tree} value={defaultAccountId} onChange={setDefaultAccountId} filterType={["asset", "liability"]} />
            </label>
          </div>

          {templates.length > 0 && (
            <div className="form-row">
              <label>
                Vorlage anwenden
                <select
                  value={selectedTemplateId}
                  onChange={(e) => onSelectTemplate(Number(e.target.value))}
                >
                  <option value="" disabled>
                    wählen…
                  </option>
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem", alignItems: "end", paddingBottom: "0.2rem" }}>
                {templates.map((t) => (
                  <span key={t.id} className="pill" style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem" }}>
                    {t.name}
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => removeTemplate(t.id)}
                      style={{ padding: "0 0.35rem", fontSize: "0.7rem", lineHeight: 1.4 }}
                      title="Vorlage löschen"
                    >
                      ✕
                    </button>
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="form-row">
            <label>
              Erste Zeile
              <input
                type="number"
                min={1}
                value={skipRows + 1}
                onChange={(e) => updateSkipRows(Number(e.target.value))}
                style={{ width: "5rem" }}
              />
            </label>
            <label>
              <input type="checkbox" checked={hasHeader} onChange={(e) => setHasHeader(e.target.checked)} />
              {" "}Diese Zeile ist die Überschrift
            </label>
          </div>
          <p className="muted" style={{ marginTop: "-0.5rem" }}>
            Bei Exports mit Metadaten vor der eigentlichen Tabelle (z. B. MLP Banking AG: Überschriften erst ab Zeile 15) hier die Zeilennummer der Überschrift bzw. ersten Datenzeile eintragen.
          </p>
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

          <div className="form-row">
            <label>
              Als Vorlage speichern
              <input
                value={templateName}
                onChange={(e) => setTemplateName(e.target.value)}
                placeholder="z. B. Sparkasse Girokonto"
              />
            </label>
            <button type="button" className="secondary" style={{ alignSelf: "end" }} onClick={saveTemplate}>
              Vorlage speichern
            </button>
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
            <h2>3. Kategorien prüfen</h2>
            <p className="muted">
              Ziel-Konto: <strong>{defaultAccountId ? accountName(defaultAccountId) : "—"}</strong>
            </p>
          </div>
          <div className="card import-table">
            <table>
              <thead>
                <tr>
                  <th>Datum</th>
                  <th>Betrag</th>
                  <th>Beschreibung</th>
                  <th>Zahlungsempfänger</th>
                  <th>Kategorie / Gegenkonto</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.rowIndex}
                    style={{
                      opacity: r.valid ? 1 : 0.4,
                      background: r.possibleDuplicate ? "rgba(220,38,38,0.07)" : undefined,
                    }}
                  >
                    <td>{r.date ?? `ungültig: ${r.rawDate}`}</td>
                    <td>{r.amountCents !== null ? formatCents(r.amountCents) : "ungültig"}</td>
                    <td>{r.description}</td>
                    <td>{r.payeeName ?? "—"}</td>
                    <td>
                      <AccountSelect
                        tree={tree}
                        value={r.categoryAccountId}
                        onChange={(id) => updateRowCategory(r.rowIndex, id)}
                        excludeId={defaultAccountId || undefined}
                      />
                    </td>
                    <td>
                      {r.possibleDuplicate && r.duplicateOf && (
                        <span
                          className="balance-warning"
                          title={`Vermutlich bereits vorhanden: ${r.duplicateOf.date}${r.duplicateOf.description ? " – " + r.duplicateOf.description : ""}`}
                        >
                          ⚠ evtl. Duplikat
                        </span>
                      )}
                      {!r.possibleDuplicate && r.suggestionSource === "similarBooking" && r.similarBookingOf && (
                        <span
                          className="pill"
                          title={`Vorschlag anhand ähnlicher Buchung vom ${r.similarBookingOf.date}${r.similarBookingOf.description ? ": „" + r.similarBookingOf.description + "“" : ""}`}
                        >
                          ähnliche Buchung
                        </span>
                      )}
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
            <button onClick={commit} disabled={validRowCount === 0}>
              {validRowCount} Buchungen importieren
            </button>
          </div>
          {result !== null && <p>{result} Buchungen wurden importiert. <button className="secondary" onClick={reset}>Neuer Import</button></p>}
        </div>
      )}
    </div>
  );
}
