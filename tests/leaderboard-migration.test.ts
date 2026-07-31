import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260731134500_vanta_pulse_leaderboard.sql",
  ),
  "utf8",
).toLowerCase();
const hardeningMigration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260731144500_vanta_pulse_credential_hardening.sql",
  ),
  "utf8",
).toLowerCase();

describe("verified leaderboard migration security invariants", () => {
  it("enables and forces RLS on every exposed leaderboard table", () => {
    for (const table of [
      "vanta_pulse_run_tickets",
      "vanta_pulse_runs",
      "vanta_pulse_best_scores",
    ]) {
      expect(migration).toContain(`alter table public.${table} enable row level security`);
      expect(migration).toContain(`alter table public.${table} force row level security`);
      expect(migration).toContain(`revoke all on table public.${table}`);
    }
  });

  it("keeps commits service-role-only and runs append-only", () => {
    expect(migration).toContain("vanta_pulse_runs_reject_mutation");
    expect(migration).toContain(
      "revoke all on table public.vanta_pulse_runs from service_role",
    );
    expect(migration).toContain("grant execute on function public.vanta_pulse_commit_run");
    expect(migration).toContain(") to service_role;");
    expect(migration).not.toMatch(
      /grant\s+execute\s+on\s+function\s+public\.vanta_pulse_commit_run[\s\S]*?to\s+(anon|authenticated)/,
    );
  });

  it("locks ticket consumption and serializes idempotency keys", () => {
    expect(migration).toContain("for update;");
    expect(migration).toContain("vanta-pulse:submission:");
    expect(migration).toContain("verification_attempts >= 3");
  });

  it("keeps forward migration versions unique", () => {
    const versions = readdirSync(resolve(process.cwd(), "supabase/migrations"))
      .filter((name) => name.endsWith(".sql"))
      .map((name) => name.split("_")[0]);
    expect(new Set(versions).size).toBe(versions.length);
  });

  it("uses the signed device identity instead of network location at submission", () => {
    expect(hardeningMigration).toContain(
      "if not found or v_ticket.client_id <> p_client_id then",
    );
    expect(hardeningMigration).not.toContain(
      "v_ticket.requester_hash <> p_requester_hash",
    );
    expect(hardeningMigration).toContain(
      "grant execute on function vanta_pulse_private.begin_submission",
    );
  });

  it("always ranks the player's incumbent best row, including a non-PB run", () => {
    expect(hardeningMigration).toContain(
      "v_is_personal_best := v_best.run_id = p_submission_id",
    );
    expect(hardeningMigration.match(/select 1 \+ count\(\*\)/g)).toHaveLength(2);
    expect(hardeningMigration).toContain("best.score > v_best.score");
    expect(hardeningMigration).not.toContain("if v_is_personal_best then");
    expect(hardeningMigration).toContain("'rank', v_rank");
  });
});
