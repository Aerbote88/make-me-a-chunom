#!/usr/bin/env node
// Flags likely-partial medians in exported stroke data.
//
// For each stroke/median pair, compares the median's bounding-box diagonal
// to the stroke's bounding-box diagonal. A median that covers less than
// ~50% of its stroke usually means the animation path was drawn only
// partway across, which plays as an animation that stops mid-stroke.
//
// Usage:
//   node scripts/diagnose-medians.js                       # default dir
//   node scripts/diagnose-medians.js --dir ../chunom-stroke-data/data
//   node scripts/diagnose-medians.js --threshold 0.4       # tighter flag

const fs = require("fs");
const path = require("path");

const args = process.argv.slice(2);
const flag = (name, def) => {
  const i = args.indexOf(`--${name}`);
  if (i < 0) return def;
  const v = args[i + 1];
  return v && !v.startsWith("--") ? v : true;
};

const dataDir = path.resolve(
  flag("dir", path.join(__dirname, "..", "..", "chunom-stroke-data", "data")),
);
const threshold = Number(flag("threshold", "0.5"));

if (!fs.existsSync(dataDir)) {
  console.error(`data dir not found: ${dataDir}`);
  process.exit(1);
}

const bboxFromPoints = (points) => {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of points) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return Math.hypot(maxX - minX, maxY - minY);
};

const bboxFromPath = (d) => {
  const nums = d.match(/-?\d+(?:\.\d+)?/g);
  if (!nums) return 0;
  const pts = [];
  for (let i = 0; i + 1 < nums.length; i += 2) {
    pts.push([parseFloat(nums[i]), parseFloat(nums[i + 1])]);
  }
  return bboxFromPoints(pts);
};

const files = fs
  .readdirSync(dataDir)
  .filter((f) => f.endsWith(".json") && f !== "index.json" && f !== "manifest.json");

const reports = [];

for (const file of files) {
  const data = JSON.parse(fs.readFileSync(path.join(dataDir, file), "utf8"));
  const issues = [];
  for (let i = 0; i < data.strokes.length; i++) {
    const strokeDiag = bboxFromPath(data.strokes[i]);
    const medDiag = bboxFromPoints(data.medians[i]);
    const ratio = strokeDiag > 0 ? medDiag / strokeDiag : 0;
    const pointCount = data.medians[i].length;
    if (ratio < threshold || pointCount < 3) {
      issues.push({ i, ratio, pointCount, strokeDiag, medDiag });
    }
  }
  if (issues.length) {
    const worst = Math.min(...issues.map((x) => x.ratio));
    reports.push({ character: data.character, file, issues, worst });
  }
}

reports.sort((a, b) => a.worst - b.worst);

if (reports.length === 0) {
  console.log(`All ${files.length} characters look OK (threshold ${threshold}).`);
  process.exit(0);
}

console.log(
  `${reports.length}/${files.length} characters have suspicious medians ` +
    `(median bbox < ${threshold} × stroke bbox, or < 3 median points):\n`,
);
for (const r of reports) {
  console.log(`  ${r.character}  (${r.file})  — ${r.issues.length} issue(s)`);
  for (const iss of r.issues) {
    console.log(
      `    stroke[${iss.i}]: ratio ${iss.ratio.toFixed(2)}, ` +
        `median pts ${iss.pointCount}, ` +
        `stroke diag ${iss.strokeDiag.toFixed(0)}, ` +
        `median diag ${iss.medDiag.toFixed(0)}`,
    );
  }
}
