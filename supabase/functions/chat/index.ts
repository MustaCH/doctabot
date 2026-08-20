// Chat edge function — thin orchestrator.
// Heavy logic lives in ./_shared/*. See refactor notes:
//   - prompt.ts            → SYSTEM_PROMPT + buildContextualPrompt + buildAIMessages
//   - tools/definitions.ts → AI Gateway tool schemas (fuente única de la lista de tools)
//   - tools/executor.ts    → executeTool dispatcher
//   - tools/validators.ts  → input sanitizers
//   - tools/google.ts      → Calendar/Gmail helpers
//   - auth.ts              → JWT validation + profile lookup
//   - supervisor.ts        → quality supervisor + retry loop + logging
//   - notifications.ts     → push notifications + n8n webhook
//   - title.ts             → auto-generated conversation titles
//   - sse.ts               → SSE streaming response
//   - cors.ts              → shared CORS headers + MAX_MESSAGE_LENGTH

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import { corsHeaders, MAX_MESSAGE_LENGTH, validateAttachmentSizes } from "./_shared/cors.ts";
import { authenticateRequest } from "./_shared/auth.ts";
import { buildContextualPrompt, buildAIMessages, buildActiveClientBlock, buildDateBlock } from "./_shared/prompt.ts";
import { toolDefinitions } from "./_shared/tools/definitions.ts";
import { executeTool, fetchAllClientContactRows } from "./_shared/tools/executor.ts";
import { getValidCalendarToken } from "./_shared/tools/google.ts";
import { generateTitle, regenerateTitle } from "./_shared/title.ts";
import { updateClientSummary } from "./_shared/client-summary.ts";
import { runSupervisorEval, logSupervisorResult } from "./_shared/supervisor.ts";
import { streamTurn } from "./_shared/stream-turn.ts";
import { extractListingSlugs, neutralizeFabricatedListings, validSlugSetFromUrls } from "./_shared/link-guardrail.ts";
import { sanitizePattern } from "./_shared/tools/validators.ts";
import { expandCards, collapseEmptyBubbles, renderPropertyCard, expandContactCards } from "./_shared/card-render.ts";
import { normalizePhone, sanitizeWhatsappBlocks, whatsappNeutralizedNotice, whatsappRemovedNotice, whatsappCorrectedNotice, verifyContactListPhones } from "./_shared/whatsapp-guardrail.ts";
import { MSG_BREAK } from "./_shared/alan-facts.ts";
import { fetchWithRetry } from "./_shared/retry.ts";
import { sendPushNotification, notifyN8nWebhook } from "./_shared/notifications.ts";
import { reportEdgeErrorBg } from "../_shared/observability.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { messages, conversationId, client_caps } = await req.json();
    // Handshake de capacidades (86aj9w5nb): el goteo en vivo + evento de reemplazo "final"
    // solo se activa si el front declara soportarlo — un bundle PWA viejo sigue recibiendo
    // el protocolo histórico (ronda final volcada de una) sin degradación.
    const supportsFinalEvent = Array.isArray(client_caps) && client_caps.includes("final_event");
    // Using Gemini API key directly (OpenAI-compatible endpoint) instead of Lovable AI Gateway
    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY not configured");
    // Alias kept for downstream functions that expect "apiKey"
    const LOVABLE_API_KEY = GEMINI_API_KEY;

    // Validate message lengths to prevent abuse
    if (Array.isArray(messages)) {
      for (const m of messages) {
        if (typeof m.content === "string" && m.content.length > MAX_MESSAGE_LENGTH) {
          return new Response(JSON.stringify({ error: "Mensaje demasiado largo" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }
    }

    // Tope de tamaño de adjuntos (el límite de content no cubre el base64 de imágenes).
    const attachmentSizeError = validateAttachmentSizes(messages);
    if (attachmentSizeError) {
      return new Response(JSON.stringify({ error: attachmentSizeError }), {
        status: 413,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Authenticate
    const authResult = await authenticateRequest(req, supabaseUrl, supabase);
    if (authResult instanceof Response) return authResult;
    const { userId, agentName, agentCode } = authResult;

    // Rate limiting propio (control de costo). Límites configurables por env. Fail-open:
    // si la función todavía no está deployada (rlError), no bloqueamos el chat.
    const RL_MAX = parseInt(Deno.env.get("CHAT_RATE_LIMIT_MAX") ?? "30", 10);
    const RL_WINDOW = parseInt(Deno.env.get("CHAT_RATE_LIMIT_WINDOW_SECONDS") ?? "300", 10);
    const { data: rlAllowed, error: rlError } = await supabase.rpc("check_chat_rate_limit", {
      p_user_id: userId,
      p_max: RL_MAX,
      p_window_seconds: RL_WINDOW,
    });
    if (!rlError && rlAllowed === false) {
      return new Response(JSON.stringify({ error: "Demasiadas solicitudes. Esperá un momento e intentá de nuevo." }), {
        status: 429,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Google credentials
    const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID")!;
    const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET")!;

    // Tool execution context
    // Lista ordenada de propiedades a mostrar como tarjeta en este turno. La llenan las tools que
    // producen tarjetas (search_properties, get_favorites, list_client_properties) vía toCardStub;
    // la consume el expansor de <<<PROPERTIES>>> en sanitizeFinal, por POSICIÓN (no por ningún id que
    // emita el modelo). Per-turno: se recrea en cada request. Ver 86ajangkb.
    const cardResults: any[] = [];
    // Registro por-turno de contactos surgidos vía list_clients/get_client (name + teléfono canónico).
    // Lo usa el guardarraíl de WhatsApp para CORREGIR un número inventado cuando el borrador nombra
    // sin ambigüedad al cliente. Se siembra con el cliente vinculado a la conversación (abajo). Ver 86ajb5g8d.
    const clientRegistry: Array<{ name: string; phone: string }> = [];
    // Teléfonos del cliente ACTIVO sembrado (vinculado a la conversación): son los únicos bloques de
    // WhatsApp que pasan el gate estructural cuando list_clients/get_client NO corrió en el turno
    // ("mandale un WhatsApp a este cliente" no necesita re-listar). Ver sanitizeWhatsappBlocks.
    const seedPhones = new Set<string>();
    // Embedding de consulta para el hybrid search (86aj9w5pn): gemini-embedding-001 con
    // outputDimensionality=768 — a <3072 dims el modelo devuelve el vector SIN normalizar
    // (verificado con sonda), así que se normaliza L2 acá (la RPC compara por coseno contra
    // embeddings backfilleados con la misma normalización). Fail-open: cualquier error o
    // timeout devuelve null y la búsqueda sigue con trigram puro.
    const embedQuery = async (text: string): Promise<number[] | null> => {
      try {
        const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent", {
          method: "POST",
          headers: { "x-goog-api-key": GEMINI_API_KEY, "Content-Type": "application/json" },
          body: JSON.stringify({ content: { parts: [{ text }] }, taskType: "RETRIEVAL_QUERY", outputDimensionality: 768 }),
          signal: AbortSignal.timeout(4_000),
        });
        if (!res.ok) return null;
        const json = await res.json();
        const values: unknown = json?.embedding?.values;
        if (!Array.isArray(values) || values.length !== 768) return null;
        const norm = Math.sqrt((values as number[]).reduce((a, v) => a + v * v, 0));
        return norm > 0 ? (values as number[]).map((v) => v / norm) : null;
      } catch {
        return null;
      }
    };

    const toolCtx: any = {
      supabase,
      userId,
      conversationId,
      cardResults,
      clientRegistry,
      getCalendarToken: () => getValidCalendarToken(supabase, userId, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET),
      embedQuery,
    };

    // Cliente vinculado a la conversación: lo releemos UNA vez (join) en el critical path
    // para que Alan no arranque ciego (keystone 86aj1f0vm). Scopeado por user_id (service_role
    // bypassa RLS). Fail-open: si no hay client_id, la query falla o no hay cliente, no se
    // inyecta nada y el chat sigue normal.
    let activeClientBlock = "";
    // Cliente vinculado del turno (86aj9w5nu): lo conserva el background para regenerar su
    // ai_summary post-turno.
    let activeClientId: string | null = null;
    if (conversationId) {
      try {
        const { data: conv } = await supabase
          .from("conversations")
          .select("client_id, clients(full_name, status, client_type, phone, email, preferred_zones, budget_min, budget_max, budget_currency, property_type_interest, birthday, company, ai_summary)")
          .eq("id", conversationId)
          .eq("user_id", userId)
          .maybeSingle();
        if (conv?.client_id && conv.clients) {
          activeClientId = conv.client_id;
          activeClientBlock = buildActiveClientBlock(conv.clients as any);
          // Sembrar el registro para el guardarraíl de WhatsApp: cubre "mandale un WhatsApp a este
          // cliente" sin que Alan haya llamado list_clients/get_client en el turno.
          const c = conv.clients as any;
          const seedPhone = normalizePhone(c.phone);
          if (c.full_name && seedPhone) {
            clientRegistry.push({ name: c.full_name, phone: seedPhone });
            seedPhones.add(seedPhone);
          }
        }
      } catch (e) {
        console.error("active client lookup error:", e);
      }
    }

    // MEMORIA ENTRE CHATS v1 (86ajbr466): bloque de actividad de campaña reciente, derivado del
    // registro REAL (last_contact_at). Le da a Alan continuidad entre conversaciones para el flujo
    // de recontacto ("ayer te pasé una tanda de N, ¿los contactaste?") sin depender de su memoria.
    // Fail-open y barato (una query chica); si no hubo actividad, no se inyecta nada.
    let recentOutreachBlock = "";
    try {
      const { data: recent } = await supabase
        .from("clients")
        .select("full_name, last_contact_at")
        .eq("user_id", userId)
        .gte("last_contact_at", new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString())
        .order("last_contact_at", { ascending: false })
        .limit(60);
      if (recent && recent.length > 0) {
        const hoy = new Date().toISOString().slice(0, 10);
        const ayer = new Date(Date.now() - 24 * 3600 * 1000).toISOString().slice(0, 10);
        const byDay = (d: string) => (recent as any[]).filter((r) => String(r.last_contact_at).slice(0, 10) === d);
        const fmt = (rows: any[]) => rows.length <= 15 ? `${rows.length} (${rows.map((r) => r.full_name).join(", ")})` : `${rows.length}`;
        const h = byDay(hoy);
        const a = byDay(ayer);
        const lines: string[] = [];
        if (h.length) lines.push(`- Hoy: ${fmt(h)}`);
        if (a.length) lines.push(`- Ayer: ${fmt(a)}`);
        if (lines.length) {
          recentOutreachBlock = `ACTIVIDAD DE CAMPAÑA RECIENTE (registro REAL del sistema — clientes marcados como contactados):\n${lines.join("\n")}\nSi el agente pide OTRA tanda de clientes para contactar, mencionale esta actividad ("hoy/ayer ya te pasé ${h.length || a.length}") y preguntale si ya los contactó, antes de dar más. La rotación sin repetir la garantiza list_clients con order="least_contacted" + mark_contacted=true — usala siempre para tandas.`;
        }
      }
    } catch (e) {
      console.error("recent outreach block error:", e);
    }

    // Build prompt and messages. Orden pensado para el prompt caching implícito de Gemini
    // (86aj9w5n8): primero el prefijo ESTÁTICO por agente (buildContextualPrompt, ~17k tokens),
    // después los bloques por-conversación (cliente activo, campaña) y AL FINAL la fecha/hora
    // (cambia minuto a minuto — antes iba dentro del prompt contextual y rompía el prefijo
    // cacheable en cada turno).
    const contextualPrompt = buildContextualPrompt(agentName, agentCode);
    const systemContent = [contextualPrompt, activeClientBlock, recentOutreachBlock, buildDateBlock()].filter(Boolean).join("\n\n");
    const currentMessages: any[] = [
      { role: "system", content: systemContent },
      ...buildAIMessages(messages),
    ];

    // Gemini OpenAI-compatible endpoint (no Lovable Gateway). Single primary model.
    // gemini-3.7-flash (86aj9w5nf, ago-2026): línea Flash = flagship agéntico de Google. Upgrade
    // desde 3.5-flash validado con el golden set head-to-head (220 turnos en 3.7: 98,2% de pass,
    // diferencia explicada por un eval flaky rediseñado; ~33% menos de latencia por turno).
    // Gotchas 3.x del tool-loop (siguen aplicando, validados contra la API real vía sonda):
    //  1. reenviar el thought_signature de cada tool_call en la continuación (sse-parse/stream-turn);
    //  2. tratar como ronda de herramientas toda ronda que acumule tool_calls, porque 3.x streaming
    //     cierra con finish_reason:"stop" (no "tool_calls" como 2.5).
    const PRIMARY_MODEL = "gemini-3.7-flash";
    const AI_URL = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
    const aiHeaders = { Authorization: `Bearer ${GEMINI_API_KEY}`, "Content-Type": "application/json" };
    // Timeout por llamada al modelo: si Gemini cuelga, se aborta (cada iteración del turno
    // es un fetch nuevo con su propia señal). max_tokens acota la respuesta y hace que
    // finish_reason:"length" sea significativo (lo maneja streamTurn).
    const AI_TIMEOUT_MS = 60_000;
    const AI_MAX_TOKENS = 8192;

    // Presupuesto de tiempo TOTAL del turno (86aj9w5mm): el timeout de arriba es POR llamada al
    // modelo, no por turno — el peor caso (7 iteraciones × 60s + tools) superaba el wall-clock de
    // la Edge Function y la plataforma mataba la función a mitad del stream: cliente colgado sin
    // [DONE] ni catch, y la persistencia en background podía no correr. Doble mecanismo:
    //  1. streamTurn no arranca otra iteración pasado el deadline (cierre elegante con aviso);
    //  2. el timeout de cada llamada se acota al presupuesto restante (piso de 5s), así una
    //     llamada en curso tampoco lo pincha por mucho.
    // Default 120s, configurable por env. Supuesto documentado en el ticket: wall-clock ~150s
    // (no verificado) — el default deja ~30s de margen para sanitizeFinal + cierre + background.
    const TURN_BUDGET_MS = parseInt(Deno.env.get("CHAT_TURN_BUDGET_MS") ?? "120000", 10);
    const TURN_DEADLINE_AT = Date.now() + TURN_BUDGET_MS;

    // Retry con backoff para transitorios (5xx/429/red/timeout). Seguro: re-pide la generación a
    // Gemini sin re-ejecutar tools (los resultados ya están en `messages`). Evita que un blip
    // transitorio en una continuación del tool-loop tumbe el turno entero. Ver 86aj1ncj4.
    const resilientAIFetch = async (body: Record<string, any>): Promise<Response> => {
      // include_usage (86aj9w5n8): el último chunk del stream trae usage con
      // prompt_tokens_details.cached_tokens — la medición real del prompt caching implícito.
      // Verificado contra la API real vía sonda: el endpoint OpenAI-compat lo acepta y lo emite.
      const payload = JSON.stringify({ ...body, model: PRIMARY_MODEL, max_tokens: AI_MAX_TOKENS, stream_options: { include_usage: true } });
      return fetchWithRetry(() => fetch(AI_URL, {
        method: "POST",
        headers: aiHeaders,
        body: payload,
        signal: AbortSignal.timeout(Math.max(5_000, Math.min(AI_TIMEOUT_MS, TURN_DEADLINE_AT - Date.now()))),
      }));
    };

    const toolLoopDeps = { resilientAIFetch, executeTool, toolCtx, toolDefinitions };

    // Guardarraíl de integridad de links: la ronda de texto final se bufferiza, así que antes de
    // volcarla validamos los listings de remax contra la tabla `properties` (única fuente de un
    // listing real — Alan solo los obtiene vía las tools que leen esa tabla). Un slug que no existe
    // en la DB lo fabricó el modelo → lo neutralizamos para no mandarle un link muerto al cliente
    // (remax redirige los listings inexistentes a la home). Fail-open: cualquier error deja el texto
    // intacto. Es la red determinista que respalda la regla de prompt "copiá el url exacto".
    const sanitizeFinal = async (text: string, executedTools: string[] = []): Promise<string> => {
      // 1) Expansión de tarjetas: el modelo marca DÓNDE van con <<<PROPERTIES>>> y el server las arma
      //    (foto + link con ?associate) desde los resultados del turno, POR POSICIÓN — inmune a que el
      //    modelo invente/renumere/no reproduzca ids (causa raíz de 86ajangkb y del bug de burbujas
      //    vacías del follow-up). Red de seguridad: si el modelo no ubicó todos los resultados
      //    (marcador olvidado o de menos), se anexan al final para no perder ninguno. Luego se
      //    colapsan burbujas vacías. Todo puro, no lanza.
      let working = text;
      try {
        const { text: expanded, leftover, hadMarker } = expandCards(working, cardResults, agentCode);
        working = expanded;
        if (leftover.length > 0) {
          // Red de seguridad para tarjetas sin ubicar (M7). Solo anexamos cuando:
          //  (a) el modelo NO puso NINGÚN marcador (si puso <<<CARD>>>/<<<PROPERTIES>>>, eligió
          //      deliberadamente qué mostrar: anexar el resto contradice su respuesta), Y
          //  (b) el lote está FRESCO según la señal del tool result (toolCtx.cardBatchFresh): la
          //      última tool de tarjetas del turno devolvió resultados (showing > 0) y el lote no
          //      fue limpiado por una búsqueda posterior con 0 resultados (M6).
          // La vieja heurística de puntuación ("la respuesta termina en ?") fallaba en ambas
          // direcciones: suprimía tarjetas legítimas de respuestas que cerraban con pregunta y
          // pegaba tarjetas viejas bajo un "no encontré" sin signo. Trade-off deliberado: una
          // respuesta de solo conteo ("hay 172, ¿te muestro?") puede llevar tarjetas debajo —
          // preferible a suprimir tarjetas legítimas de una búsqueda real.
          if (!hadMarker && toolCtx.cardBatchFresh === true) {
            const tail = leftover.map((p) => renderPropertyCard(p, agentCode)).join(MSG_BREAK);
            working = `${working}${MSG_BREAK}${tail}`;
            console.warn("card-render: resultados anexados (marcador ausente)", { count: leftover.length });
          } else {
            console.warn("card-render: leftover descartado (marcador parcial o lote no fresco)", { count: leftover.length, hadMarker, fresh: toolCtx.cardBatchFresh === true });
          }
        }
        // Tarjetas de CONTACTO (<<<CONTACTS>>>): el modelo marca dónde va la lista y el server la
        // arma desde la última página de list_clients del turno (una tarjeta por burbuja). Fail-safe:
        // sin resultados o sin marcador no queda token crudo. Ver card-render.ts / 86ajbr466.
        const cc = expandContactCards(working, toolCtx.contactCardResults ?? []);
        if (cc.hadMarker) {
          working = cc.text;
          if (cc.rendered > 0) console.warn("contact-cards: expandidas", { count: cc.rendered });
        }
        working = collapseEmptyBubbles(working);
      } catch (e) {
        console.error("card-render expand error:", e);
      }

      // 2) Backstop de links inventados FUERA de tarjeta (borradores/fichas donde el modelo aún
      //    escribe la URL a mano). Valida los listings de remax contra la tabla `properties` y
      //    neutraliza los slugs inexistentes. Fail-open: cualquier error deja `working` intacto.
      try {
        const slugs = extractListingSlugs(working);
        if (slugs.length > 0) {
          // Verificación por SLUG, no por igualdad exacta de URL: la DB puede tener variantes
          // legítimas (http://, sin www, barra final, query params) que antes daban falso positivo
          // y neutralizaban links reales. Prefetch con ilike %/listings/<slug>% (los slugs ya son
          // [a-z0-9-] por la regex de extracción; sanitizePattern es defensa en profundidad) y
          // después comparación EXACTA de slug contra las filas (validSlugSetFromUrls) — así un
          // slug más largo de la DB no valida a un candidato más corto. Slugs realmente
          // inexistentes siguen neutralizados igual que antes.
          const orExpr = slugs
            .map((s) => sanitizePattern(s))
            .filter(Boolean)
            .map((s) => `url.ilike.%/listings/${s}%`)
            .join(",");
          const { data, error } = await supabase.from("properties").select("url").or(orExpr);
          if (!error) {
            const valid = validSlugSetFromUrls(((data ?? []) as Array<{ url: string | null }>).map((r) => r.url));
            const { text: cleaned, removed } = neutralizeFabricatedListings(working, valid);
            if (removed.length > 0) {
              console.warn("link-guardrail: listings inexistentes neutralizados", { count: removed.length, slugs: removed });
              const n = removed.length;
              working = `${cleaned}${MSG_BREAK}⚠️ Quité ${n} ${n === 1 ? "enlace" : "enlaces"} de propiedad que no pude verificar en el sistema (apuntaban a una página inexistente). Volvé a pedirme esas propiedades o usá las tarjetas de búsqueda, que traen el link correcto.`;
            }
          }
        }
      } catch (e) {
        console.error("link-guardrail error:", e);
      }

      // 3) Guardarraíles de TELÉFONOS (86ajb5g8d + 86ajbr466 + incidente de contactos inventados
      //    en campañas), todos contra la MISMA agenda real (CRM del agente + lo que tipeó en el
      //    turno). Fail-open.
      //    a. WhatsApp por BLOQUE (marcador + borrador): gate estructural (sin list_clients/
      //       get_client en el turno solo pasa el cliente activo sembrado), teléfono fuera de la
      //       agenda → corrección por nombre COMPLETO o eliminación del bloque ENTERO, y validación
      //       de identidad (el nombre saludado debe corresponder al dueño del teléfono).
      //    b. Listas de contactos: si la respuesta lista 3+ teléfonos que NO están en la agenda
      //       (lista fabricada, ej. "pasame 100 contactos" sin ejecutar la tool), los marca con ⚠️
      //       y avisa — el agente nunca usa números inventados sin saberlo.
      let waRemovedBlocks = 0;
      try {
        const hasWaMarker = working.includes("<<<WHATSAPP_TO:");
        const phoneish = (working.match(/\+?\d[\d \t().\-]{8,16}\d/g) ?? []).length;
        if (hasWaMarker || phoneish >= 3) {
          const validPhones = new Set<string>();
          // Dueño(s) reales de cada teléfono canónico (validación de identidad del Ticket 1).
          const phoneOwners = new Map<string, string[]>();
          // (a) Teléfonos que el agente tipeó en el turno (leads nuevos que no están en el CRM).
          //     Van también a seedPhones: eximen del gate estructural igual que el cliente activo
          //     sembrado — "escribile al 3511234567" sin list_clients en el turno es legítimo, el
          //     número lo puso el agente (B3, y prompt.ts: "el agente lo mencionó").
          for (const m of (Array.isArray(messages) ? messages : [])) {
            if (m?.role !== "user" || typeof m.content !== "string") continue;
            for (const tok of m.content.match(/[\d(+][\d\s()+-]{6,}\d/g) ?? []) {
              const canon = normalizePhone(tok);
              if (canon) {
                validPhones.add(canon);
                seedPhones.add(canon);
              }
            }
          }
          // (b) Agenda COMPLETA del agente, paginada (PostgREST corta en ~1000 filas: un select sin
          //     límite ignoraba los teléfonos más allá de la primera página). Una sola query sirve
          //     al set de válidos Y al mapa teléfono→dueño. Scopeada por user_id.
          const { rows: agendaRows, error: agendaErr } = await fetchAllClientContactRows(supabase, userId);
          // Las filas que SÍ llegaron se usan siempre (en un error parcial suman señal); pero con
          // error (total o parcial) NO se sanea: una agenda incompleta trataría como "inventados"
          // teléfonos reales y eliminaría borradores legítimos (M1 — fail-open).
          for (const row of agendaRows) {
            const canon = normalizePhone(row.phone);
            if (!canon) continue;
            validPhones.add(canon);
            if (row.full_name) {
              const names = phoneOwners.get(canon) ?? [];
              names.push(row.full_name);
              phoneOwners.set(canon, names);
            }
          }
          if (agendaErr) {
            console.error("phone-guardrails: agenda incompleta — fail-open, texto intacto sin saneo", agendaErr);
          } else {
            // Texto PRE-saneo: el umbral de listas fabricadas se calcula sobre él (m6) para que
            // los bloques que sanitizeWhatsappBlocks elimina sigan contando.
            const preSaneo = working;
            if (hasWaMarker) {
              // Gate estructural: los destinatarios de una tanda solo pueden salir de list_clients/
              // get_client ejecutadas EN ESTE turno (o del cliente sembrado / teléfonos tipeados).
              const toolVerified = executedTools.includes("list_clients") || executedTools.includes("get_client");
              const r = sanitizeWhatsappBlocks(working, { validPhones, phoneOwners, registry: clientRegistry, toolVerified, seedPhones });
              if (r.removedBlocks || r.corrected || r.neutralizedMarkers) {
                console.warn("whatsapp-guardrail", { removedBlocks: r.removedBlocks, corrected: r.corrected, neutralizedMarkers: r.neutralizedMarkers, toolVerified });
              }
              waRemovedBlocks = r.removedBlocks;
              working = collapseEmptyBubbles(r.text)
                + whatsappRemovedNotice(r.removedBlocks)
                + whatsappCorrectedNotice(r.corrected)
                + whatsappNeutralizedNotice(r.neutralizedMarkers);
            }
            const { text: verified, flagged, totalPhones } = verifyContactListPhones(working, validPhones, preSaneo);
            if (flagged > 0) {
              console.warn("contact-list-guardrail: teléfonos no verificados en lista", { flagged, totalPhones });
              working = verified;
            }
          }
        }
      } catch (e) {
        console.error("phone-guardrails error:", e);
      }

      // Reversión del marcado de campaña (M3 — mark_contacted auditable/reversible), FUERA del
      // camino de marcadores: se revierte POR DIFERENCIA — los clientes de la(s) tanda(s) marcada(s)
      // cuyo teléfono NO aparece en ningún bloque <<<WHATSAPP_TO>>> sobreviviente del texto final no
      // recibieron un borrador válido → restauramos su last_contact_at previo y borramos sus filas
      // del activity log, para que la rotación least_contacted no los saltee.
      // Caso sin NINGÚN marcador en el texto final: revertimos solo si el saneo ELIMINÓ bloques (la
      // tanda se escribió y se invalidó). Si el modelo nunca escribió borradores, NO se revierte:
      // el agente puede haber pedido la tanda para contactarla por fuera de la app (llamadas,
      // WhatsApp manual) — ahí el marcado es correcto y revertirlo rompería la rotación.
      try {
        const batch = toolCtx.markedBatch;
        if (batch?.rows?.length) {
          const surviving = new Set<string>();
          for (const m of working.matchAll(/<<<WHATSAPP_TO:([^>]*)>>>/g)) {
            const canon = normalizePhone(m[1]);
            if (canon) surviving.add(canon);
          }
          if (surviving.size > 0 || waRemovedBlocks > 0) {
            const toRevert = (batch.rows as Array<{ id: string; prev: string | null; phone: string | null }>)
              .filter((b) => !(b.phone && surviving.has(b.phone)));
            if (toRevert.length > 0) {
              await Promise.all(toRevert.map((b) =>
                supabase.from("clients").update({ last_contact_at: b.prev }).eq("id", b.id).eq("user_id", userId)));
              const revertIds = new Set(toRevert.map((b) => b.id));
              const logIds = ((batch.logs ?? []) as Array<{ id: string; client_id: string }>)
                .filter((l) => revertIds.has(l.client_id))
                .map((l) => l.id);
              if (logIds.length) {
                await supabase.from("client_activity_log").delete().in("id", logIds).eq("user_id", userId);
              }
              toolCtx.markedBatch = null;
              const n = toRevert.length;
              working += `${MSG_BREAK}↩️ Revertí el marcado de "contactados" de ${n} ${n === 1 ? "cliente" : "clientes"} de la tanda: no les quedó un borrador válido en esta respuesta, así que siguen pendientes en la rotación.`;
              console.warn("mark-contacted revertido por diferencia", { reverted: n, batchSize: batch.rows.length, surviving: surviving.size, waRemovedBlocks });
            }
          }
        }
      } catch (revErr) {
        console.error("mark-contacted revert error:", revErr);
      }

      return working;
    };

    // Primera llamada con stream:true. Validamos el status ANTES de abrir el stream al
    // cliente para preservar el contrato 429/402 que el front espera por HTTP status.
    const firstRes = await resilientAIFetch({ messages: currentMessages, tools: toolDefinitions, stream: true });
    if (!firstRes.ok) {
      if (firstRes.status === 429) return new Response(JSON.stringify({ error: "Rate limit" }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (firstRes.status === 402) return new Response(JSON.stringify({ error: "Payment required" }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      throw new Error(`AI error: ${firstRes.status}`);
    }

    // Mensaje del usuario para el supervisor (filtra SILENT THOUGHTS de transcripción).
    let userMessage = messages[messages.length - 1]?.content ?? "";
    userMessage = userMessage.replace(/^SILENT THOUGHTS:[\s\S]*?(?=\S)/i, "").trim();
    if (!userMessage) userMessage = messages[messages.length - 1]?.content ?? "";

    // Contexto del turno anterior (penúltimo user + último assistant) para que el supervisor
    // interprete follow-ups ("sí, dale", "mandáselo") en contexto. Solo con historial. Ver 86aj1f1up.
    const asText = (c: any): string => typeof c === "string" ? c : Array.isArray(c) ? c.map((p: any) => (typeof p?.text === "string" ? p.text : "")).join(" ") : "";
    const priorContext = messages.length > 1
      ? {
          user: asText([...messages].slice(0, -1).reverse().find((m: any) => m.role === "user")?.content),
          assistant: asText([...messages].reverse().find((m: any) => m.role === "assistant")?.content),
        }
      : null;

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        let clientOpen = true;
        const emit = (text: string) => {
          if (!clientOpen) return;
          try {
            const chunk = JSON.stringify({ choices: [{ delta: { content: text }, finish_reason: null }] });
            controller.enqueue(encoder.encode(`data: ${chunk}\n\n`));
          } catch {
            clientOpen = false; // cliente desconectado; streamTurn sigue drenando Gemini
          }
        };
        // Evento de REEMPLAZO (86aj9w5nb): el texto final SANEADO completo. El front descarta
        // lo goteado en vivo y re-renderiza desde acá (mismo parseo que la recarga).
        const emitFinal = (text: string) => {
          if (!clientOpen) return;
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ final: { content: text } })}\n\n`));
          } catch {
            clientOpen = false;
          }
        };

        let finalContent = "";
        let executedTools: string[] = [];
        let streamFailed = false;
        let streamErrorMessage = "";
        try {
          const result = await streamTurn(toolLoopDeps, {
            messages: currentMessages,
            emit,
            // Goteo en vivo solo con el handshake del front (ver client_caps arriba).
            ...(supportsFinalEvent ? { emitFinal } : {}),
            firstResponse: firstRes,
            sanitizeFinal,
            // maxIterations agotado sin ronda de texto final: la respuesta salió incompleta
            // (con aviso visible anexado por streamTurn) → lo registramos en error_logs con
            // las tools ejecutadas del turno para diagnóstico.
            onMaxIterationsExhausted: (turnTools) => reportEdgeErrorBg({
              context: "chat-maxIterations",
              error: new Error("streamTurn agotó maxIterations sin ronda de texto final"),
              userId,
              metadata: {
                conversationId: conversationId ?? null,
                executedTools: turnTools,
                userMessage: typeof userMessage === "string" ? userMessage.slice(0, 300) : null,
              },
            }),
            // Presupuesto de tiempo total del turno (86aj9w5mm): cierre elegante con aviso al
            // usuario en vez de morir por wall-clock. Registro en error_logs para medir cuántos
            // turnos reales lo tocan.
            deadlineAt: TURN_DEADLINE_AT,
            onDeadlineExhausted: (turnTools) => reportEdgeErrorBg({
              context: "chat-turnDeadline",
              error: new Error(`streamTurn agotó el presupuesto de tiempo del turno (${TURN_BUDGET_MS}ms) sin ronda de texto final`),
              userId,
              metadata: {
                conversationId: conversationId ?? null,
                executedTools: turnTools,
                userMessage: typeof userMessage === "string" ? userMessage.slice(0, 300) : null,
              },
            }),
          });
          finalContent = result.content;
          executedTools = result.executedTools;
          // Medición del prompt caching implícito (86aj9w5n8): greppeable en los logs de la
          // función como "turn-usage". cacheRate = cachedTokens/promptTokens del turno entero.
          if (result.usage) {
            const u = result.usage;
            console.log("turn-usage", JSON.stringify({
              promptTokens: u.promptTokens,
              cachedTokens: u.cachedTokens,
              completionTokens: u.completionTokens,
              cacheRate: u.promptTokens > 0 ? Math.round((u.cachedTokens / u.promptTokens) * 100) / 100 : 0,
              rounds: u.rounds,
            }));
          }
        } catch (err) {
          console.error("streamTurn error:", err);
          // Guardamos el error real para mandarlo al webhook (observabilidad — ver 86aj1ncj4).
          streamErrorMessage = err instanceof Error ? err.message : String(err);
          // Instrumentación (86aj4276y): el catch del turno NO escribía en error_logs (solo pingeaba
          // n8n), dejando ciego el fallo más común del chat. Lo registramos con contexto para
          // diagnosticar el throw determinista del tool-loop tras search_properties.
          reportEdgeErrorBg({
            context: "chat-streamTurn",
            error: err,
            userId,
            metadata: {
              conversationId: conversationId ?? null,
              userMessage: typeof userMessage === "string" ? userMessage.slice(0, 300) : null,
              messagesLen: Array.isArray(messages) ? messages.length : null,
            },
          });
          // Persistimos el mensaje de error para que la conversación sea consistente al recargar.
          finalContent = "Lo siento, hubo un problema generando la respuesta. ¿Podés intentar de nuevo?";
          emit(finalContent);
          streamFailed = true;
        }

        try { controller.enqueue(encoder.encode("data: [DONE]\n\n")); } catch { /* noop */ }
        try { controller.close(); } catch { /* noop */ }

        // Trabajo de fondo: persistencia + supervisor + título + push. Desacoplado del
        // cliente: corre aunque se haya desconectado.
        const background = (async () => {
          try {
            if (finalContent && conversationId) {
              const admin = createClient(supabaseUrl, supabaseServiceKey);
              // Defensa en profundidad (service_role bypassa RLS): el UPDATE scopeado por user_id
              // solo afecta la conversación si es del agente. Persistimos el mensaje SOLO si afectó
              // una fila, evitando escritura cross-tenant con un conversationId ajeno (viene crudo
              // del body). messages no tiene user_id: su dueño es transitivo vía conversation_id. Ver 86aj1n1tf.
              const { data: owned } = await admin
                .from("conversations")
                .update({ updated_at: new Date().toISOString() })
                .eq("id", conversationId)
                .eq("user_id", userId)
                .select("id")
                .maybeSingle();
              if (owned) {
                await admin.from("messages").insert({ conversation_id: conversationId, role: "assistant", content: finalContent });
              }
            }

            if (conversationId && messages.length === 1 && userId && !streamFailed) {
              generateTitle(messages, finalContent, conversationId, userId, supabase, GEMINI_API_KEY);
            } else if (conversationId && userId && !streamFailed && finalContent && messages.length > 1) {
              // Re-titulado (una sola vez, cap por title_locked): cuando la conversación cambió
              // de foco — al vincular un cliente (hito semántico) o al acumular ~6 mensajes —,
              // regeneramos el título con contexto acumulado. No pisa renames manuales. Ver 86aj1f24c.
              const linkedThisTurn = executedTools.includes("link_conversation");
              if (linkedThisTurn || messages.length >= 6) {
                const { data: conv } = await supabase
                  .from("conversations")
                  .select("client_id, clients(full_name)")
                  .eq("id", conversationId)
                  .eq("user_id", userId)
                  .maybeSingle();
                const clientName = (conv as any)?.clients?.full_name ?? null;
                const recentMessages = [...messages.slice(-5), { role: "assistant", content: finalContent }];
                regenerateTitle({ conversationId, userId, supabase, apiKey: GEMINI_API_KEY, recentMessages, clientName });
              }
            }

            // Memoria de cliente (86aj9w5nu): con cliente vinculado (de antes, o vinculado EN
            // este turno vía link_conversation), regeneramos su ai_summary con el último
            // intercambio. Fail-open y en background: nunca toca el turno.
            if (!streamFailed && finalContent && conversationId) {
              try {
                let summaryClientId = activeClientId;
                if (!summaryClientId && executedTools.includes("link_conversation")) {
                  const { data: convNow } = await supabase
                    .from("conversations")
                    .select("client_id")
                    .eq("id", conversationId)
                    .eq("user_id", userId)
                    .maybeSingle();
                  summaryClientId = convNow?.client_id ?? null;
                }
                if (summaryClientId) {
                  await updateClientSummary({
                    supabase,
                    apiKey: GEMINI_API_KEY,
                    userId,
                    clientId: summaryClientId,
                    userMessage: typeof userMessage === "string" ? userMessage : "",
                    assistantMessage: finalContent,
                  });
                }
              } catch (sumErr) {
                console.error("client-summary bg error:", sumErr);
              }
            }

            if (streamFailed) {
              // El turno falló: no corre el supervisor (no tiene sentido evaluar el mensaje de error).
              notifyN8nWebhook({ type: "empty_response", conversationId: conversationId || null, userId, userMessage, alanResponse: finalContent, verdict: "error", reason: streamErrorMessage || "stream_error", score: 0, retryCount: 0 });
            } else if (finalContent) {
              const supervisorResult = await runSupervisorEval({ content: finalContent, userMessage, apiKey: LOVABLE_API_KEY, executedTools, priorContext, searchAppliedFilters: toolCtx.lastSearchAppliedFilters ?? null });
              logSupervisorResult({ supabaseUrl, supabaseServiceKey, conversationId: conversationId || null, userId, userMessage, finalContent, result: supervisorResult });

              const shouldNotify = supervisorResult.verdict === "error" || supervisorResult.verdict === "rejected";
              if (shouldNotify) {
                notifyN8nWebhook({
                  type: supervisorResult.verdict === "error" ? "supervisor_error" : "persistent_rejection",
                  conversationId: conversationId || null,
                  userId,
                  userMessage,
                  alanResponse: finalContent,
                  verdict: supervisorResult.verdict,
                  reason: supervisorResult.reason,
                  score: supervisorResult.score,
                  retryCount: supervisorResult.retryCount,
                });
              } else if (
                // Respuesta aprobada pero mediocre: alertamos para que la franja media no pase
                // silenciosa. Umbral configurable (default 5). Ver ticket 86aj1f157.
                supervisorResult.verdict === "approved" &&
                typeof supervisorResult.score === "number" &&
                supervisorResult.score > 0 &&
                supervisorResult.score <= parseInt(Deno.env.get("LOW_QUALITY_THRESHOLD") ?? "5", 10)
              ) {
                notifyN8nWebhook({
                  type: "low_quality",
                  conversationId: conversationId || null,
                  userId,
                  userMessage,
                  alanResponse: finalContent,
                  verdict: supervisorResult.verdict,
                  reason: supervisorResult.reason,
                  score: supervisorResult.score,
                  retryCount: supervisorResult.retryCount,
                });
              }
            } else {
              notifyN8nWebhook({ type: "empty_response", conversationId: conversationId || null, userId, userMessage, alanResponse: "", verdict: "error", reason: "empty", score: 0, retryCount: 0 });
            }

            // Push: ya no usamos la heurística de latencia (con streaming real casi todo
            // turno supera el viejo umbral de 1.5s → push redundante). Disparamos cuando
            // hay una respuesta real; el service worker decide si MOSTRARLA según el foco
            // real del usuario (suprime si ya está mirando esta conversación). Ver sw.ts.
            if (userId && conversationId && finalContent && !streamFailed) {
              sendPushNotification({ supabaseUrl, supabaseServiceKey, userId, conversationId, content: finalContent });
            }
          } catch (bgErr) {
            console.error("background task error:", bgErr);
          }
        })();

        // Mantener viva la función para el trabajo de fondo tras cerrar la respuesta.
        const edgeRuntime = (globalThis as any).EdgeRuntime;
        if (edgeRuntime?.waitUntil) {
          edgeRuntime.waitUntil(background);
        } else {
          await background; // fallback local/test
        }
      },
    });

    return new Response(stream, { headers: { ...corsHeaders, "Content-Type": "text/event-stream" } });
  } catch (e) {
    console.error("chat error:", e);
    // Observabilidad (ticket 86aj18r6x): registrar el error en error_logs + ping n8n.
    reportEdgeErrorBg({ context: "chat", error: e });
    return new Response(JSON.stringify({ error: "Error al procesar la solicitud" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
