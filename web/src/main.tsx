import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/heebo/hebrew-400.css";
import "@fontsource/heebo/hebrew-500.css";
import "@fontsource/heebo/hebrew-700.css";
import "@fontsource/heebo/latin-400.css";
import "@fontsource/heebo/latin-500.css";
import "@fontsource/heebo/latin-700.css";
import "@fontsource/frank-ruhl-libre/hebrew-700.css";
import "@fontsource/frank-ruhl-libre/latin-700.css";
import { App } from "./App";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("Root element is missing");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
