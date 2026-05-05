import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

// ---------- Capability detection ----------

export type PushSupportStatus =
  | "supported"        // Browser + context allow push, can subscribe
  | "ios-needs-install" // iOS Safari tab — must Add to Home Screen first
  | "ios-too-old"      // iOS < 16.4 — no web push support
  | "unsupported";     // Browser has no PushManager / serviceWorker

interface PushCapability {
  status: PushSupportStatus;
  isIOS: boolean;
  iosVersion: number | null;
  isStandalone: boolean;
}

function detectIOSVersion(): number | null {
  const ua = navigator.userAgent;
  // Matches "OS 16_4" / "Version/16.4" patterns
  const match = ua.match(/OS (\d+)[._](\d+)/);
  if (!match) return null;
  return parseFloat(`${match[1]}.${match[2]}`);
}

function detectIsIOS(): boolean {
  const ua = navigator.userAgent;
  // iPad on iOS 13+ identifies as Mac — also check touch capability
  return (
    /iPhone|iPad|iPod/.test(ua) ||
    (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
  );
}

function detectIsStandalone(): boolean {
  // PWA installed to Home Screen on iOS exposes navigator.standalone
  // Other platforms use display-mode media query
  if ((navigator as Navigator & { standalone?: boolean }).standalone === true) return true;
  if (window.matchMedia?.("(display-mode: standalone)").matches) return true;
  return false;
}

function detectCapability(): PushCapability {
  const isIOS = detectIOSVersion() !== null && detectIsIOS();
  const iosVersion = isIOS ? detectIOSVersion() : null;
  const isStandalone = detectIsStandalone();
  const hasAPIs =
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window;

  let status: PushSupportStatus;
  if (!hasAPIs) {
    status = "unsupported";
  } else if (isIOS && iosVersion !== null && iosVersion < 16.4) {
    status = "ios-too-old";
  } else if (isIOS && !isStandalone) {
    // Web Push on iOS requires the app to be installed to Home Screen.
    status = "ios-needs-install";
  } else {
    status = "supported";
  }

  return { status, isIOS, iosVersion, isStandalone };
}

function buildDeviceLabel(): string {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua)) return "iPad";
  if (/Android/.test(ua)) return "Android";
  if (/Macintosh/.test(ua)) return "Mac";
  if (/Windows/.test(ua)) return "Windows";
  if (/Linux/.test(ua)) return "Linux";
  return "Desconocido";
}

// ---------- VAPID key resolution ----------

let _cachedVapidKey: string | null = null;
async function getVapidPublicKey(): Promise<string> {
  if (_cachedVapidKey) return _cachedVapidKey;
  try {
    const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-push-notification`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "get_vapid_key" }),
    });
    if (res.ok) {
      const data = await res.json();
      if (data.vapid_public_key) {
        _cachedVapidKey = data.vapid_public_key;
        return _cachedVapidKey!;
      }
    }
  } catch {
    // fall through
  }
  _cachedVapidKey = "BBli4ZxvrgXo2eh39AGYKoJz7YpnGyyDDA9akOy4o3588KRSWX7ThpZDERp9vGEjd7dLoSaY3frCCxcta_42QXU";
  return _cachedVapidKey!;
}

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

// ---------- Subscription persistence ----------

async function persistSubscription(userId: string, sub: PushSubscription) {
  const json = sub.toJSON();
  const endpoint = json.endpoint!;

  // Clean up any stale subscriptions for this user that have a different endpoint
  // This prevents orphaned endpoints from receiving pushes nobody can handle
  await supabase
    .from("push_subscriptions")
    .delete()
    .eq("user_id", userId)
    .neq("endpoint", endpoint);

  await supabase.from("push_subscriptions").upsert(
    {
      user_id: userId,
      endpoint,
      p256dh: json.keys!.p256dh,
      auth: json.keys!.auth,
      user_agent: navigator.userAgent.slice(0, 500),
      platform: navigator.platform || null,
      is_standalone: detectIsStandalone(),
      device_label: buildDeviceLabel(),
      last_seen_at: new Date().toISOString(),
    },
    { onConflict: "endpoint" }
  );
}

// Get the unified service-worker registration. The SW is registered by
// vite-plugin-pwa (autoUpdate) at the root scope as /sw.js.
async function getActiveRegistration(): Promise<ServiceWorkerRegistration | null> {
  try {
    // Wait for the SW to be ready (controls the page) so subscribe works on first try
    const ready = await navigator.serviceWorker.ready;
    return ready ?? null;
  } catch {
    return null;
  }
}

// ---------- Hook ----------

export function usePushNotifications() {
  const { user } = useAuth();
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [capability, setCapability] = useState<PushCapability>(() => ({
    status: "unsupported",
    isIOS: false,
    iosVersion: null,
    isStandalone: false,
  }));

  useEffect(() => {
    const cap = detectCapability();
    setCapability(cap);

    if (cap.status !== "supported" || !user) {
      setLoading(false);
      return;
    }

    (async () => {
      try {
        if (Notification.permission === "granted") {
          const reg = await getActiveRegistration();
          const sub = reg ? await reg.pushManager.getSubscription() : null;
          if (sub) {
            setEnabled(true);
            await persistSubscription(user.id, sub);
          } else {
            // Permission granted but no subscription — re-create silently
            console.warn("[push] permission=granted but no subscription, re-subscribing…");
            try {
              const vapidKey = await getVapidPublicKey();
              const r = reg ?? (await navigator.serviceWorker.register("/sw.js"));
              await r.update();
              const newSub = await r.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: urlBase64ToUint8Array(vapidKey),
              });
              await persistSubscription(user.id, newSub);
              setEnabled(true);
            } catch (e) {
              console.warn("[push] silent re-subscribe failed:", e);
              setEnabled(false);
            }
          }
        }
      } catch {
        // ignore
      }
      setLoading(false);
    })();
  }, [user]);

  const subscribe = useCallback(async () => {
    if (!user || capability.status !== "supported") return;
    setLoading(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setLoading(false);
        return;
      }

      const vapidKey = await getVapidPublicKey();

      // Clean any stale subscription on the active worker first
      const reg = (await getActiveRegistration()) ?? (await navigator.serviceWorker.register("/sw.js"));
      await reg.update();

      const existing = await reg.pushManager.getSubscription();
      if (existing) {
        const oldEndpoint = existing.endpoint;
        await existing.unsubscribe();
        await supabase.from("push_subscriptions").delete().eq("endpoint", oldEndpoint);
      }

      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey),
      });

      await persistSubscription(user.id, sub);
      setEnabled(true);
    } catch (err) {
      console.error("Push subscribe error:", err);
    }
    setLoading(false);
  }, [user, capability.status]);

  const unsubscribe = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const reg = await getActiveRegistration();
      if (reg) {
        const sub = await reg.pushManager.getSubscription();
        if (sub) {
          const endpoint = sub.endpoint;
          await sub.unsubscribe();
          await supabase.from("push_subscriptions").delete().eq("endpoint", endpoint);
        }
      }
      setEnabled(false);
    } catch (err) {
      console.error("Push unsubscribe error:", err);
    }
    setLoading(false);
  }, [user]);

  return {
    enabled,
    loading,
    supported: capability.status === "supported",
    capability,
    subscribe,
    unsubscribe,
  };
}
