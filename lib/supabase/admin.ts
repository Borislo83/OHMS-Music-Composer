import { randomUUID } from "crypto";

const SUPABASE_URL =
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const SUPABASE_AUDIO_BUCKET = process.env.SUPABASE_AUDIO_BUCKET ?? "audio";

function mustGetEnv(value: string, name: string) {
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function encodeStoragePath(path: string) {
  return path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function joinUrl(baseUrl: string, path: string) {
  return new URL(path, baseUrl).toString();
}

function buildHeaders(extra?: HeadersInit) {
  const serviceRoleKey = mustGetEnv(SUPABASE_SERVICE_ROLE_KEY, "SUPABASE_SERVICE_ROLE_KEY");
  return {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    ...extra
  };
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  const body = text.length > 0 ? (JSON.parse(text) as T) : (null as T);
  if (!response.ok) {
    const message =
      typeof body === "object" && body && "message" in body
        ? String((body as { message?: unknown }).message ?? response.statusText)
        : response.statusText;
    throw new Error(message || `Request failed with status ${response.status}`);
  }
  return body;
}

function getSupabaseUrl() {
  return mustGetEnv(SUPABASE_URL, "SUPABASE_URL");
}

function toSearchParams(options: Record<string, string | number | boolean | undefined>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(options)) {
    if (value === undefined) continue;
    params.set(key, String(value));
  }
  return params;
}

export type SupabaseTableRow = Record<string, unknown>;

export type TableQuery = {
  select?: string;
  filters?: Array<{
    column: string;
    operator?: "eq" | "gte" | "gt" | "lte" | "lt" | "ilike" | "in";
    value: string | number | boolean | Array<string | number | boolean>;
  }>;
  orderBy?: { column: string; ascending?: boolean };
  limit?: number;
};

export class SupabaseAdminClient {
  private readonly baseUrl: string;

  constructor(baseUrl = getSupabaseUrl()) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  async queryRows<T extends SupabaseTableRow>(table: string, query: TableQuery = {}) {
    const params = toSearchParams({
      select: query.select ?? "*",
      limit: query.limit
    });

    for (const filter of query.filters ?? []) {
      const operator = filter.operator ?? "eq";
      if (operator === "in" && Array.isArray(filter.value)) {
        params.set(filter.column, `in.(${filter.value.map((value) => String(value)).join(",")})`);
      } else {
        params.set(filter.column, `${operator}.${String(filter.value)}`);
      }
    }

    if (query.orderBy) {
      params.set(
        "order",
        `${query.orderBy.column}.${query.orderBy.ascending === false ? "desc" : "asc"}`
      );
    }

    const response = await fetch(`${this.baseUrl}/rest/v1/${table}?${params.toString()}`, {
      method: "GET",
      headers: buildHeaders({ Accept: "application/json" })
    });
    return parseJsonResponse<T[]>(response);
  }

  async insertRow<T extends SupabaseTableRow>(table: string, row: SupabaseTableRow) {
    const response = await fetch(`${this.baseUrl}/rest/v1/${table}?select=*`, {
      method: "POST",
      headers: buildHeaders({
        "Content-Type": "application/json",
        Prefer: "return=representation"
      }),
      body: JSON.stringify(row)
    });
    return parseJsonResponse<T[]>(response);
  }

  async updateRows<T extends SupabaseTableRow>(
    table: string,
    row: SupabaseTableRow,
    filters: Array<{ column: string; value: string | number | boolean }>
  ) {
    const params = new URLSearchParams({ select: "*" });
    for (const filter of filters) {
      params.set(filter.column, `eq.${String(filter.value)}`);
    }

    const response = await fetch(`${this.baseUrl}/rest/v1/${table}?${params.toString()}`, {
      method: "PATCH",
      headers: buildHeaders({
        "Content-Type": "application/json",
        Prefer: "return=representation"
      }),
      body: JSON.stringify(row)
    });
    return parseJsonResponse<T[]>(response);
  }

  async getSignedAudioUrl(path: string, expiresIn = 3600) {
    const response = await fetch(
      `${this.baseUrl}/storage/v1/object/sign/${encodeURIComponent(SUPABASE_AUDIO_BUCKET)}/${encodeStoragePath(path)}`,
      {
        method: "POST",
        headers: buildHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ expiresIn })
      }
    );

    const body = await parseJsonResponse<{ signedURL?: string }>(response);
    if (!body.signedURL) {
      throw new Error("Supabase did not return a signed URL");
    }

    return body.signedURL.startsWith("http")
      ? body.signedURL
      : joinUrl(this.baseUrl, body.signedURL);
  }

  async uploadAudioObject(path: string, audioData: Uint8Array, contentType = "audio/wav") {
    const response = await fetch(
      `${this.baseUrl}/storage/v1/object/${encodeURIComponent(SUPABASE_AUDIO_BUCKET)}/${encodeStoragePath(path)}`,
      {
        method: "PUT",
        headers: buildHeaders({
          "Content-Type": contentType,
          "x-upsert": "true"
        }),
        body: audioData
      }
    );

    const body = await parseJsonResponse<{ Key?: string; path?: string }>(response);
    return {
      path: body.path ?? body.Key ?? path
    };
  }

  async downloadAudioObject(path: string) {
    const response = await fetch(
      `${this.baseUrl}/storage/v1/object/${encodeURIComponent(SUPABASE_AUDIO_BUCKET)}/${encodeStoragePath(path)}`,
      {
        method: "GET",
        headers: buildHeaders()
      }
    );
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(text || response.statusText || `Download failed (${response.status})`);
    }
    return response;
  }

  async listAudioObjects(prefix: string, limit = 200) {
    const response = await fetch(
      `${this.baseUrl}/storage/v1/object/list/${encodeURIComponent(SUPABASE_AUDIO_BUCKET)}`,
      {
        method: "POST",
        headers: buildHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          prefix,
          limit,
          offset: 0,
          sortBy: { column: "created_at", order: "desc" }
        })
      }
    );
    return parseJsonResponse<
      Array<{
        name?: string;
        id?: string;
        created_at?: string;
        updated_at?: string;
        last_accessed_at?: string;
        metadata?: Record<string, unknown>;
      }>
    >(response);
  }

  async getOne<T extends SupabaseTableRow>(table: string, query: TableQuery = {}) {
    const rows = await this.queryRows<T>(table, { ...query, limit: 1 });
    return rows[0] ?? null;
  }

  async rpc<T>(fn: string, args: Record<string, unknown>) {
    const response = await fetch(`${this.baseUrl}/rest/v1/rpc/${encodeURIComponent(fn)}`, {
      method: "POST",
      headers: buildHeaders({
        "Content-Type": "application/json",
        Accept: "application/json"
      }),
      body: JSON.stringify(args)
    });
    return parseJsonResponse<T>(response);
  }

  async getSession(sessionId: string) {
    return this.getOne<{ id: string; title?: string; active_iteration_id?: string | null }>(
      "sessions",
      {
        filters: [{ column: "id", value: sessionId }]
      }
    );
  }

  async getLatestIteration(sessionId: string) {
    return this.getOne<{
      id: string;
      session_id: string;
      idx?: number;
      created_at?: string;
    }>("iterations", {
      filters: [{ column: "session_id", value: sessionId }],
      orderBy: { column: "created_at", ascending: false }
    });
  }

  async createDraftIteration(sessionId: string) {
    const rows = await this.insertRow<{
      id: string;
      session_id: string;
      idx?: number;
    }>("iterations", {
      id: randomUUID(),
      session_id: sessionId,
      idx: 0,
      created_at: new Date().toISOString()
    });
    return rows[0] ?? null;
  }

  async ensureDraftIteration(sessionId: string) {
    const latestIteration = await this.getLatestIteration(sessionId);
    if (latestIteration) return latestIteration;
    return this.createDraftIteration(sessionId);
  }

  async getRecentFeedbackEvents(sessionId: string, iterationId: string, limit = 20) {
    return this.queryRows<{
      id: string;
      kind: string;
      payload: Record<string, unknown>;
      created_at?: string;
    }>("feedback_events", {
      filters: [
        { column: "session_id", value: sessionId },
        { column: "iteration_id", value: iterationId }
      ],
      orderBy: { column: "created_at", ascending: false },
      limit
    });
  }

  async getGenerationJob(jobId: string) {
    return this.getOne<{
      id: string;
      session_id: string;
      base_iteration_id?: string | null;
      iteration_id?: string | null;
      provider?: string;
      status: string;
      request?: Record<string, unknown> | null;
      result?: Record<string, unknown> | null;
      error?: string | null;
      created_at?: string;
      updated_at?: string;
      started_at?: string | null;
      finished_at?: string | null;
    }>("generation_jobs", {
      filters: [{ column: "id", value: jobId }]
    });
  }

  async getGenerationJobByKey(idempotencyKey: string) {
    return this.getOne<{
      id: string;
      session_id: string;
      iteration_id?: string | null;
      status: string;
    }>("generation_jobs", {
      filters: [{ column: "idempotency_key", value: idempotencyKey }]
    });
  }

  async createGenerationJob(row: SupabaseTableRow) {
    const rows = await this.insertRow<{
      id: string;
      session_id: string;
      iteration_id?: string | null;
      status: string;
      idempotency_key: string;
    }>("generation_jobs", row);
    return rows[0] ?? null;
  }

  async patchGenerationJob(jobId: string, row: SupabaseTableRow) {
    const rows = await this.updateRows<{
      id: string;
      session_id: string;
      iteration_id?: string | null;
      status: string;
    }>("generation_jobs", row, [{ column: "id", value: jobId }]);
    return rows[0] ?? null;
  }

  async updateSessionActiveIteration(sessionId: string, iterationId: string) {
    const rows = await this.updateRows<{ id: string; active_iteration_id?: string | null }>(
      "sessions",
      { active_iteration_id: iterationId },
      [{ column: "id", value: sessionId }]
    );
    return rows[0] ?? null;
  }
}

export function getSupabaseAdmin() {
  return new SupabaseAdminClient();
}
