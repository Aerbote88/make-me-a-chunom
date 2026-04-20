#!/usr/bin/env node
// Exports user-contributed Chữ Nôm stroke data into per-codepoint JSON files
// compatible with hanzi-writer, plus index.json and manifest.json.
//
// A glyph is kept only if ALL of:
//   - It lies in a CJK Unihan range (so no Latin/Greek/bopomofo noise)
//   - It is NOT present in public/graphics.txt (so no preloaded makemeahanzi Han)
//   - stages.strokes.corrected is non-empty and stages.order matches it in length
//
// The first two together mean: the character was added for this project, i.e.
// Nôm. The third is the structural-completeness check.
//
// Re-run any time to pick up newly verified characters — output files are
// overwritten idempotently.
//
// Requirements:
//   - Meteor dev server running (so embedded Mongo is reachable)
//   - MongoDB Database Tools installed (mongoexport on PATH, or MONGOEXPORT env)
//
// Usage:
//   node scripts/export-nom-data.js                                 # default: port 3101, db meteor
//   node scripts/export-nom-data.js --port 37017 --db makemeahanzi  # Docker compose setup
//   node scripts/export-nom-data.js --out ../chunom-stroke-data/data
//   node scripts/export-nom-data.js --dry-run                       # count only, no files written

const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");

const args = process.argv.slice(2);
const flag = (name, def) => {
  const i = args.indexOf(`--${name}`);
  if (i < 0) return def;
  const val = args[i + 1];
  return val && !val.startsWith("--") ? val : true;
};

const port = String(flag("port", "3101"));
const db = String(flag("db", "meteor"));
const outDir = path.resolve(ROOT, flag("out", path.join("dist", "stroke-data")));
const excludeFile = path.resolve(
  ROOT,
  flag("exclude", path.join("public", "graphics.txt")),
);
const dryRun = flag("dry-run", false) === true;

const isCJK = (cp) =>
  (cp >= 0x3400 && cp <= 0x9fff) ||   // Ext A + Unified Ideographs
  (cp >= 0xf900 && cp <= 0xfaff) ||   // Compatibility Ideographs
  (cp >= 0x20000 && cp <= 0x323af) || // Ext B through Ext H
  (cp >= 0xe000 && cp <= 0xf8ff) ||   // PUA (Nôm font assignments)
  (cp >= 0xf0000 && cp <= 0xffffd);   // SPUA-A (Nôm font assignments)

// Auto-rescue for partial medians. lib/median_util.js falls back to 2-3
// collapsed points when its Voronoi pass fails on an irregular stroke
// polygon; hanzi-writer then animates those strokes as a tiny nub. We
// detect these by comparing bbox diagonals, and synthesize a replacement
// by sampling a line between the polygon's two farthest points — good
// enough for straight strokes (horizontal/vertical/diagonal bars), which
// covers most of the flagged cases.

const RESCUE_THRESHOLD = 0.5;
const RESCUE_SAMPLES = 5;

const parsePathPoints = (d) => {
  const nums = d.match(/-?\d+(?:\.\d+)?/g);
  if (!nums) return [];
  const pts = [];
  for (let i = 0; i + 1 < nums.length; i += 2) {
    pts.push([parseFloat(nums[i]), parseFloat(nums[i + 1])]);
  }
  return pts;
};

const bboxDiag = (points) => {
  if (points.length < 2) return 0;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of points) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return Math.hypot(maxX - minX, maxY - minY);
};

const farthestPair = (points) => {
  let best = [points[0], points[0]];
  let bestD = 0;
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const d = Math.hypot(points[i][0] - points[j][0], points[i][1] - points[j][1]);
      if (d > bestD) {
        bestD = d;
        best = [points[i], points[j]];
      }
    }
  }
  return best;
};

const rescueMedian = (strokePath, originalMedian) => {
  const pts = parsePathPoints(strokePath);
  if (pts.length < 2) return null;
  let [a, b] = farthestPair(pts);

  // Orient so that `a` is nearer the original median's first point. The
  // original median — even when collapsed — was computed in the intended
  // stroke direction, so preserving its head/tail matches the user's
  // intent (set via the Order stage's reverse button).
  if (Array.isArray(originalMedian) && originalMedian.length > 0) {
    const head = originalMedian[0];
    const d2 = (p, q) => (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2;
    if (d2(b, head) < d2(a, head)) {
      [a, b] = [b, a];
    }
  }

  const out = [];
  for (let i = 0; i < RESCUE_SAMPLES; i++) {
    const t = i / (RESCUE_SAMPLES - 1);
    out.push([
      Math.round(a[0] + (b[0] - a[0]) * t),
      Math.round(a[1] + (b[1] - a[1]) * t),
    ]);
  }
  return out;
};

const loadExclusionSet = (file) => {
  const set = new Set();
  if (!fs.existsSync(file)) {
    console.warn(`Warning: exclusion file not found: ${file}`);
    return set;
  }
  const text = fs.readFileSync(file, "utf8");
  for (const line of text.split("\n")) {
    if (!line) continue;
    const m = line.match(/"character"\s*:\s*"((?:[^"\\]|\\.)+)"/);
    if (m) {
      try {
        set.add(JSON.parse(`"${m[1]}"`));
      } catch {}
    }
  }
  return set;
};

console.log(`Loading exclusion set from ${path.relative(ROOT, excludeFile)}...`);
const excluded = loadExclusionSet(excludeFile);
console.log(`  ${excluded.size} preloaded characters will be skipped`);

const mongoexport =
  process.env.MONGOEXPORT ||
  (process.platform === "win32"
    ? "C:\\Program Files\\MongoDB\\Tools\\100\\bin\\mongoexport.exe"
    : "mongoexport");

const unwrapInt = (v) => {
  if (v == null) return NaN;
  if (typeof v === "number") return v;
  if (typeof v === "string") return Number(v);
  if (typeof v === "object" && v.$numberInt != null) return Number(v.$numberInt);
  if (typeof v === "object" && v.$numberLong != null) return Number(v.$numberLong);
  if (typeof v === "object" && v.$numberDouble != null) return Number(v.$numberDouble);
  return Number(v);
};

const tmpFile = path.join(os.tmpdir(), `glyphs-export-${Date.now()}.jsonl`);

console.log(`Exporting glyphs from Mongo on port ${port} (db: ${db})...`);
try {
  execFileSync(
    mongoexport,
    [
      "--quiet",
      `--port=${port}`,
      `--db=${db}`,
      "--collection=glyphs",
      `--out=${tmpFile}`,
    ],
    { stdio: ["ignore", "inherit", "inherit"] },
  );
} catch (e) {
  console.error(
    `\nmongoexport failed. Is the Meteor dev server (or Docker) running?\n` +
      `If Mongo is on a different port/db, pass --port <port> --db <name>.\n` +
      `Docker compose setup uses: --port 37017 --db makemeahanzi\n`,
  );
  process.exit(1);
}

if (!fs.existsSync(tmpFile)) {
  console.error(`mongoexport produced no file at ${tmpFile}`);
  process.exit(1);
}

const lines = fs.readFileSync(tmpFile, "utf8").split("\n").filter(Boolean);
fs.unlinkSync(tmpFile);

const counts = {
  total: 0,
  notCJK: 0,
  preloaded: 0,
  componentOnly: 0,
  incomplete: 0,
  kept: 0,
  extBPlus: 0,
  bmp: 0,
  rescuedMedians: 0,
  rescuedChars: 0,
};

const entries = [];

for (const line of lines) {
  counts.total++;
  let doc;
  try {
    doc = JSON.parse(line);
  } catch {
    continue;
  }

  const character = doc.character;
  if (!character || typeof character !== "string") {
    counts.incomplete++;
    continue;
  }
  const codepoint = character.codePointAt(0);
  if (codepoint == null) {
    counts.incomplete++;
    continue;
  }

  if (!isCJK(codepoint)) {
    counts.notCJK++;
    continue;
  }
  if (excluded.has(character)) {
    counts.preloaded++;
    continue;
  }
  if (doc.metadata && doc.metadata.componentOnly) {
    counts.componentOnly++;
    continue;
  }

  const stages = doc.stages || {};

  const corrected = stages.strokes && stages.strokes.corrected;
  if (!Array.isArray(corrected) || corrected.length === 0) {
    counts.incomplete++;
    continue;
  }

  const order = stages.order;
  if (!Array.isArray(order) || order.length !== corrected.length) {
    counts.incomplete++;
    continue;
  }

  // order is in drawing order; each entry.stroke is an index into corrected.
  // Emit strokes and medians paired at the same index so hanzi-writer can
  // clip medians[i] to strokes[i]. See server/migration.js:85-86 for the
  // canonical pattern.
  const strokesOut = [];
  const medians = [];
  let ok = true;
  let charRescued = false;
  for (const entry of order) {
    const med = entry && entry.median;
    const strokeIdx = entry && unwrapInt(entry.stroke);
    if (
      !Array.isArray(med) ||
      !Number.isInteger(strokeIdx) ||
      strokeIdx < 0 ||
      strokeIdx >= corrected.length ||
      typeof corrected[strokeIdx] !== "string"
    ) {
      ok = false;
      break;
    }
    const strokePath = corrected[strokeIdx];
    let medianPoints = med.map((pair) => [unwrapInt(pair[0]), unwrapInt(pair[1])]);

    const strokeDiag = bboxDiag(parsePathPoints(strokePath));
    const medianD = bboxDiag(medianPoints);
    if (strokeDiag > 0 && medianD / strokeDiag < RESCUE_THRESHOLD) {
      const rescued = rescueMedian(strokePath, medianPoints);
      if (rescued) {
        medianPoints = rescued;
        counts.rescuedMedians++;
        charRescued = true;
      }
    }

    strokesOut.push(strokePath);
    medians.push(medianPoints);
  }
  if (!ok) {
    counts.incomplete++;
    continue;
  }
  if (charRescued) counts.rescuedChars++;

  const block = codepoint >= 0x20000 ? "ext-b-plus" : "bmp";
  if (block === "ext-b-plus") counts.extBPlus++;
  else counts.bmp++;

  entries.push({
    character,
    codepoint,
    strokes: strokesOut,
    medians,
    block,
  });
  counts.kept++;
}

entries.sort((a, b) => a.codepoint - b.codepoint);

if (!dryRun) {
  fs.mkdirSync(outDir, { recursive: true });

  for (const e of entries) {
    const fileName = `${e.codepoint.toString(16).toUpperCase()}.json`;
    fs.writeFileSync(
      path.join(outDir, fileName),
      JSON.stringify({
        character: e.character,
        strokes: e.strokes,
        medians: e.medians,
      }),
    );
  }

  const generated = new Date().toISOString();

  fs.writeFileSync(
    path.join(outDir, "index.json"),
    JSON.stringify(
      {
        count: entries.length,
        generated,
        characters: entries.map((e) => e.character),
      },
      null,
      2,
    ),
  );

  fs.writeFileSync(
    path.join(outDir, "manifest.json"),
    JSON.stringify(
      {
        count: entries.length,
        generated,
        entries: entries.map((e) => ({
          character: e.character,
          codepoint: `U+${e.codepoint.toString(16).toUpperCase().padStart(4, "0")}`,
          strokes: e.strokes.length,
          block: e.block,
        })),
      },
      null,
      2,
    ),
  );
}

console.log(`
Summary:
  Total docs             : ${counts.total}
  Non-CJK (skipped)      : ${counts.notCJK}
  In graphics.txt (Han)  : ${counts.preloaded}
  Component-only (skip)  : ${counts.componentOnly}
  Incomplete             : ${counts.incomplete}
  Kept (user-added Nom)  : ${counts.kept}
    Ext B+                 : ${counts.extBPlus}
    BMP                    : ${counts.bmp}
  Auto-rescued medians   : ${counts.rescuedMedians} (across ${counts.rescuedChars} chars)
${dryRun ? "\n(dry run — no files written)" : `\nOutput: ${path.relative(ROOT, outDir)}`}
`);
