import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SCRAPE_BASE_URL = "http://qiuautomations-scrapingcba-7uwjyy-33ffaf-31-97-164-164.traefik.me/api/scrape";

// GeoJSON zones for Córdoba Capital
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

function parseNumber(val: any): number | null {
  if (val == null) return null;
  if (typeof val === "number") return val;
  const s = String(val).replace(/[^\d.,\-]/g, "").replace(",", ".");
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

function parseInteger(val: any): number | null {
  if (val == null) return null;
  const s = String(val).replace(/[^\d]/g, "");
  const n = parseInt(s, 10);
  return isNaN(n) ? null : n;
}

function buildRecord(prop: any) {
  const propLat = prop.latitude ?? prop.lat ?? null;
  const propLng = prop.longitude ?? prop.lng ?? null;
  const externalId = String(prop.external_id ?? prop.id ?? prop.url ?? "");
  return {
    external_id: externalId || null,
    title: prop.title ?? null,
    operation: prop.operation ?? null,
    price: parseNumber(prop.price),
    currency: prop.currency ?? null,
    address: prop.address ?? null,
    locality: prop.locality ?? null,
    lat: propLat ? Number(propLat) : null,
    lng: propLng ? Number(propLng) : null,
    brokers: prop.brokers ?? null,
    contact_person: prop.contactPerson ?? prop.contact_person ?? null,
    office: prop.office ?? null,
    dimensions_land_m2: parseNumber(prop.dimensionsLand ?? prop.dimensions_land_m2),
    m2_total: parseNumber(prop.m2Total ?? prop.m2_total),
    m2_cover: parseNumber(prop.m2Cover ?? prop.m2_cover),
    ambientes: parseInteger(prop.ambientes),
    banos: parseInteger(prop.baños ?? prop.banos),
    property_type: prop.propertyType ?? prop.property_type ?? null,
    url: prop.url ?? null,
    photo: Array.isArray(prop.photos) ? prop.photos[0] : (prop.photo ?? null),
    zone: getZone(propLng ? Number(propLng) : null, propLat ? Number(propLat) : null),
  };
}

// Helper to write a log entry to scraping_logs table
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

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    let startPage = 1;
    let endPage: number | null = null;
    let batchTimestamp: string | null = null;
    let isLastBatch = false;

    try {
      const body = await req.json();
      if (body.startPage) startPage = Number(body.startPage);
      if (body.endPage) endPage = Number(body.endPage);
      if (body.batchTimestamp) batchTimestamp = body.batchTimestamp;
    } catch { /* no body, use defaults */ }

    if (!batchTimestamp) {
      batchTimestamp = new Date().toISOString();
    }

    const batchId = batchTimestamp!;

    // Only log "started" on the very first invocation (startPage === 1)
    if (startPage === 1) {
      await writeLog(supabase, batchId, "🚀 Scraping iniciado", "info");
    }

    let maxPages = 1;
    if (!endPage) {
      await writeLog(supabase, batchId, "📄 Consultando cantidad de páginas...", "info");
      const maxPagesRes = await fetch(`${SCRAPE_BASE_URL}?mode=checkMaxPages`);
      if (!maxPagesRes.ok) {
        await writeLog(supabase, batchId, `❌ Error al consultar páginas: ${maxPagesRes.status}`, "error");
        throw new Error(`checkMaxPages failed: ${maxPagesRes.status}`);
      }
      const maxPagesData = await maxPagesRes.json();
      maxPages = maxPagesData.maxPages ?? maxPagesData.totalPages ?? 1;
      await writeLog(supabase, batchId, `📄 Total de páginas: ${maxPages}`, "info", { total_pages: maxPages });

      endPage = Math.min(startPage + 9, maxPages);

      if (endPage < maxPages) {
        const nextStart = endPage + 1;
        const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
        await writeLog(supabase, batchId, `⏭️ Programando siguiente lote: páginas ${nextStart}-${Math.min(nextStart + 9, maxPages)}`, "info", { current_page: nextStart, total_pages: maxPages });
        fetch(`${supabaseUrl}/functions/v1/scrape-properties`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${anonKey}`,
          },
          body: JSON.stringify({ startPage: nextStart, batchTimestamp }),
        }).catch(e => console.error("Failed to schedule next batch:", e));
      } else {
        isLastBatch = true;
      }
    } else {
      isLastBatch = true;
    }

    await writeLog(supabase, batchId, `🏠 Scrapeando páginas ${startPage}-${endPage}...`, "info", { current_page: startPage, total_pages: maxPages > 1 ? maxPages : undefined });

    let allProperties: any[] = [];
    const BATCH_SIZE = 5;

    for (let start = startPage; start <= endPage; start += BATCH_SIZE) {
      const end = Math.min(start + BATCH_SIZE - 1, endPage);
      await writeLog(supabase, batchId, `🔍 Descargando páginas ${start}-${end}...`, "info", { current_page: end, total_pages: maxPages > 1 ? maxPages : undefined });

      const scrapeRes = await fetch(`${SCRAPE_BASE_URL}?startPage=${start}&endPage=${end}`);
      if (!scrapeRes.ok) {
        await writeLog(supabase, batchId, `⚠️ Error en páginas ${start}-${end}: HTTP ${scrapeRes.status}`, "error", { current_page: end });
        continue;
      }

      const scrapeData = await scrapeRes.json();
      const properties = Array.isArray(scrapeData) ? scrapeData : scrapeData.properties ?? scrapeData.data ?? [];
      allProperties = allProperties.concat(properties);
      await writeLog(supabase, batchId, `✅ Páginas ${start}-${end}: ${properties.length} propiedades encontradas (acumulado: ${allProperties.length})`, "info", { current_page: end, total_pages: maxPages > 1 ? maxPages : undefined, properties_count: allProperties.length });
    }

    await writeLog(supabase, batchId, `📦 Total scrapeadas en este lote: ${allProperties.length}`, "info", { current_page: endPage, total_pages: maxPages > 1 ? maxPages : undefined, properties_count: allProperties.length });

    const records = allProperties
      .map(prop => ({ ...buildRecord(prop), last_seen_at: batchTimestamp }))
      .filter(r => r.external_id);

    let upserted = 0;
    let errors = 0;
    const UPSERT_BATCH = 50;

    for (let i = 0; i < records.length; i += UPSERT_BATCH) {
      const batch = records.slice(i, i + UPSERT_BATCH);
      const { error } = await supabase
        .from("properties")
        .upsert(batch, { onConflict: "external_id" });

      if (error) {
        console.error(`Batch upsert error at ${i}:`, error.message);
        errors += batch.length;
      } else {
        upserted += batch.length;
      }
    }

    await writeLog(supabase, batchId, `💾 Guardadas: ${upserted} propiedades (${errors} errores)`, "info", { properties_count: upserted });

    let deleted = 0;
    if (isLastBatch && upserted > 0) {
      await writeLog(supabase, batchId, `🧹 Limpiando propiedades obsoletas...`, "info");
      const { data: staleData, error: deleteError } = await supabase
        .from("properties")
        .delete()
        .lt("last_seen_at", batchTimestamp)
        .select("id");

      if (deleteError) {
        await writeLog(supabase, batchId, `❌ Error en limpieza: ${deleteError.message}`, "error");
      } else {
        deleted = staleData?.length ?? 0;
        await writeLog(supabase, batchId, `🗑️ ${deleted} propiedades obsoletas eliminadas`, deleted > 0 ? "warning" : "info");
      }

      if (deleted > 0) {
        const N8N_WEBHOOK_URL = Deno.env.get("N8N_WEBHOOK_URL");
        if (N8N_WEBHOOK_URL) {
          fetch(N8N_WEBHOOK_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              type: "stale_properties_deleted",
              deleted_count: deleted,
              upserted_count: upserted,
              batch_timestamp: batchTimestamp,
              timestamp: new Date().toISOString(),
            }),
          }).catch(err => console.error("n8n webhook error:", err));
        }
      }

      await writeLog(supabase, batchId, `🏁 Scraping finalizado — ${upserted} actualizadas, ${deleted} eliminadas, ${errors} errores`, "success", { properties_count: upserted });
    } else if (!isLastBatch) {
      await writeLog(supabase, batchId, `⏭️ Lote parcial completado (páginas ${startPage}-${endPage}). Siguiente lote en proceso...`, "info", { current_page: endPage, total_pages: maxPages });
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

    const result = {
      success: true,
      pages: `${startPage}-${endPage}`,
      total_scraped: allProperties.length,
      upserted,
      errors,
      deleted,
      is_last_batch: isLastBatch,
      batch_timestamp: batchTimestamp,
      timestamp: new Date().toISOString(),
    };

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("❌ Scrape error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
