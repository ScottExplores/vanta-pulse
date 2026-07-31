import "@fontsource-variable/space-grotesk";
import "@fontsource/orbitron/600.css";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import "./app/styles.css";

createRoot(document.getElementById("root")!).render(<App />);
