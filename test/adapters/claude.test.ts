import { describe, it, expect } from "bun:test";
import { ClaudeAdapter } from "../../src/adapters/claude.js";

describe("ClaudeAdapter", () => {
  const adapter = new ClaudeAdapter();

  it("tiene nombre y comando correctos", () => {
    expect(adapter.name).toBe("claude");
    expect(adapter.cliCommand).toBe("claude");
  });

  it("isInstalled devuelve boolean", async () => {
    const result = await adapter.isInstalled();
    expect(typeof result).toBe("boolean");
    // En el entorno de test, claude debería estar instalado
    // pero no forzamos el resultado
  });
});
