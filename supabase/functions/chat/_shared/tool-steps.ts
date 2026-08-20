// Pasos del tool-loop visibles para el usuario (ticket 86ak3kd5r).
//
// Mapeo DETERMINISTA nombre_de_tool → texto en lenguaje natural, en el server (misma
// doctrina que los guardarraíles de sanitizeFinal): el resumen NUNCA viene del modelo
// (sería otra llamada y podría inventar). El "resumen del resultado" solo usa campos
// estructurales del JSON que devolvió la tool (conteos), con fallback fail-open al label
// genérico si el parseo falla. Puro y testeable.

export interface ToolStep {
  tool: string;
  label: string;
  status: "running" | "done";
}

const RUNNING_LABELS: Record<string, string> = {
  search_properties: "Buscando propiedades",
  compare_properties: "Comparando propiedades",
  market_stats: "Consultando el mercado",
  negotiation_brief: "Armando el brief de negociación",
  get_favorites: "Revisando tus favoritos",
  add_favorite: "Guardando el favorito",
  remove_favorite: "Quitando el favorito",
  create_client: "Creando el cliente",
  create_clients_bulk: "Cargando los clientes",
  update_client: "Actualizando el cliente",
  list_clients: "Revisando tus contactos",
  mark_client_contacted: "Marcando contactados",
  get_client: "Buscando el cliente",
  recall_client_history: "Repasando el historial del cliente",
  analyze_property_media: "Analizando las fotos",
  extract_document: "Leyendo el documento",
  link_conversation: "Vinculando la conversación",
  generate_report: "Generando la ficha",
  create_calendar_event: "Creando el evento",
  create_meet_event: "Creando la reunión de Meet",
  send_email: "Enviando el email",
  list_calendar_events: "Revisando el calendario",
  update_calendar_event: "Actualizando el evento",
  delete_calendar_event: "Borrando el evento",
  web_search: "Buscando en la web",
  scrape_url: "Leyendo la página",
  search_external_portals: "Buscando en otros portales",
  save_property_to_client: "Vinculando la propiedad",
  list_client_properties: "Revisando propiedades del cliente",
  remove_client_property: "Desvinculando la propiedad",
  update_client_property: "Actualizando la propiedad vinculada",
  create_client_event: "Agendando el recordatorio",
  list_client_events: "Revisando recordatorios",
  delete_client_event: "Borrando el recordatorio",
  create_client_note: "Guardando la nota",
  list_client_notes: "Revisando las notas",
  toggle_client_note: "Actualizando la nota",
  delete_client: "Borrando el cliente",
  delete_all_clients: "Borrando los clientes",
};

const DONE_LABELS: Record<string, string> = {
  search_properties: "Busqué propiedades",
  compare_properties: "Comparé las propiedades",
  market_stats: "Consulté el mercado",
  negotiation_brief: "Armé el brief de negociación",
  get_favorites: "Revisé tus favoritos",
  add_favorite: "Guardé el favorito",
  remove_favorite: "Quité el favorito",
  create_client: "Creé el cliente",
  create_clients_bulk: "Cargué los clientes",
  update_client: "Actualicé el cliente",
  list_clients: "Revisé tus contactos",
  mark_client_contacted: "Marqué los contactados",
  get_client: "Encontré el cliente",
  recall_client_history: "Repasé el historial",
  analyze_property_media: "Analicé las fotos",
  extract_document: "Leí el documento",
  link_conversation: "Vinculé la conversación",
  generate_report: "Generé la ficha",
  create_calendar_event: "Creé el evento",
  create_meet_event: "Creé la reunión de Meet",
  send_email: "Envié el email",
  list_calendar_events: "Revisé el calendario",
  update_calendar_event: "Actualicé el evento",
  delete_calendar_event: "Borré el evento",
  web_search: "Busqué en la web",
  scrape_url: "Leí la página",
  search_external_portals: "Busqué en otros portales",
  save_property_to_client: "Vinculé la propiedad",
  list_client_properties: "Revisé las propiedades del cliente",
  remove_client_property: "Desvinculé la propiedad",
  update_client_property: "Actualicé la propiedad vinculada",
  create_client_event: "Agendé el recordatorio",
  list_client_events: "Revisé los recordatorios",
  delete_client_event: "Borré el recordatorio",
  create_client_note: "Guardé la nota",
  list_client_notes: "Revisé las notas",
  toggle_client_note: "Actualicé la nota",
  delete_client: "Borré el cliente",
  delete_all_clients: "Borré los clientes",
};

export function runningLabel(tool: string): string {
  return RUNNING_LABELS[tool] ?? "Ejecutando una herramienta";
}

/**
 * Label de paso completado, enriquecido con conteos estructurales del resultado cuando
 * el JSON los trae (total_count/showing). Fail-open: cualquier problema → label genérico.
 */
export function doneLabel(tool: string, resultJson?: string): string {
  const base = DONE_LABELS[tool] ?? "Listo";
  if (!resultJson) return base;
  try {
    const r = JSON.parse(resultJson);
    if (tool === "search_properties") {
      const n = typeof r?.total_count === "number" ? r.total_count : undefined;
      if (n !== undefined) return n === 1 ? "Encontré 1 propiedad" : `Encontré ${n} propiedades`;
    }
    if (tool === "list_clients") {
      const n = typeof r?.total_count === "number" ? r.total_count : undefined;
      if (n !== undefined) return `Revisé tus contactos (${n})`;
    }
    if (tool === "get_client") {
      const name = typeof r?.client?.full_name === "string" ? r.client.full_name : undefined;
      if (name) return `Encontré a ${name}`;
    }
  } catch { /* fail-open al label base */ }
  return base;
}
