import { useState } from "react";
import Capture from "./Capture";
import Pairing from "./Pairing";
import { clearToken, getToken, saveToken } from "./storage";

export default function App() {
  const [token, setToken] = useState<string | null>(getToken());

  if (!token) {
    return (
      <Pairing
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
      onUnauthorized={() => {
        // Warteschlange bleibt erhalten und wird nach erneutem Koppeln gesendet
        clearToken();
        setToken(null);
      }}
    />
  );
}
