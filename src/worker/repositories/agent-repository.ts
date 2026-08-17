import {
  AgentPublicationUnchangedError,
  AgentVersionNotEditableError,
  AgentVersionNotInOrganizationError,
  DuplicateAgentNameError,
  InvalidPersistedValueError,
  requireOrganizationScope,
} from "../domain/errors";
import type {
  Agent,
  AgentDetail,
  AgentPublicationAction,
  AgentPublicationTransition,
  AgentStatus,
  AgentVersion,
  AgentVersionStatus,
  CreateAgentInput,
  CreateAgentVersionInput,
  SetAgentPublicationInput,
  UpdateAgentInput,
  UpdateAgentVersionInput,
} from "../domain/types";

type AgentRow = {
  id: string;
  organization_id: string;
  name: string;
  purpose: string | null;
  status: string;
  published_version_id: string | null;
  published_version_number: number | null;
  version: number;
  created_at: string;
  updated_at: string;
};

type AgentVersionRow = {
  id: string;
  organization_id: string;
  agent_id: string;
  version_number: number;
  status: string;
  instructions: string;
  model: string;
  playbook: string | null;
  change_reason: string | null;
  created_by_membership_id: string;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
};

type AgentPublicationRow = {
  id: string;
  organization_id: string;
  agent_id: string;
  previous_version_id: string | null;
  previous_version_number: number | null;
  next_version_id: string | null;
  next_version_number: number | null;
  action: string;
  reason: string;
  actor_id: string | null;
  actor_name: string | null;
  occurred_at: string;
};

const agentStatuses: readonly AgentStatus[] = ["active", "archived"];
const versionStatuses: readonly AgentVersionStatus[] = [
  "draft",
  "published",
  "archived",
];
const publicationActions: readonly AgentPublicationAction[] = [
  "published",
  "unpublished",
  "rolled_back",
];

/**
 * Un valor fuera del dominio indica corrupción o una migración incompleta, no
 * una entrada del usuario, así que se rompe en vez de degradar en silencio: el
 * estado de una versión decide qué configuración está viva.
 */
function asMember<T extends string>(
  allowed: readonly T[],
  value: string,
  column: string,
): T {
  const match = allowed.find((candidate) => candidate === value);
  if (match === undefined) {
    throw new InvalidPersistedValueError(column, value);
  }
  return match;
}

/**
 * La versión publicada se resuelve por `LEFT JOIN` en vez de guardarse como
 * puntero en `agents`: el índice único parcial ya garantiza que haya a lo sumo
 * una, y una columna adicional sería un segundo dueño del mismo hecho.
 */
const agentSelect = `SELECT a.id, a.organization_id, a.name, a.purpose, a.status,
    p.id AS published_version_id, p.version_number AS published_version_number,
    a.version, a.created_at, a.updated_at
  FROM agents a
  LEFT JOIN agent_versions p
    ON p.organization_id = a.organization_id
   AND p.agent_id = a.id
   AND p.status = 'published'`;

const versionSelect = `SELECT v.id, v.organization_id, v.agent_id, v.version_number,
    v.status, v.instructions, v.model, v.playbook, v.change_reason,
    v.created_by_membership_id, u.name AS created_by_name,
    v.created_at, v.updated_at
  FROM agent_versions v
  LEFT JOIN memberships m
    ON m.organization_id = v.organization_id
   AND m.id = v.created_by_membership_id
  LEFT JOIN users u ON u.id = m.user_id`;

const publicationSelect = `SELECT t.id, t.organization_id, t.agent_id,
    t.previous_version_id, prv.version_number AS previous_version_number,
    t.next_version_id, nxt.version_number AS next_version_number,
    t.action, t.reason, t.actor_id, u.name AS actor_name, t.occurred_at
  FROM agent_publication_transitions t
  LEFT JOIN agent_versions prv
    ON prv.organization_id = t.organization_id AND prv.id = t.previous_version_id
  LEFT JOIN agent_versions nxt
    ON nxt.organization_id = t.organization_id AND nxt.id = t.next_version_id
  LEFT JOIN users u ON u.id = t.actor_id`;

/**
 * Pliega el nombre para que la unicidad no dependa de mayúsculas ni de espacios
 * en los extremos. SQLite solo aplica `NOCASE` a ASCII, así que se calcula aquí
 * y se persiste, como en `services` y `contact_tags`.
 */
function normalizeName(value: string): string {
  return value.trim().toLocaleLowerCase("es");
}

function toAgent(row: AgentRow): Agent {
  return {
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    purpose: row.purpose,
    status: asMember(agentStatuses, row.status, "agents.status"),
    publishedVersionId: row.published_version_id,
    publishedVersionNumber: row.published_version_number,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toVersion(
  row: AgentVersionRow,
  tools: string[],
  knowledgeScopes: string[],
): AgentVersion {
  return {
    id: row.id,
    organizationId: row.organization_id,
    agentId: row.agent_id,
    versionNumber: row.version_number,
    status: asMember(versionStatuses, row.status, "agent_versions.status"),
    instructions: row.instructions,
    model: row.model,
    playbook: row.playbook,
    changeReason: row.change_reason,
    tools,
    knowledgeScopes,
    createdByMembershipId: row.created_by_membership_id,
    createdByName: row.created_by_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toPublication(row: AgentPublicationRow): AgentPublicationTransition {
  return {
    id: row.id,
    organizationId: row.organization_id,
    agentId: row.agent_id,
    previousVersionId: row.previous_version_id,
    previousVersionNumber: row.previous_version_number,
    nextVersionId: row.next_version_id,
    nextVersionNumber: row.next_version_number,
    action: asMember(
      publicationActions,
      row.action,
      "agent_publication_transitions.action",
    ),
    reason: row.reason,
    actorId: row.actor_id,
    actorName: row.actor_name,
    occurredAt: row.occurred_at,
  };
}

/**
 * Agentes de la organización, sus revisiones y el historial de publicación.
 * Todo método recibe `organizationId` como primer parámetro y lo incluye en su
 * cláusula `WHERE`: una consulta sin organización falla antes de tocar D1
 * (ADR-0006).
 *
 * La concurrencia de todo el conjunto vive en `agents.version`, como en
 * `pipelines`: crear o editar un borrador y cambiar la publicación exigen la
 * versión vigente del agente y la incrementan (ADR-0014).
 */
export class AgentRepository {
  readonly #db: D1Database;

  constructor(db: D1Database) {
    this.#db = db;
  }

  /**
   * Sin `status` devuelve solo los activos. El panel pide `all` para poder
   * reactivar uno archivado, igual que el catálogo de servicios.
   */
  async list(
    organizationId: string,
    options: { status?: AgentStatus | "all" } = {},
  ): Promise<Agent[]> {
    const scope = requireOrganizationScope(
      organizationId,
      "AgentRepository.list",
    );
    const status = options.status ?? "active";
    const clauses = ["a.organization_id = ?"];
    const bindings: unknown[] = [scope];
    if (status !== "all") {
      clauses.push("a.status = ?");
      bindings.push(status);
    }

    const { results } = await this.#db
      .prepare(
        `${agentSelect}
          WHERE ${clauses.join(" AND ")}
          ORDER BY a.normalized_name, a.id`,
      )
      .bind(...bindings)
      .all<AgentRow>();

    return results.map(toAgent);
  }

  /** Devuelve `null` fuera de la organización activa, nunca la fila ajena. */
  async find(organizationId: string, agentId: string): Promise<Agent | null> {
    const scope = requireOrganizationScope(
      organizationId,
      "AgentRepository.find",
    );
    const row = await this.#db
      .prepare(`${agentSelect} WHERE a.organization_id = ? AND a.id = ?`)
      .bind(scope, agentId)
      .first<AgentRow>();

    return row === null ? null : toAgent(row);
  }

  /** El agente con sus revisiones y su historial de publicación. */
  async findDetail(
    organizationId: string,
    agentId: string,
  ): Promise<AgentDetail | null> {
    const scope = requireOrganizationScope(
      organizationId,
      "AgentRepository.findDetail",
    );
    const agent = await this.find(scope, agentId);
    if (agent === null) return null;

    const [versions, tools, scopes, publications] = await this.#db.batch([
      this.#db
        .prepare(
          `${versionSelect}
            WHERE v.organization_id = ? AND v.agent_id = ?
            ORDER BY v.version_number DESC`,
        )
        .bind(scope, agentId),
      this.#db
        .prepare(
          `SELECT t.agent_version_id, t.tool_key
             FROM agent_version_tools t
             JOIN agent_versions v
               ON v.organization_id = t.organization_id
              AND v.id = t.agent_version_id
            WHERE t.organization_id = ? AND v.agent_id = ?
            ORDER BY t.tool_key`,
        )
        .bind(scope, agentId),
      this.#db
        .prepare(
          `SELECT k.agent_version_id, k.label
             FROM agent_version_knowledge_scopes k
             JOIN agent_versions v
               ON v.organization_id = k.organization_id
              AND v.id = k.agent_version_id
            WHERE k.organization_id = ? AND v.agent_id = ?
            ORDER BY k.normalized_label`,
        )
        .bind(scope, agentId),
      this.#db
        .prepare(
          `${publicationSelect}
            WHERE t.organization_id = ? AND t.agent_id = ?
            ORDER BY t.occurred_at DESC, t.id DESC`,
        )
        .bind(scope, agentId),
    ]);

    const toolsByVersion = groupByVersion(
      versions.results as AgentVersionRow[],
      tools.results as { agent_version_id: string; tool_key: string }[],
      (row) => row.tool_key,
    );
    const scopesByVersion = groupByVersion(
      versions.results as AgentVersionRow[],
      scopes.results as { agent_version_id: string; label: string }[],
      (row) => row.label,
    );

    return {
      ...agent,
      versions: (versions.results as AgentVersionRow[]).map((row) =>
        toVersion(
          row,
          toolsByVersion.get(row.id) ?? [],
          scopesByVersion.get(row.id) ?? [],
        ),
      ),
      publications: (publications.results as AgentPublicationRow[]).map(
        toPublication,
      ),
    };
  }

  /**
   * El nombre repetido se resuelve con `ON CONFLICT ... DO NOTHING`: sin fila
   * devuelta el nombre ya existe. Comprobarlo antes con un `SELECT` dejaría una
   * ventana entre verificar e insertar.
   */
  async create(
    organizationId: string,
    input: CreateAgentInput,
  ): Promise<Agent> {
    const scope = requireOrganizationScope(
      organizationId,
      "AgentRepository.create",
    );
    const now = new Date().toISOString();
    const name = input.name.trim();
    const agentId = crypto.randomUUID();

    const created = await this.#db
      .prepare(
        `INSERT INTO agents
           (id, organization_id, name, normalized_name, purpose, status,
            created_by_membership_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?)
         ON CONFLICT (organization_id, normalized_name) DO NOTHING
         RETURNING id`,
      )
      .bind(
        agentId,
        scope,
        name,
        normalizeName(name),
        input.purpose?.trim() || null,
        input.createdByMembershipId,
        now,
        now,
      )
      .first<{ id: string }>();

    if (created === null) {
      throw new DuplicateAgentNameError(name);
    }

    const agent = await this.find(scope, agentId);
    if (agent === null) {
      throw new InvalidPersistedValueError("agents.id", agentId);
    }
    return agent;
  }

  /**
   * Nombre, propósito y estado. No crea una versión: no describen
   * comportamiento. La colisión de nombre se comprueba dentro del mismo
   * `UPDATE`, como en el catálogo de servicios.
   */
  async update(
    organizationId: string,
    agentId: string,
    input: UpdateAgentInput,
  ): Promise<Agent | null> {
    const scope = requireOrganizationScope(
      organizationId,
      "AgentRepository.update",
    );
    const current = await this.find(scope, agentId);
    if (current === null || current.version !== input.expectedVersion) {
      return null;
    }

    const name = input.name === undefined ? current.name : input.name.trim();
    const normalized = normalizeName(name);
    const purpose =
      input.purpose === undefined
        ? current.purpose
        : (input.purpose?.trim() ?? null) || null;

    const result = await this.#db
      .prepare(
        `UPDATE agents
            SET name = ?, normalized_name = ?, purpose = ?, status = ?,
                version = version + 1, updated_at = ?
          WHERE organization_id = ? AND id = ? AND version = ?
            AND NOT EXISTS (SELECT 1 FROM agents other
                             WHERE other.organization_id = agents.organization_id
                               AND other.normalized_name = ?
                               AND other.id <> agents.id)`,
      )
      .bind(
        name,
        normalized,
        purpose,
        input.status ?? current.status,
        new Date().toISOString(),
        scope,
        agentId,
        input.expectedVersion,
        normalized,
      )
      .run();

    if (result.meta.changes !== 1) {
      const taken = await this.#db
        .prepare(
          `SELECT 1 AS taken FROM agents
            WHERE organization_id = ? AND normalized_name = ? AND id <> ?`,
        )
        .bind(scope, normalized, agentId)
        .first<{ taken: number }>();
      if (taken !== null) {
        throw new DuplicateAgentNameError(name);
      }
      return null;
    }

    return this.find(scope, agentId);
  }

  /**
   * Crea un borrador, escrito o derivado de otra revisión. Al derivarlo el
   * contenido se copia dentro de la misma sentencia que inserta, de modo que
   * una revisión de otro agente u otra organización no pueda sembrarlo.
   *
   * El ordinal se calcula en la misma sentencia: resolverlo antes en
   * TypeScript abriría una carrera que el índice único convertiría en un fallo
   * del servidor.
   */
  async createVersion(
    organizationId: string,
    agentId: string,
    input: CreateAgentVersionInput,
  ): Promise<AgentDetail | null> {
    const scope = requireOrganizationScope(
      organizationId,
      "AgentRepository.createVersion",
    );
    // La revisión de origen se comprueba antes para responder con precisión:
    // sin esto, una fuente ajena al agente dejaría el lote sin insertar nada y
    // la llamada parecería haber funcionado.
    if (
      input.fromVersionId !== null &&
      (await this.findVersion(scope, agentId, input.fromVersionId)) === null
    ) {
      throw new AgentVersionNotInOrganizationError(input.fromVersionId);
    }

    const now = new Date().toISOString();
    const versionId = crypto.randomUUID();
    const changeReason = input.changeReason?.trim() || null;
    const applied = this.#appliedBindings(scope, agentId, input.expectedVersion, now);

    const statements = [
      this.#versionBump(scope, agentId, input.expectedVersion, now),
    ];

    if (input.fromVersionId !== null) {
      // La fuente se filtra por organización y por agente en la propia
      // sentencia: comprobarlo antes dejaría una ventana entre verificar y
      // copiar.
      statements.push(
        this.#db
          .prepare(
            `INSERT INTO agent_versions
               (id, organization_id, agent_id, version_number, status,
                instructions, model, playbook, change_reason,
                created_by_membership_id, created_at, updated_at)
             SELECT ?, ?, ?,
                    (SELECT COALESCE(MAX(n.version_number), 0) + 1
                       FROM agent_versions n
                      WHERE n.organization_id = ? AND n.agent_id = ?),
                    'draft', source.instructions, source.model, source.playbook,
                    ?, ?, ?, ?
               FROM agent_versions source
              WHERE source.organization_id = ? AND source.agent_id = ?
                AND source.id = ? AND ${this.#appliedExists()}`,
          )
          .bind(
            versionId,
            scope,
            agentId,
            scope,
            agentId,
            changeReason,
            input.createdByMembershipId,
            now,
            now,
            scope,
            agentId,
            input.fromVersionId,
            ...applied,
          ),
        this.#db
          .prepare(
            `INSERT INTO agent_version_tools
               (organization_id, agent_version_id, tool_key, declared_at)
             SELECT organization_id, ?, tool_key, ?
               FROM agent_version_tools
              WHERE organization_id = ? AND agent_version_id = ?
                AND ${this.#appliedExists()}`,
          )
          .bind(versionId, now, scope, input.fromVersionId, ...applied),
        this.#db
          .prepare(
            `INSERT INTO agent_version_knowledge_scopes
               (organization_id, agent_version_id, label, normalized_label,
                declared_at)
             SELECT organization_id, ?, label, normalized_label, ?
               FROM agent_version_knowledge_scopes
              WHERE organization_id = ? AND agent_version_id = ?
                AND ${this.#appliedExists()}`,
          )
          .bind(versionId, now, scope, input.fromVersionId, ...applied),
      );
    } else {
      // El schema del router resuelve la exclusión antes de llamar: o se deriva
      // de una revisión, o se escribe entera. Llegar aquí sin ninguna de las dos
      // es un error de programación, no una entrada del usuario.
      const content = input.content;
      if (content === null) {
        throw new TypeError(
          "createVersion exige contenido o una revisión de origen.",
        );
      }
      statements.push(
        this.#db
          .prepare(
            `INSERT INTO agent_versions
               (id, organization_id, agent_id, version_number, status,
                instructions, model, playbook, change_reason,
                created_by_membership_id, created_at, updated_at)
             SELECT ?, ?, ?,
                    (SELECT COALESCE(MAX(n.version_number), 0) + 1
                       FROM agent_versions n
                      WHERE n.organization_id = ? AND n.agent_id = ?),
                    'draft', ?, ?, ?, ?, ?, ?, ?
              WHERE ${this.#appliedExists()}`,
          )
          .bind(
            versionId,
            scope,
            agentId,
            scope,
            agentId,
            content.instructions.trim(),
            content.model.trim(),
            content.playbook?.trim() || null,
            changeReason,
            input.createdByMembershipId,
            now,
            now,
            ...applied,
          ),
        ...this.#declarationStatements(scope, versionId, content, now, applied),
      );
    }

    const [version] = await this.#db.batch(statements);
    if (version.meta.changes !== 1) return null;

    return this.findDetail(scope, agentId);
  }

  /**
   * Edita un borrador. Una revisión ajena al agente y una que ya se publicó se
   * rechazan aquí, antes de tocar sus declaraciones: dejarlo al router
   * permitiría que una llamada mal formada borrara las de una versión
   * congelada. La carrera con una publicación simultánea la cierra la versión
   * vigente del agente, que publicar también incrementa.
   */
  async updateVersion(
    organizationId: string,
    agentId: string,
    versionId: string,
    input: UpdateAgentVersionInput,
  ): Promise<AgentDetail | null> {
    const scope = requireOrganizationScope(
      organizationId,
      "AgentRepository.updateVersion",
    );
    const target = await this.findVersion(scope, agentId, versionId);
    if (target === null) {
      throw new AgentVersionNotInOrganizationError(versionId);
    }
    if (target.status !== "draft") {
      throw new AgentVersionNotEditableError(versionId);
    }

    const now = new Date().toISOString();
    const applied = this.#appliedBindings(scope, agentId, input.expectedVersion, now);

    const [version] = await this.#db.batch([
      this.#versionBump(scope, agentId, input.expectedVersion, now),
      this.#db
        .prepare(
          `UPDATE agent_versions
              SET instructions = ?, model = ?, playbook = ?, change_reason = ?,
                  updated_at = ?
            WHERE organization_id = ? AND agent_id = ? AND id = ?
              AND status = 'draft' AND ${this.#appliedExists()}`,
        )
        .bind(
          input.instructions.trim(),
          input.model.trim(),
          input.playbook?.trim() || null,
          input.changeReason?.trim() || null,
          now,
          scope,
          agentId,
          versionId,
          ...applied,
        ),
      // Las declaraciones se reemplazan enteras: son un conjunto, no una lista
      // de cambios. El borrado repite la guarda de borrador para que un
      // publicado no pueda quedarse sin las suyas.
      this.#db
        .prepare(
          `DELETE FROM agent_version_tools
            WHERE organization_id = ? AND agent_version_id = ?
              AND EXISTS (SELECT 1 FROM agent_versions v
                           WHERE v.organization_id = ? AND v.id = ?
                             AND v.status = 'draft')
              AND ${this.#appliedExists()}`,
        )
        .bind(scope, versionId, scope, versionId, ...applied),
      this.#db
        .prepare(
          `DELETE FROM agent_version_knowledge_scopes
            WHERE organization_id = ? AND agent_version_id = ?
              AND EXISTS (SELECT 1 FROM agent_versions v
                           WHERE v.organization_id = ? AND v.id = ?
                             AND v.status = 'draft')
              AND ${this.#appliedExists()}`,
        )
        .bind(scope, versionId, scope, versionId, ...applied),
      ...this.#declarationStatements(scope, versionId, input, now, applied),
    ]);
    if (version.meta.changes !== 1) return null;

    return this.findDetail(scope, agentId);
  }

  /**
   * Publica, revierte o desactiva. Es la única operación que cambia qué versión
   * está viva, y la etiqueta de la transición la deriva el servidor comparando
   * ordinales: quien llama no puede registrar un descenso como publicación.
   *
   * El lote archiva la versión vigente antes de publicar la destino, porque
   * SQLite valida la unicidad sentencia a sentencia y el índice parcial vería
   * dos publicadas a la vez si se invirtiera el orden.
   */
  async setPublication(
    organizationId: string,
    agentId: string,
    input: SetAgentPublicationInput,
  ): Promise<AgentDetail | null> {
    const scope = requireOrganizationScope(
      organizationId,
      "AgentRepository.setPublication",
    );
    const current = await this.find(scope, agentId);
    if (current === null) return null;
    if (current.version !== input.expectedVersion) return null;

    let nextNumber: number | null = null;
    if (input.versionId !== null) {
      const target = await this.#db
        .prepare(
          `SELECT version_number FROM agent_versions
            WHERE organization_id = ? AND agent_id = ? AND id = ?`,
        )
        .bind(scope, agentId, input.versionId)
        .first<{ version_number: number }>();
      if (target === null) {
        throw new AgentVersionNotInOrganizationError(input.versionId);
      }
      nextNumber = target.version_number;
    }

    if (current.publishedVersionId === input.versionId) {
      throw new AgentPublicationUnchangedError(agentId);
    }

    const action = derivePublicationAction(
      current.publishedVersionNumber,
      nextNumber,
    );
    const now = new Date().toISOString();
    const applied = this.#appliedBindings(scope, agentId, input.expectedVersion, now);

    const statements = [
      this.#versionBump(scope, agentId, input.expectedVersion, now),
      // Archivar va primero: el índice único parcial rechazaría el lote entero
      // si viera dos versiones publicadas a la vez.
      this.#db
        .prepare(
          `UPDATE agent_versions
              SET status = 'archived', updated_at = ?
            WHERE organization_id = ? AND agent_id = ? AND status = 'published'
              AND ${this.#appliedExists()}`,
        )
        .bind(now, scope, agentId, ...applied),
    ];

    if (input.versionId !== null) {
      statements.push(
        this.#db
          .prepare(
            `UPDATE agent_versions
                SET status = 'published', updated_at = ?
              WHERE organization_id = ? AND agent_id = ? AND id = ?
                AND ${this.#appliedExists()}`,
          )
          .bind(now, scope, agentId, input.versionId, ...applied),
      );
    }

    statements.push(
      this.#db
        .prepare(
          `INSERT INTO agent_publication_transitions
             (id, organization_id, agent_id, previous_version_id,
              next_version_id, action, reason, actor_type, actor_id,
              correlation_id, occurred_at)
           SELECT ?, ?, ?, ?, ?, ?, ?, 'staff', ?, ?, ?
            WHERE ${this.#appliedExists()}`,
        )
        .bind(
          crypto.randomUUID(),
          scope,
          agentId,
          current.publishedVersionId,
          input.versionId,
          action,
          input.reason.trim(),
          input.actorId,
          input.correlationId,
          now,
          ...applied,
        ),
    );

    const [version] = await this.#db.batch(statements);
    if (version.meta.changes !== 1) return null;

    return this.findDetail(scope, agentId);
  }

  /**
   * Deja constancia de quién configuró o publicó. Guarda identificadores, nunca
   * instrucciones ni motivos: la auditoría no es un segundo lugar donde acabe
   * el contenido del negocio, que ya vive en el historial de publicación.
   */
  async recordAudit(input: {
    organizationId: string;
    actorId: string;
    resource: { type: "agent" | "agent_version"; id: string | null };
    action:
      | "agent.create"
      | "agent.update"
      | "agent_version.create"
      | "agent_version.update"
      | "agent.publication_change";
    // `audit_logs` solo admite estos tres valores. Cualquier otro rompe el
    // `CHECK` y convierte un rechazo previsto en un fallo del servidor.
    result: "allowed" | "rejected" | "failed";
    correlationId: string;
  }): Promise<void> {
    const scope = requireOrganizationScope(
      input.organizationId,
      "AgentRepository.recordAudit",
    );
    await this.#db
      .prepare(
        `INSERT INTO audit_logs
           (id, organization_id, actor_type, actor_id, action, resource_type,
            resource_id, result, correlation_id, occurred_at)
         VALUES (?, ?, 'staff', ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        crypto.randomUUID(),
        scope,
        input.actorId,
        input.action,
        input.resource.type,
        input.resource.id,
        input.result,
        input.correlationId,
        new Date().toISOString(),
      )
      .run();
  }

  /** Devuelve la revisión dentro del agente, o `null` si no le pertenece. */
  async findVersion(
    organizationId: string,
    agentId: string,
    versionId: string,
  ): Promise<{ status: AgentVersionStatus } | null> {
    const scope = requireOrganizationScope(
      organizationId,
      "AgentRepository.findVersion",
    );
    const row = await this.#db
      .prepare(
        `SELECT status FROM agent_versions
          WHERE organization_id = ? AND agent_id = ? AND id = ?`,
      )
      .bind(scope, agentId, versionId)
      .first<{ status: string }>();

    return row === null
      ? null
      : { status: asMember(versionStatuses, row.status, "agent_versions.status") };
  }

  #versionBump(
    organizationId: string,
    agentId: string,
    expectedVersion: number,
    now: string,
  ) {
    return this.#db
      .prepare(
        `UPDATE agents
            SET version = version + 1, updated_at = ?
          WHERE organization_id = ? AND id = ? AND version = ?`,
      )
      .bind(now, organizationId, agentId, expectedVersion);
  }

  /**
   * Sonda que la fila quedó como la dejó este lote, igual que en `pipelines`.
   * La versión sola no basta: otra petición podría haber alcanzado el mismo
   * número, así que se compara también el instante que escribió este lote.
   */
  #appliedExists(): string {
    return `EXISTS (SELECT 1 FROM agents
              WHERE organization_id = ? AND id = ? AND version = ? AND updated_at = ?)`;
  }

  #appliedBindings(
    organizationId: string,
    agentId: string,
    expectedVersion: number,
    now: string,
  ): unknown[] {
    return [organizationId, agentId, expectedVersion + 1, now];
  }

  /**
   * Las declaraciones son un conjunto sin catálogo: se normalizan y se
   * deduplican aquí, porque el corte que las autorice necesitará compararlas y
   * dos etiquetas que solo difieren en mayúsculas son la misma.
   */
  #declarationStatements(
    organizationId: string,
    versionId: string,
    content: { tools?: string[]; knowledgeScopes?: string[] },
    now: string,
    applied: unknown[],
  ): D1PreparedStatement[] {
    const tools = uniqueByNormalized(content.tools ?? []);
    const scopes = uniqueByNormalized(content.knowledgeScopes ?? []);

    return [
      ...tools.map(({ normalized }) =>
        this.#db
          .prepare(
            `INSERT INTO agent_version_tools
               (organization_id, agent_version_id, tool_key, declared_at)
             SELECT ?, ?, ?, ? WHERE ${this.#appliedExists()}`,
          )
          .bind(organizationId, versionId, normalized, now, ...applied),
      ),
      ...scopes.map(({ label, normalized }) =>
        this.#db
          .prepare(
            `INSERT INTO agent_version_knowledge_scopes
               (organization_id, agent_version_id, label, normalized_label,
                declared_at)
             SELECT ?, ?, ?, ?, ? WHERE ${this.#appliedExists()}`,
          )
          .bind(organizationId, versionId, label, normalized, now, ...applied),
      ),
    ];
  }
}

/**
 * `published` cuando no había nada o se avanza; `unpublished` al quedarse sin
 * versión viva; `rolled_back` cuando la destino es anterior a la vigente.
 */
function derivePublicationAction(
  previousNumber: number | null,
  nextNumber: number | null,
): AgentPublicationAction {
  if (nextNumber === null) return "unpublished";
  if (previousNumber === null) return "published";
  return nextNumber < previousNumber ? "rolled_back" : "published";
}

function uniqueByNormalized(
  values: string[],
): { label: string; normalized: string }[] {
  const seen = new Map<string, { label: string; normalized: string }>();
  for (const value of values) {
    const label = value.trim();
    if (label === "") continue;
    const normalized = normalizeName(label);
    if (!seen.has(normalized)) seen.set(normalized, { label, normalized });
  }
  return [...seen.values()];
}

function groupByVersion<T extends { agent_version_id: string }>(
  versions: AgentVersionRow[],
  rows: T[],
  pick: (row: T) => string,
): Map<string, string[]> {
  const grouped = new Map<string, string[]>(
    versions.map((version) => [version.id, [] as string[]]),
  );
  for (const row of rows) {
    grouped.get(row.agent_version_id)?.push(pick(row));
  }
  return grouped;
}
