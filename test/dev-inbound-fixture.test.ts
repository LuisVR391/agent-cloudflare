import { env, exports } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";

import { routeAuthRequest } from "../src/worker/auth/http";
import { routeDevFixtureApi } from "../src/worker/dev/inbound-fixture";
import { processInboundQueueMessage } from "../src/worker/integrations/zernio/inbound-queue";

const LOCAL_ORIGIN = "http://localhost:5190";
const REMOTE_ORIGIN = "https://agent-cloudflare-staging.example.workers.dev";

/**
 * El resto de las pruebas del panel corre sobre `https://example.com`, el
 * origen de autenticación que fija `vitest.config.ts`. Aquí hace falta un
 * entorno local de verdad, porque la ruta de simulación solo existe cuando el
 * origen configurado lo es; por eso el env se reconstruye y las rutas se
 * invocan directamente en vez de pasar por el handler del Worker.
 */
/**
 * El binding de cola no está disponible en el pool de pruebas, así que el
 * envío se entrega al consumidor real. El recorrido queda completo —webhook,
 * consumidor, runtime y D1— sin depender de la infraestructura de Queues.
 */
const inboundQueue = {
  send: async (body: unknown) => {
    await processInboundQueueMessage(
      env as never,
      body as Parameters<typeof processInboundQueueMessage>[1],
    );
  },
} as unknown as Queue;

const localEnv = {
  ...env,
  BETTER_AUTH_URL: LOCAL_ORIGIN,
  INBOUND_MESSAGES: inboundQueue,
  // Explícito y no heredado de `.dev.vars`: ese archivo no existe en CI y la
  // prueba dejaría de ejercitar la firma sin que nadie lo notara.
  ZERNIO_WEBHOOK_SECRET: "test-only-webhook-secret",
} as unknown as Parameters<typeof routeDevFixtureApi>[1];

const setupBody = {
  setupToken: "test-only-setup-token",
  organizationName: "Salón Simulado",
  organizationSlug: "salon-simulado",
  ownerName: "Olivia Owner",
  ownerEmail: "owner-fixture@example.com",
  ownerPassword: "correct-horse-battery-staple",
};

function cookiePair(setCookie: string | null): string {
  return (setCookie ?? "").split(";", 1)[0];
}

function simulate(body: string, cookie?: string, origin = LOCAL_ORIGIN) {
  return routeDevFixtureApi(
    new Request(`${origin}/api/dev/inbound-messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(cookie ? { cookie } : {}),
      },
      body,
    }),
    localEnv,
  );
}

describe.sequential("simulación de mensajes entrantes en desarrollo", () => {
  let sessionCookie: string;
  let organizationId: string;

  beforeAll(async () => {
    const setup = await routeAuthRequest(
      new Request(`${LOCAL_ORIGIN}/api/setup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(setupBody),
      }),
      localEnv,
    );
    const result = (await setup!.json()) as { organization: { id: string } };
    organizationId = result.organization.id;

    const login = await routeAuthRequest(
      new Request(`${LOCAL_ORIGIN}/api/auth/sign-in/email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: setupBody.ownerEmail,
          password: setupBody.ownerPassword,
        }),
      }),
      localEnv,
    );
    sessionCookie = cookiePair(login!.headers.get("set-cookie"));
  });

  it("no existe fuera de un entorno local", async () => {
    // Origen de petición remoto, aunque el resto del entorno sea local.
    await expect(simulate("{}", sessionCookie, REMOTE_ORIGIN)).resolves.toBeNull();

    // Y tampoco cuando el origen configurado del entorno no es local, que es
    // el caso de staging.
    await expect(
      routeDevFixtureApi(
        new Request(`${REMOTE_ORIGIN}/api/dev/inbound-messages`, {
          method: "POST",
          headers: { cookie: sessionCookie },
          body: "{}",
        }),
        env as unknown as Parameters<typeof routeDevFixtureApi>[1],
      ),
    ).resolves.toBeNull();

    // El Worker completo responde 404 en ese caso: la ruta no se anuncia.
    const response = await exports.default.fetch(
      new Request(`${REMOTE_ORIGIN}/api/dev/inbound-messages`, { method: "POST" }),
    );
    expect(response.status).toBe(404);
  });

  it("exige sesión y permiso de gestión", async () => {
    const anonymous = await simulate("{}");
    expect(anonymous?.status).toBe(401);

    await env.DB.prepare(
      `DELETE FROM role_permissions
        WHERE organization_id = ?
          AND permission_id IN (
            SELECT id FROM permissions WHERE permission_key = 'conversations.manage')`,
    )
      .bind(organizationId)
      .run();
    const forbidden = await simulate("{}", sessionCookie);
    expect(forbidden?.status).toBe(403);

    await env.DB.prepare(
      `INSERT INTO role_permissions (organization_id, role_id, permission_id, granted_at)
       SELECT r.organization_id, r.id, p.id, ?
         FROM roles r JOIN permissions p ON p.permission_key = 'conversations.manage'
        WHERE r.organization_id = ? AND r.role_key = 'owner'
         ON CONFLICT (organization_id, role_id, permission_id) DO NOTHING`,
    )
      .bind(new Date().toISOString(), organizationId)
      .run();
  });

  it("crea un contacto con teléfono y sin nombre, y continúa su hilo", async () => {
    const created = await simulate("{}", sessionCookie);
    expect(created?.status).toBe(202);
    const fixture = (await created!.json()) as { phoneNumber: string; text: string };
    expect(fixture.phoneNumber).toMatch(/^\+52\d{10}$/);
    expect(fixture.text).toMatch(/^Hola, soy /);

    const contact = await env.DB.prepare(
      `SELECT id, display_name, phone_number FROM contacts
        WHERE organization_id = ? AND phone_number = ?`,
    )
      .bind(organizationId, fixture.phoneNumber)
      .first<{ id: string; display_name: string | null; phone_number: string }>();
    // El canal real no entrega el nombre, así que la simulación tampoco lo
    // inventa: la presentación vive en el texto del mensaje.
    expect(contact?.display_name).toBeNull();
    expect(contact?.phone_number).toBe(fixture.phoneNumber);

    const conversation = await env.DB.prepare(
      `SELECT id FROM conversations WHERE organization_id = ? AND contact_id = ?`,
    )
      .bind(organizationId, contact!.id)
      .first<{ id: string }>();

    const continued = await simulate(
      JSON.stringify({ conversationId: conversation!.id }),
      sessionCookie,
    );
    expect(continued?.status).toBe(202);

    const counts = await env.DB.prepare(
      `SELECT
         (SELECT COUNT(*) FROM messages WHERE organization_id = ? AND conversation_id = ?) AS mensajes,
         (SELECT COUNT(*) FROM conversations WHERE organization_id = ? AND contact_id = ?) AS hilos`,
    )
      .bind(organizationId, conversation!.id, organizationId, contact!.id)
      .first<{ mensajes: number; hilos: number }>();
    expect(counts).toEqual({ mensajes: 2, hilos: 1 });
  });

  it("rechaza una conversación inexistente y un método no permitido", async () => {
    const missing = await simulate(
      JSON.stringify({ conversationId: crypto.randomUUID() }),
      sessionCookie,
    );
    expect(missing?.status).toBe(404);

    const wrongMethod = await routeDevFixtureApi(
      new Request(`${LOCAL_ORIGIN}/api/dev/inbound-messages`, {
        method: "GET",
        headers: { cookie: sessionCookie },
      }),
      localEnv,
    );
    expect(wrongMethod?.status).toBe(405);
  });
});
