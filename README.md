# AEGIS

**One thumb. One shield. Deflect everything.**

A one-thumb ring-defense arcade game with a Guardian collection. You defend a
single point at the centre of the screen. Everything converges on it. Nothing
you block is wasted — it becomes the shot that kills the next one.

Runs last one to two minutes. Then you spend what you earned on the thing the
game is really about: pulling for Guardians.

```bash
npm install
npm run dev          # http://localhost:5173
```

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server with hot reload |
| `npm run build` | Type-check, then production build into `dist/` |
| `npm run preview` | Serve the production build |
| `npm test` | 117 unit tests (gacha, combat, economy, engine) |
| `npm run balance` | Headless balance simulation — see [Balance](#balance) |
| `npm run smoke` | Build, serve, and drive the whole game in a real browser |
| `npm run typecheck` | `tsc --noEmit` |

No backend. No accounts. Save data lives in `localStorage` and can be exported
as a code from Settings.

---

## The game

### Two verbs

**AIM** — drag anywhere. A shield arc follows your thumb's angle around the
nexus. Contact anywhere on the arc **blocks**; contact near the arc's centre is
a **PERFECT**, worth double and enough to break armour.

**PULSE** — tap. A ring sweeps out from the nexus. Anything it touches is
**PARRIED**, at any angle. So the shield is a *positioning* tool and the pulse
is a *timing* tool, and catching a cluster at the shield radius is the highest
value play in the game.

Everything you block flies back out and kills what it hits. **Chains** are where
the big scores come from, and why a good defensive turn snowballs.

### The pressure

Six threat archetypes, each asking a different question. Orbs test coverage,
Lancers test speed, Splitters test the aftermath, Bulwarks cannot be blocked
head-on, Seekers steer toward whichever side you are *not* covering, and the
Warden — the boss on every fifth wave — is armoured, fires its own volleys, and
sheds a ring of orbs when it falls.

Combo multiplies everything, up to 12x. At 30 combo you enter **Overdrive** and
the whole arena turns gold at double score. Taking damage breaks the chain — in
Overdrive you keep part of it, because losing a 40-combo to one mistake is how
you make people stop playing.

### The collection

Sixteen Guardians across five rarities. Each one changes how the game *feels*,
not just a number: shield arc width, turn speed, parry window, deflection force,
integrity, and one of ten Ultimates. The highest-skill option in the game — a
razor arc that parries wide — sits at Rare on purpose.

---

## Architecture

```
src/
├─ core/       loop, input, RNG, storage, events, maths      (no DOM assumptions)
├─ render/     renderer + bloom, texture store, particles, camera, palette
├─ audio/      synthesis engine, adaptive score, haptics
├─ game/       simulation, wave director, VFX, HUD, coaching  (no DOM at all)
├─ meta/       profile, gacha, IAP scaffolding, share card
├─ ui/         DOM screens over the live arena
├─ data/       every tuning number, in one place
└─ app/        the shell that owns all of it
```

Four boundaries do most of the work:

**Simulation knows nothing about rendering.** `GameSession` has no DOM
dependency at all, which is why the entire combat model can be unit tested at a
fixed timestep and why `npm run balance` can play hundreds of runs in seconds.

**Gameplay emits facts; everything else listens.** Combat does not know that
audio, VFX, quests or analytics exist. It emits `hit`, `parry`, `bossKilled`,
and those systems subscribe. Delete `Vfx.ts` and the game still plays
identically — it just feels dead.

**Every drawn thing resolves a texture key.** See [Sprites](#sprites).

**Every tuning number lives in `data/`.** Balance can be iterated, diffed, and
eventually driven from a remote config without reading a line of logic.

### Rendering

Canvas2D looks flat on its own, so there is a real post chain: emissive shapes
are drawn a second time into a half-resolution buffer, blurred, and composited
back additively for bloom, then the scene is presented with camera shake, a
chromatic split on heavy hits, a vignette and film grain. Quality drops
automatically if the device cannot hold the frame budget.

The HUD is drawn on the canvas rather than in the DOM so it shares the bloom and
the camera shake. A HUD that sits perfectly still while the world shakes reads
immediately as a separate, cheaper layer.

### Audio

Everything is synthesised at runtime — no sample files, so the bundle stays
small and nothing needs licensing. A 16-step sequencer runs on the AudioContext
clock with lookahead scheduling and six layers that fade in with an intensity
value driven by wave, combo and Overdrive.

The single most important detail: **consecutive hits climb a pentatonic
ladder.** A combo is audibly a melody going up, and losing it is audibly a fall.

---

## Sprites

The game ships complete with procedurally generated art, and it is built to have
that art replaced without touching gameplay, UI or VFX code.

**Read [`docs/SPRITES.md`](docs/SPRITES.md) before drawing anything** — it lists
every texture key, its exact frame size, its anchor and its facing.

The short version: every draw call resolves a *key* like `guardian/eclipse/portrait`
or `threat/lancer`. Today those keys are produced by `render/procgen.ts`. Drop a
TexturePacker atlas at `public/assets/atlas.json` and `TextureStore.loadAtlas`
overrides the same keys with real frames at boot. Nothing else changes.

---

## Monetisation

No real money moves in this build. What exists is the *shape* of a real store:
a `PurchaseProvider` interface, an entitlement model, a currency ledger, and a
mock provider that completes instantly, charges nothing, and says so in the UI.
See [`docs/MONETISATION.md`](docs/MONETISATION.md) to connect a real one.

The gacha is implemented honestly, and that is a product decision rather than a
compromise:

- Published rates are read from the same config the roll uses, so the numbers on
  the Rates screen cannot drift from the numbers in the code.
- Soft pity from summon 61, hard pity at 90, an Epic floor every 10 and a
  Legendary floor every 20 — all stated on the Rates screen, alongside a
  *simulated* average cost per Mythic, because "0.7%" alone is technically true
  and practically misleading.
- The RNG stream is persisted and advanced, so a pull cannot be re-rolled by
  reloading, and any result can be reproduced from its recorded state.
- Rates never vary by spend, session length or account age.
- Duplicates always convert to Shards and star progress. No summon is ever worth
  nothing.
- Nothing purchasable changes summon rates or gates gameplay content.

---

## Balance

`npm run balance` plays hundreds of headless runs with a scripted bot at three
skill levels and reports the wave distribution, run lengths, an economy
projection, and a per-Guardian comparison.

```
npm run balance                          # all three skill levels
npm run balance -- --runs 400 --roster   # deeper, plus the Guardian table
npm run balance -- --skill expert
```

Current shape:

| Skill | Median wave | Median run | Met a Warden |
| --- | --- | --- | --- |
| novice | 9 | 57s | 98% |
| average | 13 | 82s | 100% |
| expert | 17 | 108s | 100% |

The harness has already earned its place. Its first report showed a median run
length equal to the harness cap — runs were not ending at all — which turned out
to be two independent soft-locks and one Ultimate that recharged itself.

---

## Accessibility

Screen shake, full-screen flashes and chromatic aberration are exactly the
effects that make this game feel good and exactly the effects that make some
people unable to play it, so they are the *first* settings, not the last:
shake is a 0-100% slider, flashes and chromatic split can be reduced, the HUD
mirrors for left-handed play, and `prefers-reduced-motion` is honoured
throughout the UI.

The whole game is playable with a keyboard: `A`/`D` or arrows to aim, `Space` to
pulse, `Shift`/`Q` for the Ultimate, `Esc` to pause.

---

## Testing

- **117 unit tests** across gacha guarantees, combat mechanics, the wallet and
  save migration, and the engine primitives. The gacha suite asserts every
  published guarantee, including the 50/50 and its make-good.
- **`npm run balance`** for systemic behaviour over hundreds of runs.
- **`npm run smoke`** drives a real Chromium at phone size: claims the daily
  reward, plays a run with an autopilot, performs a ten-pull, opens every
  screen, renders the share card, and fails on any console error. Screenshots
  land in `tools/shots/`.

---

## Status

Complete and playable end to end: gameplay, progression, collection, summoning,
shop, daily loop, coaching, share card, audio, settings and save transfer.

Not built yet, and deliberately: a backend, leaderboards, real payments, and the
sprite art itself.
