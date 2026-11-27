import { useEffect, useState } from "react";
import { setAuthRequiredHandler } from "./api";
import BasicLogin from "./BasicLogin";
import Capture from "./Capture";
import Pairing from "./Pairing";
import { clearToken, getToken, saveToken, syncBasicToCache } from "./storage";

export default function App() {
  const [token, setToken] = useState<string | null>(getToken());
  // forced: der Server hat mit 401 abgelehnt; manual: vom Nutzer geöffnet
  const [basic, setBasic] = useState<"forced" | "manual" | null>(null);

  useEffect(() => {
    setAuthRequiredHandler(() => setBasic("forced"));
    // Gespeicherte Zugangsdaten für den Service Worker bereitstellen (z. B. nach App-Update)
    syncBasicToCache();
    return () => setAuthRequiredHandler(null);
  }, []);

  if (basic) {
    return <BasicLogin forced={basic === "forced"} onDone={() => setBasic(null)} onCancel={() => setBasic(null)} />;
  }

  if (!token) {
    return (
      <Pairing
        onOpenBasic={() => setBasic("manual")}
        onPaired={(t) => {
          saveToken(t);
          setToken(t);
        }}
      />
    );
  }
  return (
    <Capture
      token={token}
      onOpenBasic={() => setBasic("manual")}
      onUnauthorized={() => {
        // Warteschlange bleibt erhalten und wird nach erneutem Koppeln gesendet
        clearToken();
        setToken(null);
      }}
    />
  );
}
