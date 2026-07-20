import { useEffect, useState } from "react";
import { api, AccountNode, AccountType, formatCents } from "../api";

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

  const remove = async (node: AccountNode) => {
    try {
      await api.deleteAccount(node.id);
      load();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const parentCandidates = (() => {
    const flat: { id: number; name: string; type: AccountType }[] = [];
    const walk = (nodes: AccountNode[]) => {
      for (const n of nodes) {
        flat.push({ id: n.id, name: n.name, type: n.type });
        walk(n.children);
      }
    };
    walk(tree);
    return flat.filter((n) => n.type === type);
  })();

  return (
    <div>
      <div className="toolbar">
        <h1>Kontenrahmen</h1>
        <button onClick={() => setShowForm((s) => !s)}>{showForm ? "Abbrechen" : "Konto anlegen"}</button>
      </div>

      {error && <div className="error-banner">{error}</div>}

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
                {parentCandidates.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
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
              <AccountRow key={node.id} node={node} depth={0} onToggle={toggleActive} onDelete={remove} />
            ))
          )}
        </div>
      ))}
    </div>
  );
}

function AccountRow({
  node,
  depth,
  onToggle,
  onDelete,
}: {
  node: AccountNode;
  depth: number;
  onToggle: (n: AccountNode) => void;
  onDelete: (n: AccountNode) => void;
}) {
  return (
    <div className="tree-node">
      <div className="row" style={{ paddingLeft: `${depth * 1.25}rem` }}>
        <span style={{ opacity: node.isActive ? 1 : 0.5 }}>
          {node.name}
          {!node.isActive && <span className="pill" style={{ marginLeft: 8 }}>inaktiv</span>}
        </span>
        <div className="actions">
          <span className="muted">{formatCents(node.balance)}</span>
          <button className="secondary" onClick={() => onToggle(node)}>
            {node.isActive ? "Deaktivieren" : "Aktivieren"}
          </button>
          <button className="danger" onClick={() => onDelete(node)}>
            Löschen
          </button>
        </div>
      </div>
      {node.children.map((child) => (
        <AccountRow key={child.id} node={child} depth={depth + 1} onToggle={onToggle} onDelete={onDelete} />
      ))}
    </div>
  );
}
