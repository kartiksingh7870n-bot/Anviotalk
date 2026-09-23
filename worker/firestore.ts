/**
 * Firestore REST client for Cloudflare Workers (no Admin SDK / gRPC).
 * Auth: service-account RS256 JWT -> Google OAuth token exchange.
 * Fallback: FIRESTORE_API_KEY (Identity Platform style key with datastore scope).
 *
 * SECURITY: every path is guarded against traversal — only [A-Za-z0-9_-] and
 * the collection/document structure is allowed, so an injected path can never
 * escape into admin_* or other collections.
 */

// ---------------------------------------------------------------------------
// Env types
// ---------------------------------------------------------------------------
export interface Env {
  SERVICE_ACCOUNT_JSON?: string;      // full service-account JSON (recommended)
  FIRESTORE_API_KEY?: string;         // fallback: web API key with Firestore enabled
  FIREBASE_PROJECT_ID?: string;       // fallback project id (defaults to anvio-talk)
  ADMIN_JWT_SECRET?: string;          // admin session JWT secret (else persisted)
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// REST value codecs
// ---------------------------------------------------------------------------
export type FsValue = {
  nullValue?: null;
  booleanValue?: boolean;
  integerValue?: string;
  doubleValue?: number;
  timestampValue?: string;
  stringValue?: string;
  bytesValue?: string;
  arrayValue?: { values?: FsValue[] };
  mapValue?: { fields?: Record<string, FsValue> };
};

export type FsFields = Record<string, FsValue>;

export function toFsValue(v: unknown): FsValue {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") {
    return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  }
  if (typeof v === "string") return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toFsValue) } };
  if (typeof v === "object") {
    const fields: FsFields = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) fields[k] = toFsValue(val);
    return { mapValue: { fields } };
  }
  return { nullValue: null };
}

export function fromFsValue(v: FsValue): unknown {
  if (v === null || v === undefined) return null;
  if ("nullValue" in v) return null;
  if ("booleanValue" in v) return v.booleanValue ?? false;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue ?? 0;
  if ("timestampValue" in v) return v.timestampValue;
  if ("stringValue" in v) return v.stringValue ?? "";
  if ("arrayValue" in v) return (v.arrayValue?.values || []).map(fromFsValue);
  if ("mapValue" in v) return fromFsFields(v.mapValue?.fields || {});
  return null;
}

export function fromFsFields(fields: FsFields): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields || {})) out[k] = fromFsValue(v);
  return out;
}

export function toFsFields(obj: Record<string, unknown>): FsFields {
  const out: FsFields = {};
  for (const [k, v] of Object.entries(obj)) out[k] = toFsValue(v);
  return out;
}

// ---------------------------------------------------------------------------
// Path + auth
// ---------------------------------------------------------------------------
const SAFE = /^[A-Za-z0-9_\-/]+$/;

function assertPath(rel: string): void {
  if (!rel || !SAFE.test(rel) || rel.includes("..")) {
    throw new Error(`Blocked unsafe Firestore path: "${rel.slice(0, 60)}"`);
  }
  const segs = rel.split("/").filter(Boolean);
  if (segs.length === 0 || segs.length % 2 !== 0) {
    throw new Error(`Firestore path must be collection/doc pairs: "${rel}"`);
  }
}

function projectId(env: Env): string {
  try {
    const sa = parseServiceAccount(env);
    if (sa) return sa.project_id || "anvio-talk";
  } catch { /* fallthrough */ }
  return env.FIREBASE_PROJECT_ID || "anvio-talk";
}

/**
 * Parses SERVICE_ACCOUNT_JSON: accepts raw JSON or base64 (recommended for
 * secrets/.env — base64 avoids all quote-escaping issues).
 */
export function parseServiceAccount(env: Env): { project_id?: string; client_email: string; private_key: string; token_uri?: string } | null {
  const raw = env.SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  const trimmed = raw.trim();
  try {
    if (trimmed.startsWith("{")) {
      return JSON.parse(trimmed);
    }
    // base64 (possibly with URL-safe alphabet / missing padding)
    const b64 = trimmed.replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const bin = atob(padded);
    const json = new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
    return JSON.parse(json);
  } catch (e) {
    throw new Error(`SERVICE_ACCOUNT_JSON parse failed (starts with "${trimmed.slice(0, 4)}", len ${trimmed.length}): ${(e as Error).message}`);
  }
}

// --- Service-account RS256 JWT -> OAuth access token -------------------------
let oauthCache: { token: string; exp: number } | null = null;

function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (const b of arr) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

async function importPkcs8(pem: string): Promise<CryptoKey> {
  const body = pem
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\s+/g, "");
  const raw = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey("pkcs8", raw, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
}

async function getOauthToken(env: Env): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (oauthCache && oauthCache.exp - 60 > now) return oauthCache.token;

  if (env.SERVICE_ACCOUNT_JSON) {
    const sa = parseServiceAccount(env);
    if (!sa) throw new Error("SERVICE_ACCOUNT_JSON is set but not valid JSON/base64");
    const header = b64url(utf8(JSON.stringify({ alg: "RS256", typ: "JWT" })));
    const claims = b64url(utf8(JSON.stringify({
      iss: sa.client_email,
      scope: "https://www.googleapis.com/auth/datastore",
      aud: sa.token_uri || "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600
    })));
    const key = await importPkcs8(sa.private_key);
    const sig = b64url(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, utf8(`${header}.${claims}`)));
    const assertion = `${header}.${claims}.${sig}`;
    const res = await fetch(sa.token_uri || "https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion })
    });
    if (!res.ok) throw new Error(`OAuth token exchange failed (${res.status})`);
    const data: any = await res.json();
    if (!data.access_token) throw new Error("OAuth response missing access_token");
    oauthCache = { token: data.access_token, exp: now + (data.expires_in || 3600) };
    return oauthCache.token;
  }

  if (env.FIRESTORE_API_KEY) return env.FIRESTORE_API_KEY; // key passed as query param
  throw new Error("No Firestore credentials configured (set SERVICE_ACCOUNT_JSON secret).");
}

function baseUrl(env: Env): string {
  return `https://firestore.googleapis.com/v1/projects/${projectId(env)}/databases/(default)/documents`;
}

async function fsFetch(env: Env, url: string, init: RequestInit): Promise<Response> {
  const token = await getOauthToken(env);
  const headers: Record<string, string> = { "Content-Type": "application/json", ...(init.headers as any) };
  const u = new URL(url);
  if (env.SERVICE_ACCOUNT_JSON) headers["Authorization"] = `Bearer ${token}`;
  else u.searchParams.set("key", token);
  return fetch(u.toString(), { ...init, headers });
}

async function readBody(res: Response): Promise<any> {
  const text = await res.text();
  if (!res.ok) {
    let msg = `Firestore REST error ${res.status}`;
    try { msg = JSON.parse(text)?.error?.message || msg; } catch { /* keep */ }
    throw new Error(msg);
  }
  return text ? JSON.parse(text) : {};
}

// ---------------------------------------------------------------------------
// Doc operations (relPath = "collection/doc" or "col/doc/subcol/doc")
// ---------------------------------------------------------------------------
export async function fsGetDoc(env: Env, relPath: string): Promise<Record<string, unknown> | null> {
  assertPath(relPath);
  const res = await fsFetch(env, `${baseUrl(env)}/${relPath}`, { method: "GET" });
  if (res.status === 404) return null;
  const data = await readBody(res);
  return fromFsFields(data.fields || {});
}

export interface FsDocRef { name: string; }

function fullDocName(env: Env, relPath: string): string {
  return `projects/${projectId(env)}/databases/(default)/documents/${relPath}`;
}

export async function fsSetDoc(
  env: Env, relPath: string, data: Record<string, unknown>,
  opts?: { mustExist?: boolean; mustNotExist?: boolean; updateMask?: string[]; replace?: boolean }
): Promise<void> {
  assertPath(relPath);
  const u = new URL(`${baseUrl(env)}/${relPath}`);
  if (opts?.mustExist) u.searchParams.set("currentDocument.exists", "true");
  if (opts?.mustNotExist) u.searchParams.set("currentDocument.exists", "false");
  // Default: MERGE semantics (like Node set(data, {merge:true})). Firestore REST
  // PATCH without updateMask REPLACES the whole doc, so we list every top-level
  // key in updateMask to merge. Pass {replace:true} for full replacement.
  const maskKeys = opts?.replace
    ? (opts?.updateMask || [])
    : (opts?.updateMask && opts.updateMask.length ? opts.updateMask : Object.keys(data));
  for (const f of maskKeys) u.searchParams.append("updateMask.fieldPaths", f);
  const body = { name: fullDocName(env, relPath), fields: toFsFields(data) };
  const res = await fsFetch(env, u.toString(), { method: "PATCH", body: JSON.stringify(body) });
  await readBody(res);
}

export async function fsAddDoc(
  env: Env, collection: string, data: Record<string, unknown>
): Promise<string> {
  if (!SAFE.test(collection) || collection.includes("..")) throw new Error("Blocked unsafe collection path");
  const res = await fsFetch(env, `${baseUrl(env)}/${collection}`, { method: "POST", body: JSON.stringify({ fields: toFsFields(data) }) });
  const doc = await readBody(res);
  const name: string = doc.name || "";
  return name.split("/").pop() || "";
}

export async function fsDeleteDoc(env: Env, relPath: string): Promise<void> {
  assertPath(relPath);
  const res = await fsFetch(env, `${baseUrl(env)}/${relPath}`, { method: "DELETE" });
  if (res.status === 404) return;
  await readBody(res);
}

export async function fsListDocs(
  env: Env, collection: string, opts?: { pageSize?: number; maxDocs?: number }
): Promise<Array<{ id: string; data: Record<string, unknown> }>> {
  if (!SAFE.test(collection) || collection.includes("..")) throw new Error("Blocked unsafe collection path");
  const out: Array<{ id: string; data: Record<string, unknown> }> = [];
  let pageToken: string | undefined;
  const pageSize = Math.min(300, opts?.pageSize || 100);
  const maxDocs = opts?.maxDocs || 500;
  do {
    const u = new URL(`${baseUrl(env)}/${collection}`);
    u.searchParams.set("pageSize", String(pageSize));
    if (pageToken) u.searchParams.set("pageToken", pageToken);
    const res = await fsFetch(env, u.toString(), { method: "GET" });
    const data = await readBody(res);
    for (const doc of data.documents || []) {
      const id: string = String(doc.name).split("/").pop() || "";
      out.push({ id, data: fromFsFields(doc.fields || {}) });
      if (out.length >= maxDocs) return out;
    }
    pageToken = data.nextPageToken;
  } while (pageToken);
  return out;
}

// ---------------------------------------------------------------------------
// Structured queries
// ---------------------------------------------------------------------------
export interface FsClause { field: string; op: string; value: unknown; }

function buildStructuredQuery(opts: {
  from: string;
  clauses?: FsClause[];
  orderBy?: string;
  orderDesc?: boolean;
  limit?: number;
  offset?: number;
}): unknown {
  const where = opts.clauses && opts.clauses.length
    ? {
        compositeFilter: {
          op: "AND",
          filters: opts.clauses.map((c) => ({
            fieldFilter: { field: { fieldPath: c.field }, op: c.op, value: toFsValue(c.value) }
          }))
        }
      }
    : undefined;
  return {
    structuredQuery: {
      from: [{ collectionId: opts.from, allDescendants: false }],
      ...(where ? { where } : {}),
      ...(opts.orderBy ? { orderBy: [{ field: { fieldPath: opts.orderBy }, direction: opts.orderDesc ? "DESCENDING" : "ASCENDING" }] } : {}),
      ...(opts.limit ? { limit: opts.limit } : {}),
      ...(opts.offset ? { offset: opts.offset } : {})
    }
  };
}

export async function fsRunQuery(
  env: Env, opts: { from: string; clauses?: FsClause[]; orderBy?: string; orderDesc?: boolean; limit?: number; offset?: number }
): Promise<Array<{ id: string; data: Record<string, unknown> }>> {
  if (!SAFE.test(opts.from) || opts.from.includes("..")) throw new Error("Blocked unsafe query collection");
  const res = await fsFetch(env, `${baseUrl(env)}:runQuery`, {
    method: "POST",
    body: JSON.stringify(buildStructuredQuery(opts))
  });
  const lines = await readBody(res);
  const docs = Array.isArray(lines) ? lines : [lines];
  const out: Array<{ id: string; data: Record<string, unknown> }> = [];
  for (const entry of docs) {
    if (!entry?.document) continue;
    const id = String(entry.document.name).split("/").pop() || "";
    out.push({ id, data: fromFsFields(entry.document.fields || {}) });
  }
  return out;
}
