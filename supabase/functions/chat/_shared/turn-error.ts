// Mensaje de error de turno + contrato de reintento (ticket 86ak3kd99).
//
// Cuando streamTurn tira, el catch de index.ts persiste un mensaje de error que ahora
// dice QUÉ alcanzó a ejecutarse antes de fallar. El front (ChatMessage/alan-orb-state)
// importa estas constantes/funciones directamente (mismo patrón que matching-core):
// - detecta el mensaje de error por prefijo (los mensajes viejos "¿Podés intentar de
//   nuevo?" también empiezan con el prefijo → siguen detectándose),
// - ofrece el botón Reintentar SOLO si el mensaje contiene TURN_ERROR_RETRY_HINT, que
//   el server incluye únicamente cuando NO corrió ninguna tool con efecto (opción (a)
//   del ticket: nunca invitar a reintentar algo que puede duplicar un email/evento).
// Módulo puro, sin deps — importable desde Deno y desde el bundle del front.

export const TURN_ERROR_PREFIX = "Lo siento, hubo un problema generando la respuesta.";

/** Presente en el mensaje ⇔ el reintento es seguro (no corrió ninguna tool con efecto). */
export const TURN_ERROR_RETRY_HINT = "podés reintentar tranquilo";

/** Tools que tocan el mundo real o escriben datos: reintentar un turno que ya las
    ejecutó puede duplicar la acción. Las de solo-lectura (search/list/get/web) no están. */
export const EFFECT_TOOLS: ReadonlySet<string> = new Set([
  "send_email",
  "create_calendar_event",
  "create_meet_event",
  "update_calendar_event",
  "delete_calendar_event",
  "create_client",
  "create_clients_bulk",
  "update_client",
  "delete_client",
  "delete_all_clients",
  "mark_client_contacted",
  "add_favorite",
  "remove_favorite",
  "save_property_to_client",
  "remove_client_property",
  "update_client_property",
  "create_client_event",
  "delete_client_event",
  "create_client_note",
  "toggle_client_note",
  "link_conversation",
  "analyze_property_media",
  "extract_document",
]);

/** Etiquetas humanas para el aviso de "alcancé a ejecutar…". Fallback: nombre crudo. */
const EFFECT_LABELS: Record<string, string> = {
  send_email: "enviar un email",
  create_calendar_event: "crear un evento en el calendario",
  create_meet_event: "crear una reunión de Meet",
  update_calendar_event: "modificar un evento del calendario",
  delete_calendar_event: "borrar un evento del calendario",
  create_client: "crear un cliente",
  create_clients_bulk: "cargar clientes",
  update_client: "actualizar un cliente",
  delete_client: "borrar un cliente",
  delete_all_clients: "borrar clientes en masa",
  mark_client_contacted: "marcar clientes como contactados",
  add_favorite: "guardar un favorito",
  remove_favorite: "quitar un favorito",
  save_property_to_client: "vincular una propiedad a un cliente",
  remove_client_property: "desvincular una propiedad",
  update_client_property: "actualizar una propiedad vinculada",
  create_client_event: "crear un evento del cliente",
  delete_client_event: "borrar un evento del cliente",
  create_client_note: "guardar una nota",
  toggle_client_note: "actualizar una nota",
  link_conversation: "vincular la conversación a un cliente",
  analyze_property_media: "guardar un análisis de fotos",
  extract_document: "guardar datos de un documento",
};

function labelFor(tool: string): string {
  return EFFECT_LABELS[tool] ?? tool;
}

/**
 * Arma el mensaje de error persistido según qué tools alcanzaron a correr.
 * - Sin tools → reintento seguro.
 * - Solo lectura → reintento seguro (aclara que solo consultó datos).
 * - Con efecto → SIN hint de reintento: lista qué se ejecutó y pide revisar antes de repetir.
 */
export function buildTurnErrorMessage(executedTools: string[]): string {
  const effects = [...new Set(executedTools.filter((t) => EFFECT_TOOLS.has(t)))];
  if (effects.length > 0) {
    const list = effects.map(labelFor).join(", ");
    return (
      `${TURN_ERROR_PREFIX} Antes de fallar alcancé a ${list}: esa parte PUEDE haberse completado. ` +
      `Revisá el resultado (calendario, enviados, CRM) antes de pedírmelo de nuevo, así no lo duplicamos.`
    );
  }
  if (executedTools.length > 0) {
    return `${TURN_ERROR_PREFIX} Solo alcancé a consultar datos, sin ejecutar ninguna acción — ${TURN_ERROR_RETRY_HINT}.`;
  }
  return `${TURN_ERROR_PREFIX} No llegué a ejecutar ninguna acción — ${TURN_ERROR_RETRY_HINT}.`;
}

/** ¿Es un mensaje de error de turno? (cubre también el mensaje estático viejo persistido). */
export function isTurnErrorContent(content: string): boolean {
  return content.trim().startsWith(TURN_ERROR_PREFIX);
}

/** ¿El mensaje de error habilita el botón Reintentar? (mensajes viejos: no, por prudencia). */
export function turnErrorAllowsRetry(content: string): boolean {
  return isTurnErrorContent(content) && content.includes(TURN_ERROR_RETRY_HINT);
}
