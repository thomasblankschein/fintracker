import { useEffect, useState } from "react";
import {
  AccountNode,
  api,
  formatCents,
  ImportExclusion,
  ImportTemplate,
  MobileDevice,
  MobileDeviceEnrollment,
  ReportAccountConfig,
} from "../api";
import AccountSelect from "../components/AccountSelect";

// SQLite liefert UTC ohne Zeitzone ("YYYY-MM-DD HH:MM:SS")
const formatUtc = (value: string | null) =>
  value ? new Date(value.replace(" ", "T") + "Z").toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" }) : "—";

const STATUS_LABEL: Record<MobileDevice["status"], string> = {
  pending: "Wartet auf Kopplung",
  expired: "Code abgelaufen",
  active: "Aktiv",
  revoked: "Widerrufen",
};

export default function Settings() {
  const [templates, setTemplates] = useState<ImportTemplate[]>([]);
  const [configs, setConfigs] = useState<ReportAccountConfig[]>([]);
  const [exclusions, setExclusions] = useState<ImportExclusion[]>([]);
  const [devices, setDevices] = useState<MobileDevice[]>([]);
  const [tree, setTree] = useState<AccountNode[]>([]);
  const [deviceName, setDeviceName] = useState("");
  const [deviceAccountId, setDeviceAccountId] = useState<number | "">("");
  const [enrollment, setEnrollment] = useState<(MobileDeviceEnrollment & { name: string }) | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadTemplates = () => api.getImportTemplates().then(setTemplates).catch((e) => setError(e.message));
  const loadConfigs = () => api.getReportConfigs().then(setConfigs).catch((e) => setError(e.message));

  const loadExclusions = () => api.getImportExclusions().then(setExclusions).catch((e) => setError(e.message));

  const loadDevices = () => api.getMobileDevices().then(setDevices).catch((e) => setError(e.message));

  useEffect(() => {
    loadTemplates();
    loadConfigs();
    loadExclusions();
    loadDevices();
    api.getAccountsTree().then(setTree).catch((e) => setError(e.message));
  }, []);

  // Solange ein Kopplungscode angezeigt wird, den Status nachziehen (Gerät koppelt sich)
  useEffect(() => {
    if (!enrollment) return;
    const timer = window.setInterval(loadDevices, 4000);
    return () => window.clearInterval(timer);
  }, [enrollment]);

  const addDevice = async () => {
    if (!deviceName.trim() || deviceAccountId === "") return;
    try {
      const result = await api.createMobileDevice({ name: deviceName.trim(), accountId: deviceAccountId });
      setEnrollment({ ...result, name: deviceName.trim() });
      setDeviceName("");
      setError(null);
      loadDevices();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const revokeDevice = async (d: MobileDevice) => {
    const text =
      d.status === "active"
        ? `Gerät „${d.name}" widerrufen? Es kann danach nichts mehr erfassen. Bereits erfasste Buchungen bleiben erhalten.`
        : `Kopplungscode für „${d.name}" ungültig machen?`;
    if (!window.confirm(text)) return;
    try {
      await api.revokeMobileDevice(d.id);
      if (enrollment?.id === d.id) setEnrollment(null);
      loadDevices();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const removeDevice = async (id: number) => {
    try {
      await api.removeMobileDevice(id);
      loadDevices();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const deleteExclusion = async (id: number) => {
    await api.deleteImportExclusion(id);
    loadExclusions();
  };

  const renameTemplate = async (id: number, name: string) => {
    try {
      await api.updateImportTemplate(id, name);
      setError(null);
      loadTemplates();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const deleteTemplate = async (id: number) => {
    await api.deleteImportTemplate(id);
    loadTemplates();
  };

  const renameConfig = async (id: number, name: string) => {
    try {
      await api.updateReportConfig(id, name);
      setError(null);
      loadConfigs();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const deleteConfig = async (id: number) => {
    await api.deleteReportConfig(id);
    loadConfigs();
  };

  return (
    <div>
      <h1>Einstellungen</h1>
      {error && <div className="error-banner">{error}</div>}

      <div className="card">
        <h2>Mobile Geräte (iPhone-Erfassung)</h2>
        <p className="muted">
          Erfassen von Bargeld-Ausgaben unterwegs. Jedes Gerät bucht immer auf sein festes Konto und kann sonst nichts
          sehen oder ändern. Zum Koppeln wird einmalig ein Code erzeugt.
        </p>

        {enrollment && (
          <div className="card" style={{ background: "var(--accent-soft)" }}>
            <strong>Kopplungscode für „{enrollment.name}"</strong>
            <div style={{ fontSize: "2rem", fontWeight: 700, letterSpacing: "0.15em", margin: "0.4rem 0" }}>
              {enrollment.code}
            </div>
            <ol style={{ margin: "0 0 0.5rem 1.2rem", padding: 0 }}>
              <li>Auf dem iPhone die mobile Adresse im Safari öffnen und über „Teilen → Zum Home-Bildschirm" ablegen.</li>
              <li>Die App vom Home-Bildschirm starten.</li>
              <li>
                Den Code eintippen. Er gilt {enrollment.validMinutes} Minuten und nur einmal, danach ist er hier
                verschwunden.
              </li>
            </ol>
            <button className="secondary" onClick={() => setEnrollment(null)}>
              Code ausblenden
            </button>
          </div>
        )}

        {devices.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Konto</th>
                <th>Status</th>
                <th>Zuletzt genutzt</th>
                <th>Einträge</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {devices.map((d) => (
                <tr key={d.id}>
                  <td>{d.name}</td>
                  <td>{d.accountName}</td>
                  <td>
                    {STATUS_LABEL[d.status]}
                    {d.status === "pending" && <span className="muted"> (bis {formatUtc(d.enrollExpiresAt)})</span>}
                  </td>
                  <td>{formatUtc(d.lastUsedAt)}</td>
                  <td>{d.entryCount}</td>
                  <td>
                    {d.status === "revoked" ? (
                      <button className="secondary" onClick={() => removeDevice(d.id)}>
                        Entfernen
                      </button>
                    ) : (
                      <button className="danger" onClick={() => revokeDevice(d)}>
                        {d.status === "active" ? "Widerrufen" : "Code ungültig machen"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <h3 style={{ marginBottom: "0.5rem" }}>Gerät hinzufügen</h3>
        <div className="form-row">
          <label>
            Name
            <input
              value={deviceName}
              maxLength={60}
              placeholder="z. B. iPhone Thomas"
              onChange={(e) => setDeviceName(e.target.value)}
            />
          </label>
          <label>
            Bargeldkonto
            <AccountSelect
              tree={tree}
              value={deviceAccountId}
              onChange={setDeviceAccountId}
              filterType={["asset"]}
              placeholder="Konto wählen"
            />
          </label>
          <button
            style={{ alignSelf: "flex-end" }}
            disabled={!deviceName.trim() || deviceAccountId === ""}
            onClick={addDevice}
          >
            Kopplungscode erzeugen
          </button>
        </div>
      </div>

      <div className="card">
        <h2>CSV-Import-Vorlagen</h2>
        {templates.length === 0 ? (
          <p className="muted">Noch keine Vorlagen.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {templates.map((t) => (
                <NameRow key={t.id} id={t.id} name={t.name} onRename={renameTemplate} onDelete={deleteTemplate} />
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h2>Geldverwendungs-Konfigurationen</h2>
        {configs.length === 0 ? (
          <p className="muted">Noch keine Konfigurationen.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {configs.map((c) => (
                <NameRow key={c.id} id={c.id} name={c.name} onRename={renameConfig} onDelete={deleteConfig} />
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h2>Ausgeschlossene Import-Zeilen</h2>
        {exclusions.length === 0 ? (
          <p className="muted">Noch keine ausgeschlossenen Zeilen.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Konto</th>
                <th>Datum</th>
                <th>Betrag</th>
                <th>Beschreibung</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {exclusions.map((e) => (
                <tr key={e.id}>
                  <td>{e.accountName}</td>
                  <td style={{ whiteSpace: "nowrap" }}>{e.date}</td>
                  <td>{formatCents(e.amountCents)}</td>
                  <td>{e.description || "—"}</td>
                  <td>
                    <button className="danger" onClick={() => deleteExclusion(e.id)}>
                      Löschen
                    </button>
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

function NameRow({
  id,
  name,
  onRename,
  onDelete,
}: {
  id: number;
  name: string;
  onRename: (id: number, name: string) => void;
  onDelete: (id: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);

  const startEdit = () => {
    setDraft(name);
    setEditing(true);
  };

  const save = () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== name) {
      onRename(id, trimmed);
    }
    setEditing(false);
  };

  return (
    <tr>
      <td>
        {editing ? (
          <input
            value={draft}
            autoFocus
            onChange={(e) => setDraft(e.target.value)}
            onBlur={save}
            onKeyDown={(e) => {
              if (e.key === "Enter") save();
              if (e.key === "Escape") setEditing(false);
            }}
          />
        ) : (
          name
        )}
      </td>
      <td>
        <div className="actions">
          <button className="secondary" onClick={startEdit}>
            Umbenennen
          </button>
          <button className="danger" onClick={() => onDelete(id)}>
            Löschen
          </button>
        </div>
      </td>
    </tr>
  );
}
