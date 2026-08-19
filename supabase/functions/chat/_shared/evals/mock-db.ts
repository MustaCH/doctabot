// Supabase in-memory para el harness de evals (ticket 86aj9w5mg).
// Interpreta las cadenas de query que usan los tools del executor (select/eq/ilike/or/not/
// gte/lte/is/in/order/limit/range/filter-imatch/single/maybeSingle + insert/update/upsert/
// delete) sobre tablas en memoria. El turno de eval corre el modelo REAL pero TODA la data
// es sintética: ninguna tool puede tocar el CRM/calendario/email de verdad (gate del loop).
//
// Limitaciones deliberadas (alcanza para los tools de Alan; NO es un PostgREST completo):
// - or() soporta condiciones planas col.op.valor con op ∈ {eq, ilike, is}.
// - Los selects anidados tipo "clients(full_name)" / "properties(*)" se resuelven por
//   convención de FK: client_id → clients, property_id → properties.
// - count es siempre "exact" sobre el set filtrado.

type Row = Record<string, any>;

export interface MockDb {
  tables: Record<string, Row[]>;
}

let autoId = 0;
const genId = () => {
  autoId += 1;
  // UUID v4 sintético estable en formato (los tools validan con UUID_REGEX).
  return `00000000-0000-4000-8000-${String(autoId).padStart(12, "0")}`;
};

/** Crea el store; a cada fila sin id se le asigna un UUID sintético. */
export function createMockDb(seed: Record<string, Row[]>): MockDb {
  const tables: Record<string, Row[]> = {};
  for (const [name, rows] of Object.entries(seed)) {
    tables[name] = rows.map((r) => ({ id: r.id ?? genId(), ...r }));
  }
  return { tables };
}

function likeToTest(pattern: string): (v: unknown) => boolean {
  const p = String(pattern);
  const inner = p.replace(/^%|%$/g, "").toLowerCase();
  const starts = p.startsWith("%");
  const ends = p.endsWith("%");
  return (v: unknown) => {
    if (typeof v !== "string") return false;
    const s = v.toLowerCase();
    if (starts && ends) return s.includes(inner);
    if (ends) return s.startsWith(inner);
    if (starts) return s.endsWith(inner);
    return s === inner;
  };
}

function posixToJsRegex(pattern: string): RegExp {
  // \m / \M (word boundaries POSIX de Postgres) → \b de JS.
  return new RegExp(pattern.replace(/\\m|\\M/g, "\\b"), "i");
}

type Cond = (row: Row) => boolean;

function parseOrString(orStr: string): Cond {
  const parts = String(orStr).split(",").map((p) => p.trim()).filter(Boolean);
  const conds: Cond[] = parts.map((part) => {
    const m = part.match(/^([\w.]+)\.(eq|ilike|is)\.(.*)$/);
    if (!m) return () => false;
    const [, col, op, raw] = m;
    if (op === "is") return (row) => (raw === "null" ? row[col] == null : row[col] === (raw === "true"));
    if (op === "eq") return (row) => String(row[col]) === raw;
    const test = likeToTest(raw);
    return (row) => test(row[col]);
  });
  return (row) => conds.some((c) => c(row));
}

class QueryBuilder {
  private conds: Cond[] = [];
  private orderBy: { col: string; asc: boolean } | null = null;
  private limitN: number | null = null;
  private rangeFrom = 0;
  private rangeTo: number | null = null;
  private head = false;
  private wantCount = false;
  private selectCols = "*";
  private mode: "select" | "insert" | "update" | "upsert" | "delete" = "select";
  private payload: Row | Row[] | null = null;
  private onConflict: string | null = null;

  constructor(private db: MockDb, private table: string) {}

  select(cols = "*", opts?: { count?: string; head?: boolean }) {
    this.selectCols = cols;
    if (opts?.head) this.head = true;
    if (opts?.count) this.wantCount = true;
    return this;
  }
  eq(col: string, val: unknown) { this.conds.push((r) => r[col] === val || String(r[col]) === String(val)); return this; }
  neq(col: string, val: unknown) { this.conds.push((r) => String(r[col]) !== String(val)); return this; }
  ilike(col: string, pattern: string) { const t = likeToTest(pattern); this.conds.push((r) => t(r[col])); return this; }
  or(orStr: string) { this.conds.push(parseOrString(orStr)); return this; }
  not(col: string, op: string, val: unknown) {
    if (op === "ilike") { const t = likeToTest(String(val)); this.conds.push((r) => !t(r[col])); }
    else if (op === "is") this.conds.push((r) => (val === null ? r[col] != null : r[col] !== val));
    else this.conds.push((r) => String(r[col]) !== String(val));
    return this;
  }
  gte(col: string, val: any) { this.conds.push((r) => r[col] != null && r[col] >= val); return this; }
  lte(col: string, val: any) { this.conds.push((r) => r[col] != null && r[col] <= val); return this; }
  gt(col: string, val: any) { this.conds.push((r) => r[col] != null && r[col] > val); return this; }
  lt(col: string, val: any) { this.conds.push((r) => r[col] != null && r[col] < val); return this; }
  is(col: string, val: unknown) { this.conds.push((r) => (val === null ? r[col] == null : r[col] === val)); return this; }
  in(col: string, vals: unknown[]) { const set = new Set((vals ?? []).map(String)); this.conds.push((r) => set.has(String(r[col]))); return this; }
  contains(col: string, val: any) { this.conds.push((r) => Array.isArray(r[col]) && r[col].includes(val)); return this; }
  filter(col: string, op: string, val: string) {
    if (op === "imatch") { const re = posixToJsRegex(val); this.conds.push((r) => typeof r[col] === "string" && re.test(r[col])); }
    else if (op === "eq") this.eq(col, val);
    return this;
  }
  order(col: string, opts?: { ascending?: boolean }) { this.orderBy = { col, asc: opts?.ascending !== false }; return this; }
  limit(n: number) { this.limitN = n; return this; }
  range(from: number, to: number) { this.rangeFrom = from; this.rangeTo = to; return this; }

  insert(payload: Row | Row[]) { this.mode = "insert"; this.payload = payload; return this; }
  update(payload: Row) { this.mode = "update"; this.payload = payload; return this; }
  upsert(payload: Row | Row[], opts?: { onConflict?: string }) { this.mode = "upsert"; this.payload = payload; this.onConflict = opts?.onConflict ?? null; return this; }
  delete() { this.mode = "delete"; return this; }

  private rows(): Row[] {
    let rows = (this.db.tables[this.table] ?? []).filter((r) => this.conds.every((c) => c(r)));
    if (this.orderBy) {
      const { col, asc } = this.orderBy;
      rows = [...rows].sort((a, b) => {
        const av = a[col], bv = b[col];
        if (av === bv) return 0;
        if (av == null) return 1;
        if (bv == null) return -1;
        return (av < bv ? -1 : 1) * (asc ? 1 : -1);
      });
    }
    if (this.rangeTo != null) rows = rows.slice(this.rangeFrom, this.rangeTo + 1);
    if (this.limitN != null) rows = rows.slice(0, this.limitN);
    return rows.map((r) => this.expandRelations(r));
  }

  /** "clients(full_name)" / "properties(*)" → adjunta la fila relacionada por FK. */
  private expandRelations(row: Row): Row {
    const rels = [...this.selectCols.matchAll(/(\w+)\(([^)]*)\)/g)];
    if (rels.length === 0) return { ...row };
    const out: Row = { ...row };
    for (const [, relTable] of rels) {
      const fk = relTable === "clients" ? "client_id" : relTable === "properties" ? "property_id" : null;
      if (!fk) continue;
      const related = (this.db.tables[relTable] ?? []).find((r) => String(r.id) === String(row[fk]));
      out[relTable] = related ? { ...related } : null;
    }
    return out;
  }

  private execute(): { data: any; count: number | null; error: any } {
    const tables = this.db.tables;
    if (!tables[this.table]) tables[this.table] = [];
    if (this.mode === "insert" || this.mode === "upsert") {
      const items = (Array.isArray(this.payload) ? this.payload : [this.payload]) as Row[];
      const inserted: Row[] = [];
      for (const item of items) {
        let target: Row | null = null;
        if (this.mode === "upsert" && this.onConflict) {
          const keys = this.onConflict.split(",").map((k) => k.trim());
          target = tables[this.table].find((r) => keys.every((k) => String(r[k]) === String(item[k]))) ?? null;
        }
        if (target) { Object.assign(target, item); inserted.push(target); }
        else {
          // FK sintética: client_id/property_id deben existir si la tabla relacionada está seedeada.
          for (const [fk, rel] of [["client_id", "clients"], ["property_id", "properties"]] as const) {
            if (item[fk] != null && (tables[rel] ?? []).length > 0 && !(tables[rel] ?? []).some((r) => String(r.id) === String(item[fk]))) {
              return { data: null, count: null, error: { code: "23503", message: `insert or update on table "${this.table}" violates foreign key constraint` } };
            }
          }
          const row = { id: item.id ?? genId(), created_at: item.created_at ?? new Date().toISOString(), ...item };
          tables[this.table].push(row);
          inserted.push(row);
        }
      }
      return { data: inserted, count: null, error: null };
    }
    if (this.mode === "update") {
      const rows = (tables[this.table] ?? []).filter((r) => this.conds.every((c) => c(r)));
      rows.forEach((r) => Object.assign(r, this.payload));
      return { data: rows.map((r) => ({ ...r })), count: null, error: null };
    }
    if (this.mode === "delete") {
      const keep = (tables[this.table] ?? []).filter((r) => !this.conds.every((c) => c(r)));
      const removed = (tables[this.table] ?? []).length - keep.length;
      tables[this.table] = keep;
      return { data: null, count: removed, error: null };
    }
    const rows = this.rows();
    return { data: this.head ? null : rows, count: this.wantCount ? rows.length : null, error: null };
  }

  single() {
    const res = this.execute();
    const row = Array.isArray(res.data) ? res.data[0] : res.data;
    return Promise.resolve({ data: row ?? null, error: res.error ?? (row ? null : { code: "PGRST116", message: "no rows" }) });
  }
  maybeSingle() {
    const res = this.execute();
    const row = Array.isArray(res.data) ? res.data[0] : res.data;
    return Promise.resolve({ data: row ?? null, error: res.error });
  }
  then(onF: any, onR: any) {
    const res = this.execute();
    return Promise.resolve({ data: res.data, count: res.count, error: res.error }).then(onF, onR);
  }
}

// ---- RPC search_properties_relevance v2 (migración 20260819100000) ----
// Réplica in-memory de la RPC que usa search_properties (executor): filtros con la misma
// semántica (unaccent+ilike para ubicación, ilike plano para title/tipo/moneda/oficina,
// exclude_office con office-IS-NULL-pasa), similarity trigram estilo pg_trgm (umbral 0.25 o
// substring en título), orden (docta DESC, rel DESC, created_at DESC) y total_count window.

const stripAccents = (s: string): string => s.normalize("NFD").replace(/[̀-ͯ]/g, "");
const norm = (v: unknown): string => stripAccents(String(v ?? "").toLowerCase());

function trigrams(s: string): Set<string> {
  const grams = new Set<string>();
  for (const w of s.split(/\s+/).filter(Boolean)) {
    const padded = `  ${w} `;
    for (let i = 0; i <= padded.length - 3; i++) grams.add(padded.slice(i, i + 3));
  }
  return grams;
}

/** similarity() de pg_trgm: |trigrams(a) ∩ trigrams(b)| / |unión|. */
function trigramSimilarity(a: string, b: string): number {
  const ta = trigrams(a), tb = trigrams(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const g of ta) if (tb.has(g)) inter += 1;
  return inter / (ta.size + tb.size - inter);
}

// Nota v3 (86aj9w5pn): la RPC real acepta además `query_embedding` (hybrid search). El mock lo
// IGNORA a propósito — las filas seed no tienen embedding, y en la RPC real ese caso degrada a
// trigram puro, que es exactamente lo que este mock calcula. Paridad sin simular vectores.
function searchPropertiesRelevance(db: MockDb, p: Record<string, any>): { data: Row[]; error: null } {
  const term = norm(p.search_term ?? "");
  const strArr = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => String(x)) : []);
  const includes = (col: unknown, needle: string, unaccented: boolean) =>
    (unaccented ? norm(col) : String(col ?? "").toLowerCase()).includes(unaccented ? norm(needle) : needle.toLowerCase());

  const filtered = (db.tables["properties"] ?? []).filter((r) => {
    if (p.filter_active !== false && !(r.listing_status === "active" || r.listing_status == null)) return false;
    const zones = strArr(p.zones);
    if (zones.length && !zones.some((z) => includes(r.zone, z, true))) return false;
    if (strArr(p.exclude_zones).some((z) => includes(r.zone, z, true))) return false;
    if (strArr(p.exclude_neighborhoods).some((n) => includes(r.zone_neighborhood, n, true))) return false;
    if (p.locality_filter && !includes(r.locality, p.locality_filter, true)) return false;
    if (p.neighborhood_filter && !includes(r.zone_neighborhood, p.neighborhood_filter, true)) return false;
    if (p.city_filter && !includes(r.zone_city, p.city_filter, true)) return false;
    if (p.op_filter && r.operation !== p.op_filter) return false;
    if (p.op_filter_like && !includes(r.operation, p.op_filter_like, false)) return false;
    const types = strArr(p.property_types);
    if (types.length && !types.some((t) => includes(r.property_type, t, false))) return false;
    if (p.title_filter && !includes(r.title, p.title_filter, false)) return false;
    if (p.currency_filter && !includes(r.currency, p.currency_filter, false)) return false;
    if (p.price_min != null && !(r.price != null && r.price >= p.price_min)) return false;
    if (p.price_max != null && !(r.price != null && r.price <= p.price_max)) return false;
    if (p.rooms_min != null && !(r.habitaciones != null && r.habitaciones >= p.rooms_min)) return false;
    if (p.rooms_max != null && !(r.habitaciones != null && r.habitaciones <= p.rooms_max)) return false;
    if (p.amb_min != null && !(r.ambientes != null && r.ambientes >= p.amb_min)) return false;
    if (p.amb_max != null && !(r.ambientes != null && r.ambientes <= p.amb_max)) return false;
    if (p.office_filter && !includes(r.office, p.office_filter, false)) return false;
    if (p.exclude_office_filter && r.office != null && includes(r.office, p.exclude_office_filter, false)) return false;
    return true;
  });

  const scored = filtered
    .map((r) => ({
      row: r,
      rel: term === ""
        ? 1.0
        : Math.max(
            trigramSimilarity(norm(r.title), term),
            trigramSimilarity(norm(r.zone), term),
            trigramSimilarity(norm(r.locality), term),
            trigramSimilarity(norm(r.zone_neighborhood), term),
          ),
    }))
    .filter((s) => term === "" || s.rel >= 0.25 || norm(s.row.title).includes(term));

  const doctaFirst = p.docta_first !== false;
  scored.sort((a, b) => {
    const da = doctaFirst && String(a.row.office ?? "").toLowerCase().includes("docta") ? 1 : 0;
    const dbb = doctaFirst && String(b.row.office ?? "").toLowerCase().includes("docta") ? 1 : 0;
    if (da !== dbb) return dbb - da;
    if (a.rel !== b.rel) return b.rel - a.rel;
    const ca = String(a.row.created_at ?? ""), cb = String(b.row.created_at ?? "");
    return ca === cb ? 0 : ca < cb ? 1 : -1;
  });

  const offset = Number(p.page_offset ?? 0);
  const size = Number(p.page_size ?? 20);
  const page = scored.slice(offset, offset + size);
  return {
    data: page.map((s) => ({ ...s.row, relevance_score: s.rel, total_count: scored.length })),
    error: null,
  };
}

/** Cliente supabase mockeado para inyectar como toolCtx.supabase. */
export function mockSupabase(db: MockDb) {
  return {
    from: (table: string) => new QueryBuilder(db, table),
    rpc: (name: string, params: Record<string, any> = {}) => {
      if (name === "search_properties_relevance") return Promise.resolve(searchPropertiesRelevance(db, params));
      return Promise.resolve({ data: null, error: { message: `rpc ${name} no soportada por el mock de evals` } });
    },
  };
}
