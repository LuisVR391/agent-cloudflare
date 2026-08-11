const maximumBytes = 16 * 1024 * 1024;
const allowedContentTypes = {
  audio: ["audio/"],
  image: ["image/"],
  document: ["application/pdf"],
} as const;

function validateUrl(value: string): URL {
  const url = new URL(value);
  const host = url.hostname.toLowerCase();
  if (
    url.protocol !== "https:" ||
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "127.0.0.1" ||
    host === "::1"
  ) {
    throw new Error("ATTACHMENT_URL_REJECTED");
  }
  return url;
}

export async function persistInboundAttachments(input: {
  db: D1Database;
  bucket: R2Bucket;
  organizationId: string;
  messageId: string;
  attachments: Array<{ type: "audio" | "image" | "document"; url: string }>;
}): Promise<void> {
  for (const [index, attachment] of input.attachments.entries()) {
    const url = validateUrl(attachment.url);
    const response = await fetch(url, { redirect: "error" });
    if (!response.ok) throw new Error("ATTACHMENT_DOWNLOAD_FAILED");
    const declaredSize = Number(response.headers.get("content-length"));
    if (!Number.isFinite(declaredSize) || declaredSize < 0 || declaredSize > maximumBytes) {
      throw new Error("ATTACHMENT_SIZE_REJECTED");
    }
    const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.toLowerCase() ?? "";
    if (!allowedContentTypes[attachment.type].some((allowed) =>
      allowed.endsWith("/") ? contentType.startsWith(allowed) : contentType === allowed
    )) {
      throw new Error("ATTACHMENT_CONTENT_TYPE_REJECTED");
    }
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength !== declaredSize || bytes.byteLength > maximumBytes) {
      throw new Error("ATTACHMENT_SIZE_MISMATCH");
    }
    const attachmentId = `${input.messageId}:${index}`;
    const key = `${input.organizationId}/conversations/${input.messageId}/${index}`;
    await input.bucket.put(key, bytes, { httpMetadata: { contentType } });
    await input.db.prepare(`INSERT INTO message_attachments
      (id, organization_id, message_id, attachment_type, content_type, byte_size, r2_key, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (id) DO UPDATE SET content_type = excluded.content_type,
        byte_size = excluded.byte_size, r2_key = excluded.r2_key`)
      .bind(attachmentId, input.organizationId, input.messageId, attachment.type,
        contentType, bytes.byteLength, key, new Date().toISOString()).run();
  }
}
