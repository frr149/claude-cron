import { describe, it, expect } from "bun:test";
import { LaunchdInstaller } from "../../src/daemon/launchd.js";

describe("LaunchdInstaller", () => {
  const installer = new LaunchdInstaller();

  it("tiene platform correcto", () => {
    expect(installer.platform).toBe("macOS");
  });

  it("status devuelve un valor válido", async () => {
    const result = await installer.status();
    expect(["running", "stopped", "not_installed"]).toContain(result);
  });
});
