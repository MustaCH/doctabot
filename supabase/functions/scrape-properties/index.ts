import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, handleOptions } from "../_shared/cors.ts";
import { errorResponse, safeError } from "../_shared/http.ts";
import { reportEdgeErrorBg } from "../_shared/observability.ts";
import { dedupeByExternalId } from "./dedupe.ts";

const SCRAPE_BASE_URL = "http://remaxdocta-scrapingdocta-zos1k5-a90019-31-97-164-164.sslip.io/api/scrape";

// Max pages to scrape per invocation to stay well under 150s timeout
const PAGES_PER_INVOCATION = 20;

// GeoJSON zones for Córdoba Capital (fallback when zone_data is not provided by scraper)
const CORDOBA_ZONES = [
  { name: "Ruta 20", polygon: [[-64.20594530297676,-31.41855213142289],[-64.23666395394986,-31.41176762764692],[-64.24261544284653,-31.4316917296247],[-64.23947211786738,-31.45121383061365],[-64.23478021827735,-31.45091128014509],[-64.23238264910181,-31.44907669569495],[-64.23160661718263,-31.44276402415655],[-64.21404057744546,-31.44288206897711],[-64.21020162184459,-31.4302133115201],[-64.20594530297676,-31.41855213142289]] },
  { name: "Nueva Córdoba", polygon: [[-64.18863847306291,-31.41873096920493],[-64.19477256928857,-31.43304034799817],[-64.18359724895386,-31.43499937773949],[-64.17440728215153,-31.42415369728308],[-64.18863847306291,-31.41873096920493]] },
  { name: "Centro", polygon: [[-64.17453675804093,-31.41644919391496],[-64.17446672359156,-31.40907226180772],[-64.1795807888565,-31.40583934819045],[-64.18642587994019,-31.40665614754602],[-64.19497865089954,-31.40616171470717],[-64.19921952110577,-31.41783553477848],[-64.17707075770284,-31.42392501638625],[-64.17625820079601,-31.42318129628694],[-64.17453675804093,-31.41644919391496]] },
  { name: "Alberdi", polygon: [[-64.1946632174022,-31.40739005396344],[-64.23155216470761,-31.39765221267374],[-64.23838734101835,-31.41193168903524],[-64.19885305069185,-31.42105772185711],[-64.1946632174022,-31.40739005396344]] },
  { name: "Alta Córdoba", polygon: [[-64.17522908419161,-31.37818480268874],[-64.18972063256055,-31.37779813906096],[-64.19059678731286,-31.3868339195515],[-64.19332851176743,-31.39947214865794],[-64.18725602795246,-31.40374648127149],[-64.17594783925024,-31.404595754179],[-64.17522908419161,-31.37818480268874]] },
  { name: "General Paz", polygon: [[-64.15567869816424,-31.41396607770304],[-64.15769533748981,-31.40804350538401],[-64.16444202024282,-31.40491344450822],[-64.17433186126473,-31.40729886264724],[-64.17384473729041,-31.41404603823372],[-64.17151896385553,-31.41966254112388],[-64.15567869816424,-31.41396607770304]] },
  { name: "Zona Sur", polygon: [[-64.17580606707754,-31.43412858905587],[-64.1967146529316,-31.43390868775534],[-64.2121702425686,-31.43744993665954],[-64.21619407145376,-31.44451383123361],[-64.22395083392581,-31.4473924895236],[-64.23253090502809,-31.4612396990933],[-64.22138486220948,-31.46315386332827],[-64.25648912767134,-31.4965696199643],[-64.2005341599003,-31.52655673228268],[-64.13916797811837,-31.53003516958177],[-64.14473226074655,-31.47117737019211],[-64.14775694800389,-31.46816173768493],[-64.1469398711047,-31.45973308210516],[-64.1486148017691,-31.43301057700542],[-64.15986110855694,-31.43292000920227],[-64.16727995598261,-31.43098673322366],[-64.17580606707754,-31.43412858905587]] },
  { name: "Zona Norte", polygon: [[-64.22030768758788,-31.3952184832952],[-64.21477133138443,-31.39233041683953],[-64.20634421620595,-31.39038503471124],[-64.20546437182199,-31.37143815738181],[-64.21173177877002,-31.3682656753509],[-64.22527771364754,-31.35845268474864],[-64.2246962761805,-31.35439858088836],[-64.21347734112192,-31.35499593801205],[-64.2130036360701,-31.34555196726241],[-64.22350914292139,-31.34602019024683],[-64.22354249492953,-31.34123744476245],[-64.22863336790803,-31.34095374705415],[-64.24523333270565,-31.340032431706],[-64.25275804801902,-31.33764800910709],[-64.25853678002905,-31.33176048470611],[-64.28305490104965,-31.32671011899061],[-64.27678507504298,-31.31624075846921],[-64.28554979181156,-31.30147688359594],[-64.2730926155402,-31.30247283942912],[-64.27611431040539,-31.30824177685708],[-64.27135288424681,-31.31153975092727],[-64.2668949166329,-31.30950343853384],[-64.22053111424836,-31.31018524019772],[-64.22037626986392,-31.31014612912532],[-64.23096459667447,-31.28774928048505],[-64.25019311783811,-31.28756256332732],[-64.25085108884574,-31.30023303279721],[-64.30292592354071,-31.29710320296649],[-64.3153270581518,-31.3141082799982],[-64.31148562380774,-31.36179473999974],[-64.30399176685151,-31.36746394763791],[-64.26727307422837,-31.39615744943348],[-64.2541151061113,-31.37558773260302],[-64.24635258885941,-31.384377705335],[-64.22714021137115,-31.3926297063523],[-64.22030768758788,-31.3952184832952]] },
];

function isPointInPolygon(point: [number, number], polygon: number[][]): boolean {
  const [x, y] = point;
  let isInside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
    if (intersect) isInside = !isInside;
  }
  return isInside;
}

function getZone(lng: number | null, lat: number | null): string | null {
  if (lng == null || lat == null) return null;
  const point: [number, number] = [lng, lat];
  for (const zone of CORDOBA_ZONES) {
    if (isPointInPolygon(point, zone.polygon)) return zone.name;
  }
  return null;
}

function safeNumber(val: any): number | null {
  if (val == null) return null;
  if (typeof val === "number") return isNaN(val) ? null : val;
  const s = String(val).replace(/[^\d.,\-]/g, "").replace(",", ".");
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

function safeInt(val: any): number | null {
  if (val == null) return null;
  if (typeof val === "number") return isNaN(val) ? null : Math.round(val);
  const s = String(val).replace(/[^\d]/g, "");
  const n = parseInt(s, 10);
  return isNaN(n) ? null : n;
}

const OP_LABELS: Record<number, string> = { 1: "Venta", 2: "Alquiler", 3: "Alquiler temporario" };
const ALL_OPS = [1, 2, 3];

function buildRecord(prop: any) {
  const propLat = safeNumber(prop.latitude ?? prop.lat ?? null);
  const propLng = safeNumber(prop.longitude ?? prop.lng ?? null);
  const externalId = String(prop.entityId ?? prop.external_id ?? prop.id ?? prop.url ?? "");
  const zoneObj = prop.zone && typeof prop.zone === "object" ? prop.zone : null;
  const geoZone = getZone(propLng, propLat);
  const zoneLabel = zoneObj
    ? (zoneObj.neighborhood || zoneObj.city || zoneObj.county || geoZone || null)
    : geoZone;

  return {
    external_id: externalId || null,
    remax_id: safeInt(typeof prop.id === "number" ? prop.id : null),
    entity_id: typeof prop.entityId === "string" ? prop.entityId : null,
    title: prop.title ?? null,
    operation: prop._opId ? (OP_LABELS[prop._opId] ?? prop.operation ?? null) : (prop.operation ?? null),
    operation_id: safeInt(prop._opId ?? prop.operationId),
    price: safeNumber(prop.price),
    currency: prop.currency ?? null,
    price_exposure: prop.priceExposure ?? true,
    expenses_price: safeNumber(prop.expensesPrice),
    expenses_currency: prop.expensesCurrency ?? null,
    address: prop.address ?? null,
    locality: prop.locality ?? null,
    lat: propLat,
    lng: propLng,
    brokers: prop.brokers ?? null,
    contact_person: prop.contactPerson ?? prop.contact_person ?? null,
    contact_phone: prop.contactPhone ?? null,
    contact_email: prop.contactEmail ?? null,
    office: prop.office ?? null,
    office_id: prop.officeId ?? null,
    associate_id: prop.associateId ?? null,
    dimensions_land_m2: safeNumber(prop.dimensionLand ?? prop.dimensionsLand ?? prop.dimensions_land_m2),
    m2_total: safeNumber(prop.dimensionTotalBuilt ?? prop.m2Total ?? prop.m2_total),
    m2_cover: safeNumber(prop.dimensionCovered ?? prop.m2Cover ?? prop.m2_cover),
    ambientes: safeInt(prop.ambientes),
    habitaciones: safeInt(prop.habitaciones),
    banos: safeInt(prop.baños ?? prop.banos),
    property_type: prop.propertyType ?? prop.property_type ?? null,
    property_type_id: safeInt(prop.propertyTypeId),
    listing_status: prop.listingStatus ?? "active",
    is_entrepreneurship: prop.isEntrepreneurship ?? false,
    entrepreneurship: prop.isEntrepreneurship && prop.entrepreneurship ? prop.entrepreneurship : null,
    url: prop.url ?? null,
    photo: Array.isArray(prop.photos) && prop.photos.length > 0 ? prop.photos[0] : (prop.photo ?? null),
    photos: Array.isArray(prop.photos) ? prop.photos : null,
    zone: zoneLabel,
    zone_data: zoneObj,
    zone_neighborhood: zoneObj?.neighborhood ?? null,
    zone_city: zoneObj?.city ?? null,
    zone_county: zoneObj?.county ?? null,
    zone_private_community: zoneObj?.privateCommunity ?? null,
  };
}

async function writeLog(
  supabase: any,
  batchId: string,
  message: string,
  level: string = "info",
  extra: { current_page?: number; total_pages?: number; properties_count?: number } = {}
) {
  await supabase.from("scraping_logs").insert({
    batch_id: batchId,
    message,
    level,
    current_page: extra.current_page ?? null,
    total_pages: extra.total_pages ?? null,
    properties_count: extra.properties_count ?? null,
  });
  console.log(`[${level.toUpperCase()}] ${message}`);
}

/** Fetch with retry for flaky DNS. Logs failures to scraping_logs. */
async function fetchWithRetry(
  url: string,
  retries = 3,
  delayMs = 2000,
  supabase?: any,
  batchId?: string,
  context?: string,
): Promise<Response> {
  let lastErr: any = null;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url);
      return res;
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Fetch attempt ${attempt}/${retries} failed for ${url}: ${msg}`);
      if (supabase && batchId) {
        await writeLog(
          supabase,
          batchId,
          `🌐 Error de conexión (intento ${attempt}/${retries})${context ? ` [${context}]` : ""}: ${msg}`,
          attempt === retries ? "error" : "warning",
        );
      }
      if (attempt === retries) throw err;
      await new Promise(r => setTimeout(r, delayMs * attempt));
    }
  }
  throw lastErr ?? new Error("unreachable");
}

/** Fire-and-forget: invoke self with the next chunk */
function selfInvoke(supabaseUrl: string, anonKey: string, body: Record<string, any>) {
  const url = `${supabaseUrl}/functions/v1/scrape-properties`;
  fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": anonKey,
    },
    body: JSON.stringify(body),
  }).catch(err => console.error("Self-invoke error:", err));
}

serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Parse params
    let operationId: number | null = null;
    let startPage = 1;
    let maxPages: number | null = null;
    let batchTimestamp: string | null = null;
    // operationId=null means orchestrator mode

    try {
      const body = await req.json();
      if (body.operationId) operationId = Number(body.operationId);
      if (body.startPage) startPage = Number(body.startPage);
      if (body.maxPages) maxPages = Number(body.maxPages);
      if (body.batchTimestamp) batchTimestamp = body.batchTimestamp;
      // isOrchestrator removed - sequential chain handles everything
    } catch { /* no body */ }

    if (!batchTimestamp) {
      batchTimestamp = new Date().toISOString();
    }
    const batchId = batchTimestamp!;

    // ─── ORCHESTRATOR MODE ───
    // When called with no operationId (e.g. from cron), start first operation sequentially
    if (!operationId) {
      await writeLog(supabase, batchId, `🚀 Scraping iniciado (operaciones: ${ALL_OPS.map(o => OP_LABELS[o]).join(", ")})`, "info");

      // Start only the first operation; each operation chains to the next when done
      selfInvoke(supabaseUrl, anonKey, {
        operationId: ALL_OPS[0],
        startPage: 1,
        batchTimestamp,
      });

      return new Response(JSON.stringify({
        success: true,
        mode: "orchestrator",
        message: `Dispatched operation ${OP_LABELS[ALL_OPS[0]]} (sequential chain)`,
        batch_timestamp: batchTimestamp,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ─── WORKER MODE: scrape one operation, one chunk of pages ───
    const opLabel = OP_LABELS[operationId] ?? `Op${operationId}`;

    // Helper: chain to next operation or finalize (used when an operation must be aborted)
    const chainToNextOrFinalize = async (reason: string) => {
      await writeLog(supabase, batchId, `⏭️ ${opLabel}: saltando al siguiente paso (${reason})`, "warning");
      const currentOpIndex = ALL_OPS.indexOf(operationId!);
      const nextOpIndex = currentOpIndex + 1;
      if (nextOpIndex < ALL_OPS.length) {
        selfInvoke(supabaseUrl, anonKey, {
          operationId: ALL_OPS[nextOpIndex],
          startPage: 1,
          batchTimestamp,
        });
      } else {
        await runCleanup(supabase, batchId, batchTimestamp!);
      }
    };

    // Resolve maxPages if not known yet (first chunk)
    if (!maxPages) {
      try {
        const mpRes = await fetchWithRetry(
          `${SCRAPE_BASE_URL}?mode=checkMaxPages&operationId=${operationId}`,
          3, 2000, supabase, batchId, `${opLabel} checkMaxPages`,
        );
        if (!mpRes.ok) {
          await writeLog(supabase, batchId, `⚠️ Error consultando páginas para ${opLabel}: HTTP ${mpRes.status}`, "error");
          await chainToNextOrFinalize(`checkMaxPages HTTP ${mpRes.status}`);
          return new Response(JSON.stringify({ success: false, skipped: true, operation: opLabel, reason: `checkMaxPages HTTP ${mpRes.status}` }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        const mpData = await mpRes.json();
        maxPages = mpData.maxPages ?? mpData.totalPages ?? 1;
        await writeLog(supabase, batchId, `📄 ${opLabel}: ${maxPages} páginas totales`, "info", { total_pages: maxPages });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await writeLog(supabase, batchId, `❌ ${opLabel}: no se pudo resolver maxPages: ${msg}`, "error");
        await chainToNextOrFinalize(`error de red en checkMaxPages: ${msg}`);
        return new Response(JSON.stringify({ success: false, skipped: true, operation: opLabel, reason: msg }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const endPage = Math.min(startPage + PAGES_PER_INVOCATION - 1, maxPages);
    await writeLog(supabase, batchId, `🔍 ${opLabel}: páginas ${startPage}-${endPage} de ${maxPages}...`, "info", {
      current_page: endPage,
      total_pages: maxPages,
    });

    // Scrape pages in sub-batches of 5 — never throw, always continue to next sub-batch
    const allProperties: any[] = [];
    const FETCH_BATCH = 5;
    for (let p = startPage; p <= endPage; p += FETCH_BATCH) {
      const pEnd = Math.min(p + FETCH_BATCH - 1, endPage);
      try {
        const scrapeRes = await fetchWithRetry(
          `${SCRAPE_BASE_URL}?startPage=${p}&endPage=${pEnd}&operationId=${operationId}`,
          3, 2000, supabase, batchId, `${opLabel} pág ${p}-${pEnd}`,
        );
        if (!scrapeRes.ok) {
          await writeLog(supabase, batchId, `⚠️ ${opLabel} error páginas ${p}-${pEnd}: HTTP ${scrapeRes.status}`, "error");
          continue;
        }
        const scrapeData = await scrapeRes.json();
        const properties = Array.isArray(scrapeData) ? scrapeData : (scrapeData.data ?? scrapeData.properties ?? []);
        allProperties.push(...properties.map((pr: any) => ({ ...pr, _opId: operationId })));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await writeLog(supabase, batchId, `❌ ${opLabel} fallo de red páginas ${p}-${pEnd}: ${msg} (se continúa)`, "error");
        continue;
      }
    }

    // Upsert
    const rawRecords = allProperties
      .map(prop => ({ ...buildRecord(prop), last_seen_at: batchTimestamp }))
      .filter(r => r.external_id);

    // Dedup por external_id: el scraper puede traer la misma propiedad en páginas
    // distintas y Postgres rechaza un ON CONFLICT que toca la misma fila dos veces
    // (PG 21000 → HTTP 500). Ver dedupe.ts.
    const { deduped: records, dropped: dupes } = dedupeByExternalId(rawRecords);
    if (dupes > 0) {
      await writeLog(supabase, batchId, `🔁 ${opLabel}: ${dupes} duplicados por external_id descartados antes del upsert`, "info");
    }

    let upserted = 0;
    let errors = 0;
    const UPSERT_BATCH = 50;
    for (let i = 0; i < records.length; i += UPSERT_BATCH) {
      const batch = records.slice(i, i + UPSERT_BATCH);
      const { error } = await supabase.from("properties").upsert(batch, { onConflict: "external_id" });
      if (error) {
        console.error(`Upsert error at ${i}:`, error.message);
        errors += batch.length;
      } else {
        upserted += batch.length;
      }
    }

    await writeLog(supabase, batchId, `💾 ${opLabel} pág ${startPage}-${endPage}: ${upserted} guardadas (${errors} errores)`, "info", {
      current_page: endPage,
      total_pages: maxPages,
      properties_count: upserted,
    });

    // ─── CHAIN: if more pages remain, self-invoke next chunk ───
    const hasMorePages = endPage < maxPages;
    if (hasMorePages) {
      selfInvoke(supabaseUrl, anonKey, {
        operationId,
        startPage: endPage + 1,
        maxPages,
        batchTimestamp,
      });
    } else {
      // This operation is done
      await writeLog(supabase, batchId, `✅ ${opLabel}: completado`, "info");

      // Chain to next operation, or run cleanup if all done
      const currentOpIndex = ALL_OPS.indexOf(operationId);
      const nextOpIndex = currentOpIndex + 1;
      if (nextOpIndex < ALL_OPS.length) {
        // Start next operation
        selfInvoke(supabaseUrl, anonKey, {
          operationId: ALL_OPS[nextOpIndex],
          startPage: 1,
          batchTimestamp,
        });
      } else {
        // All operations done — run cleanup
        await runCleanup(supabase, batchId, batchTimestamp!);
      }
    }

    return new Response(JSON.stringify({
      success: true,
      mode: "worker",
      operation: opLabel,
      pages: `${startPage}-${endPage}/${maxPages}`,
      upserted,
      errors,
      has_more: hasMorePages,
      batch_timestamp: batchTimestamp,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (e) {
    reportEdgeErrorBg({ context: "scrape-properties", error: e });
    return errorResponse(safeError(e, "scrape-properties"), 500);
  }
});

/** Run after all operations complete: delete stale props, clean old logs, notify OVERLORD */
async function runCleanup(supabase: any, batchId: string, batchTimestamp: string) {
  await writeLog(supabase, batchId, `🧹 Limpiando propiedades obsoletas...`, "info");

  const { data: staleData, error: deleteError } = await supabase
    .from("properties")
    .delete()
    .lt("last_seen_at", batchTimestamp)
    .select("id");

  let deleted = 0;
  if (deleteError) {
    await writeLog(supabase, batchId, `❌ Error en limpieza: ${deleteError.message}`, "error");
  } else {
    deleted = staleData?.length ?? 0;
    await writeLog(supabase, batchId, `🗑️ ${deleted} propiedades obsoletas eliminadas`, deleted > 0 ? "warning" : "info");
  }

  // Count total upserted + hard errors logged for this batch
  const { data: upsertLogs } = await supabase
    .from("scraping_logs")
    .select("properties_count")
    .eq("batch_id", batchId)
    .like("message", "%guardadas%");
  const totalUpserted = (upsertLogs ?? []).reduce((sum: number, l: any) => sum + (l.properties_count ?? 0), 0);

  const { data: errorLogs } = await supabase
    .from("scraping_logs")
    .select("message")
    .eq("batch_id", batchId)
    .eq("level", "error")
    .order("created_at", { ascending: true });
  const errorCount = errorLogs?.length ?? 0;
  const firstError = errorLogs?.[0]?.message ?? null;

  // status:
  //   error   → la corrida no produjo nada (VPS scraper caído / todas las páginas fallaron)
  //   partial → guardó datos pero perdió alguna página (degradado, no caída total)
  //   success → corrida limpia
  const status = totalUpserted === 0 ? "error" : (errorCount > 0 ? "partial" : "success");
  const durationSeconds = Math.max(
    0,
    Math.round((Date.now() - new Date(batchTimestamp).getTime()) / 1000),
  );

  await writeLog(supabase, batchId, `🏁 Scraping finalizado — ${totalUpserted} actualizadas, ${deleted} eliminadas`, "success", {
    properties_count: totalUpserted,
  });

  // ─── Aviso a OVERLORD vía endpoint de Intake — SIEMPRE al cerrar el batch ───
  // Contrato canónico (OVERLORD/INSTRUCTIONS.md §7): success → ping info (sin ticket),
  // partial → ping info con detalle, error → ticket + ping.
  // El scraper devuelve 200 aun cuando falla (errores resilientes), así que el Monitor de
  // OVERLORD NO lo detecta por 5xx → reportarlo acá no duplica el ticket del Monitor.
  const OVERLORD_TOKEN = Deno.env.get("OVERLORD_TOKEN");
  if (OVERLORD_TOKEN) {
    const durTxt = `${Math.floor(durationSeconds / 60)}m ${durationSeconds % 60}s`;
    const intake =
      status === "error"
        ? {
            title: "Scraper diario FALLÓ — 0 propiedades guardadas",
            message: `La corrida ${batchTimestamp} no guardó ninguna propiedad (probable caída del scraper del VPS). ${errorCount} errores. Primer error: ${firstError ?? "n/d"}.`,
            severity: "high",
            type: "error",
            ticket: true,
          }
        : status === "partial"
        ? {
            title: "Scraper diario degradado",
            message: `Corrida ${batchTimestamp}: ${totalUpserted} actualizadas, ${deleted} eliminadas en ${durTxt}, pero con ${errorCount} errores de página (se perdieron datos). Primer error: ${firstError ?? "n/d"}.`,
            type: "info",
          }
        : {
            title: "Scraper diario OK",
            message: `Corrida ${batchTimestamp}: ${totalUpserted} propiedades actualizadas, ${deleted} eliminadas en ${durTxt}. Sin errores.`,
            type: "info",
          };
    fetch("https://n8n.ignaciopoletti.dev/webhook/overlord-intake", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Overlord-Token": OVERLORD_TOKEN,
      },
      body: JSON.stringify({ project: "doctabot", ...intake }),
    }).catch(err => console.error("OVERLORD intake error:", err));
  } else {
    console.warn("OVERLORD_TOKEN no seteado — se omite el aviso a OVERLORD");
  }

  // Clean up old logs (keep last 5 batches)
  const { data: recentBatches } = await supabase
    .from("scraping_logs")
    .select("batch_id")
    .order("created_at", { ascending: false });

  if (recentBatches) {
    const uniqueBatches = [...new Set(recentBatches.map((r: any) => r.batch_id))];
    if (uniqueBatches.length > 5) {
      const oldBatches = uniqueBatches.slice(5);
      await supabase.from("scraping_logs").delete().in("batch_id", oldBatches);
    }
  }
}
