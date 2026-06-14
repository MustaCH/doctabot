import { describe, it, expect } from "vitest";
import { conversationIdFromUrl, isViewingConversation } from "./push-visibility";

describe("conversationIdFromUrl", () => {
  it("extrae el id de una URL relativa /?c=<id>", () => {
    expect(conversationIdFromUrl("/?c=abc-123")).toBe("abc-123");
  });
  it("extrae el id de una URL absoluta", () => {
    expect(conversationIdFromUrl("https://app.docta/?c=xyz")).toBe("xyz");
  });
  it("devuelve null si no hay parámetro c", () => {
    expect(conversationIdFromUrl("/")).toBeNull();
    expect(conversationIdFromUrl("/?c=")).toBeNull();
    expect(conversationIdFromUrl("/?other=1")).toBeNull();
  });
});

describe("isViewingConversation (supresión de push redundante)", () => {
  const conv = "conv-1";

  it("suprime si una ventana visible está en esa conversación", () => {
    const clients = [{ visibilityState: "visible", url: "/?c=conv-1" }];
    expect(isViewingConversation(clients, conv)).toBe(true);
  });

  it("NO suprime si la única ventana está oculta (app en background)", () => {
    const clients = [{ visibilityState: "hidden", url: "/?c=conv-1" }];
    expect(isViewingConversation(clients, conv)).toBe(false);
  });

  it("NO suprime si el usuario está en OTRA conversación", () => {
    const clients = [{ visibilityState: "visible", url: "/?c=conv-2" }];
    expect(isViewingConversation(clients, conv)).toBe(false);
  });

  it("NO suprime si no hay ventanas abiertas", () => {
    expect(isViewingConversation([], conv)).toBe(false);
  });

  it("suprime si CUALQUIERA de varias ventanas está visible en la conversación", () => {
    const clients = [
      { visibilityState: "hidden", url: "/?c=conv-1" },
      { visibilityState: "visible", url: "/?c=conv-2" },
      { visibilityState: "visible", url: "/?c=conv-1" },
    ];
    expect(isViewingConversation(clients, conv)).toBe(true);
  });

  it("NO suprime un push sin conversación (proactivo, ej. morning-matches) aunque la app esté en foco", () => {
    const clients = [{ visibilityState: "visible", url: "/" }];
    expect(isViewingConversation(clients, null)).toBe(false);
  });

  it("NO suprime un push sin conversación aunque la app esté en una conversación", () => {
    const clients = [{ visibilityState: "visible", url: "/?c=conv-9" }];
    expect(isViewingConversation(clients, null)).toBe(false);
  });
});
