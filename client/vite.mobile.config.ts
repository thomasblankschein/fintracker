import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Eigener Build für die iPhone-Erfassung: kleines Bundle ohne Router/Charts, enthält keinen Code der Hauptapp.
// Ausgabe nach client/dist-mobile, ausgeliefert vom Mobile-Listener des Servers (Port 3002).
export default defineConfig({
  root: "mobile",
  plugins: [react()],
  build: { outDir: "../dist-mobile", emptyOutDir: true },
  server: {
    port: 5174,
    proxy: { "/api/m": { target: "http://localhost:3002", changeOrigin: true } },
  },
});
