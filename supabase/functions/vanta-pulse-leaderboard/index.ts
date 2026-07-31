import {
  dailySeedForDate,
  SIMULATION_VERSION,
  verifyReplay,
  type LevelMode,
  type Replay,
} from "./simulation.ts";

const JSON_CONTENT_TYPE = "application/json; charset=utf-8";
const CONTROL_BODY_LIMIT = 2_048;
const SUBMIT_BODY_LIMIT = 96 * 1_024;
const MAX_REPLAY_EVENTS = 1_024;
const MAX_LEADERBOARD_LIMIT = 100;
const DEFAULT_LEADERBOARD_LIMIT = 25;
const TICKET_TTL_SECONDS = 180;
const DEVICE_CREDENTIAL_TTL_SECONDS = 90 * 24 * 60 * 60;
const RUN_RENEWAL_TTL_SECONDS = 2 * 60 * 60;
const MAX_CLOCK_SKEW_SECONDS = 60;
const CREDENTIAL_PREFIX = "vp1";
const DEVICE_CREDENTIAL_KIND = "device";
const RUN_RENEWAL_KIND = "run";
const PUBLIC_ID_PATTERN = /^vp_[0-9a-f]{24}$/;
const DEFAULT_ALLOWED_ORIGINS =
  "https://vanta-pulse.vercel.app,http://127.0.0.1:4173,http://localhost:4173," +
  "http://127.0.0.1:4174,http://localhost:4174";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BOARD_PATTERN = /^[a-z0-9][a-z0-9:_-]{0,63}$/;
const LEVEL_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const CHECKSUM_PATTERN = /^[0-9a-f]{8,128}$/;
const CAMPAIGN_SEEDS = {
  "glass-horizon": 0x474c4153,
  "phase-bloom": 0x50484153,
  "null-circuit": 0x4e554c4c,
} as const;

type JsonRecord = Record<string, unknown>;

interface ServiceConfig {
  url: string;
  key: string;
  legacyJwt: boolean;
}

interface RunScope {
  boardId: string;
  mode: LevelMode;
  levelId: string;
  seed: number;
  simulationVersion: number;
}

interface DeviceClaims {
  kind: typeof DEVICE_CREDENTIAL_KIND;
  version: 1;
  clientId: string;
  issuedAt: number;
  expiresAt: number;
}

interface RunRenewalClaims extends RunScope {
  kind: typeof RUN_RENEWAL_KIND;
  version: 1;
  clientId: string;
  runSessionId: string;
  issuedAt: number;
  expiresAt: number;
}

interface AuthenticatedDevice {
  clientId: string;
  publicId: string;
}

class ApiError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    readonly retryAfter?: number,
  ) {
    super(code);
  }
}

class UpstreamError extends Error {
  constructor(
    readonly status: number,
    readonly upstreamCode: string,
  ) {
    super("upstream_error");
  }
}

function env(name: string): string | undefined {
  const value = Deno.env.get(name)?.trim();
  return value ? value : undefined;
}

function serviceConfig(): ServiceConfig {
  const url = env("SUPABASE_URL");
  let key: string | undefined;
  const secretKeysJson = env("SUPABASE_SECRET_KEYS");
  if (secretKeysJson) {
    try {
      const secretKeys: unknown = JSON.parse(secretKeysJson);
      if (isRecord(secretKeys) && typeof secretKeys.default === "string") {
        key = secretKeys.default;
      }
    } catch {
      // A malformed host-provided key map is a configuration error and fails closed below.
    }
  }
  key ??= env("SUPABASE_SERVICE_ROLE_KEY");

  if (!url || !key) {
    throw new ApiError("service_unavailable", 503);
  }

  return {
    url: url.replace(/\/$/, ""),
    key,
    legacyJwt: !key.startsWith("sb_secret_"),
  };
}

function allowedOrigin(request: Request): string | null {
  const origin = request.headers.get("origin");
  if (!origin) return null;

  const configured = env("VANTA_PULSE_ALLOWED_ORIGINS") ?? DEFAULT_ALLOWED_ORIGINS;
  if (configured === "*") return "*";

  const allowed = configured
    .split(",")
    .map((candidate) => candidate.trim().replace(/\/$/, ""))
    .filter(Boolean);

  return allowed.includes(origin.replace(/\/$/, "")) ? origin : null;
}

function corsHeaders(request: Request): Headers {
  const headers = new Headers({
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  });
  const origin = allowedOrigin(request);
  if (origin) headers.set("Access-Control-Allow-Origin", origin);
  return headers;
}

function jsonResponse(
  request: Request,
  body: unknown,
  status = 200,
  extraHeaders?: HeadersInit,
): Response {
  const headers = corsHeaders(request);
  headers.set("Content-Type", JSON_CONTENT_TYPE);
  headers.set("X-Content-Type-Options", "nosniff");
  if (extraHeaders) {
    new Headers(extraHeaders).forEach((value, key) => headers.set(key, value));
  }
  return new Response(JSON.stringify(body), { status, headers });
}

function errorResponse(request: Request, error: unknown): Response {
  if (error instanceof ApiError) {
    const headers = new Headers({ "Cache-Control": "no-store" });
    if (error.retryAfter) headers.set("Retry-After", String(error.retryAfter));
    return jsonResponse(request, { ok: false, error: error.code }, error.status, headers);
  }

  if (error instanceof UpstreamError) {
    const message = error.upstreamCode;
    if (message === "rate_limited" || message === "verification_limited") {
      return jsonResponse(
        request,
        { ok: false, error: "rate_limited" },
        429,
        { "Cache-Control": "no-store", "Retry-After": "60" },
      );
    }
    if (message === "ticket_expired") {
      return jsonResponse(
        request,
        { ok: false, error: "ticket_expired" },
        410,
        { "Cache-Control": "no-store" },
      );
    }
    if (message === "ticket_consumed" || message === "idempotency_conflict") {
      return jsonResponse(
        request,
        { ok: false, error: message },
        409,
        { "Cache-Control": "no-store" },
      );
    }
    if (
      message === "invalid_ticket" ||
      message === "ticket_mismatch" ||
      message === "invalid_run"
    ) {
      return jsonResponse(
        request,
        { ok: false, error: "invalid_submission" },
        400,
        { "Cache-Control": "no-store" },
      );
    }
  }

  console.error("vanta-pulse-leaderboard request failed", error);
  return jsonResponse(
    request,
    { ok: false, error: "service_unavailable" },
    503,
    { "Cache-Control": "no-store", "Retry-After": "10" },
  );
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: JsonRecord, allowed: readonly string[]): boolean {
  const allowedSet = new Set(allowed);
  return Object.keys(value).every((key) => allowedSet.has(key));
}

function isInteger(value: unknown, min: number, max: number): value is number {
  return Number.isSafeInteger(value) && Number(value) >= min && Number(value) <= max;
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function sanitizeCallsign(value: unknown): string {
  if (typeof value !== "string" || value.length > 64) return "PULSE";
  const sanitized = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9_]+/g, "")
    .slice(0, 12);
  return sanitized.length >= 3 ? sanitized : "PULSE";
}

async function readJson(
  request: Request,
  limit: number,
): Promise<Readonly<{ body: JsonRecord; byteLength: number }>> {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!/^application\/json(?:\s*;|$)/.test(contentType)) {
    throw new ApiError("unsupported_media_type", 415);
  }

  const declaredLength = request.headers.get("content-length");
  if (declaredLength) {
    const parsed = Number(declaredLength);
    if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > limit) {
      throw new ApiError("payload_too_large", 413);
    }
  }

  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength === 0) throw new ApiError("invalid_json", 400);
  if (bytes.byteLength > limit) throw new ApiError("payload_too_large", 413);

  try {
    const parsed: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (!isRecord(parsed)) throw new ApiError("invalid_json", 400);
    return { body: parsed, byteLength: bytes.byteLength };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError("invalid_json", 400);
  }
}

function randomUint32(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0] ?? 0;
}

function utcDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function resolveTicketScope(body: JsonRecord): RunScope {
  if (
    !hasOnlyKeys(body, [
      "action",
      "clientId",
      "credential",
      "mode",
      "levelId",
      "date",
      "segmentCount",
      "simulationVersion",
    ]) ||
    (body.simulationVersion !== undefined && body.simulationVersion !== SIMULATION_VERSION)
  ) {
    throw new ApiError("invalid_ticket_request", 400);
  }

  const mode = body.mode;
  if (mode !== "campaign" && mode !== "daily" && mode !== "endless") {
    throw new ApiError("invalid_ticket_request", 400);
  }

  if (mode === "campaign") {
    if (
      !hasOnlyKeys(body, [
        "action",
        "clientId",
        "credential",
        "mode",
        "levelId",
        "simulationVersion",
      ])
    ) {
      throw new ApiError("invalid_ticket_request", 400);
    }
    const levelId = body.levelId;
    if (typeof levelId !== "string" || !(levelId in CAMPAIGN_SEEDS)) {
      throw new ApiError("invalid_ticket_request", 400);
    }
    return {
      boardId: `campaign:v${SIMULATION_VERSION}:${levelId}`,
      mode,
      levelId,
      seed: CAMPAIGN_SEEDS[levelId as keyof typeof CAMPAIGN_SEEDS],
      simulationVersion: SIMULATION_VERSION,
    };
  }

  if (mode === "daily") {
    if (
      !hasOnlyKeys(body, [
        "action",
        "clientId",
        "credential",
        "mode",
        "date",
        "simulationVersion",
      ])
    ) {
      throw new ApiError("invalid_ticket_request", 400);
    }
    const today = utcDate();
    const date = body.date === undefined ? today : body.date;
    if (typeof date !== "string" || date !== today) {
      throw new ApiError("daily_not_active", 400);
    }
    return {
      boardId: `daily:v${SIMULATION_VERSION}:${date}`,
      mode,
      levelId: `daily-${date}`,
      seed: dailySeedForDate(date),
      simulationVersion: SIMULATION_VERSION,
    };
  }

  if (
    !hasOnlyKeys(body, [
      "action",
      "clientId",
      "credential",
      "mode",
      "segmentCount",
      "simulationVersion",
    ])
  ) {
    throw new ApiError("invalid_ticket_request", 400);
  }
  const segmentCount = body.segmentCount === undefined ? 24 : body.segmentCount;
  if (!isInteger(segmentCount, 1, 128)) {
    throw new ApiError("invalid_ticket_request", 400);
  }
  const seed = randomUint32();
  const levelId = `endless-${seed.toString(16).padStart(8, "0")}-${segmentCount}`;
  return {
    boardId: `endless:v${SIMULATION_VERSION}:${segmentCount}`,
    mode,
    levelId,
    seed,
    simulationVersion: SIMULATION_VERSION,
  };
}

function requestIp(request: Request): string {
  const direct = request.headers.get("cf-connecting-ip") ?? request.headers.get("x-real-ip");
  if (direct) return direct.slice(0, 128);
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return (forwarded || "unknown").slice(0, 128);
}

async function requesterHash(request: Request): Promise<string> {
  // A dedicated pepper is preferred. Hosted projects can still start safely
  // without manual secret provisioning by deriving the HMAC from the
  // server-only Supabase secret key that is already injected at runtime.
  const secret = env("VANTA_PULSE_RATE_LIMIT_SECRET") ?? serviceConfig().key;
  if (secret.length < 32) throw new ApiError("service_unavailable", 503);

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`v1:${requestIp(request)}`),
  );
  return toHex(digest);
}

function toHex(value: ArrayBuffer): string {
  return Array.from(new Uint8Array(value), (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

function unixSeconds(): number {
  return Math.floor(Date.now() / 1_000);
}

function credentialSecrets(): readonly string[] {
  // Prefer an independently rotatable credential key. Hosted deployments can
  // still start safely before one is provisioned by deriving HMACs from the
  // injected server-only Supabase service/secret key.
  const current = env("VANTA_PULSE_DEVICE_CREDENTIAL_SECRET") ?? serviceConfig().key;
  if (!current || new TextEncoder().encode(current).byteLength < 32) {
    throw new ApiError("service_unavailable", 503);
  }
  const previous = env("VANTA_PULSE_DEVICE_CREDENTIAL_PREVIOUS_SECRET");
  if (previous && new TextEncoder().encode(previous).byteLength < 32) {
    throw new ApiError("service_unavailable", 503);
  }
  return previous && previous !== current ? [current, previous] : [current];
}

function toBase64Url(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new ApiError("credential_invalid", 401);
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  let binary: string;
  try {
    binary = atob(value.replace(/-/g, "+").replace(/_/g, "/") + padding);
  } catch {
    throw new ApiError("credential_invalid", 401);
  }
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function hmac(secret: string, message: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)),
  );
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  let difference = left.byteLength ^ right.byteLength;
  const length = Math.max(left.byteLength, right.byteLength);
  for (let index = 0; index < length; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}

async function signCredential(claims: DeviceClaims | RunRenewalClaims): Promise<string> {
  const payload = toBase64Url(new TextEncoder().encode(JSON.stringify(claims)));
  const unsigned = `${CREDENTIAL_PREFIX}.${payload}`;
  const signature = await hmac(credentialSecrets()[0]!, unsigned);
  return `${unsigned}.${toBase64Url(signature)}`;
}

async function verifyCredentialPayload(credential: unknown): Promise<JsonRecord> {
  if (typeof credential !== "string" || credential.length < 32 || credential.length > 4_096) {
    throw new ApiError("credential_invalid", 401);
  }
  const parts = credential.split(".");
  if (parts.length !== 3 || parts[0] !== CREDENTIAL_PREFIX || !parts[1] || !parts[2]) {
    throw new ApiError("credential_invalid", 401);
  }
  const [prefix, payload, signatureText] = parts as [string, string, string];
  const signature = fromBase64Url(signatureText);
  if (signature.byteLength !== 32) throw new ApiError("credential_invalid", 401);

  let valid = false;
  for (const secret of credentialSecrets()) {
    const expected = await hmac(secret, `${prefix}.${payload}`);
    valid = constantTimeEqual(signature, expected) || valid;
  }
  if (!valid) throw new ApiError("credential_invalid", 401);

  try {
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(fromBase64Url(payload));
    if (decoded.length > 2_048) throw new ApiError("credential_invalid", 401);
    const claims: unknown = JSON.parse(decoded);
    if (!isRecord(claims)) throw new ApiError("credential_invalid", 401);
    return claims;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError("credential_invalid", 401);
  }
}

function validateCredentialTimes(claims: JsonRecord, expiredCode: string, expiredStatus: number): void {
  if (
    !isInteger(claims.issuedAt, 0, 4_102_444_800) ||
    !isInteger(claims.expiresAt, 0, 4_102_444_800) ||
    claims.expiresAt <= claims.issuedAt ||
    claims.issuedAt > unixSeconds() + MAX_CLOCK_SKEW_SECONDS
  ) {
    throw new ApiError("credential_invalid", 401);
  }
  if (claims.expiresAt <= unixSeconds() - MAX_CLOCK_SKEW_SECONDS) {
    throw new ApiError(expiredCode, expiredStatus);
  }
}

async function verifyDeviceCredential(credential: unknown): Promise<DeviceClaims> {
  const claims = await verifyCredentialPayload(credential);
  if (
    !hasOnlyKeys(claims, ["kind", "version", "clientId", "issuedAt", "expiresAt"]) ||
    claims.kind !== DEVICE_CREDENTIAL_KIND ||
    claims.version !== 1 ||
    !isUuid(claims.clientId)
  ) {
    throw new ApiError("credential_invalid", 401);
  }
  validateCredentialTimes(claims, "credential_expired", 401);
  return claims as unknown as DeviceClaims;
}

async function verifyRunRenewalCredential(credential: unknown): Promise<RunRenewalClaims> {
  const claims = await verifyCredentialPayload(credential);
  if (
    !hasOnlyKeys(claims, [
      "kind",
      "version",
      "clientId",
      "runSessionId",
      "issuedAt",
      "expiresAt",
      "boardId",
      "mode",
      "levelId",
      "seed",
      "simulationVersion",
    ]) ||
    claims.kind !== RUN_RENEWAL_KIND ||
    claims.version !== 1 ||
    !isUuid(claims.clientId) ||
    !isUuid(claims.runSessionId) ||
    typeof claims.boardId !== "string" ||
    !BOARD_PATTERN.test(claims.boardId) ||
    (claims.mode !== "campaign" && claims.mode !== "daily" && claims.mode !== "endless") ||
    typeof claims.levelId !== "string" ||
    !LEVEL_PATTERN.test(claims.levelId) ||
    !isInteger(claims.seed, 0, 0xffff_ffff) ||
    claims.simulationVersion !== SIMULATION_VERSION
  ) {
    throw new ApiError("credential_invalid", 401);
  }
  validateCredentialTimes(claims, "renewal_expired", 410);
  const renewal = claims as unknown as RunRenewalClaims;
  if (renewal.expiresAt <= unixSeconds()) throw new ApiError("renewal_expired", 410);
  return renewal;
}

async function publicIdForClient(clientId: string): Promise<string> {
  const digest = await hmac(
    credentialSecrets()[0]!,
    `vanta-pulse:public-id:v1:${clientId}`,
  );
  return `vp_${toHex(digest.buffer as ArrayBuffer).slice(0, 24)}`;
}

async function authenticateDevice(body: JsonRecord): Promise<AuthenticatedDevice> {
  if (!isUuid(body.clientId)) throw new ApiError("credential_required", 401);
  const claims = await verifyDeviceCredential(body.credential);
  if (claims.clientId !== body.clientId) throw new ApiError("identity_mismatch", 401);
  return {
    clientId: claims.clientId,
    publicId: await publicIdForClient(claims.clientId),
  };
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new ApiError("invalid_replay", 400);
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  throw new ApiError("invalid_replay", 400);
}

async function replayHash(replay: Replay): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonicalJson(replay)),
  );
  return toHex(digest);
}

function validateReplay(value: unknown): Replay {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      "version",
      "simulationVersion",
      "mode",
      "levelId",
      "seed",
      "events",
      "claimedScore",
      "claimedChecksum",
    ]) ||
    value.version !== 1 ||
    value.simulationVersion !== SIMULATION_VERSION ||
    (value.mode !== "campaign" && value.mode !== "daily" && value.mode !== "endless") ||
    typeof value.levelId !== "string" ||
    !LEVEL_PATTERN.test(value.levelId) ||
    !isInteger(value.seed, 0, 0xffffffff) ||
    !Array.isArray(value.events) ||
    value.events.length > MAX_REPLAY_EVENTS
  ) {
    throw new ApiError("invalid_replay", 400);
  }

  let previousTick = -1;
  for (const event of value.events) {
    if (
      !isRecord(event) ||
      !hasOnlyKeys(event, ["tick", "action"]) ||
      !isInteger(event.tick, 0, 2_592_000) ||
      (event.action !== "jump-down" && event.action !== "jump-up") ||
      event.tick < previousTick
    ) {
      throw new ApiError("invalid_replay", 400);
    }
    previousTick = event.tick;
  }

  if (
    value.claimedScore !== undefined &&
    !isInteger(value.claimedScore, 0, 1_000_000_000_000)
  ) {
    throw new ApiError("invalid_replay", 400);
  }
  if (
    value.claimedChecksum !== undefined &&
    (typeof value.claimedChecksum !== "string" || value.claimedChecksum.length > 128)
  ) {
    throw new ApiError("invalid_replay", 400);
  }

  return value as unknown as Replay;
}

function boardIdForReplay(replay: Replay): string {
  if (replay.mode === "campaign") return `campaign:v${SIMULATION_VERSION}:${replay.levelId}`;
  if (replay.mode === "daily") {
    const date = replay.levelId.replace(/^daily-/, "");
    const boardId = `daily:v${SIMULATION_VERSION}:${date}`;
    if (!/^daily-\d{4}-\d{2}-\d{2}$/.test(replay.levelId) || !BOARD_PATTERN.test(boardId)) {
      throw new ApiError("invalid_replay", 400);
    }
    return boardId;
  }
  const match = /^endless-[0-9a-f]{8}-(\d{1,3})$/.exec(replay.levelId);
  const segmentCount = match?.[1] ? Number(match[1]) : Number.NaN;
  if (!isInteger(segmentCount, 1, 128)) throw new ApiError("invalid_replay", 400);
  return `endless:v${SIMULATION_VERSION}:${segmentCount}`;
}

async function postgrest(
  path: string,
  init: RequestInit,
  maxResponseBytes = 256 * 1_024,
): Promise<unknown> {
  const config = serviceConfig();
  const headers = new Headers(init.headers);
  headers.set("apikey", config.key);
  // New secret keys are opaque, not JWTs, and must be sent on `apikey` only.
  // Legacy service_role JWTs still use Authorization to establish the DB role.
  if (config.legacyJwt) headers.set("Authorization", `Bearer ${config.key}`);
  headers.set("Content-Type", "application/json");
  headers.set("Accept", "application/json");

  const response = await fetch(`${config.url}/rest/v1/${path}`, { ...init, headers });
  const responseText = await response.text();
  if (responseText.length > maxResponseBytes) throw new UpstreamError(502, "oversized_response");

  let data: unknown;
  try {
    data = responseText ? JSON.parse(responseText) : null;
  } catch {
    throw new UpstreamError(response.status, "invalid_response");
  }

  if (!response.ok) {
    const message = isRecord(data) && typeof data.message === "string" ? data.message : "unknown";
    throw new UpstreamError(response.status, message);
  }
  return data;
}

async function callRpc(name: string, args: JsonRecord): Promise<JsonRecord> {
  const data = await postgrest(`rpc/${name}`, {
    method: "POST",
    body: JSON.stringify(args),
  });
  if (!isRecord(data)) throw new UpstreamError(502, "invalid_response");
  return data;
}

async function registerIdentity(request: Request, body: JsonRecord): Promise<Response> {
  if (!hasOnlyKeys(body, ["action", "credential"])) {
    throw new ApiError("invalid_identity_request", 400);
  }

  const previous = body.credential === undefined
    ? null
    : await verifyDeviceCredential(body.credential);
  const clientId = previous?.clientId ?? crypto.randomUUID();
  const issuedAt = unixSeconds();
  const expiresAt = issuedAt + DEVICE_CREDENTIAL_TTL_SECONDS;
  const credential = await signCredential({
    kind: DEVICE_CREDENTIAL_KIND,
    version: 1,
    clientId,
    issuedAt,
    expiresAt,
  });

  return jsonResponse(
    request,
    {
      ok: true,
      identity: {
        clientId,
        publicId: await publicIdForClient(clientId),
        credential,
        expiresAt: new Date(expiresAt * 1_000).toISOString(),
      },
    },
    previous ? 200 : 201,
    { "Cache-Control": "no-store" },
  );
}

async function issueDatabaseTicket(
  request: Request,
  clientId: string,
  scope: RunScope,
  ttlSeconds = TICKET_TTL_SECONDS,
): Promise<Readonly<{ ticketId: string; expiresAt: string }>> {
  const ticketId = crypto.randomUUID();
  const result = await callRpc("vanta_pulse_issue_ticket", {
    p_ticket_id: ticketId,
    p_client_id: clientId,
    p_requester_hash: await requesterHash(request),
    p_board_id: scope.boardId,
    p_mode: scope.mode,
    p_level_id: scope.levelId,
    p_seed: scope.seed,
    p_simulation_version: scope.simulationVersion,
    p_ttl_seconds: ttlSeconds,
  });

  const expiresAt = result.ticket_id === ticketId && typeof result.expires_at === "string"
    ? result.expires_at
    : null;
  if (!expiresAt) throw new UpstreamError(502, "invalid_response");
  return { ticketId, expiresAt };
}

async function issueTicket(request: Request, body: JsonRecord): Promise<Response> {
  const device = await authenticateDevice(body);
  const scope = resolveTicketScope(body);
  const ticket = await issueDatabaseTicket(request, device.clientId, scope);
  const issuedAt = unixSeconds();
  const renewalExpiresAt = issuedAt + RUN_RENEWAL_TTL_SECONDS;
  const renewalCredential = await signCredential({
    kind: RUN_RENEWAL_KIND,
    version: 1,
    clientId: device.clientId,
    runSessionId: crypto.randomUUID(),
    issuedAt,
    expiresAt: renewalExpiresAt,
    ...scope,
  });

  return jsonResponse(
    request,
    {
      ok: true,
      ticket: {
        status: "verified",
        ...ticket,
        renewalCredential,
        renewalExpiresAt: new Date(renewalExpiresAt * 1_000).toISOString(),
        ...scope,
      },
    },
    201,
    { "Cache-Control": "no-store" },
  );
}

async function renewTicket(request: Request, body: JsonRecord): Promise<Response> {
  if (!hasOnlyKeys(body, ["action", "clientId", "credential", "renewalCredential"])) {
    throw new ApiError("invalid_renewal_request", 400);
  }
  const device = await authenticateDevice(body);
  const renewal = await verifyRunRenewalCredential(body.renewalCredential);
  if (renewal.clientId !== device.clientId) throw new ApiError("identity_mismatch", 401);

  const scope: RunScope = {
    boardId: renewal.boardId,
    mode: renewal.mode,
    levelId: renewal.levelId,
    seed: renewal.seed,
    simulationVersion: renewal.simulationVersion,
  };
  const remainingSeconds = renewal.expiresAt - unixSeconds();
  if (remainingSeconds < 61) throw new ApiError("renewal_expired", 410);
  const ticket = await issueDatabaseTicket(
    request,
    device.clientId,
    scope,
    Math.min(TICKET_TTL_SECONDS, remainingSeconds - 1),
  );
  if (Date.parse(ticket.expiresAt) > renewal.expiresAt * 1_000) {
    // Never disclose a ticket that would outlive its signed run-session lease.
    throw new UpstreamError(502, "invalid_response");
  }

  return jsonResponse(
    request,
    {
      ok: true,
      ticket: {
        status: "verified",
        ...ticket,
        renewalCredential: body.renewalCredential,
        renewalExpiresAt: new Date(renewal.expiresAt * 1_000).toISOString(),
        ...scope,
      },
    },
    201,
    { "Cache-Control": "no-store" },
  );
}

async function submitRun(request: Request, body: JsonRecord): Promise<Response> {
  if (
    !hasOnlyKeys(body, [
      "action",
      "submissionId",
      "ticketId",
      "clientId",
      "credential",
      "callsign",
      "replay",
    ]) ||
    !isUuid(body.submissionId) ||
    !isUuid(body.ticketId) ||
    !isUuid(body.clientId)
  ) {
    throw new ApiError("invalid_submission", 400);
  }

  const device = await authenticateDevice(body);
  const callsign = sanitizeCallsign(body.callsign);
  const replay = validateReplay(body.replay);
  const boardId = boardIdForReplay(replay);
  const gate = await callRpc("vanta_pulse_begin_submission", {
    p_submission_id: body.submissionId,
    p_ticket_id: body.ticketId,
    p_client_id: device.clientId,
    p_requester_hash: await requesterHash(request),
  });
  const ticketSeed = numberFromDatabase(gate.seed);
  if (
    gate.board_id !== boardId ||
    gate.mode !== replay.mode ||
    gate.level_id !== replay.levelId ||
    ticketSeed !== replay.seed ||
    numberFromDatabase(gate.simulation_version) !== replay.simulationVersion
  ) {
    throw new ApiError("invalid_submission", 400);
  }
  const verification = verifyReplay({
    boardId,
    mode: replay.mode,
    levelId: replay.levelId,
    seed: replay.seed,
    replay,
    simulationVersion: replay.simulationVersion,
  });

  if (
    !verification.valid ||
    !verification.completed ||
    !isInteger(verification.score, 0, 1_000_000_000_000) ||
    !isInteger(verification.durationMs, 0, 21_600_000) ||
    !isInteger(verification.completionTicks, 0, 2_592_000) ||
    typeof verification.checksum !== "string" ||
    !CHECKSUM_PATTERN.test(verification.checksum)
  ) {
    throw new ApiError("replay_rejected", 422);
  }

  const result = await callRpc("vanta_pulse_commit_run", {
    p_submission_id: body.submissionId,
    p_ticket_id: body.ticketId,
    p_client_id: device.clientId,
    p_callsign: callsign,
    p_mode: replay.mode,
    p_level_id: replay.levelId,
    p_seed: replay.seed,
    p_simulation_version: replay.simulationVersion,
    p_score: verification.score,
    p_duration_ms: verification.durationMs,
    p_completion_ticks: verification.completionTicks,
    p_simulation_checksum: verification.checksum,
    p_replay_hash: await replayHash(replay),
    p_replay: replay,
  });

  return jsonResponse(
    request,
    {
      ok: true,
      result: {
        status: "verified",
        runId: result.run_id,
        boardId: result.board_id,
        score: numberFromDatabase(result.score),
        durationMs: numberFromDatabase(result.duration_ms),
        isPersonalBest: result.is_personal_best === true,
        // The DB always ranks the player's incumbent PB, even when this run
        // does not replace it. A missing rank is therefore an upstream fault.
        rank: numberFromDatabase(result.rank),
        idempotent: result.idempotent === true,
        submittedAt: result.submitted_at,
      },
    },
    200,
    { "Cache-Control": "no-store" },
  );
}

function numberFromDatabase(value: unknown): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isSafeInteger(parsed)) throw new UpstreamError(502, "invalid_response");
  return parsed;
}

async function getLeaderboard(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const boardId = url.searchParams.get("boardId") ?? url.searchParams.get("board") ?? "";
  if (!BOARD_PATTERN.test(boardId)) throw new ApiError("invalid_board", 400);

  const limitText = url.searchParams.get("limit");
  const limit = limitText === null ? DEFAULT_LEADERBOARD_LIMIT : Number(limitText);
  if (!isInteger(limit, 1, MAX_LEADERBOARD_LIMIT)) throw new ApiError("invalid_limit", 400);

  const query = new URLSearchParams({
    select: "best_score_id,board_id,client_id,callsign,score,duration_ms,achieved_at",
    board_id: `eq.${boardId}`,
    order: "score.desc,duration_ms.asc,achieved_at.asc,best_score_id.asc",
    limit: String(limit),
  });
  const data = await postgrest(`vanta_pulse_best_scores?${query.toString()}`, { method: "GET" });
  if (!Array.isArray(data)) throw new UpstreamError(502, "invalid_response");

  const entries = await Promise.all(data.map(async (raw, index) => {
    if (
      !isRecord(raw) ||
      raw.board_id !== boardId ||
      !isUuid(raw.client_id) ||
      typeof raw.callsign !== "string" ||
      typeof raw.achieved_at !== "string"
    ) {
      throw new UpstreamError(502, "invalid_response");
    }
    const publicId = await publicIdForClient(raw.client_id);
    if (!PUBLIC_ID_PATTERN.test(publicId)) throw new UpstreamError(502, "invalid_response");
    return {
      rank: index + 1,
      publicId,
      callsign: raw.callsign,
      score: numberFromDatabase(raw.score),
      durationMs: numberFromDatabase(raw.duration_ms),
      achievedAt: raw.achieved_at,
      status: "verified",
    };
  }));

  return jsonResponse(
    request,
    {
      ok: true,
      leaderboard: {
        boardId,
        status: "verified",
        entries,
        updatedAt: new Date().toISOString(),
      },
    },
    200,
    { "Cache-Control": "public, max-age=15, stale-while-revalidate=60" },
  );
}

type RouteAction = "identity" | "ticket" | "renew" | "submit";

function routeAction(request: Request, body?: JsonRecord): RouteAction | null {
  const pathAction = new URL(request.url).pathname.split("/").filter(Boolean).at(-1);
  if (pathAction === "identity" || pathAction === "register") return "identity";
  if (pathAction === "ticket" || pathAction === "renew" || pathAction === "submit") {
    return pathAction;
  }
  const bodyAction = body?.action;
  if (bodyAction === "identity" || bodyAction === "register") return "identity";
  return bodyAction === "ticket" || bodyAction === "renew" || bodyAction === "submit"
    ? bodyAction
    : null;
}

Deno.serve(async (request) => {
  try {
    const origin = request.headers.get("origin");
    if (origin && !allowedOrigin(request)) throw new ApiError("origin_not_allowed", 403);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }
    if (request.method === "GET") return await getLeaderboard(request);
    if (request.method !== "POST") throw new ApiError("method_not_allowed", 405);

    const pathAction = routeAction(request);
    const parsed = await readJson(
      request,
      pathAction && pathAction !== "submit" ? CONTROL_BODY_LIMIT : SUBMIT_BODY_LIMIT,
    );
    const body = parsed.body;
    const action = routeAction(request, body);

    if (action !== "submit" && parsed.byteLength > CONTROL_BODY_LIMIT) {
      throw new ApiError("payload_too_large", 413);
    }
    if (action === "identity") return await registerIdentity(request, body);
    if (action === "ticket") return await issueTicket(request, body);
    if (action === "renew") return await renewTicket(request, body);
    if (action === "submit") return await submitRun(request, body);
    throw new ApiError("unknown_action", 404);
  } catch (error) {
    return errorResponse(request, error);
  }
});
