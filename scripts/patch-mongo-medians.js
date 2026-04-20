#!/usr/bin/env node
// Patches partial medians directly in Mongo for user-added Chữ Nôm glyphs.
//
// Same farthest-pair rescue logic as scripts/export-nom-data.js, but writes
// the fixes back into stages.order[i].median so the editor (and any future
// export) sees them. Only glyphs not present in public/graphics.txt are
// considered — preloaded makemeahanzi data is never modified.
//
// Requirements:
//   - Meteor dev server running (Mongo reachable)
//   - MongoDB Database Tools installed (mongoexport + mongoimport)
//
// Usage:
//   node scripts/patch-mongo-medians.js --dry-run         # preview counts
//   node scripts/patch-mongo-medians.js                   # write changes
//   node scripts/patch-mongo-medians.js --port 37017 --db makemeahanzi

const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");

const args = process.argv.slice(2);
const flag = (name, def) => {
  const i = args.indexOf(`--${name}`);
  if (i < 0) return def;
  const v = args[i + 1];
  return v && !v.startsWith("--") ? v : true;
};

const port = String(flag("port", "3101"));
const db = String(flag("db", "meteor"));
const excludeFile = path.resolve(
  ROOT,
  flag("exclude", path.join("public", "graphics.txt")),
);
const dryRun = flag("dry-run", false) === true;

const mongoexport =
  process.env.MONGOEXPORT ||
  (process.platform === "win32"
    ? "C:\\Program Files\\MongoDB\\Tools\\100\\bin\\mongoexport.exe"
    : "mongoexport");
const mongoimport =
  process.env.MONGOIMPORT ||
  (process.platform === "win32"
    ? "C:\\Program Files\\MongoDB\\Tools\\100\\bin\\mongoimport.exe"
    : "mongoimport");

const RESCUE_THRESHOLD = 0.5;
const RESCUE_SAMPLES = 5;

const isCJK = (cp) =>
  (cp >= 0x3400 && cp <= 0x9fff) ||
  (cp >= 0xf900 && cp <= 0xfaff) ||
  (cp >= 0x20000 && cp <= 0x323af) ||
  (cp >= 0xe000 && cp <= 0xf8ff) ||
  (cp >= 0xf0000 && cp <= 0xffffd);

const unwrapInt = (v) => {
  if (v == null) return NaN;
  if (typeof v === "number") return v;
  if (typeof v === "string") return Number(v);
  if (typeof v === "object" && v.$numberInt != null) return Number(v.$numberInt);
  if (typeof v === "object" && v.$numberLong != null) return Number(v.$numberLong);
  if (typeof v === "object" && v.$numberDouble != null) return Number(v.$numberDouble);
  return Number(v);
};

const parsePathPoints = (d) => {
  const nums = d.match(/-?\d+(?:\.\d+)?/g);
  if (!nums) return [];
  const pts = [];
  for (let i = 0; i + 1 < nums.length; i += 2) {
    pts.push([parseFloat(nums[i]), parseFloat(nums[i + 1])]);
  }
  return pts;
};

const bboxDiag = (pts) => {
  if (pts.length < 2) return 0;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of pts) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return Math.hypot(maxX - minX, maxY - minY);
};

const farthestPair = (pts) => {
  let a = pts[0], b = pts[0], bestD = 0;
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const d = Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1]);
      if (d > bestD) {
        bestD = d;
        a = pts[i];
        b = pts[j];
      }
    }
  }
  return [a, b];
};

const rescueMedian = (strokePath, originalMedian) => {
  const pts = parsePathPoints(strokePath);
  if (pts.length < 2) return null;
  let [a, b] = farthestPair(pts);
  if (Array.isArray(originalMedian) && originalMedian.length > 0) {
    const head = originalMedian[0];
    const d2 = (p, q) => (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2;
    if (d2(b, head) < d2(a, head)) [a, b] = [b, a];
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

// Load exclusion set (characters to NEVER touch).
const excluded = new Set();
if (fs.existsSync(excludeFile)) {
  for (const line of fs.readFileSync(excludeFile, "utf8").split("\n")) {
    if (!line) continue;
    const m = line.match(/"character"\s*:\s*"((?:[^"\\]|\\.)+)"/);
    if (m) {
      try { excluded.add(JSON.parse(`"${m[1]}"`)); } catch {}
    }
  }
}
console.log(`Loaded ${excluded.size} preloaded characters (excluded from patching).`);

const exportFile = path.join(os.tmpdir(), `mongo-patch-export-${Date.now()}.jsonl`);
console.log(`Reading glyphs from Mongo (port ${port}, db ${db})...`);
try {
  execFileSync(
    mongoexport,
    ["--quiet", `--port=${port}`, `--db=${db}`, "--collection=glyphs", `--out=${exportFile}`],
    { stdio: ["ignore", "inherit", "inherit"] },
  );
} catch (e) {
  console.error(`\nmongoexport failed. Is the Meteor dev server running on Mongo port ${port}?`);
  process.exit(1);
}

const lines = fs.readFileSync(exportFile, "utf8").split("\n").filter(Boolean);
fs.unlinkSync(exportFile);

const patchedDocs = [];
const perChar = [];
let docsEligible = 0;
let mediansPatched = 0;

for (const line of lines) {
  let doc;
  try { doc = JSON.parse(line); } catch { continue; }

  const ch = doc.character;
  if (!ch || typeof ch !== "string") continue;
  const cp = ch.codePointAt(0);
  if (cp == null || !isCJK(cp)) continue;
  if (excluded.has(ch)) continue;

  const stages = doc.stages || {};
  const corrected = stages.strokes && stages.strokes.corrected;
  const order = stages.order;
  if (!Array.isArray(corrected) || !Array.isArray(order)) continue;
  if (order.length !== corrected.length) continue;

  docsEligible++;

  const patchedStrokes = [];
  for (const entry of order) {
    const med = entry && entry.median;
    const strokeIdx = entry && unwrapInt(entry.stroke);
    if (!Array.isArray(med) || !Number.isInteger(strokeIdx)) continue;
    if (strokeIdx < 0 || strokeIdx >= corrected.length) continue;
    const strokePath = corrected[strokeIdx];
    if (typeof strokePath !== "string") continue;

    const medRaw = med.map((p) => [unwrapInt(p[0]), unwrapInt(p[1])]);
    const strokeDiag = bboxDiag(parsePathPoints(strokePath));
    const medDiag = bboxDiag(medRaw);
    if (strokeDiag > 0 && medDiag / strokeDiag < RESCUE_THRESHOLD) {
      const rescued = rescueMedian(strokePath, medRaw);
      if (rescued) {
        entry.median = rescued; // mutates doc in place
        mediansPatched++;
        patchedStrokes.push(strokeIdx);
      }
    }
  }

  if (patchedStrokes.length) {
    patchedDocs.push(doc);
    perChar.push({ ch, strokes: patchedStrokes });
  }
}

console.log(`\nEligible user-added glyphs : ${docsEligible}`);
console.log(`Glyphs with partial medians: ${patchedDocs.length}`);
console.log(`Medians to patch           : ${mediansPatched}\n`);

if (patchedDocs.length) {
  for (const row of perChar) {
    console.log(`  ${row.ch}  stroke${row.strokes.length > 1 ? "s" : ""} ${row.strokes.join(", ")}`);
  }
}

if (dryRun || patchedDocs.length === 0) {
  if (dryRun) console.log("\n(dry run — nothing written to Mongo)");
  process.exit(0);
}

const importFile = path.join(os.tmpdir(), `mongo-patch-import-${Date.now()}.jsonl`);
fs.writeFileSync(
  importFile,
  patchedDocs.map((d) => JSON.stringify(d)).join("\n") + "\n",
);

console.log(`\nWriting ${patchedDocs.length} patched docs back to Mongo (upsert by _id)...`);
try {
  execFileSync(
    mongoimport,
    [
      "--quiet",
      `--port=${port}`,
      `--db=${db}`,
      "--collection=glyphs",
      "--mode=upsert",
      `--file=${importFile}`,
    ],
    { stdio: ["ignore", "inherit", "inherit"] },
  );
} catch (e) {
  console.error("\nmongoimport failed. The temp file is preserved for inspection:");
  console.error("  " + importFile);
  process.exit(1);
}

fs.unlinkSync(importFile);
console.log("Done.");
