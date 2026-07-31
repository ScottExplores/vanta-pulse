import {
  dailySeedForDate,
  endlessLevelId,
  getCampaignLevel,
} from "../../game/content";
import { SIMULATION_VERSION, type Replay } from "../../game/sim";
import { sanitizeCallsign } from "./sanitize";
import type {
  LeaderboardClient,
  LeaderboardClientOptions,
  LeaderboardEntry,
  LeaderboardSnapshot,
  LocalFallbackReason,
  LocalRunResult,
  LocalRunTicket,
  LocalSubmitResult,
  PlayerIdentity,
  RunScope,
  RunTicket,
  StorageLike,
  SubmitRunResult,
  TicketRequest,
  VerifiedRunTicket,
  VerifiedSubmitResult,
} from "./types";

const CLIENT_ID_KEY = "vanta-pulse/client-id/v1";
const CALLSIGN_KEY = "vanta-pulse/callsign/v1";
const LOCAL_SCORES_KEY = "vanta-pulse/local-scores/v1";
const DEVICE_IDENTITY_KEY = "vanta-pulse/device-identity/v1";
const MAX_LOCAL_BOARDS = 100;
const MAX_RESPONSE_CHARACTERS = 256 * 1_024;
const DEVICE_REFRESH_WINDOW_MS = 14 * 24 * 60 * 60_000;
const TICKET_RENEWAL_WINDOW_MS = 45_000;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BOARD_PATTERN = /^[a-z0-9][a-z0-9:_-]{0,63}$/;
const REMOTE_PUBLIC_ID_PATTERN = /^vp_[0-9a-f]{24}$/;
const CREDENTIAL_PATTERN = /^vp1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

interface StoredScore {
  readonly boardId: string;
  readonly clientId: string;
  readonly runId: string;
  readonly callsign: string;
  readonly score: number;
  readonly durationMs: number;
  readonly achievedAt: string;
}

interface StoredDeviceIdentity {
  readonly clientId: string;
  readonly publicId: string;
  readonly credential: string;
  readonly expiresAt: string;
}

class MemoryStorage implements StorageLike {
  readonly #values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.#values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.#values.set(key, value);
  }

  removeItem(key: string): void {
    this.#values.delete(key);
  }
}

const sharedMemoryStorage = new MemoryStorage();
const sharedDeviceIdentityRequests = new WeakMap<object, Promise<StoredDeviceIdentity>>();

class RemoteError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isSafeInteger = (value: unknown, minimum = 0): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= minimum;

const isUuid = (value: unknown): value is string =>
  typeof value === "string" && UUID_PATTERN.test(value);

const validIsoDate = (value: unknown): value is string =>
  typeof value === "string" && Number.isFinite(Date.parse(value));

const resolveStorage = (provided?: StorageLike): StorageLike => {
  if (provided) return provided;
  try {
    if (typeof window !== "undefined" && window.localStorage) return window.localStorage;
  } catch {
    // Privacy mode and sandboxed iframes can throw while reading localStorage.
  }
  return sharedMemoryStorage;
};

const safeGet = (storage: StorageLike, key: string): string | null => {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
};

const safeSet = (storage: StorageLike, key: string, value: string): void => {
  try {
    storage.setItem(key, value);
  } catch {
    // The in-memory identity still lets the game run when storage is unavailable.
  }
};

const safeRemove = (storage: StorageLike, key: string): void => {
  try {
    storage.removeItem?.(key);
  } catch {
    // A stale in-memory credential is discarded even when persistent storage is read-only.
  }
};

const defaultRandomUUID = (): string => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(
    16,
    20,
  )}-${hex.slice(20)}`;
};

const defaultRandomUint32 = (): number => {
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    return crypto.getRandomValues(new Uint32Array(1))[0] ?? 0;
  }
  return Math.floor(Math.random() * 0x1_0000_0000) >>> 0;
};

const normalizeEndpoint = (value: string | null | undefined): string | null => {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    url.hash = "";
    url.search = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
};

const configuredEndpoint = (): string | null =>
  normalizeEndpoint(import.meta.env.VITE_LEADERBOARD_URL);

const fallbackReason = (error: unknown): LocalFallbackReason => {
  if (error instanceof RemoteError) {
    if (error.status === 429) return "rate-limited";
    if (error.status >= 400 && error.status < 500) return "rejected";
    return "unavailable";
  }
  if (error instanceof DOMException && error.name === "AbortError") return "timeout";
  if (error instanceof TypeError) return "offline";
  return "unavailable";
};

const canRebootstrapCredential = (error: unknown): boolean =>
  error instanceof RemoteError &&
  error.status === 401 &&
  ["credential_invalid", "credential_expired", "credential_required", "identity_mismatch"].includes(
    error.code,
  );

const assertLocalResult = (result: LocalRunResult): void => {
  if (
    !Number.isSafeInteger(result.score) ||
    result.score < 0 ||
    result.score > 1_000_000_000_000 ||
    !Number.isSafeInteger(result.durationMs) ||
    result.durationMs < 0 ||
    result.durationMs > 21_600_000
  ) {
    throw new TypeError("Invalid local run result");
  }
};

const scoreIsBetter = (candidate: StoredScore, incumbent: StoredScore): boolean =>
  candidate.score > incumbent.score ||
  (candidate.score === incumbent.score && candidate.durationMs < incumbent.durationMs);

const localPublicId = (clientId: string): string =>
  `lp_${clientId.replace(/-/g, "").slice(0, 24).toLowerCase()}`;

const parseStoredScores = (storage: StorageLike): StoredScore[] => {
  const raw = safeGet(storage, LOCAL_SCORES_KEY);
  if (!raw || raw.length > MAX_RESPONSE_CHARACTERS) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.slice(0, MAX_LOCAL_BOARDS).filter((entry): entry is StoredScore =>
      isRecord(entry) &&
      typeof entry.boardId === "string" &&
      BOARD_PATTERN.test(entry.boardId) &&
      isUuid(entry.clientId) &&
      isUuid(entry.runId) &&
      typeof entry.callsign === "string" &&
      sanitizeCallsign(entry.callsign) === entry.callsign &&
      isSafeInteger(entry.score) &&
      isSafeInteger(entry.durationMs) &&
      validIsoDate(entry.achievedAt)
    );
  } catch {
    return [];
  }
};

const rankedEntries = (
  scores: readonly StoredScore[],
  boardId: string,
  limit: number,
  currentClientId: string,
): LeaderboardEntry[] =>
  scores
    .filter((entry) => entry.boardId === boardId)
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.durationMs - right.durationMs ||
        left.achievedAt.localeCompare(right.achievedAt),
    )
    .slice(0, limit)
    .map((entry, index) => ({
      rank: index + 1,
      publicId: localPublicId(entry.clientId),
      isCurrentPlayer: entry.clientId === currentClientId,
      callsign: entry.callsign,
      score: entry.score,
      durationMs: entry.durationMs,
      achievedAt: entry.achievedAt,
      status: "local",
    }));

const resolveLocalScope = (
  request: TicketRequest,
  now: Date,
  randomUint32: () => number,
): RunScope => {
  if (request.mode === "campaign") {
    const level = getCampaignLevel(request.levelId);
    if (!level) throw new TypeError("Unknown campaign level");
    return {
      boardId: `campaign:v${SIMULATION_VERSION}:${level.id}`,
      mode: "campaign",
      levelId: level.id,
      seed: level.seed,
      simulationVersion: SIMULATION_VERSION,
    };
  }
  if (request.mode === "daily") {
    const date = request.date ?? now.toISOString().slice(0, 10);
    return {
      boardId: `daily:v${SIMULATION_VERSION}:${date}`,
      mode: "daily",
      levelId: `daily-${date}`,
      seed: dailySeedForDate(date),
      simulationVersion: SIMULATION_VERSION,
    };
  }
  const segmentCount = request.segmentCount ?? 24;
  if (!Number.isSafeInteger(segmentCount) || segmentCount < 1 || segmentCount > 128) {
    throw new TypeError("Endless segmentCount must be from 1 through 128");
  }
  const seed = randomUint32() >>> 0;
  return {
    boardId: `endless:v${SIMULATION_VERSION}:${segmentCount}`,
    mode: "endless",
    levelId: endlessLevelId(seed, segmentCount),
    seed,
    simulationVersion: SIMULATION_VERSION,
  };
};

const parseStoredDeviceIdentity = (storage: StorageLike): StoredDeviceIdentity | null => {
  const raw = safeGet(storage, DEVICE_IDENTITY_KEY);
  if (!raw || raw.length > 8_192) return null;
  try {
    const identity: unknown = JSON.parse(raw);
    if (
      !isRecord(identity) ||
      !isUuid(identity.clientId) ||
      typeof identity.publicId !== "string" ||
      !REMOTE_PUBLIC_ID_PATTERN.test(identity.publicId) ||
      typeof identity.credential !== "string" ||
      identity.credential.length > 4_096 ||
      !CREDENTIAL_PATTERN.test(identity.credential) ||
      !validIsoDate(identity.expiresAt)
    ) {
      return null;
    }
    return identity as unknown as StoredDeviceIdentity;
  } catch {
    return null;
  }
};

const parseDeviceIdentity = (value: unknown): StoredDeviceIdentity => {
  if (!isRecord(value) || value.ok !== true || !isRecord(value.identity)) {
    throw new RemoteError(502, "invalid_response");
  }
  const identity = value.identity;
  if (
    !isUuid(identity.clientId) ||
    typeof identity.publicId !== "string" ||
    !REMOTE_PUBLIC_ID_PATTERN.test(identity.publicId) ||
    typeof identity.credential !== "string" ||
    identity.credential.length > 4_096 ||
    !CREDENTIAL_PATTERN.test(identity.credential) ||
    !validIsoDate(identity.expiresAt)
  ) {
    throw new RemoteError(502, "invalid_response");
  }
  return identity as unknown as StoredDeviceIdentity;
};

const ticketBody = (
  request: TicketRequest,
  identity: StoredDeviceIdentity,
): Record<string, unknown> => {
  if (request.mode === "campaign") {
    return {
      action: "ticket",
      clientId: identity.clientId,
      credential: identity.credential,
      mode: request.mode,
      levelId: request.levelId,
      simulationVersion: SIMULATION_VERSION,
    };
  }
  if (request.mode === "daily") {
    return {
      action: "ticket",
      clientId: identity.clientId,
      credential: identity.credential,
      mode: request.mode,
      ...(request.date ? { date: request.date } : {}),
      simulationVersion: SIMULATION_VERSION,
    };
  }
  return {
    action: "ticket",
    clientId: identity.clientId,
    credential: identity.credential,
    mode: request.mode,
    ...(request.segmentCount === undefined ? {} : { segmentCount: request.segmentCount }),
    simulationVersion: SIMULATION_VERSION,
  };
};

const parseVerifiedTicket = (value: unknown): VerifiedRunTicket => {
  if (!isRecord(value) || value.ok !== true || !isRecord(value.ticket)) {
    throw new RemoteError(502, "invalid_response");
  }
  const ticket = value.ticket;
  if (
    ticket.status !== "verified" ||
    !isUuid(ticket.ticketId) ||
    !validIsoDate(ticket.expiresAt) ||
    typeof ticket.renewalCredential !== "string" ||
    ticket.renewalCredential.length > 4_096 ||
    !CREDENTIAL_PATTERN.test(ticket.renewalCredential) ||
    !validIsoDate(ticket.renewalExpiresAt) ||
    typeof ticket.boardId !== "string" ||
    !BOARD_PATTERN.test(ticket.boardId) ||
    (ticket.mode !== "campaign" && ticket.mode !== "daily" && ticket.mode !== "endless") ||
    typeof ticket.levelId !== "string" ||
    !isSafeInteger(ticket.seed) ||
    ticket.seed > 0xffff_ffff ||
    ticket.simulationVersion !== SIMULATION_VERSION
  ) {
    throw new RemoteError(502, "invalid_response");
  }
  return ticket as unknown as VerifiedRunTicket;
};

const parseVerifiedSubmit = (value: unknown): VerifiedSubmitResult => {
  if (!isRecord(value) || value.ok !== true || !isRecord(value.result)) {
    throw new RemoteError(502, "invalid_response");
  }
  const result = value.result;
  if (
    result.status !== "verified" ||
    !isUuid(result.runId) ||
    typeof result.boardId !== "string" ||
    !BOARD_PATTERN.test(result.boardId) ||
    !isSafeInteger(result.score) ||
    !isSafeInteger(result.durationMs) ||
    typeof result.isPersonalBest !== "boolean" ||
    !isSafeInteger(result.rank, 1) ||
    typeof result.idempotent !== "boolean" ||
    !validIsoDate(result.submittedAt)
  ) {
    throw new RemoteError(502, "invalid_response");
  }
  return result as unknown as VerifiedSubmitResult;
};

const parseVerifiedLeaderboard = (
  value: unknown,
  boardId: string,
  currentPublicId?: string,
): LeaderboardSnapshot => {
  if (!isRecord(value) || value.ok !== true || !isRecord(value.leaderboard)) {
    throw new RemoteError(502, "invalid_response");
  }
  const leaderboard = value.leaderboard;
  if (
    leaderboard.boardId !== boardId ||
    leaderboard.status !== "verified" ||
    !Array.isArray(leaderboard.entries) ||
    !validIsoDate(leaderboard.updatedAt)
  ) {
    throw new RemoteError(502, "invalid_response");
  }
  const entries = leaderboard.entries.map((entry): LeaderboardEntry => {
    if (
      !isRecord(entry) ||
      !isSafeInteger(entry.rank, 1) ||
      typeof entry.publicId !== "string" ||
      !REMOTE_PUBLIC_ID_PATTERN.test(entry.publicId) ||
      "clientId" in entry ||
      "runId" in entry ||
      typeof entry.callsign !== "string" ||
      sanitizeCallsign(entry.callsign) !== entry.callsign ||
      !isSafeInteger(entry.score) ||
      !isSafeInteger(entry.durationMs) ||
      !validIsoDate(entry.achievedAt) ||
      entry.status !== "verified"
    ) {
      throw new RemoteError(502, "invalid_response");
    }
    return {
      rank: entry.rank,
      publicId: entry.publicId,
      isCurrentPlayer: entry.publicId === currentPublicId,
      callsign: entry.callsign,
      score: entry.score,
      durationMs: entry.durationMs,
      achievedAt: entry.achievedAt,
      status: "verified",
    };
  });
  return {
    boardId,
    status: "verified",
    entries,
    updatedAt: leaderboard.updatedAt,
  };
};

export const createLeaderboardClient = (
  urlOrOptions: string | LeaderboardClientOptions = {},
): LeaderboardClient => {
  const options: LeaderboardClientOptions =
    typeof urlOrOptions === "string" ? { endpoint: urlOrOptions } : urlOrOptions;
  const endpoint = normalizeEndpoint(options.endpoint ?? configuredEndpoint());
  const storage = resolveStorage(options.storage);
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const now = options.now ?? (() => new Date());
  const randomUUID = options.randomUUID ?? defaultRandomUUID;
  const randomUint32 = options.randomUint32 ?? defaultRandomUint32;
  const requestTimeoutMs = Math.max(1_000, Math.min(options.requestTimeoutMs ?? 6_000, 20_000));

  let memoryIdentity: PlayerIdentity | undefined;
  let memoryDeviceIdentity = parseStoredDeviceIdentity(storage) ?? undefined;
  let deviceIdentityPromise: Promise<StoredDeviceIdentity> | undefined;

  const getIdentity = (): PlayerIdentity => {
    if (memoryIdentity) return memoryIdentity;
    const storedId = safeGet(storage, CLIENT_ID_KEY);
    let clientId = storedId && isUuid(storedId) ? storedId : randomUUID();
    if (!isUuid(clientId)) clientId = defaultRandomUUID();
    const callsign = sanitizeCallsign(safeGet(storage, CALLSIGN_KEY));
    safeSet(storage, CLIENT_ID_KEY, clientId);
    safeSet(storage, CALLSIGN_KEY, callsign);
    memoryIdentity = { clientId, callsign };
    return memoryIdentity;
  };

  const setCallsign = (value: string): PlayerIdentity => {
    const current = getIdentity();
    const callsign = sanitizeCallsign(value);
    memoryIdentity = { clientId: current.clientId, callsign };
    safeSet(storage, CALLSIGN_KEY, callsign);
    return memoryIdentity;
  };

  const fetchJson = async (url: string, init: RequestInit): Promise<unknown> => {
    const controller = new AbortController();
    const timeout = globalThis.setTimeout(() => controller.abort(), requestTimeoutMs);
    try {
      const response = await fetchImpl(url, { ...init, signal: controller.signal });
      const text = await response.text();
      if (text.length > MAX_RESPONSE_CHARACTERS) throw new RemoteError(502, "oversized_response");
      let data: unknown;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        throw new RemoteError(502, "invalid_response");
      }
      if (!response.ok) {
        const code = isRecord(data) && typeof data.error === "string" ? data.error : "request_failed";
        throw new RemoteError(response.status, code);
      }
      return data;
    } finally {
      globalThis.clearTimeout(timeout);
    }
  };

  const persistDeviceIdentity = (identity: StoredDeviceIdentity): StoredDeviceIdentity => {
    memoryDeviceIdentity = identity;
    safeSet(storage, DEVICE_IDENTITY_KEY, JSON.stringify(identity));
    return identity;
  };

  const discardDeviceIdentity = (): void => {
    memoryDeviceIdentity = undefined;
    safeRemove(storage, DEVICE_IDENTITY_KEY);
  };

  const ensureDeviceIdentity = async (): Promise<StoredDeviceIdentity> => {
    if (!endpoint) throw new RemoteError(503, "unconfigured");
    const current = memoryDeviceIdentity;
    if (
      current &&
      Date.parse(current.expiresAt) > now().getTime() + DEVICE_REFRESH_WINDOW_MS
    ) {
      return current;
    }
    if (deviceIdentityPromise) return deviceIdentityPromise;
    const sharedRequest = sharedDeviceIdentityRequests.get(storage as object);
    if (sharedRequest) return persistDeviceIdentity(await sharedRequest);

    const pending = (async (): Promise<StoredDeviceIdentity> => {
      const requestIdentity = async (credential?: string): Promise<StoredDeviceIdentity> => {
        const data = await fetchJson(`${endpoint}/identity`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({
            action: "identity",
            ...(credential ? { credential } : {}),
          }),
        });
        return parseDeviceIdentity(data);
      };

      if (current) {
        try {
          const refreshed = await requestIdentity(current.credential);
          if (refreshed.clientId !== current.clientId) {
            throw new RemoteError(502, "identity_changed");
          }
          return persistDeviceIdentity(refreshed);
        } catch (error) {
          if (!canRebootstrapCredential(error)) throw error;
          discardDeviceIdentity();
        }
      }
      return persistDeviceIdentity(await requestIdentity());
    })();

    deviceIdentityPromise = pending;
    sharedDeviceIdentityRequests.set(storage as object, pending);
    try {
      return await pending;
    } finally {
      if (deviceIdentityPromise === pending) deviceIdentityPromise = undefined;
      if (sharedDeviceIdentityRequests.get(storage as object) === pending) {
        sharedDeviceIdentityRequests.delete(storage as object);
      }
    }
  };

  const localSnapshot = (
    boardId: string,
    limit: number,
    reason?: LocalFallbackReason,
  ): LeaderboardSnapshot => ({
    boardId,
    status: "local",
    entries: rankedEntries(parseStoredScores(storage), boardId, limit, getIdentity().clientId),
    updatedAt: now().toISOString(),
    ...(reason ? { fallbackReason: reason } : {}),
  });

  const recordLocalScore = (
    boardId: string,
    localResult: LocalRunResult,
    runId = randomUUID(),
  ): LocalSubmitResult => {
    if (!BOARD_PATTERN.test(boardId) || !isUuid(runId)) throw new TypeError("Invalid local score");
    assertLocalResult(localResult);
    const identity = getIdentity();
    const submittedAt = now().toISOString();
    const candidate: StoredScore = {
      boardId,
      clientId: identity.clientId,
      runId,
      callsign: identity.callsign,
      score: localResult.score,
      durationMs: localResult.durationMs,
      achievedAt: submittedAt,
    };
    const scores = parseStoredScores(storage);
    const incumbentIndex = scores.findIndex(
      (score) => score.boardId === boardId && score.clientId === identity.clientId,
    );
    const incumbent = incumbentIndex >= 0 ? scores[incumbentIndex] : undefined;
    const isPersonalBest = incumbent === undefined || scoreIsBetter(candidate, incumbent);
    if (isPersonalBest) {
      if (incumbentIndex >= 0) scores.splice(incumbentIndex, 1, candidate);
      else scores.unshift(candidate);
      safeSet(storage, LOCAL_SCORES_KEY, JSON.stringify(scores.slice(0, MAX_LOCAL_BOARDS)));
    }
    const rankedScores = scores
      .filter((score) => score.boardId === boardId)
      .sort(
        (left, right) =>
          right.score - left.score ||
          left.durationMs - right.durationMs ||
          left.achievedAt.localeCompare(right.achievedAt),
      );
    const rankedRunId = isPersonalBest ? runId : incumbent?.runId;
    const rankIndex = rankedScores.findIndex((score) => score.runId === rankedRunId);
    const rank = rankIndex >= 0 ? rankIndex + 1 : null;
    return {
      status: "local",
      runId,
      boardId,
      score: localResult.score,
      durationMs: localResult.durationMs,
      isPersonalBest,
      rank,
      idempotent: false,
      submittedAt,
      reason: endpoint ? "unavailable" : "unconfigured",
    };
  };

  const fetchLeaderboard = async (boardId: string, limit = 25): Promise<LeaderboardSnapshot> => {
    if (!BOARD_PATTERN.test(boardId)) throw new TypeError("Invalid leaderboard board ID");
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new TypeError("Leaderboard limit must be from 1 through 100");
    }
    if (!endpoint) return localSnapshot(boardId, limit, "unconfigured");
    try {
      const query = new URLSearchParams({ boardId, limit: String(limit) });
      const data = await fetchJson(`${endpoint}?${query.toString()}`, {
        method: "GET",
        headers: { Accept: "application/json" },
      });
      return parseVerifiedLeaderboard(data, boardId, memoryDeviceIdentity?.publicId);
    } catch (error) {
      return localSnapshot(boardId, limit, fallbackReason(error));
    }
  };

  const localTicket = (
    request: TicketRequest,
    reason: LocalFallbackReason,
  ): LocalRunTicket => ({
    status: "local",
    ticketId: null,
    expiresAt: new Date(now().getTime() + 5 * 60_000).toISOString(),
    reason,
    ...resolveLocalScope(request, now(), randomUint32),
  });

  const issueTicket = async (request: TicketRequest): Promise<RunTicket> => {
    if (!endpoint) return localTicket(request, "unconfigured");
    try {
      let device = await ensureDeviceIdentity();
      const requestRemoteTicket = async (): Promise<VerifiedRunTicket> => {
        const data = await fetchJson(`${endpoint}/ticket`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify(ticketBody(request, device)),
        });
        return parseVerifiedTicket(data);
      };
      try {
        return await requestRemoteTicket();
      } catch (error) {
        if (!canRebootstrapCredential(error)) throw error;
        discardDeviceIdentity();
        device = await ensureDeviceIdentity();
        return await requestRemoteTicket();
      }
    } catch (error) {
      return localTicket(request, fallbackReason(error));
    }
  };

  const renewVerifiedTicket = async (
    ticket: VerifiedRunTicket,
    device: StoredDeviceIdentity,
  ): Promise<VerifiedRunTicket> => {
    if (!endpoint) throw new RemoteError(503, "unconfigured");
    const data = await fetchJson(`${endpoint}/renew`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        action: "renew",
        clientId: device.clientId,
        credential: device.credential,
        renewalCredential: ticket.renewalCredential,
      }),
    });
    const renewed = parseVerifiedTicket(data);
    if (
      renewed.boardId !== ticket.boardId ||
      renewed.mode !== ticket.mode ||
      renewed.levelId !== ticket.levelId ||
      renewed.seed !== ticket.seed ||
      renewed.simulationVersion !== ticket.simulationVersion ||
      renewed.renewalCredential !== ticket.renewalCredential ||
      renewed.renewalExpiresAt !== ticket.renewalExpiresAt
    ) {
      throw new RemoteError(502, "renewal_scope_changed");
    }
    return renewed;
  };

  const submitRun = async (
    ticket: RunTicket,
    replay: Replay,
    localResult: LocalRunResult,
    submissionId = randomUUID(),
  ): Promise<SubmitRunResult> => {
    assertLocalResult(localResult);
    if (!isUuid(submissionId)) throw new TypeError("Invalid submission ID");
    if (
      replay.mode !== ticket.mode ||
      replay.levelId !== ticket.levelId ||
      replay.seed !== ticket.seed ||
      replay.simulationVersion !== ticket.simulationVersion
    ) {
      throw new TypeError("Replay does not match its run ticket");
    }

    if (endpoint && ticket.status === "verified") {
      try {
        const identity = getIdentity();
        const device = await ensureDeviceIdentity();
        // A signed two-hour lease survives tutorial, pause, and restarts. Mint a
        // fresh three-minute DB ticket only when the current one is near expiry;
        // the renewal response must preserve the original scope and endless seed.
        let activeTicket = Date.parse(ticket.expiresAt) <=
            now().getTime() + TICKET_RENEWAL_WINDOW_MS
          ? await renewVerifiedTicket(ticket, device)
          : ticket;
        const submitVerified = (submissionTicket: VerifiedRunTicket): Promise<unknown> =>
          fetchJson(`${endpoint}/submit`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify({
              action: "submit",
              submissionId,
              ticketId: submissionTicket.ticketId,
              clientId: device.clientId,
              credential: device.credential,
              callsign: identity.callsign,
              replay,
            }),
          });

        let data: unknown;
        try {
          data = await submitVerified(activeTicket);
        } catch (error) {
          // A slow device clock or upload can race the DB expiry. Renew and
          // retry once with the same idempotency key and replay.
          if (
            !(error instanceof RemoteError) ||
            error.status !== 410 ||
            error.code !== "ticket_expired"
          ) {
            throw error;
          }
          activeTicket = await renewVerifiedTicket(activeTicket, device);
          data = await submitVerified(activeTicket);
        }
        const verified = parseVerifiedSubmit(data);
        recordLocalScore(
          verified.boardId,
          { score: verified.score, durationMs: verified.durationMs },
          verified.runId,
        );
        return verified;
      } catch (error) {
        const local = recordLocalScore(ticket.boardId, localResult, submissionId);
        return { ...local, reason: fallbackReason(error) };
      }
    }

    const local = recordLocalScore(ticket.boardId, localResult, submissionId);
    return {
      ...local,
      reason: ticket.status === "local" ? ticket.reason : endpoint ? "rejected" : "unconfigured",
    };
  };

  return {
    getIdentity,
    setCallsign,
    fetchLeaderboard,
    issueTicket,
    requestTicket: issueTicket,
    submitRun,
    recordLocalScore,
  };
};
