// Backfill de embeddings de propiedades (ticket 86aj9w5pn) — CORRER SOLO CON OK DE NACHO:
// escribe en la tabla `properties` REAL.
//
// Qué hace: para cada propiedad activa sin embedding, arma el texto (title + zone + description),
// pide el embedding a Gemini (gemini-embedding-001, outputDimensionality=768, RETRIEVAL_DOCUMENT),
// lo NORMALIZA L2 (a <3072 dims el modelo devuelve vectores sin normalizar) y lo guarda.
//
// Uso (PowerShell, desde la raíz del repo — lee GEMINI_API_KEY y SUPABASE_* de .env.local):
//   node scripts/backfill-property-embeddings.mjs            # corrida real
//   node scripts/backfill-property-embeddings.mjs --dry-run  # solo cuenta pendientes
//
// Idempotente: filtra embedding IS NULL, así que re-correrlo continúa donde quedó.
// Nuevas propiedades del scraper quedan sin embedding hasta la próxima corrida (fail-open:
// la RPC las rankea con trigram puro). Integrarlo al scraper es un ticket aparte.

import { readFileSync } from "node:fs";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const get = (k) => env.match(new RegExp(`^${k}=(.+)$`, "m"))?.[1]?.trim();
const GEMINI_API_KEY = get("GEMINI_API_KEY");
const SUPABASE_URL = get("SUPABASE_URL");
const SERVICE_ROLE = get("SUPABASE_SERVICE_ROLE_KEY");
if (!GEMINI_API_KEY || !SUPABASE_URL || !SERVICE_ROLE) {
  console.error("Faltan GEMINI_API_KEY / SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY en .env.local");
  process.exit(1);
}

const DRY_RUN = process.argv.includes("--dry-run");
const BATCH = 50;           // filas por página de lectura
const PAUSE_MS = 300;       // pausa entre embeddings (rate limit amable)
const sbHeaders = { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}`, "Content-Type": "application/json" };

async function embed(text) {
  const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent", {
    method: "POST",
    headers: { "x-goog-api-key": GEMINI_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ content: { parts: [{ text }] }, taskType: "RETRIEVAL_DOCUMENT", outputDimensionality: 768 }),
  });
  if (!res.ok) throw new Error(`embedContent HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const values = (await res.json())?.embedding?.values;
  if (!Array.isArray(values) || values.length !== 768) throw new Error("embedding inválido");
  const norm = Math.sqrt(values.reduce((a, v) => a + v * v, 0));
  return values.map((v) => v / norm);
}

async function pendingPage() {
  const url = `${SUPABASE_URL}/rest/v1/properties?select=id,title,zone,description&embedding=is.null&or=(listing_status.eq.active,listing_status.is.null)&limit=${BATCH}`;
  const res = await fetch(url, { headers: sbHeaders });
  if (!res.ok) throw new Error(`select HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

async function saveEmbedding(id, vector) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/properties?id=eq.${id}`, {
    method: "PATCH",
    headers: sbHeaders,
    body: JSON.stringify({ embedding: JSON.stringify(vector) }),
  });
  if (!res.ok) throw new Error(`update HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

const countRes = await fetch(`${SUPABASE_URL}/rest/v1/properties?select=id&embedding=is.null&or=(listing_status.eq.active,listing_status.is.null)&limit=1`, {
  headers: { ...sbHeaders, Prefer: "count=exact" },
});
const total = Number(countRes.headers.get("content-range")?.split("/")[1] ?? "?");
console.log(`Pendientes de embedding (activas, embedding IS NULL): ${total}`);

if (!DRY_RUN) {
  let done = 0, failed = 0;
  outer: for (;;) {
    const rows = await pendingPage();
    if (rows.length === 0) break;
    for (const r of rows) {
      const text = [r.title, r.zone, r.description].filter(Boolean).join(". ").slice(0, 6000);
      if (!text) { failed += 1; continue; }
      try {
        const v = await embed(text);
        await saveEmbedding(r.id, v);
        done += 1;
        if (done % 25 === 0) console.log(`  ${done}/${total} listas…`);
      } catch (e) {
        failed += 1;
        console.error(`  fila ${r.id}: ${e.message}`);
        if (failed > 20) { console.error("Demasiados fallos seguidos — corto."); break outer; }
      }
      await new Promise((res) => setTimeout(res, PAUSE_MS));
    }
  }
  console.log(`Backfill terminado: ${done} embebidas, ${failed} con fallo.`);
}
