# Configuración operativa de WhatsApp mediante Zernio

Este runbook prepara staging. No autoriza recursos de producción ni contiene
valores de secretos. El canal no se considera activo hasta completar la prueba
firmada y un mensaje real de entrada.

## Prerrequisitos

- Cuenta de WhatsApp conectada y saludable en Zernio.
- Fila de organización creada mediante `/setup` en Agent Cloudflare.
- D1, R2, Queue y Worker de staging provisionados según
  [entornos y staging](./environments.md).
- API key dedicada de Zernio, limitada al perfil conectado y al grupo
  `messages`; la clave general `Default Key` no se usa en el Worker.

El MCP de Zernio no es necesario. Puede usarse como herramienta administrativa
de desarrollo mediante OAuth, pero no forma parte del runtime ni recibe los
secretos del Worker.

## 1. Obtener identificadores externos

Consulta la API de cuentas desde una terminal humana autenticada con la clave
dedicada. No incluyas la clave en el comando, historial o captura. Identifica:

- `accountId` de la cuenta cuya plataforma sea `whatsapp`;
- `profileId` del perfil al que pertenece;
- nombre visible que permita reconocer el número.

El teléfono mostrado en el panel no sustituye estos identificadores opacos.

## 2. Vincular la cuenta en D1

Registra una fila de `communication_channels` con:

- `organization_id`: organización ya instalada en staging;
- `provider`: `whatsapp`;
- `adapter`: `zernio`;
- `external_account_id`: `accountId` obtenido de Zernio;
- `external_profile_id`: `profileId` obtenido de Zernio;
- `status`: `active`.

La escritura se realiza como operación de bootstrap revisada mediante D1 y no
incluye secretos. Hasta que exista una pantalla administrativa de canales,
conserva el identificador de la operación y verifica la fila por organización
antes de continuar.

## 3. Cargar secretos

Para desarrollo local crea `.dev.vars`, que está ignorado por Git:

```dotenv
ZERNIO_WEBHOOK_SECRET=<valor-local-exclusivo>
ZERNIO_API_KEY=<clave-local-o-de-sandbox>
```

No uses `.env` en paralelo. Para staging usa prompts interactivos:

```bash
npx wrangler secret put ZERNIO_WEBHOOK_SECRET --env staging
npx wrangler secret put ZERNIO_API_KEY --env staging
npx wrangler secret list --env staging
```

El secreto HMAC y la API key son valores distintos, exclusivos de staging y no
se copian a producción.

## 4. Crear el webhook en Zernio

Después de desplegar el Worker, crea manualmente:

| Campo | Valor |
| --- | --- |
| Name | `Agent Cloudflare - Staging` |
| URL | `https://agent-cloudflare-staging.<subdominio>.workers.dev/webhooks/zernio` |
| Secret Key | Mismo valor de `ZERNIO_WEBHOOK_SECRET` de staging |
| Custom Headers | Ninguno |

Selecciona solamente:

- `message.received`
- `message.delivered`
- `message.read`
- `message.failed`
- `account.disconnected`

No selecciones `message.sent`, porque Agent Cloudflare será la única interfaz
operativa de envío.

## 5. Validar

1. Envía `webhook.test` desde Zernio y confirma `204` en sus logs.
2. Comprueba que una firma alterada recibe `401` y no escribe D1.
3. Envía un mensaje sintético al número conectado.
4. Verifica una sola fila `enqueued` o `processed` por ID externo, la
   organización correcta y ausencia de contenido personal en logs.
5. Reentrega el mismo evento y confirma `200` sin segundo efecto.
6. Comprueba que `account.disconnected` marca el canal como desconectado.

El cliente de salida está probado en repositorio, pero no se realiza una prueba
real hasta que exista Queue de salida, persistencia de mensajes y una operación
autorizada de Fase 1.

## Recuperación

- Firma inválida: confirma que ambos entornos usan el mismo secreto y rota si
  existe sospecha de exposición.
- `UNKNOWN_CHANNEL`: revisa `accountId`, `profileId`, organización y estado.
- `QUEUE_UNAVAILABLE`: conserva el evento fallido; Zernio reintentará y la
  deduplicación evitará efectos repetidos.
- Cuenta desconectada: reconecta en Zernio, verifica salud y reactiva el canal
  mediante una operación administrativa revisada.
