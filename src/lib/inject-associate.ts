// Inyección del código de asociado en links de propiedades. Extraído de ChatMessage.tsx para
// testearlo sin React (ver draft-parse.test.ts).
//
// OJO: la clase de caracteres de la URL EXCLUYE '<' — una URL pegada a un marcador
// <<<DRAFT_END>>> (sin espacio) se tragaba el marcador y lo convertía en
// `...casa-x1<<<DRAFT_END?associate=AR200123>>>`, rompiendo el parseo del draft.

/** Inject ?associate=agentCode into any property URL that doesn't already have it */
export function injectAssociate(text: string, agentCode: string | null): string {
  if (!agentCode) return text;
  return text.replace(
    /(https?:\/\/[^\s"')>\]<]+)/g,
    (url) => {
      if (!/remax\.com\.ar/i.test(url)) return url;
      // Strip trailing punctuation captured accidentally
      const trailingMatch = url.match(/([.,;!?)\]]+)$/);
      const trailing = trailingMatch ? trailingMatch[1] : "";
      const cleanUrl = trailing ? url.slice(0, -trailing.length) : url;
      if (cleanUrl.includes(`associate=`)) return url; // already has associate param
      const sep = cleanUrl.includes("?") ? "&" : "?";
      return `${cleanUrl}${sep}associate=${encodeURIComponent(agentCode)}${trailing}`;
    }
  );
}
