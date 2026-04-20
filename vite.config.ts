import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { VitePWA } from "vite-plugin-pwa";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [
    react(),
    mode === "development" && componentTagger(),
    VitePWA({
      // Use injectManifest so we have a SINGLE service worker that handles
      // both PWA precaching AND web push (push / notificationclick events).
      // Previously we had vite-plugin-pwa's generated SW + a separate
      // /sw-push.js, which competed for the root scope and could leave
      // pushes accepted by Apple but never displayed on iOS.
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      registerType: "autoUpdate",
      includeAssets: ["favicon.ico", "alan-192.png", "alan-512.png"],
      injectManifest: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
      },
      manifest: {
        name: "Alan - Asistente RE/MAX Docta",
        short_name: "Alan",
        description: "Tu asistente IA para búsqueda de propiedades",
        theme_color: "#1e40af",
        background_color: "#ffffff",
        display: "standalone",
        orientation: "portrait",
        start_url: "/",
        icons: [
          {
            src: "/alan-192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "/alan-512.png",
            sizes: "512x512",
            type: "image/png",
          },
          {
            src: "/alan-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
    }),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
