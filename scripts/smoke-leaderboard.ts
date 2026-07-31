import { createEndlessLevel } from "../src/game/content";
import { createReferenceReplay } from "../tests/helpers/referenceReplay";

const endpoint = process.env.VANTA_PULSE_LEADERBOARD_URL ??
  "https://ktdruljunithwopizorq.supabase.co/functions/v1/vanta-pulse-leaderboard";
const submissionId = crypto.randomUUID();
const segmentCount = 128;

if (process.env.VANTA_PULSE_RUN_LIVE_SMOKE !== "1") {
  throw new Error(
    "This smoke test writes one verified score. Set VANTA_PULSE_RUN_LIVE_SMOKE=1 to continue.",
  );
}

const requestJson = async (url: string, init?: RequestInit) => {
  const response = await fetch(url, init);
  const body: unknown = await response.json();
  if (!response.ok) throw new Error(`${response.status} ${JSON.stringify(body)}`);
  return body as Record<string, unknown>;
};

const post = (path: string, body: Record<string, unknown>) =>
  requestJson(`${endpoint}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

const identityEnvelope = await post("/identity", { action: "identity" });
const identity = identityEnvelope.identity as {
  clientId: string;
  publicId: string;
  credential: string;
};
if (!identity.clientId || !identity.publicId || !identity.credential) {
  throw new Error("Identity bootstrap returned an invalid response");
}

const ticketEnvelope = await post("/ticket", {
  action: "ticket",
  clientId: identity.clientId,
  credential: identity.credential,
  mode: "endless",
  segmentCount,
  simulationVersion: 1,
});

const originalTicket = ticketEnvelope.ticket as {
  ticketId: string;
  seed: number;
  levelId: string;
  boardId: string;
  renewalCredential: string;
  renewalExpiresAt: string;
};
const level = createEndlessLevel(originalTicket.seed, segmentCount);
if (level.id !== originalTicket.levelId || originalTicket.boardId !== `endless:${segmentCount}`) {
  throw new Error("Ticket content does not match the deterministic level generator");
}

// Exercise the same-scope lease explicitly, even though the first DB ticket is
// normally still fresh when this operator-only reference replay is generated.
const renewalEnvelope = await post("/renew", {
  action: "renew",
  clientId: identity.clientId,
  credential: identity.credential,
  renewalCredential: originalTicket.renewalCredential,
});
const ticket = renewalEnvelope.ticket as typeof originalTicket;
if (
  ticket.seed !== originalTicket.seed ||
  ticket.levelId !== originalTicket.levelId ||
  ticket.boardId !== originalTicket.boardId ||
  ticket.renewalCredential !== originalTicket.renewalCredential ||
  ticket.renewalExpiresAt !== originalTicket.renewalExpiresAt
) {
  throw new Error("Renewal changed the signed run scope");
}

const replay = createReferenceReplay(level);
const submitEnvelope = await post("/submit", {
  action: "submit",
  submissionId,
  ticketId: ticket.ticketId,
  clientId: identity.clientId,
  credential: identity.credential,
  callsign: "LAUNCHBOT",
  replay,
});

const leaderboard = await requestJson(
  `${endpoint}?boardId=${encodeURIComponent(ticket.boardId)}&limit=5`,
);
const publicPayload = JSON.stringify(leaderboard);
if (publicPayload.includes("clientId") || publicPayload.includes("runId")) {
  throw new Error("Public leaderboard leaked a private database identifier");
}

console.log(JSON.stringify({
  identity: { publicId: identity.publicId },
  ticket: { boardId: ticket.boardId, levelId: ticket.levelId },
  submitted: submitEnvelope.result,
  leaderboard: leaderboard.leaderboard,
}, null, 2));
