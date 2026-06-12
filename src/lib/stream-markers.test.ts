import { describe, it, expect, vi } from "vitest";
import { MarkerStream } from "./stream-markers";

function collect() {
  const deltas: string[] = [];
  const breaks: number[] = [];
  const ms = new MarkerStream(
    (t) => deltas.push(t),
    () => breaks.push(deltas.length),
  );
  return { ms, deltas, breaks, text: () => deltas.join("") };
}

describe("MarkerStream", () => {
  it("emite texto plano tal cual", () => {
    const c = collect();
    c.ms.push("Hola, ¿cómo estás?");
    c.ms.flush();
    expect(c.text()).toBe("Hola, ¿cómo estás?");
  });

  it("no emite un MSG_BREAK partido entre pushes como texto crudo", () => {
    const c = collect();
    c.ms.push("uno ===MSG_");
    expect(c.text()).toBe("uno "); // retiene el prefijo parcial del marcador
    c.ms.push("BREAK=== dos");
    c.ms.flush();
    // El espacio antes y después de MSG_BREAK se conservan (cada uno va a una burbuja
    // distinta, separadas por onNewMessage; el renderer trimea cada burbuja). Acá se ven
    // juntos solo porque el test concatena todos los deltas, pero nunca se renderizan así.
    expect(c.text()).toBe("uno  dos");
    expect(c.breaks.length).toBe(1);
  });

  it("retiene un draft incompleto hasta que llega DRAFT_END", () => {
    const c = collect();
    c.ms.push("Te paso el borrador: <<<DRAFT_START>>>Hola Ju");
    // el marcador y el contenido del draft NO se emiten todavía
    expect(c.text()).toBe("Te paso el borrador: ");
    c.ms.push("an, te escribo por la propiedad.<<<DRAFT_END>>> avisame");
    c.ms.flush();
    expect(c.text()).toContain("<<<DRAFT_START>>>");
    expect(c.text()).toContain("<<<DRAFT_END>>>");
    expect(c.text()).toContain("avisame");
  });

  it("mantiene WHATSAPP_TO pegado al draft", () => {
    const c = collect();
    c.ms.push("<<<WHATSAPP_TO:+5493510000000>>><<<DRAFT_START>>>Hola<<<DRAFT_END>>>");
    c.ms.flush();
    expect(c.text()).toBe("<<<WHATSAPP_TO:+5493510000000>>><<<DRAFT_START>>>Hola<<<DRAFT_END>>>");
  });

  it("nunca emite un <<<DRAFT_ST parcial como texto", () => {
    const c = collect();
    c.ms.push("listo <<<DRAFT_ST");
    expect(c.text()).toBe("listo ");
    c.ms.push("ART>>>contenido<<<DRAFT_END>>>");
    c.ms.flush();
    expect(c.text()).toBe("listo <<<DRAFT_START>>>contenido<<<DRAFT_END>>>");
  });

  it("en flush emite lo que quedó aunque el draft no haya cerrado", () => {
    const c = collect();
    c.ms.push("texto <<<DRAFT_START>>>a medio");
    c.ms.flush();
    expect(c.text()).toBe("texto <<<DRAFT_START>>>a medio");
  });

  it("dispara onNewMessage por cada MSG_BREAK", () => {
    const c = collect();
    c.ms.push("uno ===MSG_BREAK=== dos ===MSG_BREAK=== tres");
    c.ms.flush();
    expect(c.text()).toBe("uno  dos  tres");
    expect(c.breaks.length).toBe(2);
  });
});
