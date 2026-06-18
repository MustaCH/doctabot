// Dedup de filas por external_id antes del upsert.
//
// Postgres no permite que un único `INSERT ... ON CONFLICT (external_id) DO UPDATE`
// toque la misma fila dos veces (error 21000). Como el scraper de RE/MAX puede
// devolver la misma propiedad en páginas distintas (destacadas repetidas, solape
// de paginación), hay que colapsar duplicados antes de mandar el batch.
//
// Se conserva la ÚLTIMA ocurrencia de cada external_id (la más reciente dentro del
// batch) pero respetando el orden de primera aparición, y se reporta cuántas filas
// se descartaron.

export interface DedupeResult<T> {
  deduped: T[];
  dropped: number;
}

export function dedupeByExternalId<T extends { external_id: unknown }>(
  rows: T[],
): DedupeResult<T> {
  const order: unknown[] = [];
  const byId = new Map<unknown, T>();

  for (const row of rows) {
    if (!byId.has(row.external_id)) order.push(row.external_id);
    byId.set(row.external_id, row); // overwrite → se queda con la última
  }

  const deduped = order.map((id) => byId.get(id) as T);
  return { deduped, dropped: rows.length - deduped.length };
}
