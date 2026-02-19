import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SCRAPE_BASE_URL = "http://qiuautomations-scrapingcba-7uwjyy-33ffaf-31-97-164-164.traefik.me/api/scrape";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    console.log("🏠 Starting nightly property scrape...");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Step 1: Check max pages
    console.log("📄 Checking max pages...");
    const maxPagesRes = await fetch(`${SCRAPE_BASE_URL}?mode=checkMaxPages`);
    if (!maxPagesRes.ok) throw new Error(`checkMaxPages failed: ${maxPagesRes.status}`);
    const maxPagesData = await maxPagesRes.json();
    const maxPages = maxPagesData.maxPages ?? maxPagesData.totalPages ?? 1;
    console.log(`📄 Max pages detected: ${maxPages}`);

    // Step 2: Scrape all pages
    let allProperties: any[] = [];
    const BATCH_SIZE = 5;
    
    for (let start = 1; start <= maxPages; start += BATCH_SIZE) {
      const end = Math.min(start + BATCH_SIZE - 1, maxPages);
      console.log(`🔍 Scraping pages ${start}-${end}...`);
      
      const scrapeRes = await fetch(`${SCRAPE_BASE_URL}?startPage=${start}&endPage=${end}`);
      if (!scrapeRes.ok) {
        console.error(`Scrape failed for pages ${start}-${end}: ${scrapeRes.status}`);
        continue;
      }
      
      const scrapeData = await scrapeRes.json();
      const properties = Array.isArray(scrapeData) ? scrapeData : scrapeData.properties ?? scrapeData.data ?? [];
      allProperties = allProperties.concat(properties);
    }

    console.log(`📦 Total properties scraped: ${allProperties.length}`);

    // Step 3: Upsert into database
    let upserted = 0;
    let errors = 0;

    for (const prop of allProperties) {
      const record = {
        external_id: String(prop.external_id ?? prop.id ?? ""),
        title: prop.title ?? null,
        operation: prop.operation ?? null,
        price: prop.price ? Number(prop.price) : null,
        currency: prop.currency ?? null,
        address: prop.address ?? null,
        locality: prop.locality ?? null,
        lat: prop.latitude ?? prop.lat ?? null,
        lng: prop.longitude ?? prop.lng ?? null,
        brokers: prop.brokers ?? null,
        contact_person: prop.contact_person ?? null,
        office: prop.office ?? null,
        dimensions_land_m2: prop.dimensions_land_m2 ? Number(prop.dimensions_land_m2) : null,
        m2_total: prop.m2_total ? Number(prop.m2_total) : null,
        m2_cover: prop.m2_cover ? Number(prop.m2_cover) : null,
        ambientes: prop.ambientes ? Number(prop.ambientes) : null,
        banos: prop.banos ? Number(prop.banos) : null,
        property_type: prop.property_type ?? null,
        url: prop.url ?? null,
        photo: prop.photo ?? null,
      };

      if (!record.external_id) {
        errors++;
        continue;
      }

      const { error } = await supabase
        .from("properties")
        .upsert(record, { onConflict: "external_id" });

      if (error) {
        console.error(`Error upserting ${record.external_id}:`, error.message);
        errors++;
      } else {
        upserted++;
      }
    }

    const result = { 
      success: true, 
      total_scraped: allProperties.length, 
      upserted, 
      errors,
      timestamp: new Date().toISOString(),
    };
    console.log("✅ Scrape complete:", result);

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
