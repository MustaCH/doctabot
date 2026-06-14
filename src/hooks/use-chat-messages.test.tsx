// Frontend — Máquina de estados del indicador "Alan trabajando" (ticket 86aj1naw2).
// Verifica que isWorking refleje el estado REAL del turno (no se "pega"):
//  - true al arrancar el turno, hasta el primer token
//  - false apenas entra texto (onDelta)
//  - true de nuevo en el gap del tool-loop (onNewMessage = ===MSG_BREAK===)
//  - false al llegar la continuación y al terminar (onDone)
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({
  streamChat: vi.fn(),
  getSession: vi.fn(),
  insert: vi.fn(),
}));

vi.mock("@/lib/stream-chat", () => ({ streamChat: h.streamChat }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getSession: h.getSession },
    from: () => ({
      select: () => ({ eq: () => ({ order: () => Promise.resolve({ data: [] }) }) }),
      insert: h.insert,
    }),
    storage: { from: () => ({ upload: vi.fn(), createSignedUrl: () => Promise.resolve({ data: null }) }) },
  },
}));
vi.mock("@/hooks/use-file-processing", () => ({
  useFileProcessing: () => ({
    isProcessingPdf: false,
    processAttachments: () => Promise.resolve({ msgAttachments: undefined, pdfTexts: [] }),
  }),
}));
vi.mock("@/hooks/use-feedback", () => ({ feedbackReceive: vi.fn() }));
vi.mock("@/hooks/use-audio-recorder", () => ({ transcribeAudio: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { useChatMessages } from "@/hooks/use-chat-messages";

function setup() {
  return renderHook(() =>
    useChatMessages(
      "conv1",
      vi.fn(() => Promise.resolve("conv1")),
      vi.fn(),
      vi.fn(() => Promise.resolve()),
      vi.fn(() => Promise.resolve()),
    )
  );
}

describe("useChatMessages — indicador 'Alan trabajando' (isWorking)", () => {
  let streamOpts: any;
  let resolveStream: () => void;

  beforeEach(() => {
    vi.clearAllMocks();
    streamOpts = null;
    h.getSession.mockResolvedValue({ data: { session: { access_token: "t", user: { id: "u1" } } } });
    h.insert.mockResolvedValue({ error: null });
    h.streamChat.mockImplementation((opts: any) => {
      streamOpts = opts;
      return new Promise<void>((res) => { resolveStream = res; });
    });
  });

  it("conmuta isWorking siguiendo el ciclo real del turno multi-tool", async () => {
    const { result } = setup();
    expect(result.current.isWorking).toBe(false);

    // Arranca el turno: isWorking true hasta el primer token.
    act(() => { void result.current.handleSend("buscá propiedades para Armando"); });
    await waitFor(() => expect(streamOpts).toBeTruthy());
    expect(result.current.isWorking).toBe(true);

    // Primer token → se oculta el indicador.
    act(() => streamOpts.onDelta("Dale, busco para Armando."));
    expect(result.current.isWorking).toBe(false);

    // Gap del tool-loop (===MSG_BREAK===) → vuelve a mostrarse.
    act(() => streamOpts.onNewMessage());
    expect(result.current.isWorking).toBe(true);

    // Continuación entrando → se oculta de nuevo.
    act(() => streamOpts.onDelta("Encontré 3 propiedades 🏠"));
    expect(result.current.isWorking).toBe(false);

    // Fin del turno → permanece oculto.
    await act(async () => { await streamOpts.onDone(); resolveStream(); });
    expect(result.current.isWorking).toBe(false);
  });

  it("la continuación tras ===MSG_BREAK=== se renderiza como burbuja nueva, no appendeada", async () => {
    const { result } = setup();
    act(() => { void result.current.handleSend("hola"); });
    await waitFor(() => expect(streamOpts).toBeTruthy());

    act(() => streamOpts.onDelta("Primera respuesta."));
    act(() => streamOpts.onNewMessage());
    act(() => streamOpts.onDelta("Continuación tras tools."));

    const assistantMsgs = result.current.messages.filter((m) => m.role === "assistant");
    expect(assistantMsgs).toHaveLength(2);
    expect(assistantMsgs[0].content).toBe("Primera respuesta.");
    expect(assistantMsgs[1].content).toBe("Continuación tras tools.");

    await act(async () => { await streamOpts.onDone(); resolveStream(); });
  });
});
