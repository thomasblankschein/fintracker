import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, Payee, formatCents } from "../api";

export default function Payees() {
  const [payees, setPayees] = useState<Payee[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const navigate = useNavigate();

  const load = () => api.getPayees().then(setPayees).catch((e) => setError(e.message));

  useEffect(() => {
    load();
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.createPayee(name);
      setName("");
      load();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const remove = async (id: number) => {
    try {
      await api.deletePayee(id);
      load();
    } catch (err: any) {
      setError(err.message);
    }
  };

  return (
    <div>
      <h1>Zahlungsempfänger</h1>
      {error && <div className="error-banner">{error}</div>}

      <form className="card form-row" onSubmit={submit}>
        <label>
          Neuer Zahlungsempfänger
          <input value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <button type="submit" style={{ alignSelf: "end" }}>
          Anlegen
        </button>
      </form>

      <div className="card">
        {payees.length === 0 ? (
          <p className="muted">Noch keine Zahlungsempfänger.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Buchungen</th>
                <th>Ausgaben gesamt</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {payees.map((p) => (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td>{p.transactionCount}</td>
                  <td>{formatCents(p.expenseTotal)}</td>
                  <td>
                    <div className="actions">
                      <button className="secondary" onClick={() => navigate(`/buchungen?payee=${p.id}`)}>
                        Buchungen ansehen
                      </button>
                      <button className="danger" onClick={() => remove(p.id)}>
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
