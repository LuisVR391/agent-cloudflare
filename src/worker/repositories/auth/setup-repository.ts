export class SetupRepository {
  readonly #db: D1Database;

  constructor(db: D1Database) {
    this.#db = db;
  }

  async isCompleted(): Promise<boolean> {
    const state = await this.#db
      .prepare(
        `SELECT 1 AS installed
         FROM installation_state
         WHERE installation_key = 'initial' AND status = 'completed'
         LIMIT 1`,
      )
      .first<{ installed: number }>();
    return state !== null;
  }

  async claim(attemptId: string): Promise<boolean> {
    const now = new Date();
    const leaseExpiresAt = new Date(now.getTime() + 5 * 60_000).toISOString();
    const nowIso = now.toISOString();
    const result = await this.#db
      .prepare(
        `INSERT INTO installation_state
           (installation_key, status, attempt_id, lease_expires_at, completed_at,
            created_at, updated_at)
         VALUES ('initial', 'in_progress', ?, ?, NULL, ?, ?)
         ON CONFLICT (installation_key) DO UPDATE SET
           status = 'in_progress',
           attempt_id = excluded.attempt_id,
           lease_expires_at = excluded.lease_expires_at,
           updated_at = excluded.updated_at
         WHERE installation_state.status = 'in_progress'
           AND installation_state.lease_expires_at < ?`,
      )
      .bind(attemptId, leaseExpiresAt, nowIso, nowIso, nowIso)
      .run();
    return (result.meta.changes ?? 0) === 1;
  }

  async complete(attemptId: string): Promise<void> {
    const now = new Date().toISOString();
    const result = await this.#db
      .prepare(
        `UPDATE installation_state
         SET status = 'completed', completed_at = ?, updated_at = ?
         WHERE installation_key = 'initial'
           AND status = 'in_progress'
           AND attempt_id = ?`,
      )
      .bind(now, now, attemptId)
      .run();

    if ((result.meta.changes ?? 0) !== 1) {
      throw new Error("La instalación perdió su bloqueo exclusivo.");
    }
  }

  async release(attemptId: string): Promise<void> {
    await this.#db
      .prepare(
        `DELETE FROM installation_state
         WHERE installation_key = 'initial'
           AND status = 'in_progress'
           AND attempt_id = ?`,
      )
      .bind(attemptId)
      .run();
  }
}
