import { useEffect, useState } from "react";

type HealthStatus = "checking" | "online" | "offline";

const capabilities = [
  {
    label: "Agents SDK",
    detail: "Estado durable por conversación",
  },
  {
    label: "Workers AI",
    detail: "Inferencia en el edge",
  },
  {
    label: "R2",
    detail: "Archivos y medios de WhatsApp",
  },
  {
    label: "React 19",
    detail: "Panel listo para evolucionar",
  },
];

export function App() {
  const [health, setHealth] = useState<HealthStatus>("checking");

  useEffect(() => {
    const controller = new AbortController();

    async function checkHealth() {
      try {
        const response = await fetch("/api/health", {
          signal: controller.signal,
        });
        setHealth(response.ok ? "online" : "offline");
      } catch (error) {
        if (!controller.signal.aborted) {
          console.error("No fue posible consultar el Worker.", error);
          setHealth("offline");
        }
      }
    }

    void checkHealth();

    return () => controller.abort();
  }, []);

  return (
    <main className="shell">
      <div className="ambient ambient--one" aria-hidden="true" />
      <div className="ambient ambient--two" aria-hidden="true" />

      <section className="hero" aria-labelledby="hero-title">
        <div className="eyebrow">
          <span className={`status-dot status-dot--${health}`} />
          Worker {health === "checking" ? "comprobando" : health}
        </div>

        <div className="brand-mark" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>

        <p className="kicker">Cloudflare-native customer care</p>
        <h1 id="hero-title">
          Hola, soy tu próximo
          <span> agente de atención.</span>
        </h1>
        <p className="intro">
          Una base segura y escalable para conversar con tus clientes por
          WhatsApp, construida de extremo a extremo sobre Cloudflare.
        </p>

        <div className="capabilities" aria-label="Tecnologías preparadas">
          {capabilities.map((capability) => (
            <article className="capability" key={capability.label}>
              <div className="capability-icon" aria-hidden="true">
                ✓
              </div>
              <div>
                <h2>{capability.label}</h2>
                <p>{capability.detail}</p>
              </div>
            </article>
          ))}
        </div>

        <footer>
          <span>agent-cloudflare</span>
          <span className="footer-separator" />
          <span>Primer latido en el edge</span>
        </footer>
      </section>
    </main>
  );
}
