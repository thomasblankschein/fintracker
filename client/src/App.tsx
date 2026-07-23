import { useEffect, useState } from "react";
import { NavLink, Route, Routes } from "react-router-dom";
import Dashboard from "./pages/Dashboard";
import Accounts from "./pages/Accounts";
import Transactions from "./pages/Transactions";
import Payees from "./pages/Payees";
import Recurring from "./pages/Recurring";
import Import from "./pages/Import";
import Reports from "./pages/Reports";
import { api } from "./api";

const navItems = [
  { to: "/", label: "Dashboard" },
  { to: "/buchungen", label: "Buchungen" },
  { to: "/konten", label: "Konten" },
  { to: "/zahlungsempfaenger", label: "Zahlungsempfänger" },
  { to: "/wiederkehrend", label: "Wiederkehrend" },
  { to: "/import", label: "Import" },
  { to: "/auswertungen", label: "Auswertungen" },
];

export default function App() {
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    api.getInfo().then((info) => setVersion(info.version)).catch(() => {});
  }, []);

  return (
    <div className="app-shell">
      <nav className="sidebar">
        <div className="brand">💶 Finanzen</div>
        <ul>
          {navItems.map((item) => (
            <li key={item.to}>
              <NavLink to={item.to} end={item.to === "/"} className={({ isActive }) => (isActive ? "active" : "")}>
                {item.label}
              </NavLink>
            </li>
          ))}
        </ul>
        {version && <div className="sidebar-version">Version {version}</div>}
      </nav>
      <main className="content">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/buchungen" element={<Transactions />} />
          <Route path="/konten" element={<Accounts />} />
          <Route path="/zahlungsempfaenger" element={<Payees />} />
          <Route path="/wiederkehrend" element={<Recurring />} />
          <Route path="/import" element={<Import />} />
          <Route path="/auswertungen" element={<Reports />} />
        </Routes>
      </main>
    </div>
  );
}
