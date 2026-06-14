import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, handleOptions } from "../_shared/cors.ts";
import { errorResponse, safeError } from "../_shared/http.ts";
import { requireString, requireUuid, optionalString, ValidationError } from "../_shared/validation.ts";
import { importVapidKeys, createVapidAuthHeader, encryptPayload } from "./webpush.ts";

// ---- Main handler ----

serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;

  try {
    const body = await req.json();

    // Allow clients to fetch the VAPID public key to stay in sync
    if (body.action === "get_vapid_key") {
      const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY")!;
      return new Response(JSON.stringify({ vapid_public_key: vapidPublicKey }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const user_id = requireUuid(body.user_id, "user_id");
    const title = requireString(body.title, "title", { maxLength: 200 });
    const pushBody = optionalString(body.body, "body", { maxLength: 500 }) ?? "";
    const url = optionalString(body.url, "url", { maxLength: 500 }) ?? "/";

    const triggerSource = typeof body.trigger_source === "string"
      ? body.trigger_source.slice(0, 64)
      : null;

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: subs } = await supabaseAdmin
      .from("push_subscriptions")
      .select("*")
      .eq("user_id", user_id);

    if (!subs || subs.length === 0) {
      return new Response(JSON.stringify({ sent: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY")!;
    const vapidPrivateKeyB64 = Deno.env.get("VAPID_PRIVATE_KEY")!;
    const { privateKey, publicKeyRaw } = await importVapidKeys(vapidPublicKey, vapidPrivateKeyB64);

    const payload = JSON.stringify({ title, body: pushBody || "", url: url || "/" });
    let sent = 0;
    const deliveryLogs: Array<{
      user_id: string;
      endpoint_preview: string;
      status: "sent" | "failed" | "pruned";
      http_status: number | null;
      error_message: string | null;
      pruned: boolean;
      trigger_source: string | null;
    }> = [];

    for (const sub of subs) {
      const endpointPreview = sub.endpoint.slice(0, 80);
      try {
        const encrypted = await encryptPayload(payload, sub.p256dh, sub.auth);
        const authHeader = await createVapidAuthHeader(
          sub.endpoint,
          vapidPublicKey,
          privateKey,
          publicKeyRaw,
          "mailto:alan@remax-docta.com"
        );

        const res = await fetch(sub.endpoint, {
          method: "POST",
          headers: {
            Authorization: authHeader,
            "Content-Encoding": "aes128gcm",
            "Content-Type": "application/octet-stream",
            TTL: "86400",
          },
          body: encrypted,
        });

        if (res.ok || res.status === 201) {
          sent++;
          deliveryLogs.push({
            user_id,
            endpoint_preview: endpointPreview,
            status: "sent",
            http_status: res.status,
            error_message: null,
            pruned: false,
            trigger_source: triggerSource,
          });
        } else {
          const respText = await res.text();
          const isVapidMismatch =
            res.status === 400 && /VapidPk|BadJwtToken/i.test(respText);
          const shouldPrune =
            res.status === 410 || res.status === 404 || isVapidMismatch;
          if (shouldPrune) {
            await supabaseAdmin.from("push_subscriptions").delete().eq("id", sub.id);
            console.log(
              `Removed dead subscription ${sub.id} (status=${res.status}, endpoint=${endpointPreview}…): ${respText}`
            );
            deliveryLogs.push({
              user_id,
              endpoint_preview: endpointPreview,
              status: "pruned",
              http_status: res.status,
              error_message: respText.slice(0, 500),
              pruned: true,
              trigger_source: triggerSource,
            });
          } else {
            console.error(`Push failed for ${sub.id}: ${res.status} ${respText}`);
            deliveryLogs.push({
              user_id,
              endpoint_preview: endpointPreview,
              status: "failed",
              http_status: res.status,
              error_message: respText.slice(0, 500),
              pruned: false,
              trigger_source: triggerSource,
            });
          }
        }
      } catch (err) {
        console.error(`Push error for ${sub.id}:`, err);
        deliveryLogs.push({
          user_id,
          endpoint_preview: endpointPreview,
          status: "failed",
          http_status: null,
          error_message: (err as Error)?.message?.slice(0, 500) ?? "unknown error",
          pruned: false,
          trigger_source: triggerSource,
        });
      }
    }

    if (deliveryLogs.length > 0) {
      const { error: logErr } = await supabaseAdmin
        .from("push_delivery_logs")
        .insert(deliveryLogs);
      if (logErr) {
        console.error("Failed to insert push_delivery_logs:", logErr.message);
      }
    }

    return new Response(JSON.stringify({ sent }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    if (err instanceof ValidationError) return errorResponse(err.message, 400);
    return errorResponse(safeError(err, "send-push-notification"), 500);
  }
});
