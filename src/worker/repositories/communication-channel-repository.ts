import { requireOrganizationScope } from "../domain/errors";
import type {
  CommunicationChannel,
  CreateCommunicationChannelInput,
} from "../domain/types";
import {
  type CommunicationChannelRow,
  toCommunicationChannel,
} from "./row-mapping";

export class CommunicationChannelRepository {
  readonly #db: D1Database;

  constructor(db: D1Database) {
    this.#db = db;
  }

  async create(
    organizationId: string,
    input: CreateCommunicationChannelInput,
  ): Promise<CommunicationChannel> {
    const scope = requireOrganizationScope(
      organizationId,
      "CommunicationChannelRepository.create",
    );
    const now = new Date().toISOString();
    const row = await this.#db
      .prepare(
        `INSERT INTO communication_channels (
           id, organization_id, provider, adapter, external_account_id,
           external_profile_id, display_name, status, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
         RETURNING *`,
      )
      .bind(
        crypto.randomUUID(),
        scope,
        input.provider,
        input.adapter,
        input.externalAccountId,
        input.externalProfileId ?? null,
        input.displayName ?? null,
        now,
        now,
      )
      .first<CommunicationChannelRow>();

    if (row === null) {
      throw new Error("No se pudo crear el canal de comunicación.");
    }

    return toCommunicationChannel(row);
  }

  /**
   * La combinación adaptador/cuenta es única globalmente. La organización se
   * deriva de esta fila canónica y nunca de un valor recibido en el webhook.
   */
  async findActiveZernioAccount(
    externalAccountId: string,
  ): Promise<CommunicationChannel | null> {
    const row = await this.#db
      .prepare(
        `SELECT * FROM communication_channels
         WHERE adapter = 'zernio' AND external_account_id = ? AND status = 'active'`,
      )
      .bind(externalAccountId)
      .first<CommunicationChannelRow>();

    return row === null ? null : toCommunicationChannel(row);
  }

  async markDisconnected(
    organizationId: string,
    channelId: string,
    disconnectedAt: string,
  ): Promise<void> {
    const scope = requireOrganizationScope(
      organizationId,
      "CommunicationChannelRepository.markDisconnected",
    );

    await this.#db
      .prepare(
        `UPDATE communication_channels
         SET status = 'disconnected', disconnected_at = ?, updated_at = ?
         WHERE organization_id = ? AND id = ?`,
      )
      .bind(disconnectedAt, disconnectedAt, scope, channelId)
      .run();
  }
}
