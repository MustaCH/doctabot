import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { installGlobalErrorHandlers } from "@/lib/error-reporting";

// Observabilidad (ticket 86aj18r6x): capturar errores no manejados del front.
installGlobalErrorHandlers();

// One-time cleanup: the previous architecture registered TWO service workers
// (/sw-push.js + the PWA-generated SW). Now there's only one (/sw.js via
// vite-plugin-pwa injectManifest). Unregister the legacy /sw-push.js so it
// can't compete for scope or swallow push events.
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.getRegistrations().then((regs) => {
    regs.forEach((r) => {
      const url = r.active?.scriptURL || r.installing?.scriptURL || r.waiting?.scriptURL || "";
      if (url.endsWith("/sw-push.js")) {
        r.unregister().catch(() => {});
      }
    });
  });
}

createRoot(document.getElementById("root")!).render(<App />);

// Remove splash screen after app mounts
const splash = document.getElementById("splash");
if (splash) {
  splash.style.transition = "opacity 0.3s ease";
  splash.style.opacity = "0";
  setTimeout(() => splash.remove(), 300);
}
