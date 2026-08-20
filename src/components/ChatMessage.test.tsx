// Frontend — Contrato del layout de mensajes de Alan (ticket 86ak3kc9v).
// Las tarjetas de propiedad van FUERA de la burbuja (full-bleed, ancho completo del
// contenedor); el texto sigue en burbuja, intercalado en el orden original. La tarjeta
// monta el precio sobre la foto y los datos secundarios son chips sin emoji.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import ChatMessage from "@/components/ChatMessage";
import { buildTurnErrorMessage } from "../../supabase/functions/chat/_shared/turn-error";

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

const bubbleSel = '[data-bubble="assistant"]';

afterEach(cleanup);

describe("ChatMessage — tarjetas fuera de la burbuja", () => {
  it("texto en burbuja y tarjetas full-bleed, en el orden original", () => {
    const content = `Encontré 2 opciones:\n\n${cardMd(1)}\n\n¿Te sirven estas?\n\n${cardMd(2)}`;
    const { container } = render(<ChatMessage role="assistant" content={content} />);

    // primera propiedad completa, la segunda compacta
    const cards = container.querySelectorAll('[data-testid^="property-card"]');
    expect(cards.length).toBe(2);
    expect(cards[0].getAttribute("data-testid")).toBe("property-card");
    expect(cards[1].getAttribute("data-testid")).toBe("property-card-compact");

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

  it("con 3+ propiedades, solo la primera es completa", () => {
    const content = [cardMd(1), cardMd(2), cardMd(3)].join("\n\n");
    const { container } = render(<ChatMessage role="assistant" content={content} />);
    expect(container.querySelectorAll('[data-testid="property-card"]').length).toBe(1);
    expect(container.querySelectorAll('[data-testid="property-card-compact"]').length).toBe(2);
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

  it("la compacta de una propiedad Docta lleva punto rojo y rótulo; sin match no reserva badge", () => {
    const doctaCard = [
      "🏠 **Depto Docta**",
      "🏢 RE/MAX Docta",
      "💰 Precio: USD 90.000",
      "📐 Superficie: 58 m² totales (2 hab · 1 baños)",
      "🔗 [Ver propiedad](https://remax.com.ar/pd)",
    ].join("\n");
    const { container } = render(
      <ChatMessage role="assistant" content={`${cardMd(1)}\n\n${doctaCard}`} />
    );
    const compact = container.querySelector('[data-testid="property-card-compact"]')!;
    expect(compact.querySelector('[data-testid="docta-dot"]')).not.toBeNull();
    expect(compact.textContent).toContain("RE/MAX Docta");
    // línea de datos compacta y sin badge de match
    expect(compact.textContent).toContain("58 m² totales · 2 hab");
    expect(compact.textContent).not.toMatch(/%/);
  });

  it("un mensaje sin tarjetas sigue yendo entero en burbuja", () => {
    const { container } = render(<ChatMessage role="assistant" content="Hola, ¿en qué te ayudo?" />);
    const bubble = container.querySelector(bubbleSel);
    expect(bubble).not.toBeNull();
    expect(bubble!.textContent).toContain("Hola");
    expect(container.querySelector('[data-testid="property-card"]')).toBeNull();
  });
});

describe("ChatMessage — turno fallido y Reintentar (ticket 86ak3kd99)", () => {
  it("error sin tools con efecto: burbuja roja, orb en error y botón Reintentar que dispara onRetry", () => {
    const onRetry = vi.fn();
    const { container } = render(
      <ChatMessage role="assistant" content={buildTurnErrorMessage([])} onRetry={onRetry} />
    );
    expect(container.querySelector('.alan-orb[data-state="error"]')).not.toBeNull();
    const btn = screen.getByRole("button", { name: /reintentar/i });
    fireEvent.click(btn);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("error tras tools con efecto: advierte qué se ejecutó y NO ofrece Reintentar", () => {
    const onRetry = vi.fn();
    render(
      <ChatMessage role="assistant" content={buildTurnErrorMessage(["send_email"])} onRetry={onRetry} />
    );
    expect(screen.getByText(/enviar un email/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /reintentar/i })).toBeNull();
  });

  it("mensaje de error viejo persistido: se estiliza como error pero sin botón (prudencia)", () => {
    const { container } = render(
      <ChatMessage
        role="assistant"
        content="Lo siento, hubo un problema generando la respuesta. ¿Podés intentar de nuevo?"
        onRetry={vi.fn()}
      />
    );
    expect(container.querySelector('.alan-orb[data-state="error"]')).not.toBeNull();
    expect(screen.queryByRole("button", { name: /reintentar/i })).toBeNull();
  });

  it("una respuesta normal no muestra Reintentar aunque reciba onRetry", () => {
    render(<ChatMessage role="assistant" content="Listo, agendado." onRetry={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /reintentar/i })).toBeNull();
  });
});
