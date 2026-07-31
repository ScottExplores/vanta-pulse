# VANTA//PULSE visual specification

## Creative direction

VANTA//PULSE is a kinetic light-runner through a collapsing signal lattice. The visual hierarchy is strict: hazards and rails are mathematically crisp; the background is atmospheric; effects celebrate input and never obscure collision silhouettes.

## Design tokens

- Void: `#03040a`
- Void raised: `#08111a`
- Electric cyan: `#37f5ff`
- Hot magenta: `#ff2bd6`
- Acid lime: `#c8ff4a`
- Cool white: `#f6fbff`
- Muted blue-gray: `#7890a0`
- Typography: Orbitron for display; Space Grotesk Variable for UI and data
- Rules and corners: clipped 45-degree geometry, 1px luminous borders, restrained glass fill
- Motion: 160–240 ms UI transitions; beat-synchronous world pulses; reduced-motion alternative required

## Primary states

- Menu: centered eclipse and title, one dominant Run action, three-level campaign rail, one supporting Global Signal leaderboard, bottom utility strip.
- Gameplay: thin progress rail, score/flow left, pause/audio right, input hint only before first action, collision-readable neon stage.
- Results: grade and score first, timing breakdown and prisms second, retry receives default focus.
- Mobile: game canvas retains a 16:9 canonical viewport; menus collapse to a scrollable single rail without hiding Run.

## Production-art policy

Generated raster art supplies the level backdrops, concept references, and the six-pose Vanta courier atlas. The courier artwork is animation-only and pins to the deterministic 42x42 collision box through a shared contact baseline; a code-native vector courier remains the resilient loading fallback. Rails, hazards, portals, particles, and shader masks stay mathematically crisp, reactive, and resolution-independent.
