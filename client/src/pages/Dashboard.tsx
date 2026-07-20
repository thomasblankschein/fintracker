import { useEffect, useState } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend, ResponsiveContainer } from "recharts";
import { api, ForecastResponse, formatCents } from "../api";

const COLORS = ["#2563eb", "#16a34a", "#f59e0b", "#dc2626", "#9333ea", "#0891b2"];

export default function Dashboard() {
  const [forecast, setForecast] = useState<ForecastResponse | null>(null);
  const [months, setMonths] = useState(6);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getForecast(months)
      .then(setForecast)
      .catch((e) => setError(e.message));
  }, [months]);

  if (error) return <div className="error-banner">{error}</div>;
  if (!forecast) return <p className="muted">Lädt…</p>;

  const totalBalance = forecast.accounts.reduce((sum, a) => sum + a.currentBalance, 0);

  const chartData = buildChartData(forecast);

  return (
    <div>
      <h1>Dashboard</h1>

      <div className="card">
        <div className="grid grid-3">
          <div className="stat">
            <span className="label">Gesamtsaldo</span>
            <span className="value">{formatCents(totalBalance)}</span>
          </div>
          {forecast.accounts.map((a) => (
            <div className="stat" key={a.accountId}>
              <span className="label">{a.accountName}</span>
              <span className="value">{formatCents(a.currentBalance)}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="toolbar">
          <h2>Prognose</h2>
          <select value={months} onChange={(e) => setMonths(Number(e.target.value))}>
            <option value={3}>3 Monate</option>
            <option value={6}>6 Monate</option>
            <option value={12}>12 Monate</option>
          </select>
        </div>
        {chartData.length > 1 ? (
          <ResponsiveContainer width="100%" height={320}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
              <XAxis dataKey="date" />
              <YAxis tickFormatter={(v) => formatCents(v as number)} width={90} />
              <Tooltip formatter={(v: number) => formatCents(v)} />
              <Legend />
              {forecast.accounts.map((a, i) => (
                <Line
                  key={a.accountId}
                  type="stepAfter"
                  dataKey={a.accountName}
                  stroke={COLORS[i % COLORS.length]}
                  dot={false}
                  strokeWidth={2}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <p className="muted">Noch keine wiederkehrenden Zahlungen für eine Prognose hinterlegt.</p>
        )}
      </div>

      <div className="card">
        <h2>Anstehende wiederkehrende Zahlungen</h2>
        {forecast.upcomingOccurrences.length === 0 ? (
          <p className="muted">Keine anstehenden Zahlungen.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Datum</th>
                <th>Name</th>
                <th>Von</th>
                <th>Nach</th>
                <th>Betrag</th>
              </tr>
            </thead>
            <tbody>
              {forecast.upcomingOccurrences.slice(0, 15).map((o, i) => (
                <tr key={i}>
                  <td>{o.date}</td>
                  <td>{o.templateName}</td>
                  <td>{o.fromAccountName}</td>
                  <td>{o.toAccountName}</td>
                  <td>{formatCents(o.amountCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function buildChartData(forecast: ForecastResponse) {
  const dateSet = new Set<string>();
  for (const acc of forecast.accounts) {
    for (const p of acc.projection) dateSet.add(p.date);
  }
  const dates = Array.from(dateSet).sort();
  return dates.map((date) => {
    const row: Record<string, string | number> = { date };
    for (const acc of forecast.accounts) {
      const pointsUpToDate = acc.projection.filter((p) => p.date <= date);
      row[acc.accountName] = pointsUpToDate.length > 0
        ? pointsUpToDate[pointsUpToDate.length - 1].balance
        : acc.currentBalance;
    }
    return row;
  });
}
