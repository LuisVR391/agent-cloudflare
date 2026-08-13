import { FlaskConical } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { simulateInboundMessage } from "@/lib/api";

/**
 * Siembra un mensaje entrante sin salir del panel.
 *
 * Es utillaje de desarrollo: quien lo monta lo hace dentro de
 * `import.meta.env.DEV`, y el Worker tampoco expone la ruta en el artefacto
 * construido. El icono y la etiqueta lo separan de los controles reales para
 * que nadie lo confunda con una acción del producto.
 */
export function DevInboundButton({
  conversationId,
  onSimulated,
}: {
  /** Continúa ese hilo; sin él, simula un contacto nuevo. */
  conversationId?: string;
  onSimulated: () => void;
}) {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function simulate() {
    setRunning(true);
    setError(null);
    try {
      await simulateInboundMessage(conversationId);
      onSimulated();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "No fue posible simular el mensaje.",
      );
    } finally {
      setRunning(false);
    }
  }

  return (
    <Button
      disabled={running}
      onClick={() => void simulate()}
      size="sm"
      title={error ?? "Solo disponible en desarrollo local"}
      variant="ghost"
    >
      {running ? <Spinner /> : <FlaskConical aria-hidden="true" />}
      {conversationId ? "Simular respuesta" : "Simular contacto"}
    </Button>
  );
}
