# make-me-a-chunom

A stroke order editor for Vietnamese Chữ Nôm (𡨸喃) characters.

Based on [make-me-a-hanzi](https://github.com/skishore/makemeahanzi) and [make-me-a-hanzi-tool](https://github.com/MadLadSquad/make-me-a-hanzi-tool), upgraded to **Meteor 3.x** and extended with Chữ Nôm-specific authoring tools: manual median editing, a Nôm-only character browser, DVN dictionary integration, component-only tagging, and a pipeline for publishing verified stroke data to a separate public dataset repo.

## Features

- Create stroke order data for Chữ Nôm characters, including CJK Extensions B–H and SPUA-A font assignments used by the Nôm community
- Author manual medians for strokes where Voronoi median extraction fails
- Browse, filter, and search just your own added characters (skipping the ~9,600 preloaded makemeahanzi glyphs)
- Fetch decomposition hints from [digitizingvietnam.com](https://www.digitizingvietnam.com/) and apply them with one click
- Export verified glyphs to hanzi-writer-format JSON for publishing as a separate dataset
- Docker-based or native-Meteor setup

## Quick Start (Docker)

```bash
docker compose up --build
# Open http://localhost:3000/#家
```

## Manual Setup

1. Install [Meteor](https://www.meteor.com/install):
   ```bash
   curl https://install.meteor.com/ | sh
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Run the editor:
   ```bash
   npm start
   ```

4. Open `http://localhost:3000/#家`

## Editor Workflow

1. **Path** — Load character outline from font (AR PL UKai or AR PL KaitiM GB)
2. **Bridges** — Define stroke boundaries by connecting points
3. **Strokes** — Verify and select correct strokes
4. **Analysis** — Set decomposition, radical, and etymology (see [DVN integration](#dvn-integration))
5. **Order** — Reorder strokes, flip direction, or fix partial medians via [Edit median](#edit-median-order-stage)
6. **Verified** — Mark as complete and save

### Edit median (Order stage)

Medians are auto-computed, but the Voronoi algorithm falls back to a short line segment for irregular stroke polygons. For strokes where the animation plays as a tiny nub:

1. The permutation list flags suspect strokes with a yellow tint and ⚠.
2. Click **Edit median** next to the stroke. The target stroke highlights yellow on the canvas.
3. Hover any non-editing **Edit median** link to preview that stroke's stored median as a red polyline with waypoints, so you can compare before committing.
4. Click along the centerline of the highlighted stroke to place waypoints (first = green, last = red).
5. **Undo** removes the last point, **Clear** empties, **Save** commits (need ≥ 2 points), **Cancel** aborts.

Saved medians persist via the normal save flow — no separate export step.

### DVN integration

In the Analysis stage, click **Fetch decomposition hint from DVN** to scrape [digitizingvietnam.com](https://www.digitizingvietnam.com/) for the current character. Any IDS-formatted hints embedded in its etymology notes (e.g. `宁⿰字` → `⿰宁字`) appear as clickable pills — one click replaces the current decomposition.

Next to each leaf character in the decomposition tree, two pills appear:

- **→ meaning** — sets that character as the etymology's semantic (meaning) provider
- **→ sound** — sets it as the phonetic (pronunciation) provider

Both buttons automatically flip the etymology type to **Pictophonetic**.

### Character browser (top-right panel)

A collapsible panel showing only characters you've added for this project (filters out the ~9,600 preloaded Han glyphs from makemeahanzi). Each tile is clickable and navigates the editor to that character.

**Filter dropdown:**

- **Nôm only** (default) — your user-added Nôm set
- **Components only** — characters flagged with `metadata.componentOnly` (authoring aids, not standalone Nôm)
- **All** — includes both
- **Partial medians** — only characters flagged as having at least one median < 50% of its stroke's bounding box
- **Incomplete** — characters that don't yet have complete order data

**Search:** either type a character or a codepoint (`U+21A38` or just `21A38` hex).

**Status coloring:**

- Neutral — done
- Yellow — has partial medians
- Red — incomplete
- Dashed outline + muted — marked component-only

The list auto-refreshes after every save.

### Component-only flag

In the metadata panel, tick **Component only (skip in Nôm export)** for characters that are decomposition helpers (e.g. `𧾷` as a radical) rather than standalone Nôm characters. Flagged glyphs:

- Disappear from the default Nôm browser view
- Are skipped by the `export-nom` publishing pipeline
- Stay visible via the **Components only** or **All** filters

## Keybindings

| Key | Action |
|-----|--------|
| `s` | Next stage |
| `w` | Previous stage |
| `d` | Next character |
| `a` | Previous character |
| `r` | Reset current stage |
| `e` | Next verified character |
| `q` | Previous verified character |
| `D` | Next unverified character |
| `A` | Previous unverified character |
| `n` | Next user-added Nôm character |
| `N` | Previous user-added Nôm character |
| `t` | Next unverified in Truyện Kiều queue |
| `T` | Previous in Truyện Kiều queue |
| `C-click` | Add a point (Bridges stage) |

## Publishing Nôm stroke data

The editor can publish your verified user-added Nôm characters to a sibling GitHub repo (e.g. [`chunom-stroke-data`](https://github.com/Aerbote88/chunom-stroke-data)) in hanzi-writer-compatible JSON.

```bash
# Default: writes to ../chunom-stroke-data/data/
npm run export-nom

# Preview counts without writing
node scripts/export-nom-data.js --dry-run

# Override the Mongo port or DB if needed (Docker compose defaults below)
npm run export-nom -- --port 37017 --db makemeahanzi

# Override the output directory
npm run export-nom -- --out ../some-other-repo/data
```

The exporter only publishes glyphs that:

1. Are in a CJK Unihan range or a PUA range used by Nôm fonts
2. Are NOT present in the upstream `public/graphics.txt` (so no makemeahanzi data is republished)
3. Have `metadata.componentOnly` unset
4. Have a complete `stages.order` with a median per stroke

It also auto-rescues medians with bbox ratio < 0.5 (a safety net — see `scripts/patch-mongo-medians.js` below for a durable in-Mongo fix).

### Diagnostic & in-Mongo patcher

```bash
# Flag suspicious medians in an exported dataset
node scripts/diagnose-medians.js
node scripts/diagnose-medians.js --dir ../chunom-stroke-data/data --threshold 0.4

# Write farthest-pair rescued medians directly into Mongo
node scripts/patch-mongo-medians.js --dry-run
node scripts/patch-mongo-medians.js
```

The patcher fixes partial medians at the source (`stages.order[i].median`) so the editor shows them correctly and subsequent exports don't need to keep auto-rescuing.

## Export legacy format

The original makemeahanzi export still works:

```javascript
// In the browser console:
Meteor.call('export')
```

Creates (in `public/`):

- `graphics_export.txt` — stroke paths and medians
- `dictionary_export.txt` — definitions, decomposition, etymology

Merged into the canonical `public/graphics.txt` / `public/dictionary.txt` via `task stroke:export`.

## Data Format

Exported per-character JSON is hanzi-writer compatible:

```json
{
  "character": "𡨸",
  "strokes": ["M ...", "M ...", ...],
  "medians": [[[x, y], [x, y], ...], ...]
}
```

`strokes[i]` is an SVG path. `medians[i]` is the animation path for that stroke, in drawing order (so `medians[i]` clips against `strokes[i]`).

## Validate Stroke Data

```bash
npm run validate
```

## Test Stroke Animations

```bash
cd public
python3 -m http.server 8992
# Open http://localhost:8992/index.html
```

Or, for the published dataset, use the preview page in the sibling repo (`chunom-stroke-data/preview.html`).

## Nôm fonts

`public/nom-fonts/` ships three fonts that together cover CJK + Nôm SPUA assignments:

- **NomNaTong-Regular** — Nôm Na Tống (default)
- **BabelStoneHan** — CJK Ext A–H + SPUA Nôm
- **Plangothic P1/P2** — broad CJK coverage

They're loaded via `@font-face` and applied globally, so SPUA-A Nôm characters like `󰞺` render anywhere in the UI.

## Credits

- Original data and editor: [skishore/makemeahanzi](https://github.com/skishore/makemeahanzi)
- Editor improvements: [MadLadSquad/make-me-a-hanzi-tool](https://github.com/MadLadSquad/make-me-a-hanzi-tool)
- Upstream Chữ Nôm port: [nhatvu148/make-me-a-chunom](https://github.com/nhatvu148/make-me-a-chunom)
- Fonts: [Arphic Public License](http://ftp.gnu.org/gnu/non-gnu/chinese-fonts-truetype/), [Nôm Na Tống](https://github.com/vietnamese-nom-preservation-foundation), [BabelStone Han](https://www.babelstone.co.uk/Fonts/), [Plangothic](https://github.com/Fitzgerald-Porthmouth-Koyogh/Plangothic-Project)
- Dictionary integration: [digitizingvietnam.com](https://www.digitizingvietnam.com/), [Hán Nôm NVNV](https://hannom.nvnv.app/)

## License

[Arphic Public License](https://www.freedesktop.org/wiki/Arphic_Public_License/)
