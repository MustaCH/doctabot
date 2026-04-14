import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

const VAPID_PUBLIC_KEY = "BBli4ZxvrgXo2eh39AGYKoJz7YpnGyyDDA9akOy4o3588KRSWX7ThpZDERp9vGEjd7dLoSaY3frCCxcta_42QXU";

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

export function usePushNotifications() {
  const { user } = useAuth();
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [supported, setSupported] = useState(false);

  useEffect(() => {
    const isSupported = "serviceWorker" in navigator && "PushManager" in window;
    setSupported(isSupported);
    if (!isSupported || !user) {
      setLoading(false);
      return;
    }

    // Check current state
    (async () => {
      try {
        // Check both OS-level permission and active push subscription
        if (Notification.permission === "granted") {
          const registrations = await navigator.serviceWorker.getRegistrations();
          for (const reg of registrations) {
            const sub = await reg.pushManager.getSubscription();
            if (sub) {
              setEnabled(true);
              break;
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
    if (!user) return;
    setLoading(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setLoading(false);
        return;
      }

      const reg = await navigator.serviceWorker.register("/sw-push.js");
      await reg.update();

      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });

      const json = sub.toJSON();
      await supabase.from("push_subscriptions").upsert(
        {
          user_id: user.id,
          endpoint: json.endpoint!,
          p256dh: json.keys!.p256dh,
          auth: json.keys!.auth,
        },
        { onConflict: "endpoint" }
      );

      setEnabled(true);
    } catch (err) {
      console.error("Push subscribe error:", err);
    }
    setLoading(false);
  }, [user]);

  const unsubscribe = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const reg = await navigator.serviceWorker.getRegistration("/sw-push.js");
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

  return { enabled, loading, supported, subscribe, unsubscribe };
}
