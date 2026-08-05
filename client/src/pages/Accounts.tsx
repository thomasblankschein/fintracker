import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, AccountExportNode, AccountNode, AccountType, flattenAccounts, formatCents } from "../api";

const TYPE_LABELS: Record<AccountType, string> = {
  asset: "Aktiva",
  liability: "Passiva",
  equity: "Eigenkapital",
  income: "Erträge",
  expense: "Aufwendungen",
};

export default function Accounts() {
  const [tree, setTree] = useState<AccountNode[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<AccountType>("expense");
  const [parentId, setParentId] = useState<number | "">("");
  const [importResult, setImportResult] = useState<string | null>(null);

  const load = () => api.getAccountsTree().then(setTree).catch((e) => setError(e.message));

  useEffect(() => {
    load();
  }, []);

  const rootsOfType = (t: AccountType) => tree.filter((n) => n.type === t);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.createAccount({ name, type, parentId: parentId === "" ? null : parentId });
      setName("");
      setParentId("");
      setShowForm(false);
      load();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const toggleActive = async (node: AccountNode) => {
    await api.updateAccount(node.id, { isActive: !node.isActive });
    load();
  };

  const rename = async (node: AccountNode, newName: string) => {
    try {
      await api.updateAccount(node.id, { name: newName });
      load();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const startCreateChild = (node: AccountNode) => {
    setType(node.type);
    setParentId(node.id);
    setName("");
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const move = async (node: AccountNode, newParentId: number | null) => {
    try {
      await api.updateAccount(node.id, { parentId: newParentId });
      load();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const remove = async (node: AccountNode) => {
    try {
      await api.deleteAccount(node.id);
      load();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const exportAccounts = async () => {
    try {
      const data = await api.exportAccounts();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "kontenrahmen.json";
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const importAccounts = async (file: File) => {
    try {
      const text = await file.text();
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new Error("Datei ist kein gültiges JSON.");
      }
      if (!Array.isArray(parsed)) {
        throw new Error("Die Datei muss ein JSON-Array von Kontenrahmen-Knoten enthalten.");
      }
      const res = await api.importAccounts(parsed as AccountExportNode[]);
      setImportResult(`${res.created} Konto(en) neu angelegt, ${res.updated} aktualisiert.`);
      setError(null);
      load();
    } catch (err: any) {
      setImportResult(null);
      setError(err.message);
    }
  };

  const parentCandidates = flattenAccounts(tree).filter((entry) => entry.node.type === type);

  return (
    <div>
      <div className="toolbar">
        <h1>Kontenrahmen</h1>
        <div className="actions">
          <button className="secondary" onClick={exportAccounts}>
            Exportieren
          </button>
          <label className="btn secondary" style={{ cursor: "pointer" }}>
            Importieren
            <input
              type="file"
              accept=".json"
              style={{ display: "none" }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) importAccounts(file);
                e.target.value = "";
              }}
            />
          </label>
          <button onClick={() => setShowForm((s) => !s)}>{showForm ? "Abbrechen" : "Konto anlegen"}</button>
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}
      {importResult && (
        <div className="card">
          {importResult}{" "}
          <button className="secondary" onClick={() => setImportResult(null)}>
            OK
          </button>
        </div>
      )}

      {showForm && (
        <form className="card" onSubmit={submit}>
          <div className="form-row">
            <label>
              Name
              <input value={name} onChange={(e) => setName(e.target.value)} required />
            </label>
            <label>
              Typ
              <select
                value={type}
                onChange={(e) => {
                  setType(e.target.value as AccountType);
                  setParentId("");
                }}
              >
                {Object.entries(TYPE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Übergeordnetes Konto (optional)
              <select value={parentId} onChange={(e) => setParentId(e.target.value ? Number(e.target.value) : "")}>
                <option value="">— kein —</option>
                {parentCandidates.map(({ node, depth }) => (
                  <option key={node.id} value={node.id}>
                    {"  ".repeat(depth)}
                    {node.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <button type="submit">Speichern</button>
        </form>
      )}

      {Object.entries(TYPE_LABELS).map(([typeKey, label]) => (
        <div className="card" key={typeKey}>
          <h2>{label}</h2>
          {rootsOfType(typeKey as AccountType).length === 0 ? (
            <p className="muted">Keine Konten.</p>
          ) : (
            rootsOfType(typeKey as AccountType).map((node) => (
              <AccountRow
                key={node.id}
                node={node}
                depth={0}
                tree={tree}
                onToggle={toggleActive}
                onDelete={remove}
                onRename={rename}
                onMove={move}
                onAddChild={startCreateChild}
              />
            ))
          )}
        </div>
      ))}
    </div>
  );
}

function collectDescendantIds(node: AccountNode): Set<number> {
  const ids = new Set<number>();
  const walk = (n: AccountNode) => {
    for (const c of n.children) {
      ids.add(c.id);
      walk(c);
    }
  };
  walk(node);
  return ids;
}

function AccountRow({
  node,
  depth,
  tree,
  onToggle,
  onDelete,
  onRename,
  onMove,
  onAddChild,
}: {
  node: AccountNode;
  depth: number;
  tree: AccountNode[];
  onToggle: (n: AccountNode) => void;
  onDelete: (n: AccountNode) => void;
  onRename: (n: AccountNode, newName: string) => void;
  onMove: (n: AccountNode, newParentId: number | null) => void;
  onAddChild: (n: AccountNode) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(node.name);
  const [moving, setMoving] = useState(false);
  const navigate = useNavigate();

  const startEdit = () => {
    setDraft(node.name);
    setEditing(true);
  };

  const save = () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== node.name) {
      onRename(node, trimmed);
    }
    setEditing(false);
  };

  const moveCandidates = (() => {
    const descendantIds = collectDescendantIds(node);
    return flattenAccounts(tree).filter(
      ({ node: candidate }) => candidate.type === node.type && candidate.id !== node.id && !descendantIds.has(candidate.id)
    );
  })();

  return (
    <div className="tree-node">
      <div className="row" style={{ paddingLeft: `${depth * 1.25}rem` }}>
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
        ) : moving ? (
          <span style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
            <span className="muted">{node.name} →</span>
            <select
              autoFocus
              value={node.parentId ?? ""}
              onChange={(e) => {
                const value = e.target.value;
                onMove(node, value === "" ? null : Number(value));
                setMoving(false);
              }}
              onBlur={() => setMoving(false)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setMoving(false);
              }}
            >
              <option value="">— kein (Wurzel) —</option>
              {moveCandidates.map(({ node: candidate, depth: candidateDepth }) => (
                <option key={candidate.id} value={candidate.id}>
                  {"  ".repeat(candidateDepth)}
                  {candidate.name}
                </option>
              ))}
            </select>
          </span>
        ) : (
          <span style={{ opacity: node.isActive ? 1 : 0.5 }}>
            {node.name}
            {!node.isActive && <span className="pill" style={{ marginLeft: 8 }}>inaktiv</span>}
          </span>
        )}
        <div className="actions">
          <span className="muted">{formatCents(node.balance)}</span>
          <AccountMenu
            isActive={node.isActive}
            onRename={startEdit}
            onMove={() => setMoving(true)}
            onAddChild={() => onAddChild(node)}
            onViewTransactions={() => navigate(`/buchungen?account=${node.id}`)}
            onToggle={() => onToggle(node)}
            onDelete={() => onDelete(node)}
          />
        </div>
      </div>
      {node.children.map((child) => (
        <AccountRow
          key={child.id}
          node={child}
          depth={depth + 1}
          tree={tree}
          onToggle={onToggle}
          onDelete={onDelete}
          onRename={onRename}
          onMove={onMove}
          onAddChild={onAddChild}
        />
      ))}
    </div>
  );
}

function AccountMenu({
  isActive,
  onRename,
  onMove,
  onAddChild,
  onViewTransactions,
  onToggle,
  onDelete,
}: {
  isActive: boolean;
  onRename: () => void;
  onMove: () => void;
  onAddChild: () => void;
  onViewTransactions: () => void;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  const run = (fn: () => void) => {
    setOpen(false);
    fn();
  };

  return (
    <div className="menu" ref={ref}>
      <button type="button" className="icon-button" onClick={() => setOpen((o) => !o)} aria-label="Aktionen">
        ⋯
      </button>
      {open && (
        <div className="menu-dropdown">
          <button type="button" onClick={() => run(onRename)}>
            Umbenennen
          </button>
          <button type="button" onClick={() => run(onMove)}>
            Verschieben
          </button>
          <button type="button" onClick={() => run(onAddChild)}>
            Untergeordnetes Konto anlegen
          </button>
          <button type="button" onClick={() => run(onViewTransactions)}>
            Buchungen ansehen
          </button>
          <button type="button" onClick={() => run(onToggle)}>
            {isActive ? "Deaktivieren" : "Aktivieren"}
          </button>
          <button type="button" className="danger" onClick={() => run(onDelete)}>
            Löschen
          </button>
        </div>
      )}
    </div>
  );
}
