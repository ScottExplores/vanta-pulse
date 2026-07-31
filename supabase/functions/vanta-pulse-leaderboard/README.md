# VANTA//PULSE verified leaderboard

This public Edge Function is the only browser-facing leaderboard boundary. It issues a signed anonymous device identity, mints short-lived run tickets, renews the exact signed run scope when needed, re-simulates the submitted 120 Hz input replay, and commits verified results through service-role-only database RPCs.

## Hosted configuration

- `SUPABASE_URL` — injected automatically by hosted Edge Functions
- `SUPABASE_SECRET_KEYS` — injected automatically; the `default` secret key is preferred
- `SUPABASE_SERVICE_ROLE_KEY` — legacy fallback for older projects
- `VANTA_PULSE_DEVICE_CREDENTIAL_SECRET` — optional independent HMAC key, at least 32 random characters; the injected server-only Supabase secret is the safe fallback
- `VANTA_PULSE_DEVICE_CREDENTIAL_PREVIOUS_SECRET` — optional previous HMAC key during rotation
- `VANTA_PULSE_RATE_LIMIT_SECRET` — optional independent requester-hash key, at least 32 random characters; the injected server-only Supabase secret is the safe fallback
- `VANTA_PULSE_ALLOWED_ORIGINS` — optional comma-separated exact browser origins; the source fallback contains only the production game and explicit local QA origins

Never expose any service or HMAC secret through a `VITE_` environment variable.

When rotating a dedicated credential key, move the old value into `VANTA_PULSE_DEVICE_CREDENTIAL_PREVIOUS_SECRET`, deploy the new current value, and retain the previous key for the maximum outstanding device-credential lifetime plus clock skew. Clients proactively refresh credentials near expiry.

## API

- `GET ?boardId=campaign:v2:glass-horizon&limit=25` — public personal-best rows using keyed public aliases; raw client and run UUIDs are never returned
- `POST /identity` — create or refresh a server-signed anonymous device identity
- `POST /ticket` — issue a three-minute database ticket and a two-hour signed same-run renewal lease
- `POST /renew` — mint a new database ticket for the exact signed board/mode/level/seed/simulation version
- `POST /submit` — authenticate the device, replay the input trace, and atomically commit the result

The same operations accept `action: "identity" | "ticket" | "renew" | "submit"` at the base function URL. Control requests are bounded to 2 KiB and submissions to 96 KiB. A submit result’s `rank` is always the device’s current personal-best rank, including when the submitted run did not improve that PB.

## Integrity model

“Verified” means the server rebuilt the authoritative level and confirmed that the submitted input replay deterministically completes it with the claimed score/checksum. The protocol prevents direct table writes, score tampering, UUID impersonation, replay-scope mutation, ticket reuse, and accidental duplicate commits. It does not prove a human generated the inputs; browser games need separate challenge, anomaly, or moderation systems for that stronger claim.

New identities cannot bypass the database ticket limits, which are enforced per requester and per server-authenticated client. Operators should still monitor Sybil/anomaly patterns on high-value competitive boards.

## Authoritative source mirror

`authoritative/` mirrors the pure modules under `src/game/{sim,content}`. Keeping the mirror inside the function directory is intentional: Dashboard and MCP deployments can otherwise omit imports outside the Edge Function bundle. When simulation rules change, update both copies and increment `SIMULATION_VERSION`; old tickets then fail closed.

The browser remains fully playable when the Edge URL is absent. Local entries are explicitly labeled `local`; only server-replayed entries are `verified`.
