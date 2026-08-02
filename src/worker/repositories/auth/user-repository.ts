export class UserRepository {
  readonly #db: D1Database;

  constructor(db: D1Database) {
    this.#db = db;
  }

  async deleteById(userId: string): Promise<void> {
    if (!userId.trim()) {
      throw new Error("UserRepository.deleteById requiere userId.");
    }
    await this.#db.prepare("DELETE FROM users WHERE id = ?").bind(userId).run();
  }
}
