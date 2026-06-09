import { describe, it, expect } from "vitest";
import { corsHeaders, handleOptions } from "./cors";

describe("corsHeaders", () => {
  it("permite el origen y los headers del cliente supabase", () => {
    expect(corsHeaders["Access-Control-Allow-Origin"]).toBe("*");
    expect(corsHeaders["Access-Control-Allow-Headers"]).toContain("authorization");
    expect(corsHeaders["Access-Control-Allow-Headers"]).toContain("x-supabase-client-platform");
  });
});

describe("handleOptions", () => {
  it("devuelve una Response para OPTIONS con headers CORS", () => {
    const res = handleOptions(new Request("https://x", { method: "OPTIONS" }));
    expect(res).not.toBeNull();
    expect(res!.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });
  it("devuelve null para otros métodos", () => {
    expect(handleOptions(new Request("https://x", { method: "POST" }))).toBeNull();
  });
});
