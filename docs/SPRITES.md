# Sprite integration

The game ships with procedurally generated art so it is complete and playable
today. That art is a **placeholder with a contract**, not a stand-in to be
worked around: every silhouette, size, anchor and facing listed here is what the
gameplay code already assumes.

Match the contract and real sprites drop in with **zero code changes**.

---

## How it works

Nothing in the game references an image. Everything resolves a **texture key**:

```ts
textures.draw(ctx, 'threat/lancer', x, y, { rotation, scale });
```

A key resolves through `TextureStore`:

1. If an atlas has been loaded and contains the key → that frame is used.
2. Otherwise → the procedural generator registered for that key runs once and
   its canvas is cached.

At boot, `App.boot()` calls:

```ts
await textures.tryLoadAtlas('assets/atlas.json');
```

which silently does nothing if the file is absent. So the entire integration is:

**Put `atlas.json` and `atlas.png` in `public/assets/`. That is the whole task.**

---

## Producing the atlas

Any packer that can emit **TexturePacker "JSON (Hash)"** works — TexturePacker
itself, `free-tex-packer`, `spritesmith`, Unity's exporter, etc.

Recommended settings:

| Setting | Value | Why |
| --- | --- | --- |
| Data format | JSON (Hash) | The format the loader parses |
| Texture format | PNG-32 | Alpha is required everywhere |
| Premultiply alpha | **off** | The renderer composites additively itself |
| Trim | allowed | Trimmed frames are handled; the anchor is corrected |
| Rotation | **off** | Rotated frames are not unpacked |
| Extrude / padding | 2px | Prevents bleeding when scaled |
| Max size | 2048 or 4096 | Safe on every mobile GPU worth targeting |

Frame names may include a folder path and a `.png` extension; both are stripped.
`sprites/threat/lancer.png` and `threat/lancer` both resolve to `threat/lancer`.

To split across several sheets, call the loader once per sheet — later loads
override earlier keys:

```ts
await textures.tryLoadAtlas('assets/characters.json');
await textures.tryLoadAtlas('assets/effects.json');
```

Verify the manifest at any time:

```bash
npm run atlas:manifest          # print every required key
npm run atlas:manifest -- --json > manifest.json
```

---

## Global rules

**Anchors are centred.** Every frame is drawn from its centre unless the atlas
declares a `pivot`. Draw with the visual centre of mass in the middle of the
frame.

**Threats face +X.** A threat sprite must point *right* at rotation 0. The game
rotates it toward the nexus. Getting this wrong makes every enemy fly backwards.

**Do not bake in glow.** Everything emissive is drawn a second time into the
bloom buffer, so painted-on halos double up and turn to mush. Paint the object;
the engine adds the light.

**Sizes below are the natural size at scale 1**, in logical pixels. The game
scales from these, so keeping the ratio matters more than the absolute number.
Supply 2x if you want crisper art on dense displays and halve the declared size
via the atlas `scale` field.

**Tinting exists.** Several keys are drawn tinted (`fx/spark` is reused in many
colours). Draw those **white or near-white** so the tint reads.

---

## The keys

### Nexus — the thing you defend

| Key | Size | Notes |
| --- | --- | --- |
| `nexus/core` | 256 × 256 | Rotates slowly. Should read as a faceted crystal core. Scales with the arena; the visible diameter is about 60% of the frame. |
| `nexus/ring` | 512 × 512 | Decorative orbit ring with tick marks. Drawn twice at different scales, counter-rotating, tinted to the accent. Keep it thin and mostly transparent. |

### Threats — all facing +X

| Key | Size | Reads as | Notes |
| --- | --- | --- | --- |
| `threat/orb` | 72 × 72 | The baseline | Radially symmetric is fine; it still rotates. |
| `threat/lancer` | 96 × 60 | Speed | Elongated along X. The silhouette is the readability. |
| `threat/splitter` | 84 × 84 | Something that will break apart | Spins as it travels. |
| `threat/bulwark` | 92 × 92 | Armour on the leading edge | The front plate must read as "you cannot block this head-on". Its +X side is the armoured side. |
| `threat/seeker` | 80 × 80 | Something aiming at you | Steers toward your blind side. |
| `threat/herald` | 88 × 88 | Artillery | Never reaches the shield — it parks outside it and fires inward. The silhouette has to say "pointing at you from over there", because the correct answer to it is different from every other threat. |
| `threat/warden` | 320 × 320 | The boss | Gets a health arc drawn around it at 1.32x its collision radius, so leave the outer edge readable. |

Threat colours are declared in `game/GameRenderer.ts:threatColor` and used for
trails and particles. Keep the sprite palette in the same family or update that
function.

### Effects

Reused constantly and often tinted. Draw these **white**.

| Key | Size | Notes |
| --- | --- | --- |
| `fx/spark` | 64 × 64 | Soft point with a hot core. The workhorse. |
| `fx/spark-aegis`, `fx/spark-threat`, `fx/spark-parry` | 64 × 64 | Pre-coloured variants; can all point at the same white frame if you prefer to tint. |
| `fx/glow` | 128 × 128 | Soft falloff blob, no hard edge. |
| `fx/glow-aegis`, `fx/glow-parry`, `fx/glow-threat`, `fx/glow-ultimate` | 128 × 128 | Coloured variants. |
| `fx/ring` | 256 × 256 | A thin bright annulus, transparent centre. Used for every shockwave — it is scaled up to 4x. |
| `fx/ring-aegis`, `fx/ring-parry` | 256 × 256 | Coloured variants. |
| `fx/starburst` | 256 × 256 | Four-point lens flare. The "something great happened" mark. |
| `fx/starburst-parry` | 256 × 256 | |
| `fx/starburst-legendary`, `fx/starburst-mythic` | 384 × 384 | Bigger; used only in the summon burst. |
| `fx/streak` | 128 × 32 | Motion streak along +X. |
| `fx/streak-aegis` | 128 × 32 | |
| `fx/smoke` | 96 × 96 | Drawn non-additively behind entities at low alpha. |
| `fx/shard`, `fx/shard-threat` | 48 × 48 | Debris. Spins. |

### UI

| Key | Size | Notes |
| --- | --- | --- |
| `ui/prism` | 96 × 96 | Premium currency. Also rendered into `<img>` for the DOM. |
| `ui/core` | 96 × 96 | Soft currency. |
| `ui/shard` | 96 × 96 | Upgrade material. |
| `ui/star` | 64 × 64 | Filled rarity star. |
| `ui/star-empty` | 64 × 64 | Unfilled star. Same shape, desaturated. |

### Resonance sigils — the in-run draft

One per card category, not one per card. Eight keys, all 96 × 96, all drawn on
the same dark hex plate so a row of them reads as a set at 20px.

| Key | Reads as |
| --- | --- |
| `res/arc` | Shield shape |
| `res/turn` | Shield tracking |
| `res/pulse` | Pulse |
| `res/perfect` | Precision |
| `res/chain` | Deflection and chains |
| `res/nexus` | Survival |
| `res/score` | Score and economy |
| `res/ult` | Ultimate |

### Guardians — two frames each

Generated for every entry in `data/guardians.ts`. Sixteen Guardians, so
thirty-two frames.

| Key pattern | Size | Where it appears |
| --- | --- | --- |
| `guardian/<id>/portrait` | 512 × 640 | Home hero card, banner art, roster detail, pull hero card, share card background |
| `guardian/<id>/emblem` | 192 × 192 | Roster grid, pull result cards, HUD, results screen, share card badge |

Current ids:

```
vane  slate  ember                       (common)
kestrel  halcyon  onyx  vesper           (rare)
seraph  noct  zephyr  cinder             (epic)
oracle  tempest  solstice                (legendary)
eclipse  zenith                          (mythic)
```

**Portrait composition matters.** Portraits are cropped with
`object-fit: cover` and `object-position: center 30%`, and the bottom ~40% is
covered by a scrim carrying the name and tagline. Put the face and the read of
the character in the **upper two thirds** — the procedural portraits centre
their subject at **37% of the height** and you should match that. Keep the
bottom quiet.

This is not a style note. Composing to the middle of the frame puts the
Guardian's name across the subject's face on the home screen, the banner and
the roster detail all at once, and it looks like a layering bug rather than a
design. If a portrait has to be centred, extend the quiet space downward rather
than moving the subject.

**Emblems must read at 44px.** They are used as small as a chip icon. One strong
shape, high contrast, no fine detail.

Each Guardian declares a `hue` in `data/guardians.ts` that drives the accent
colour of every screen showing it. Either match the sprite to that hue or update
the field.

---

## Animation

`TextureStore` supports frame animation already, though nothing ships using it:

```ts
textures.defineAnimation({
  name: 'warden/idle',
  frames: ['warden/idle_0', 'warden/idle_1', 'warden/idle_2'],
  fps: 12,
  loop: true,
});

textures.drawAnimated(ctx, 'warden/idle', elapsedSeconds, x, y, { rotation });
```

Name atlas frames with a numeric suffix and register them at boot next to the
other art. `frameAt()` returns `undefined` once a non-looping animation is done,
which is a convenient end-of-effect signal.

---

## Checklist

- [ ] Frame names match the keys above exactly, after path and extension stripping
- [ ] Threats point along **+X**
- [ ] Anchors centred, or an explicit `pivot` in the atlas
- [ ] Rotation **off** in the packer
- [ ] Premultiplied alpha **off**
- [ ] Tintable effects drawn white
- [ ] No baked glow
- [ ] Portraits composed for a bottom scrim
- [ ] Emblems legible at 44px
- [ ] `npm run atlas:manifest` reports no missing keys
- [ ] `npm run smoke` passes and the screenshots in `tools/shots/` look right

A key that is missing from the atlas quietly falls back to its procedural
version, so a partial atlas is fine — you can migrate the art one category at a
time. A key that is missing from *both* draws a magenta checkerboard and logs a
warning rather than crashing.
