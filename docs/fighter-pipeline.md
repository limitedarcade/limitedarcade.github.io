# Fighter creation pipeline (easy add)

Goal: satirical **Street Fighter** bosses from a concept screenshot or trait list — fast, repeatable, 1024-native.

## One-command shape

```powershell
# From screenshot crop already in Comfy input / refs:
python tools/comfy/create_fighter.py --slug trump --name TRUMP `
  --ref art/comfy/refs/trump_satire_1024.png `
  --traits-file art/comfy/characters/trump.traits.json `
  --count 6
```

Then you pick an option; lock it:

```powershell
python tools/comfy/create_fighter.py --slug trump --lock options/trump_opt3_01.png
```

## Character sheet (`art/comfy/characters/<slug>.traits.json`)

```json
{
  "slug": "trump",
  "display_name": "TRUMP",
  "role": "P1",
  "satire": "Street Fighter boss caricature",
  "traits": [
    "cartoonishly bulky torso and thick neck",
    "distinctive swept blond-orange hair",
    "orange-tan skin, squinting smug face",
    "navy blue suit, white shirt",
    "long bright red necktie hanging low",
    "fists raised in victory / fighting pose"
  ],
  "forbid": ["tracksuit", "hoodie", "top knot", "gold chain", "sunglasses"],
  "palette_row": "char_trump"
}
```

## Process (always)

1. **Brief** — screenshot crop and/or traits JSON (user words win).
2. **1024** — any photo/crop padded/scaled to **1024×1024** before Comfy (verify `Image.size`).
3. **Generate N options** — txt2img and/or img2img from satire crop; Pixel Art XL on; side-view SF sprite framing.
4. **Visual QA** — open reference + each option; checklist hair / face / suit / tie / bulk / pose. Drop failures.
5. **Lock** — copy chosen file to `art/raw/<slug>/<slug>_idle_1024_01.png` + `art/comfy/refs/<slug>_idle_master_1024.png` + update manifest.
6. **Later** — punches/kicks via OpenPose ControlNet from locked idle; Color Bible remap → ROM.

## Do / don’t

| Do | Don’t |
|----|--------|
| Exaggerate into SF boss proportions | Photoreal portrait paste |
| Match the **satire screenshot** vibe | Invent costumes from an unrelated mockup |
| Check size is 1024 after every save | Trust filenames alone |
| QA vs reference every few gens | Batch 20 and hope |

See also: `docs/truths.md`.
