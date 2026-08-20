// Frontend — Contrato del layout de mensajes de Alan (ticket 86ak3kc9v).
// Las tarjetas de propiedad van FUERA de la burbuja (full-bleed, ancho completo del
// contenedor); el texto sigue en burbuja, intercalado en el orden original. La tarjeta
// monta el precio sobre la foto y los datos secundarios son chips sin emoji.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import ChatMessage from "@/components/ChatMessage";

// useFavorite (vía PropertyCard) usa useAuth + supabase; con user null corta temprano y no toca la red.
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: null, agentCode: null }),
}));

// use-favorite importa el client generado de Supabase, que exige VITE_SUPABASE_URL en
// colección; mockeado, esta suite corre sin .env local (a diferencia de PropertyCard.test).
vi.mock("@/hooks/use-favorite", () => ({
  useFavorite: () => ({ isFavorite: false, toggle: () => {}, loading: false, canFavorite: false }),
}));

const cardMd = (n: number) =>
  [
    `🏠 **Propiedad ${n}**`,
    `💰 Precio: USD 10${n}.000`,
    "📍 Ubicación: Nueva Córdoba",
    "📐 Superficie: 62 m² totales (2 hab · 1 baños)",
    `🔗 [Ver propiedad](https://remax.com.ar/p${n})`,
  ].join("\n");

const bubbleSel = ".rounded-tl-md";

afterEach(cleanup);

describe("ChatMessage — tarjetas fuera de la burbuja", () => {
  it("texto en burbuja y tarjetas full-bleed, en el orden original", () => {
    const content = `Encontré 2 opciones:\n\n${cardMd(1)}\n\n¿Te sirven estas?\n\n${cardMd(2)}`;
    const { container } = render(<ChatMessage role="assistant" content={content} />);

    const cards = container.querySelectorAll('[data-testid="property-card"]');
    expect(cards.length).toBe(2);

    const bubbles = container.querySelectorAll(bubbleSel);
    expect(bubbles.length).toBe(2);
    bubbles.forEach((b) => cards.forEach((c) => expect(b.contains(c)).toBe(false)));

    // orden: burbuja de intro → tarjeta 1 → burbuja intermedia → tarjeta 2
    expect(bubbles[0].compareDocumentPosition(cards[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(cards[0].compareDocumentPosition(bubbles[1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(bubbles[1].compareDocumentPosition(cards[1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    // full-bleed: la tarjeta no está anidada en la columna del 80%
    cards.forEach((c) => expect(c.closest(".max-w-\\[80\\%\\]")).toBeNull());
  });

  it("una sola tarjeta renderiza fuera de burbuja y sin burbuja vacía", () => {
    const { container } = render(<ChatMessage role="assistant" content={cardMd(1)} />);
    expect(container.querySelectorAll('[data-testid="property-card"]').length).toBe(1);
    expect(container.querySelector(bubbleSel)).toBeNull();
  });

  it("el precio va montado sobre la foto, no en el cuerpo", () => {
    render(<ChatMessage role="assistant" content={cardMd(1)} />);
    const price = screen.getByText("USD 101.000");
    // el overlay del precio vive en el contenedor relative de la imagen
    expect(price.closest(".relative")).not.toBeNull();
  });

  it("los datos secundarios son chips sin emoji", () => {
    const { container } = render(<ChatMessage role="assistant" content={cardMd(1)} />);
    expect(screen.getByText("62 m² totales")).toBeTruthy();
    expect(screen.getByText("2 hab")).toBeTruthy();
    expect(screen.getByText("1 baños")).toBeTruthy();
    expect(container.textContent).not.toMatch(/📐|💰|📍/u);
  });

  it("un mensaje sin tarjetas sigue yendo entero en burbuja", () => {
    const { container } = render(<ChatMessage role="assistant" content="Hola, ¿en qué te ayudo?" />);
    const bubble = container.querySelector(bubbleSel);
    expect(bubble).not.toBeNull();
    expect(bubble!.textContent).toContain("Hola");
    expect(container.querySelector('[data-testid="property-card"]')).toBeNull();
  });
});
