// Bufferiza el stream de Alan para que marcadores incompletos no lleguen al renderer:
//  - MSG_BREAK: corta el mensaje en burbujas (onNewMessage).
//  - DRAFT_START..DRAFT_END (+ WHATSAPP_TO previo): se retiene la región entera hasta que
//    cierra, para que el renderer nunca vea un draft a medias ni un marcador crudo.
//  - Prefijos parciales de cualquier marcador al final del buffer se retienen hasta tener más texto.

export const MSG_BREAK = "===MSG_BREAK===";
const DRAFT_START = "<<<DRAFT_START>>>";
const DRAFT_END = "<<<DRAFT_END>>>";
const WHATSAPP_TO = "<<<WHATSAPP_TO:";

// Tokens cuyo prefijo parcial NO debe emitirse crudo al final del buffer.
const OPENINGS = [MSG_BREAK, DRAFT_START, WHATSAPP_TO];
const WA_FULL_RE = /<<<WHATSAPP_TO:[\d+]*>>>\s*$/;

// Longitud del sufijo más largo de `s` que es prefijo propio de algún marcador.
function partialPrefixLen(s: string, markers: string[]): number {
  let max = 0;
  for (const m of markers) {
    const maxK = Math.min(m.length - 1, s.length);
    for (let k = maxK; k > max; k--) {
      if (s.slice(s.length - k) === m.slice(0, k)) { max = k; break; }
    }
  }
  return max;
}

export class MarkerStream {
  private buf = "";

  constructor(
    private onDelta: (text: string) => void,
    private onNewMessage: () => void,
  ) {}

  push(text: string): void {
    this.buf += text;
    this.drain(false);
  }

  flush(): void {
    this.drain(true);
    if (this.buf) { this.onDelta(this.buf); this.buf = ""; }
  }

  private emit(text: string) {
    if (text) this.onDelta(text);
  }

  private drain(final: boolean): void {
    while (true) {
      const mb = this.buf.indexOf(MSG_BREAK);
      const ds = this.buf.indexOf(DRAFT_START);

      // MSG_BREAK antes que cualquier draft → cortar burbuja.
      if (mb !== -1 && (ds === -1 || mb < ds)) {
        this.emit(this.buf.slice(0, mb));
        this.onNewMessage();
        this.buf = this.buf.slice(mb + MSG_BREAK.length);
        continue;
      }

      // Región de draft.
      if (ds !== -1) {
        // Si un WHATSAPP_TO completo precede directamente al draft, lo incluimos en la región.
        const waIdx = this.buf.lastIndexOf(WHATSAPP_TO, ds);
        const regionStart = (waIdx !== -1 && WA_FULL_RE.test(this.buf.slice(waIdx, ds))) ? waIdx : ds;

        this.emit(this.buf.slice(0, regionStart)); // texto antes del draft
        const de = this.buf.indexOf(DRAFT_END, ds);
        if (de === -1) {
          // Draft sin cerrar: retener desde regionStart (o emitir crudo si es el flush final).
          if (final) { this.emit(this.buf.slice(regionStart)); this.buf = ""; }
          else { this.buf = this.buf.slice(regionStart); }
          return;
        }
        const end = de + DRAFT_END.length;
        this.emit(this.buf.slice(regionStart, end)); // draft completo, de una
        this.buf = this.buf.slice(end);
        continue;
      }

      // Sin marcadores adelante: emitir salvo un prefijo parcial al final.
      const hold = final ? 0 : partialPrefixLen(this.buf, OPENINGS);
      const safe = this.buf.slice(0, this.buf.length - hold);
      this.emit(safe);
      this.buf = this.buf.slice(safe.length);
      return;
    }
  }
}
