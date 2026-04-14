#!/usr/bin/env node
// Imports upstream makemeahanzi data (public/graphics.txt + public/dictionary.txt)
// into the Meteor dev MongoDB as stub-verified Glyphs, so the Analysis stage's
// component-readiness check stops blocking on common Chinese components.
//
// Requirements:
//   - Meteor dev server running (so embedded Mongo is up on <meteor_port>+1)
//   - MongoDB Database Tools installed (mongoimport on PATH, or via MONGOIMPORT env var)
//
// Usage:
//   node scripts/import-hanzi.js                 # defaults: port 3101, skip existing
//   node scripts/import-hanzi.js --port 3001     # override mongo port
//   node scripts/import-hanzi.js --upsert        # overwrite existing glyphs too
//   node scripts/import-hanzi.js --dry-run       # write JSONL to /tmp, skip mongoimport
//
// Imported glyphs get:
//   - stages.strokes.{raw,corrected} from graphics.txt
//   - stages.order[i].{median,stroke} paired from medians/strokes
//   - stages.analysis.{decomposition,radical,etymology} from dictionary.txt
//   - stages.verified = {sentinel: true} so validators accept them as components
//   - stages.path = ""  (imported glyphs are NOT editable in the Path stage)

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const os = require("os");

const ROOT = path.resolve(__dirname, "..");
const GRAPHICS = path.join(ROOT, "public", "graphics.txt");
const DICTIONARY = path.join(ROOT, "public", "dictionary.txt");

const args = process.argv.slice(2);
const getFlag = (name, def) => {
  const i = args.indexOf(`--${name}`);
  if (i < 0) return def;
  const val = args[i + 1];
  return val && !val.startsWith("--") ? val : true;
};

const port = String(getFlag("port", "3101"));
const upsert = !!getFlag("upsert", false);
const dryRun = !!getFlag("dry-run", false);
const MONGOIMPORT =
  process.env.MONGOIMPORT ||
  "C:\\Program Files\\MongoDB\\Tools\\100\\bin\\mongoimport.exe";

const readJsonl = (file) => {
  const rows = new Map();
  const text = fs.readFileSync(file, "utf8");
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const obj = JSON.parse(line);
    rows.set(obj.character, obj);
  }
  return rows;
};

console.log(`Reading ${path.relative(ROOT, GRAPHICS)}...`);
const graphics = readJsonl(GRAPHICS);
console.log(`  ${graphics.size} characters`);

console.log(`Reading ${path.relative(ROOT, DICTIONARY)}...`);
const dictionary = readJsonl(DICTIONARY);
console.log(`  ${dictionary.size} characters`);

const codepointOf = (ch) => {
  const cp = ch.codePointAt(0);
  if (cp === undefined) throw new Error(`bad char: ${ch}`);
  return cp;
};

const buildGlyph = (ch, g, d) => {
  const strokes = (g && g.strokes) || [];
  const medians = (g && g.medians) || [];
  const order = strokes.map((stroke, i) => ({
    stroke,
    median: medians[i] || [],
  }));
  const analysis = {
    decomposition: (d && d.decomposition) || "？",
    etymology: (d && d.etymology) || { type: "ideographic" },
    radical: (d && d.radical) || undefined,
  };
  return {
    character: ch,
    codepoint: codepointOf(ch),
    metadata: {
      strokes: strokes.length,
      definition: (d && d.definition) || undefined,
      pinyin: (d && d.pinyin) || [],
    },
    stages: {
      path: "",
      bridges: [],
      strokes: { raw: strokes, corrected: strokes },
      analysis,
      order,
      verified: { sentinel: true },
    },
  };
};

// Union of characters from either file.
const allChars = new Set([...graphics.keys(), ...dictionary.keys()]);
console.log(`Merging -> ${allChars.size} unique characters`);

const tmpFile = path.join(os.tmpdir(), `chunom-import-${process.pid}.jsonl`);
let written = 0;
let skipped = 0;
const lines = [];
for (const ch of allChars) {
  const g = graphics.get(ch);
  const d = dictionary.get(ch);
  if (!g && !d) {
    skipped++;
    continue;
  }
  lines.push(JSON.stringify(buildGlyph(ch, g, d)));
  written++;
}
fs.writeFileSync(tmpFile, lines.join("\n") + "\n");
console.log(`Wrote ${written} docs (${skipped} skipped) to ${tmpFile}`);

if (dryRun) {
  console.log("--dry-run: stopping before mongoimport");
  process.exit(0);
}

const importArgs = [
  "--port",
  port,
  "--db",
  "meteor",
  "--collection",
  "glyphs",
  "--file",
  tmpFile,
  "--type",
  "json",
];
if (upsert) {
  importArgs.push("--mode", "upsert", "--upsertFields", "character");
} else {
  // Don't clobber existing docs (preserves the bundled 125-glyph seed and any
  // hand-verified glyphs). Duplicate-key errors are expected and ignored.
  importArgs.push("--mode", "insert");
}

console.log(`Running: ${MONGOIMPORT} ${importArgs.join(" ")}`);
try {
  execFileSync(MONGOIMPORT, importArgs, { stdio: "inherit" });
} catch (err) {
  if (!upsert) {
    console.log(
      "(duplicate-key errors above are expected without --upsert; existing docs were preserved)",
    );
  } else {
    throw err;
  }
} finally {
  try {
    fs.unlinkSync(tmpFile);
  } catch {}
}
console.log("Done.");
