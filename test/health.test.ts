import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

describe("GET /api/health", () => {
  it("reports the Worker as healthy", async () => {
    const response = await exports.default.fetch(
      new Request("https://example.com/api/health"),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      service: "agent-cloudflare",
      runtime: "cloudflare-workers",
    });
  });
});
