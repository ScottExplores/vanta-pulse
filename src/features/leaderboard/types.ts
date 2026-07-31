import type { Replay } from "../../game/sim";

export type LeaderboardStatus = "verified" | "local";
export type LocalFallbackReason =
  | "unconfigured"
  | "offline"
  | "timeout"
  | "rate-limited"
  | "rejected"
  | "unavailable";

export interface PlayerIdentity {
  readonly clientId: string;
  readonly callsign: string;
}

export interface RunScope {
  readonly boardId: string;
  readonly mode: "campaign" | "daily" | "endless";
  readonly levelId: string;
  readonly seed: number;
  readonly simulationVersion: number;
}

export interface VerifiedRunTicket extends RunScope {
  readonly status: "verified";
  readonly ticketId: string;
  readonly expiresAt: string;
  readonly renewalCredential: string;
  readonly renewalExpiresAt: string;
}

export interface LocalRunTicket extends RunScope {
  readonly status: "local";
  readonly ticketId: null;
  readonly expiresAt: string;
  readonly reason: LocalFallbackReason;
}

export type RunTicket = VerifiedRunTicket | LocalRunTicket;

export type TicketRequest =
  | Readonly<{
      mode: "campaign";
      levelId: string;
    }>
  | Readonly<{
      mode: "daily";
      date?: string;
    }>
  | Readonly<{
      mode: "endless";
      segmentCount?: number;
    }>;

export interface LocalRunResult {
  readonly score: number;
  readonly durationMs: number;
}

export interface LeaderboardEntry {
  readonly rank: number;
  readonly publicId: string;
  readonly isCurrentPlayer: boolean;
  readonly callsign: string;
  readonly score: number;
  readonly durationMs: number;
  readonly achievedAt: string;
  readonly status: LeaderboardStatus;
}

export interface LeaderboardSnapshot {
  readonly boardId: string;
  readonly status: LeaderboardStatus;
  readonly entries: readonly LeaderboardEntry[];
  readonly updatedAt: string;
  readonly fallbackReason?: LocalFallbackReason;
}

export interface VerifiedSubmitResult {
  readonly status: "verified";
  readonly runId: string;
  readonly boardId: string;
  readonly score: number;
  readonly durationMs: number;
  readonly isPersonalBest: boolean;
  /** The player's current personal-best rank after this submission. */
  readonly rank: number;
  readonly idempotent: boolean;
  readonly submittedAt: string;
}

export interface LocalSubmitResult {
  readonly status: "local";
  readonly runId: string;
  readonly boardId: string;
  readonly score: number;
  readonly durationMs: number;
  readonly isPersonalBest: boolean;
  readonly rank: number | null;
  readonly idempotent: false;
  readonly submittedAt: string;
  readonly reason: LocalFallbackReason;
}

export type SubmitRunResult = VerifiedSubmitResult | LocalSubmitResult;

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

export interface LeaderboardClientOptions {
  readonly endpoint?: string | null;
  readonly fetch?: typeof globalThis.fetch;
  readonly storage?: StorageLike;
  readonly now?: () => Date;
  readonly randomUUID?: () => string;
  readonly randomUint32?: () => number;
  readonly requestTimeoutMs?: number;
}

export interface LeaderboardClient {
  getIdentity(): PlayerIdentity;
  setCallsign(value: string): PlayerIdentity;
  fetchLeaderboard(boardId: string, limit?: number): Promise<LeaderboardSnapshot>;
  issueTicket(request: TicketRequest): Promise<RunTicket>;
  requestTicket(request: TicketRequest): Promise<RunTicket>;
  submitRun(
    ticket: RunTicket,
    replay: Replay,
    localResult: LocalRunResult,
    submissionId?: string,
  ): Promise<SubmitRunResult>;
  recordLocalScore(
    boardId: string,
    localResult: LocalRunResult,
    runId?: string,
  ): LocalSubmitResult;
}
