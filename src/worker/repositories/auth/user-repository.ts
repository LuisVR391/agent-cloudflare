export class UserRepository {
  readonly #db: D1Database;

  constructor(db: D1Database) {
    this.#db = db;
  }

  /**
   * `users.email` es único en toda la instalación, así que una invitación
   * dirigida a un correo que ya tiene cuenta no puede completarse: crear la
   * identidad fallaría. Comprobarlo antes permite explicar el motivo en vez de
   * devolver un fallo genérico de alta.
   */
  async existsByEmail(email: string): Promise<boolean> {
    const row = await this.#db
      .prepare("SELECT 1 AS present FROM users WHERE email = ?")
      .bind(email)
      .first<{ present: number }>();
    return row !== null;
  }

  async deleteById(userId: string): Promise<void> {
    if (!userId.trim()) {
      throw new Error("UserRepository.deleteById requiere userId.");
    }
    await this.#db.prepare("DELETE FROM users WHERE id = ?").bind(userId).run();
  }
}
