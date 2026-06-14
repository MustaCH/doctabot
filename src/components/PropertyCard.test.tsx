// Frontend — Comportamiento del botón "Compartir por WhatsApp" de la PropertyCard.
// Ticket 86aj1f1wu: el botón sólo existe cuando la conversación activa tiene un cliente
// con teléfono (whatsappPhone real). Sin cliente vinculado (undefined) NO se muestra,
// en vez de quedar disabled/inútil.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import PropertyCard from "@/components/PropertyCard";

// useFavorite (vía PropertyCard) usa useAuth + supabase; con user null corta temprano y no toca la red.
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: null, agentCode: null }),
}));

const baseProps = {
  title: "Depto en Nueva Córdoba",
  price: "USD 120.000",
  location: "Nueva Córdoba",
  url: "https://remax.com.ar/p1",
};

afterEach(cleanup);

describe("PropertyCard — botón compartir por WhatsApp", () => {
  it("con whatsappPhone real, muestra el botón y precarga wa.me al teléfono del cliente", () => {
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    render(<PropertyCard {...baseProps} whatsappPhone="+54 9 351 123-4567" />);

    const btn = screen.getByRole("button", { name: /compartir por whatsapp/i });
    expect(btn).toBeEnabled();

    fireEvent.click(btn);
    expect(openSpy).toHaveBeenCalledTimes(1);
    const calledUrl = openSpy.mock.calls[0][0] as string;
    expect(calledUrl).toContain("wa.me/5493511234567"); // sólo dígitos
    openSpy.mockRestore();
  });

  it("sin cliente vinculado (whatsappPhone undefined), el botón NO se muestra", () => {
    render(<PropertyCard {...baseProps} />);
    expect(
      screen.queryByRole("button", { name: /compartir por whatsapp/i })
    ).toBeNull();
  });
});
