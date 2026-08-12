import {
  ZernioClient,
  ZernioMediaUnavailableError,
  ZernioTransportError,
} from "./client";
import type { AttachmentType } from "./contracts";

const maximumBytes = 16 * 1024 * 1024;

// Solo se conservan los tipos con contenido descargable y verificable. `sticker`
// y `share` se registran sin copiar: el primero no aporta contenido operativo y
// el segundo referencia material externo cuya autoría y permisos no podemos
// demostrar.
const allowedContentTypes: Partial<Record<AttachmentType, readonly string[]>> = {
  image: ["image/"],
  video: ["video/"],
  audio: ["audio/"],
  file: ["application/", "text/"],
};

export type AttachmentOutcome =
  | { status: "stored" }
  | { status: "rejected"; reason: string }
  | { status: "retryable"; reason: string };

function matches(contentType: string, allowed: readonly string[]): boolean {
  return allowed.some((prefix) =>
    prefix.endsWith("/") ? contentType.startsWith(prefix) : contentType === prefix,
  );
}

async function persistAttachment(input: {
  client: ZernioClient;
  db: D1Database;
  bucket: R2Bucket;
  organizationId: string;
  externalAccountId: string;
  messageId: string;
  index: number;
  attachment: {
    type: AttachmentType;
    url: string;
    id?: string | null;
    filename?: string | null;
  };
}): Promise<AttachmentOutcome> {
  const allowed = allowedContentTypes[input.attachment.type];
  const attachmentId = `${input.messageId}:${input.index}`;
  const record = async (
    outcome: AttachmentOutcome,
    stored?: { contentType: string; byteSize: number; key: string },
  ) => {
    const now = new Date().toISOString();
    await input.db.prepare(`INSERT INTO message_attachments
      (id, organization_id, message_id, attachment_type, content_type, byte_size,
       r2_key, status, failure_reason, external_media_id, filename, created_at,
       updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (id) DO UPDATE SET content_type = excluded.content_type,
        byte_size = excluded.byte_size, r2_key = excluded.r2_key,
        status = excluded.status, failure_reason = excluded.failure_reason,
        updated_at = excluded.updated_at`)
      .bind(
        attachmentId,
        input.organizationId,
        input.messageId,
        input.attachment.type,
        stored?.contentType ?? null,
        stored?.byteSize ?? null,
        stored?.key ?? null,
        outcome.status === "stored" ? "stored" : "rejected",
        outcome.status === "stored" ? null : outcome.reason,
        input.attachment.id ?? null,
        input.attachment.filename ?? null,
        now,
        now,
      ).run();
    return outcome;
  };

  if (!allowed) {
    return record({ status: "rejected", reason: "ATTACHMENT_TYPE_UNSUPPORTED" });
  }

  let media: Awaited<ReturnType<ZernioClient["downloadWhatsAppMedia"]>>;
  try {
    media = await input.client.downloadWhatsAppMedia({
      url: input.attachment.url,
      accountId: input.externalAccountId,
    });
  } catch (caught) {
    if (caught instanceof ZernioMediaUnavailableError) {
      // `0` marca una URL fuera del origen del proveedor, que se rechaza antes
      // de enviar la credencial; el resto conserva el estado que devolvió.
      return record({
        status: "rejected",
        reason: caught.status === 0
          ? "ATTACHMENT_HOST_REJECTED"
          : `ATTACHMENT_UNAVAILABLE_${caught.status}`,
      });
    }
    // Transitorio: no se registra un rechazo definitivo para no ocultar que el
    // medio aún podría recuperarse. El motivo viaja en el resultado porque sin
    // él un reintento perpetuo no puede diagnosticarse.
    return {
      status: "retryable",
      reason: caught instanceof ZernioTransportError
        // La categoría distingue un fallo de red de un uso incorrecto del
        // runtime, que exigen respuestas operativas distintas.
        ? `ZernioTransportError:${caught.category}`
        : caught instanceof Error
          ? `${caught.name}:${caught.message}`.slice(0, 200)
          : "ATTACHMENT_DOWNLOAD_FAILED",
    };
  }

  if (media.bytes.byteLength > maximumBytes) {
    return record({ status: "rejected", reason: "ATTACHMENT_SIZE_REJECTED" });
  }
  if (!matches(media.contentType, allowed)) {
    return record({ status: "rejected", reason: "ATTACHMENT_CONTENT_TYPE_REJECTED" });
  }

  const key = `${input.organizationId}/conversations/${input.messageId}/${input.index}`;
  try {
    await input.bucket.put(key, media.bytes, {
      httpMetadata: { contentType: media.contentType },
    });
  } catch (caught) {
    return {
      status: "retryable",
      reason: caught instanceof Error
        ? `STORAGE:${caught.name}:${caught.message}`.slice(0, 200)
        : "ATTACHMENT_STORAGE_FAILED",
    };
  }
  return record({ status: "stored" }, {
    contentType: media.contentType,
    byteSize: media.bytes.byteLength,
    key,
  });
}

// Nunca lanza: un adjunto irrecuperable no debe impedir que su mensaje llegue al
// inbox. El consumidor decide reintentar solo si algún resultado es transitorio.
export async function persistInboundAttachments(input: {
  client: ZernioClient;
  db: D1Database;
  bucket: R2Bucket;
  organizationId: string;
  externalAccountId: string;
  messageId: string;
  attachments: Array<{
    type: AttachmentType;
    url: string;
    id?: string | null;
    filename?: string | null;
  }>;
}): Promise<AttachmentOutcome[]> {
  const outcomes: AttachmentOutcome[] = [];
  for (const [index, attachment] of input.attachments.entries()) {
    outcomes.push(
      await persistAttachment({
        client: input.client,
        db: input.db,
        bucket: input.bucket,
        organizationId: input.organizationId,
        externalAccountId: input.externalAccountId,
        messageId: input.messageId,
        index,
        attachment,
      }),
    );
  }
  return outcomes;
}
