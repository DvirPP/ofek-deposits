import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
      "/agent": {
        target: "http://localhost:3001",
        rewrite: (path) => path.replace(/^\/agent/, ""),
        timeout: 120_000,
      },
      "/ledger": {
        target: "http://localhost:3002",
        rewrite: (path) => path.replace(/^\/ledger/, ""),
      },
    },
  },
});
