/// <reference path="../supabase/functions/vanta-pulse-leaderboard/deno-globals.d.ts" />

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GLASS_HORIZON } from "../src/game/content";
import { SIMULATION_VERSION, verifyReplay } from "../src/game/sim";
import { createReferenceReplay } from "./helpers/referenceReplay";

const environment = new Map<string, string>();
let handler: ((request: Request) => Response | Promise<Response>) | undefined;
const fetchMock = vi.fn<typeof fetch>();

interface IssuedIdentity {
  clientId: string;
  publicId: string;
  credential: string;
  expiresAt: string;
}

const post = async (path: string, body: Record<string, unknown>, headers?: HeadersInit) =>
  handler!(
    new Request(`https://edge.example/functions/v1/vanta-pulse-leaderboard${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://game.example",
        ...Object.fromEntries(new Headers(headers)),
      },
      body: JSON.stringify(body),
    }),
  );

const issueIdentity = async (): Promise<IssuedIdentity> => {
  const response = await post("/identity", { action: "identity" });
  expect(response.status).toBe(201);
  const envelope = await response.json() as { identity: IssuedIdentity };
  return envelope.identity;
};

beforeAll(async () => {
  vi.stubGlobal("Deno", {
    env: { get: (name: string) => environment.get(name) },
    serve: (nextHandler: typeof handler) => {
      handler = nextHandler;
    },
  });
  vi.stubGlobal("fetch", fetchMock);
  await import("../supabase/functions/vanta-pulse-leaderboard/index.ts");
  expect(handler).toBeTypeOf("function");
});

beforeEach(() => {
  environment.clear();
  environment.set("SUPABASE_URL", "https://project.supabase.co");
  environment.set("SUPABASE_SECRET_KEYS", JSON.stringify({ default: "sb_secret_test_key" }));
  environment.set("VANTA_PULSE_ALLOWED_ORIGINS", "https://game.example");
  environment.set("VANTA_PULSE_RATE_LIMIT_SECRET", "r".repeat(32));
  environment.set("VANTA_PULSE_DEVICE_CREDENTIAL_SECRET", "d".repeat(32));
  fetchMock.mockReset();
});

describe("leaderboard Edge boundary", () => {
  it("returns pseudonymous verified scores without raw database identifiers", async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json([
        {
          best_score_id: 1,
          board_id: "campaign:v2:glass-horizon",
          client_id: "018f4c2a-6f23-7d81-9b4e-c320ae0f1234",
          callsign: "VECTOR",
          score: "12000",
          duration_ms: 15000,
          achieved_at: "2026-07-31T12:00:00.000Z",
        },
      ]),
    );

    const response = await handler!(
      new Request(
        "https://edge.example/functions/v1/vanta-pulse-leaderboard?boardId=campaign%3Av2%3Aglass-horizon",
        { headers: { Origin: "https://game.example" } },
      ),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("https://game.example");
    const envelope = await response.json() as Record<string, unknown>;
    expect(envelope).toMatchObject({
      leaderboard: {
        status: "verified",
        entries: [{ rank: 1, callsign: "VECTOR", score: 12_000 }],
      },
    });
    const serialized = JSON.stringify(envelope);
    expect(serialized).toMatch(/"publicId":"vp_[0-9a-f]{24}"/);
    expect(serialized).not.toContain("clientId");
    expect(serialized).not.toContain("runId");
    expect(serialized).not.toContain("018f4c2a-6f23-7d81-9b4e-c320ae0f1234");

    const [, init] = fetchMock.mock.calls[0] ?? [];
    const headers = new Headers(init?.headers);
    expect(headers.get("apikey")).toBe("sb_secret_test_key");
    expect(headers.has("Authorization")).toBe(false);
  });

  it("retains legacy service-role JWT compatibility", async () => {
    environment.delete("SUPABASE_SECRET_KEYS");
    environment.set("SUPABASE_SERVICE_ROLE_KEY", "legacy.jwt.service-role");
    fetchMock.mockResolvedValueOnce(Response.json([]));

    const response = await handler!(
      new Request(
        "https://edge.example/functions/v1/vanta-pulse-leaderboard?boardId=campaign%3Av2%3Aphase-bloom",
      ),
    );
    expect(response.status).toBe(200);
    const [, init] = fetchMock.mock.calls[0] ?? [];
    const headers = new Headers(init?.headers);
    expect(headers.get("Authorization")).toBe("Bearer legacy.jwt.service-role");
  });

  it("uses a deny-by-default browser-origin fallback while allowing non-browser calls", async () => {
    environment.delete("VANTA_PULSE_ALLOWED_ORIGINS");
    const blocked = await handler!(
      new Request("https://edge.example/functions/v1/vanta-pulse-leaderboard", {
        method: "OPTIONS",
        headers: { Origin: "https://attacker.example" },
      }),
    );
    expect(blocked.status).toBe(403);

    const allowed = await handler!(
      new Request("https://edge.example/functions/v1/vanta-pulse-leaderboard", {
        method: "OPTIONS",
        headers: { Origin: "https://vanta-pulse.vercel.app" },
      }),
    );
    expect(allowed.status).toBe(204);
    expect(allowed.headers.get("Access-Control-Allow-Origin")).toBe(
      "https://vanta-pulse.vercel.app",
    );

    const identity = await handler!(
      new Request("https://edge.example/functions/v1/vanta-pulse-leaderboard/identity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "identity" }),
      }),
    );
    expect(identity.status).toBe(201);
  });

  it("rejects oversized control payloads before touching PostgREST", async () => {
    const response = await post("/ticket", {
      action: "ticket",
      padding: "x".repeat(3_000),
    });
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ ok: false, error: "payload_too_large" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("issues and refreshes a signed device credential without accepting a chosen UUID", async () => {
    const identity = await issueIdentity();
    expect(identity.clientId).toMatch(/^[0-9a-f-]{36}$/);
    expect(identity.publicId).toMatch(/^vp_[0-9a-f]{24}$/);
    expect(identity.credential).toMatch(/^vp1\./);

    const refreshed = await post("/identity", {
      action: "identity",
      credential: identity.credential,
    });
    expect(refreshed.status).toBe(200);
    expect(await refreshed.json()).toMatchObject({
      identity: { clientId: identity.clientId, publicId: identity.publicId },
    });

    const mismatch = await post("/ticket", {
      action: "ticket",
      clientId: "018f4c2a-6f23-7d81-9b4e-c320ae0f9999",
      credential: identity.credential,
      mode: "campaign",
      levelId: "glass-horizon",
      simulationVersion: SIMULATION_VERSION,
    });
    expect(mismatch.status).toBe(401);
    expect(await mismatch.json()).toEqual({ ok: false, error: "identity_mismatch" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects legacy physics tickets before issuing a run", async () => {
    const identity = await issueIdentity();
    const response = await post("/ticket", {
      action: "ticket",
      clientId: identity.clientId,
      credential: identity.credential,
      mode: "campaign",
      levelId: "glass-horizon",
      simulationVersion: 1,
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, error: "invalid_ticket_request" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("HMACs public IDs and refreshes through the configured previous key", async () => {
    environment.set("VANTA_PULSE_DEVICE_CREDENTIAL_SECRET", "a".repeat(32));
    const original = await issueIdentity();

    environment.set("VANTA_PULSE_DEVICE_CREDENTIAL_SECRET", "b".repeat(32));
    environment.set("VANTA_PULSE_DEVICE_CREDENTIAL_PREVIOUS_SECRET", "a".repeat(32));
    const response = await post("/identity", {
      action: "identity",
      credential: original.credential,
    });
    expect(response.status).toBe(200);
    const refreshed = (await response.json() as { identity: IssuedIdentity }).identity;
    expect(refreshed.clientId).toBe(original.clientId);
    expect(refreshed.publicId).toMatch(/^vp_[0-9a-f]{24}$/);
    expect(refreshed.publicId).not.toBe(original.publicId);
    expect(refreshed.credential).not.toBe(original.credential);
  });

  it("renews only the server-signed scope and preserves an endless seed", async () => {
    const identity = await issueIdentity();
    const issuedScopes: Array<Record<string, unknown>> = [];
    fetchMock.mockImplementation(async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      issuedScopes.push(body);
      return Response.json({
        ticket_id: body.p_ticket_id,
        expires_at: new Date(Date.now() + 180_000).toISOString(),
      });
    });

    const ticketResponse = await post("/ticket", {
      action: "ticket",
      clientId: identity.clientId,
      credential: identity.credential,
      mode: "endless",
      segmentCount: 64,
      simulationVersion: SIMULATION_VERSION,
    });
    expect(ticketResponse.status).toBe(201);
    const ticketEnvelope = await ticketResponse.json() as {
      ticket: Record<string, unknown>;
    };
    expect(ticketEnvelope.ticket.renewalCredential).toMatch(/^vp1\./);

    const renewResponse = await post("/renew", {
      action: "renew",
      clientId: identity.clientId,
      credential: identity.credential,
      renewalCredential: ticketEnvelope.ticket.renewalCredential,
    });
    expect(renewResponse.status).toBe(201);
    const renewEnvelope = await renewResponse.json() as { ticket: Record<string, unknown> };
    expect(renewEnvelope.ticket).toMatchObject({
      boardId: ticketEnvelope.ticket.boardId,
      mode: "endless",
      levelId: ticketEnvelope.ticket.levelId,
      seed: ticketEnvelope.ticket.seed,
      renewalCredential: ticketEnvelope.ticket.renewalCredential,
      renewalExpiresAt: ticketEnvelope.ticket.renewalExpiresAt,
    });
    expect(issuedScopes).toHaveLength(2);
    expect(issuedScopes[1]).toMatchObject({
      p_client_id: identity.clientId,
      p_board_id: issuedScopes[0]?.p_board_id,
      p_level_id: issuedScopes[0]?.p_level_id,
      p_seed: issuedScopes[0]?.p_seed,
    });
    expect(issuedScopes[1]?.p_ticket_id).not.toBe(issuedScopes[0]?.p_ticket_id);
  });

  it("re-simulates an authenticated replay before committing its authoritative score", async () => {
    const identity = await issueIdentity();
    const replay = createReferenceReplay(GLASS_HORIZON);
    const verified = verifyReplay({
      boardId: "campaign:v2:glass-horizon",
      mode: replay.mode,
      levelId: replay.levelId,
      seed: replay.seed,
      replay,
      simulationVersion: SIMULATION_VERSION,
    });
    expect(verified.valid).toBe(true);

    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input);
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      if (url.endsWith("/rpc/vanta_pulse_begin_submission")) {
        expect(body.p_client_id).toBe(identity.clientId);
        return Response.json({
          board_id: "campaign:v2:glass-horizon",
          mode: "campaign",
          level_id: "glass-horizon",
          seed: GLASS_HORIZON.seed,
          simulation_version: SIMULATION_VERSION,
        });
      }
      if (url.endsWith("/rpc/vanta_pulse_commit_run")) {
        expect(body).toMatchObject({
          p_client_id: identity.clientId,
          p_callsign: "NEONFOX",
          p_mode: "campaign",
          p_level_id: "glass-horizon",
          p_seed: GLASS_HORIZON.seed,
          p_score: verified.score,
          p_duration_ms: verified.durationMs,
          p_completion_ticks: verified.completionTicks,
          p_simulation_checksum: verified.checksum,
        });
        expect(body.p_replay_hash).toMatch(/^[0-9a-f]{64}$/);
        return Response.json({
          run_id: "018f4c2a-6f23-7d81-9b4e-c320ae0f5678",
          board_id: "campaign:v2:glass-horizon",
          score: verified.score,
          duration_ms: verified.durationMs,
          is_personal_best: false,
          rank: 4,
          idempotent: false,
          submitted_at: "2026-07-31T12:00:00.000Z",
        });
      }
      return Response.json({ message: "unexpected_rpc" }, { status: 500 });
    });

    const response = await post(
      "/submit",
      {
        action: "submit",
        submissionId: "018f4c2a-6f23-7d81-9b4e-c320ae0f5678",
        ticketId: "018f4c2a-6f23-7d81-9b4e-c320ae0f9abc",
        clientId: identity.clientId,
        credential: identity.credential,
        callsign: "neon fox",
        replay,
      },
      { "x-forwarded-for": "203.0.113.7" },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      result: {
        status: "verified",
        score: verified.score,
        rank: 4,
        isPersonalBest: false,
      },
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
