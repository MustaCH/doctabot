// Decisión pura de si un push de "Alan respondió" es redundante porque el usuario
// ya está mirando esa conversación. La usa el service worker (sw.ts) en el evento
// `push`, evaluando el foco/visibilidad REAL en el momento de la entrega — en vez de
// la vieja heurística de latencia del backend (que con streaming real casi siempre
// daba >1.5s y disparaba push aunque el agente estuviera mirando la pantalla).

/** Subconjunto de WindowClient que necesitamos para decidir. */
export interface VisibilityClient {
  visibilityState: string; // "visible" | "hidden" | "prerender"
  url: string;
}

/** Extrae el id de conversación de una URL de la app (formato /?c=<id>). */
export function conversationIdFromUrl(url: string): string | null {
  try {
    const u = new URL(url, "http://local"); // base para tolerar URLs relativas
    const c = u.searchParams.get("c");
    return c && c.length > 0 ? c : null;
  } catch {
    return null;
  }
}

/**
 * ¿Hay alguna ventana VISIBLE mirando esta conversación? Si sí, el push es redundante
 * (la respuesta ya está en pantalla) y el service worker no debe mostrar la notificación.
 * Si la app está en background/oculta, o el usuario está en OTRA conversación, devuelve
 * false → se muestra el push (caso mobile "mando el mensaje y guardo el teléfono").
 */
export function isViewingConversation(
  clients: VisibilityClient[],
  convId: string | null,
): boolean {
  // Un push sin conversación asociada (ej. morning-matches con url "/chat") es
  // proactivo, NO redundante: hay que mostrarlo aunque la app esté abierta.
  if (!convId) return false;
  return clients.some((c) => {
    if (c.visibilityState !== "visible") return false;
    return conversationIdFromUrl(c.url) === convId;
  });
}
