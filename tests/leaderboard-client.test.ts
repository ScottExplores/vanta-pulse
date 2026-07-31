import { describe, expect, it, vi } from "vitest";
import {
  createLeaderboardClient,
  sanitizeCallsign,
  type StorageLike,
} from "../src/features/leaderboard";
import { SIMULATION_VERSION } from "../src/game/sim";

class TestStorage implements StorageLike {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

const CLIENT_ID = "018f4c2a-6f23-7d81-9b4e-c320ae0f1234";
const RUN_ID = "018f4c2a-6f23-7d81-9b4e-c320ae0f5678";
const SECOND_RUN_ID = "018f4c2a-6f23-7d81-9b4e-c320ae0f9abc";
const SERVER_CLIENT_ID = "018f4c2a-6f23-7d81-9b4e-c320ae0f7777";
const SERVER_PUBLIC_ID = "vp_0123456789abcdef01234567";
const DEVICE_CREDENTIAL = "vp1.ZGV2aWNl.c2lnbmF0dXJl";
const RENEWAL_CREDENTIAL = "vp1.cnVuLXNlc3Npb24.c2lnbmF0dXJl";
const ENDPOINT = "https://example.supabase.co/functions/v1/vanta-pulse-leaderboard";

const json = (body: unknown, status = 200): Response => Response.json(body, { status });

const identityEnvelope = (credential = DEVICE_CREDENTIAL) => ({
  ok: true,
  identity: {
    clientId: SERVER_CLIENT_ID,
    publicId: SERVER_PUBLIC_ID,
    credential,
    expiresAt: "2026-10-29T12:00:00.000Z",
  },
});

const ticketEnvelope = (
  ticketId = RUN_ID,
  expiresAt = "2026-07-31T12:03:00.000Z",
) => ({
  ok: true,
  ticket: {
    status: "verified",
    ticketId,
    expiresAt,
    renewalCredential: RENEWAL_CREDENTIAL,
    renewalExpiresAt: "2026-07-31T14:00:00.000Z",
    boardId: "campaign:v2:glass-horizon",
    mode: "campaign",
    levelId: "glass-horizon",
    seed: 0x474c4153,
    simulationVersion: SIMULATION_VERSION,
  },
});

describe("leaderboard callsign sanitation", () => {
  it("normalizes friendly input into the server allow-list", () => {
    expect(sanitizeCallsign("  Néon pulse!  ")).toBe("NEONPULSE");
    expect(sanitizeCallsign("signal_runner_very_long")).toBe("SIGNAL_RUNNE");
    expect(sanitizeCallsign("<b>VX</b>")).toBe("BVXB");
  });

  it("uses a safe default for empty, short, or oversized input", () => {
    expect(sanitizeCallsign(" ")).toBe("PULSE");
    expect(sanitizeCallsign("VX")).toBe("PULSE");
    expect(sanitizeCallsign("x".repeat(65))).toBe("PULSE");
  });
});

describe("offline leaderboard client", () => {
  it("persists a stable anonymous identity and sanitized callsign", () => {
    const storage = new TestStorage();
    const first = createLeaderboardClient({ storage, randomUUID: () => CLIENT_ID });
    expect(first.getIdentity()).toEqual({ clientId: CLIENT_ID, callsign: "PULSE" });
    expect(first.setCallsign("néon fox")).toEqual({
      clientId: CLIENT_ID,
      callsign: "NEONFOX",
    });

    const second = createLeaderboardClient({
      storage,
      randomUUID: () => "018f4c2a-6f23-7d81-9b4e-c320ae0fffff",
    });
    expect(second.getIdentity()).toEqual({ clientId: CLIENT_ID, callsign: "NEONFOX" });
  });

  it("issues a local scope and keeps only the better local score", async () => {
    const storage = new TestStorage();
    const client = createLeaderboardClient({
      endpoint: null,
      storage,
      now: () => new Date("2026-07-31T12:00:00.000Z"),
      randomUUID: () => CLIENT_ID,
    });
    client.getIdentity();
    client.setCallsign("vector");

    const ticket = await client.issueTicket({ mode: "campaign", levelId: "glass-horizon" });
    expect(ticket).toMatchObject({
      status: "local",
      reason: "unconfigured",
      boardId: "campaign:v2:glass-horizon",
      levelId: "glass-horizon",
      seed: 0x474c4153,
    });

    const replay = {
      version: 1 as const,
      simulationVersion: ticket.simulationVersion,
      mode: ticket.mode,
      levelId: ticket.levelId,
      seed: ticket.seed,
      events: [],
    };
    const first = await client.submitRun(
      ticket,
      replay,
      { score: 12_000, durationMs: 15_000 },
      RUN_ID,
    );
    expect(first).toMatchObject({ status: "local", isPersonalBest: true, rank: 1 });

    const slower = client.recordLocalScore(
      ticket.boardId,
      { score: 11_000, durationMs: 14_000 },
      SECOND_RUN_ID,
    );
    expect(slower.isPersonalBest).toBe(false);

    const board = await client.fetchLeaderboard(ticket.boardId);
    expect(board.status).toBe("local");
    expect(board.fallbackReason).toBe("unconfigured");
    expect(board.entries).toHaveLength(1);
    expect(board.entries[0]).toMatchObject({
      publicId: "lp_018f4c2a6f237d819b4ec320",
      isCurrentPlayer: true,
      callsign: "VECTOR",
      score: 12_000,
      status: "local",
    });
  });

  it("falls back visibly when the verified endpoint is unreachable", async () => {
    const storage = new TestStorage();
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new TypeError("offline"));
    const client = createLeaderboardClient({
      endpoint: "https://example.supabase.co/functions/v1/vanta-pulse-leaderboard",
      fetch: fetchMock,
      storage,
      randomUUID: () => CLIENT_ID,
    });
    client.getIdentity();
    client.recordLocalScore(
      "campaign:v2:phase-bloom",
      { score: 9_000, durationMs: 20_000 },
      RUN_ID,
    );

    const board = await client.fetchLeaderboard("campaign:v2:phase-bloom", 10);
    expect(board).toMatchObject({ status: "local", fallbackReason: "offline" });
    expect(board.entries[0]).toMatchObject({ score: 9_000, status: "local" });
  });

  it("keeps legacy physics scores isolated from v2 boards", async () => {
    const storage = new TestStorage();
    const client = createLeaderboardClient({ endpoint: null, storage, randomUUID: () => CLIENT_ID });
    client.getIdentity();
    client.recordLocalScore(
      "campaign:glass-horizon",
      { score: 99_999, durationMs: 10_000 },
      RUN_ID,
    );
    const ticket = await client.issueTicket({ mode: "campaign", levelId: "glass-horizon" });
    const current = await client.fetchLeaderboard(ticket.boardId);
    const legacy = await client.fetchLeaderboard("campaign:glass-horizon");
    expect(ticket.boardId).toBe("campaign:v2:glass-horizon");
    expect(current.entries).toEqual([]);
    expect(legacy.entries).toHaveLength(1);
  });
});

describe("verified leaderboard client credentials", () => {
  it("bootstraps once, persists the server identity, and maps its public row", async () => {
    const storage = new TestStorage();
    const actions: string[] = [];
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (init?.method === "GET") {
        return json({
          ok: true,
          leaderboard: {
            boardId: "campaign:v2:glass-horizon",
            status: "verified",
            entries: [
              {
                rank: 2,
                publicId: SERVER_PUBLIC_ID,
                callsign: "VECTOR",
                score: 12_000,
                durationMs: 15_000,
                achievedAt: "2026-07-31T12:00:00.000Z",
                status: "verified",
              },
            ],
            updatedAt: "2026-07-31T12:00:00.000Z",
          },
        });
      }
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      actions.push(String(body.action));
      if (url.endsWith("/identity")) return json(identityEnvelope(), 201);
      expect(body).toMatchObject({
        action: "ticket",
        clientId: SERVER_CLIENT_ID,
        credential: DEVICE_CREDENTIAL,
      });
      return json(ticketEnvelope(), 201);
    });

    const first = createLeaderboardClient({
      endpoint: ENDPOINT,
      fetch: fetchMock,
      storage,
      now: () => new Date("2026-07-31T12:00:00.000Z"),
    });
    expect(await first.issueTicket({ mode: "campaign", levelId: "glass-horizon" }))
      .toMatchObject({ status: "verified", ticketId: RUN_ID });

    const second = createLeaderboardClient({
      endpoint: ENDPOINT,
      fetch: fetchMock,
      storage,
      now: () => new Date("2026-07-31T12:00:00.000Z"),
    });
    expect(await second.issueTicket({ mode: "campaign", levelId: "glass-horizon" }))
      .toMatchObject({ status: "verified" });
    const board = await second.fetchLeaderboard("campaign:v2:glass-horizon");
    expect(board.entries[0]).toMatchObject({
      publicId: SERVER_PUBLIC_ID,
      isCurrentPlayer: true,
    });
    expect(actions).toEqual(["identity", "ticket", "ticket"]);
    expect(storage.values.get("vanta-pulse/device-identity/v1")).toContain(
      SERVER_CLIENT_ID,
    );
  });

  it("proactively rotates a device credential inside the 14-day window", async () => {
    const storage = new TestStorage();
    storage.setItem("vanta-pulse/device-identity/v1", JSON.stringify({
      ...identityEnvelope().identity,
      expiresAt: "2026-08-10T12:00:00.000Z",
    }));
    const rotatedCredential = "vp1.cm90YXRlZA.bmV3LXNpZw";
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      if (String(input).endsWith("/identity")) {
        expect(body).toEqual({ action: "identity", credential: DEVICE_CREDENTIAL });
        return json(identityEnvelope(rotatedCredential));
      }
      expect(body.credential).toBe(rotatedCredential);
      return json(ticketEnvelope(), 201);
    });
    const client = createLeaderboardClient({
      endpoint: ENDPOINT,
      fetch: fetchMock,
      storage,
      now: () => new Date("2026-07-31T12:00:00.000Z"),
    });

    expect(await client.issueTicket({ mode: "campaign", levelId: "glass-horizon" }))
      .toMatchObject({ status: "verified" });
    expect(storage.values.get("vanta-pulse/device-identity/v1")).toContain(
      rotatedCredential,
    );
  });

  it("renews an expired ticket without changing scope, then submits with server identity", async () => {
    const storage = new TestStorage();
    const actions: Array<Record<string, unknown>> = [];
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      actions.push(body);
      if (String(input).endsWith("/identity")) return json(identityEnvelope(), 201);
      if (String(input).endsWith("/ticket")) {
        return json(ticketEnvelope(RUN_ID, "2026-07-31T11:59:00.000Z"), 201);
      }
      if (String(input).endsWith("/renew")) {
        expect(body).toEqual({
          action: "renew",
          clientId: SERVER_CLIENT_ID,
          credential: DEVICE_CREDENTIAL,
          renewalCredential: RENEWAL_CREDENTIAL,
        });
        return json(ticketEnvelope(SECOND_RUN_ID, "2026-07-31T12:03:00.000Z"), 201);
      }
      expect(body).toMatchObject({
        action: "submit",
        submissionId: "018f4c2a-6f23-7d81-9b4e-c320ae0faaaa",
        ticketId: SECOND_RUN_ID,
        clientId: SERVER_CLIENT_ID,
        credential: DEVICE_CREDENTIAL,
      });
      return json({
        ok: true,
        result: {
          status: "verified",
          runId: "018f4c2a-6f23-7d81-9b4e-c320ae0faaaa",
          boardId: "campaign:v2:glass-horizon",
          score: 12_000,
          durationMs: 15_000,
          isPersonalBest: false,
          rank: 4,
          idempotent: false,
          submittedAt: "2026-07-31T12:00:00.000Z",
        },
      });
    });
    const client = createLeaderboardClient({
      endpoint: ENDPOINT,
      fetch: fetchMock,
      storage,
      now: () => new Date("2026-07-31T12:00:00.000Z"),
      randomUUID: () => CLIENT_ID,
    });
    const ticket = await client.issueTicket({ mode: "campaign", levelId: "glass-horizon" });
    const replay = {
      version: 1 as const,
      simulationVersion: ticket.simulationVersion,
      mode: ticket.mode,
      levelId: ticket.levelId,
      seed: ticket.seed,
      events: [],
    };
    const result = await client.submitRun(
      ticket,
      replay,
      { score: 12_000, durationMs: 15_000 },
      "018f4c2a-6f23-7d81-9b4e-c320ae0faaaa",
    );
    expect(result).toMatchObject({ status: "verified", rank: 4, isPersonalBest: false });
    expect(actions.map((action) => action.action)).toEqual([
      "identity",
      "ticket",
      "renew",
      "submit",
    ]);
  });

  it("renews and retries once when the server expires a ticket during upload", async () => {
    const storage = new TestStorage();
    const submittedTicketIds: unknown[] = [];
    const submittedIds: unknown[] = [];
    let submitAttempts = 0;
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      if (url.endsWith("/identity")) return json(identityEnvelope(), 201);
      if (url.endsWith("/ticket")) return json(ticketEnvelope(RUN_ID), 201);
      if (url.endsWith("/renew")) {
        return json(ticketEnvelope(SECOND_RUN_ID), 201);
      }
      submitAttempts += 1;
      submittedTicketIds.push(body.ticketId);
      submittedIds.push(body.submissionId);
      if (submitAttempts === 1) {
        return json({ ok: false, error: "ticket_expired" }, 410);
      }
      return json({
        ok: true,
        result: {
          status: "verified",
          runId: "018f4c2a-6f23-7d81-9b4e-c320ae0fbbbb",
          boardId: "campaign:v2:glass-horizon",
          score: 10_000,
          durationMs: 16_000,
          isPersonalBest: true,
          rank: 2,
          idempotent: false,
          submittedAt: "2026-07-31T12:00:00.000Z",
        },
      });
    });
    const client = createLeaderboardClient({
      endpoint: ENDPOINT,
      fetch: fetchMock,
      storage,
      now: () => new Date("2026-07-31T12:00:00.000Z"),
    });
    const ticket = await client.issueTicket({ mode: "campaign", levelId: "glass-horizon" });
    const replay = {
      version: 1 as const,
      simulationVersion: ticket.simulationVersion,
      mode: ticket.mode,
      levelId: ticket.levelId,
      seed: ticket.seed,
      events: [],
    };
    const submissionId = "018f4c2a-6f23-7d81-9b4e-c320ae0fbbbb";

    expect(await client.submitRun(
      ticket,
      replay,
      { score: 10_000, durationMs: 16_000 },
      submissionId,
    )).toMatchObject({ status: "verified", rank: 2 });
    expect(submittedTicketIds).toEqual([RUN_ID, SECOND_RUN_ID]);
    expect(submittedIds).toEqual([submissionId, submissionId]);
    expect(submitAttempts).toBe(2);
  });

  it("coordinates simultaneous empty-storage bootstrap across client instances", async () => {
    const storage = new TestStorage();
    let identityRequests = 0;
    let ticketRequests = 0;
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      if (String(input).endsWith("/identity")) {
        identityRequests += 1;
        await Promise.resolve();
        return json(identityEnvelope(), 201);
      }
      ticketRequests += 1;
      const ticketId = ticketRequests === 1 ? RUN_ID : SECOND_RUN_ID;
      return json(ticketEnvelope(ticketId), 201);
    });
    const options = {
      endpoint: ENDPOINT,
      fetch: fetchMock,
      storage,
      now: () => new Date("2026-07-31T12:00:00.000Z"),
    } as const;
    const first = createLeaderboardClient(options);
    const second = createLeaderboardClient(options);

    const tickets = await Promise.all([
      first.issueTicket({ mode: "campaign", levelId: "glass-horizon" }),
      second.issueTicket({ mode: "campaign", levelId: "glass-horizon" }),
    ]);
    expect(tickets.every((ticket) => ticket.status === "verified")).toBe(true);
    expect(identityRequests).toBe(1);
    expect(ticketRequests).toBe(2);
  });
});
