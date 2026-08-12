import { useEffect, useState } from "react";
import { api, ImportTemplate, ReportAccountConfig } from "../api";

export default function Settings() {
  const [templates, setTemplates] = useState<ImportTemplate[]>([]);
  const [configs, setConfigs] = useState<ReportAccountConfig[]>([]);
  const [error, setError] = useState<string | null>(null);

  const loadTemplates = () => api.getImportTemplates().then(setTemplates).catch((e) => setError(e.message));
  const loadConfigs = () => api.getReportConfigs().then(setConfigs).catch((e) => setError(e.message));

  useEffect(() => {
    loadTemplates();
    loadConfigs();
  }, []);

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
