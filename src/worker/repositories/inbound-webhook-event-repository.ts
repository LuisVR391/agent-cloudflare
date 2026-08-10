import { requireOrganizationScope } from "../domain/errors";
import type {
  InboundWebhookEvent,
  RegisterInboundWebhookEventInput,
} from "../domain/types";
import {
  type InboundWebhookEventRow,
  toInboundWebhookEvent,
} from "./row-mapping";

export class InboundWebhookEventRepository {
  readonly #db: D1Database;

  constructor(db: D1Database) {
    this.#db = db;
  }

  async register(
    organizationId: string,
    input: RegisterInboundWebhookEventInput,
  ): Promise<{ event: InboundWebhookEvent; created: boolean }> {
    const scope = requireOrganizationScope(
      organizationId,
      "InboundWebhookEventRepository.register",
    );
    const result = await this.#db
      .prepare(
        `INSERT OR IGNORE INTO inbound_webhook_events (
           id, organization_id, channel_id, adapter, external_event_id,
           event_type, status, correlation_id, received_at
         ) VALUES (?, ?, ?, ?, ?, ?, 'received', ?, ?)`,
      )
      .bind(
        crypto.randomUUID(),
        scope,
        input.channelId,
        input.adapter,
        input.externalEventId,
        input.eventType,
        input.correlationId,
        input.receivedAt,
      )
      .run();

    const row = await this.#db
      .prepare(
        `SELECT * FROM inbound_webhook_events
         WHERE adapter = ? AND external_event_id = ?`,
      )
      .bind(input.adapter, input.externalEventId)
      .first<InboundWebhookEventRow>();

    if (row === null || row.organization_id !== scope) {
      throw new Error("No se pudo registrar el evento entrante.");
    }

    return {
      event: toInboundWebhookEvent(row),
      created: result.meta.changes === 1,
    };
  }

  async markEnqueued(
    organizationId: string,
    externalEventId: string,
    enqueuedAt: string,
  ): Promise<void> {
    await this.#updateStatus(
      organizationId,
      externalEventId,
      "enqueued",
      "enqueued_at",
      enqueuedAt,
    );
  }

  async markProcessed(
    organizationId: string,
    externalEventId: string,
    processedAt: string,
  ): Promise<void> {
    await this.#updateStatus(
      organizationId,
      externalEventId,
      "processed",
      "processed_at",
      processedAt,
    );
  }

  async markFailed(
    organizationId: string,
    externalEventId: string,
    failureCode: string,
  ): Promise<void> {
    const scope = requireOrganizationScope(
      organizationId,
      "InboundWebhookEventRepository.markFailed",
    );
    await this.#db
      .prepare(
        `UPDATE inbound_webhook_events
         SET status = 'failed', failure_code = ?
         WHERE organization_id = ? AND adapter = 'zernio' AND external_event_id = ?`,
      )
      .bind(failureCode, scope, externalEventId)
      .run();
  }

  async #updateStatus(
    organizationId: string,
    externalEventId: string,
    status: "enqueued" | "processed",
    timestampColumn: "enqueued_at" | "processed_at",
    timestamp: string,
  ): Promise<void> {
    const scope = requireOrganizationScope(
      organizationId,
      `InboundWebhookEventRepository.${status}`,
    );
    await this.#db
      .prepare(
        `UPDATE inbound_webhook_events
         SET status = ?, ${timestampColumn} = ?, failure_code = NULL
         WHERE organization_id = ? AND adapter = 'zernio' AND external_event_id = ?`,
      )
      .bind(status, timestamp, scope, externalEventId)
      .run();
  }
}
