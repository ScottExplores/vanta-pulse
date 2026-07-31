# VANTA//PULSE

An original neon rhythm-platformer for the browser. One input pilots a signal courier—and later its two delayed echoes—through a deterministic lattice of rails, fractures, shutters, membranes, and portals.

**[Play VANTA//PULSE](https://vanta-pulse.vercel.app/)**

## Highlights

- Three handcrafted campaigns, a date-seeded Daily Rift, and seeded Endless runs
- Deterministic 120 Hz simulation with replay recording and server-side replay verification
- Global personal-best leaderboards with expiring run tickets, signed device credentials, rate limits, idempotent submission, forced RLS, and RPC-only database writes
- Custom PixiJS/WebGL post-processing: chromatic separation, scan texture, glitch bursts, glow geometry, parallax, particles, and responsive quality scaling
- Original procedural Web Audio score and event-reactive sound design
- Keyboard, pointer, touch, gamepad, pause, instant restart, tutorial, cosmetics, and persistent progress
- Reduced-motion, photosafe, high-contrast, volume mixing, keyboard focus management, and renderer safe mode
- Responsive desktop, tablet, mobile, and landscape layouts

## Controls

| Action | Input |
| --- | --- |
| Phase jump / hold | Space, W, Arrow Up, pointer, touch, or gamepad face button |
| Pause / resume | Escape or P |
| Quick restart | R |

## Local development

```bash
npm install
npm run dev
```

The game remains fully playable with local records when `VITE_LEADERBOARD_URL` is omitted. Copy `.env.example` and set the public Supabase Edge Function URL to enable verified global rankings.

## Quality gates

```bash
npm run typecheck
npm test
npm run test:coverage
npm run build
npm audit
```

To regenerate optimized WebP backdrops and the social share card from the retained master art:

```bash
npm run optimize:art
```

To exercise deployed identity bootstrap, same-scope renewal, replay verification,
submit, and privacy-safe fetch, explicitly opt into the operator smoke write:

```bash
$env:VANTA_PULSE_LEADERBOARD_URL="https://ktdruljunithwopizorq.supabase.co/functions/v1/vanta-pulse-leaderboard"
$env:VANTA_PULSE_RUN_LIVE_SMOKE="1"
npm run smoke:leaderboard
```

## Architecture

- `src/game/sim`: pure integer-tick simulation, replay, checksum, and verifier
- `src/game/runtime`: fixed-step clock, timing guard, HUD and render projections
- `src/game/view`: Pixi renderer, vector stage art, adaptive effects, and custom GLSL
- `src/game/audio`: original procedural music and sound director
- `src/features/leaderboard`: verified/local client with signed identity persistence and offline fallback
- `supabase/functions`: public Edge API and mirrored server verifier
- `supabase/migrations`: deny-by-default schema, append-only runs, personal-best indexes, and audited RPCs
- `design`: ImageGen concept references, visual specification, and retained source art

## Score integrity

The browser never writes leaderboard tables. It requests a short-lived ticket bound to a server-signed device identity, records input edges, and submits the replay. The Edge Function reconstructs the exact level, re-simulates every tick, validates completion/checksum/score, and only then invokes service-role-only database RPCs. Public leaderboard responses expose only HMAC-derived pseudonyms, never private device or run identifiers. “Verified” means simulation-valid; it is not proof that a human generated the input stream.

VANTA//PULSE is an original work. It uses generic one-button precision-running conventions and does not contain Geometry Dash assets, characters, level layouts, branding, or trade dress.
