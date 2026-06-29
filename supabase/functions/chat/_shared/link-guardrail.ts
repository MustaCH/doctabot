// Guardarraíl de integridad de links de propiedad.
//
// Alan (Gemini) a veces FABRICA URLs de remax al redactar prosa/borradores: toma su propia
// descripción y autocompleta un slug plausible que NO existe (ej. escribe "dpto" donde la
// propiedad real dice "depto"). Como remax redirige los listings inexistentes a la home, el
// cliente recibe links muertos. La regla de prompt ("copiá el url exacto, nunca inventes")
// reduce el problema pero no lo elimina; este módulo es la red determinista que lo cierra.
//
// Función: extraer los slugs de listings de remax presentes en un texto y neutralizar los que
// NO correspondan a una propiedad real. El orquestador (index.ts) valida los slugs contra la
// tabla `properties` (única fuente de un listing real: Alan solo obtiene URLs vía las tools que
// leen esa tabla) y le pasa acá el set de slugs válidos. Puro y testeable (sin deps de Deno/DB).

// remax.com.ar/listings/<slug> — el slug es kebab-case del título: [a-z0-9-]+.
const LISTING = `https?:\\/\\/(?:www\\.)?remax\\.com\\.ar\\/listings\\/([a-z0-9-]+)`;

/** Slug (en minúsculas) de una URL de listing, o null si no es una. */
function slugOf(url: string): string | null {
  const m = url.match(/\/listings\/([a-z0-9-]+)/i);
  return m ? m[1].toLowerCase() : null;
}

/** Devuelve los slugs DISTINTOS de listings de remax que aparecen en el texto. */
export function extractListingSlugs(text: string): string[] {
  if (!text) return [];
  const re = new RegExp(LISTING, "gi");
  const slugs = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) slugs.add(m[1].toLowerCase());
  return [...slugs];
}

/**
 * Neutraliza los links de propiedad cuyo slug NO esté en `validSlugs`:
 *  - Markdown `[texto](url-inventada)` → queda solo `texto` (se quita el link muerto).
 *  - URL suelta inventada → se elimina.
 * Los links válidos quedan intactos. Devuelve el texto saneado y los slugs removidos (únicos).
 * Puro y testeable.
 */
export function neutralizeFabricatedListings(
  text: string,
  validSlugs: Set<string>,
): { text: string; removed: string[] } {
  if (!text) return { text, removed: [] };
  const removed = new Set<string>();

  // 1) Markdown links primero: [label](URL). Grupos: 1=label, 2=url completa, 3=slug.
  const mdRe = new RegExp(`\\[([^\\]]*)\\]\\((${LISTING}[^)\\s]*)\\)`, "gi");
  let out = text.replace(mdRe, (full: string, label: string, url: string) => {
    const slug = slugOf(url);
    if (slug && !validSlugs.has(slug)) {
      removed.add(slug);
      return label; // conservamos el texto visible, sacamos el link muerto
    }
    return full;
  });

  // 2) URLs sueltas que hayan quedado fuera de markdown.
  const bareRe = new RegExp(`${LISTING}[^\\s)\\]]*`, "gi");
  out = out.replace(bareRe, (url: string) => {
    const slug = slugOf(url);
    if (slug && !validSlugs.has(slug)) {
      removed.add(slug);
      return "";
    }
    return url;
  });

  // Limpieza liviana SOLO si removimos algo: huecos de espacios horizontales que dejó la
  // eliminación de una URL suelta (no tocamos saltos de línea ni el formato markdown).
  if (removed.size > 0) {
    out = out.replace(/[ \t]{2,}/g, " ").replace(/[ \t]+\n/g, "\n").replace(/\(\s*\)/g, "");
  }

  return { text: out, removed: [...removed] };
}
