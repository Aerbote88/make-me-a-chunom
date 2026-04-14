#!/usr/bin/env node
// Extracts the unique Nôm characters of Truyện Kiều in first-appearance order
// from a Nomflow database backup JSON and writes them to
// public/texts/truyen-kieu-chars.json.
//
// Usage:
//   node scripts/extract-truyen-kieu.js <path-to-nomflow-backup.json>

const fs = require("fs");
const path = require("path");

const TRUYEN_KIEU_SOURCE_ID = 1;

const main = () => {
  const backupPath = process.argv[2];
  if (!backupPath) {
    console.error("usage: node scripts/extract-truyen-kieu.js <backup.json>");
    process.exit(1);
  }

  const backup = JSON.parse(fs.readFileSync(backupPath, "utf8"));
  const expressions = new Map(backup.expressions.map((e) => [e.id, e]));
  const lines = backup.lines
    .filter((l) => l.text_id === TRUYEN_KIEU_SOURCE_ID)
    .sort((a, b) => a.line_number - b.line_number);

  const seen = new Set();
  const ordered = [];
  let linesWithoutExpression = 0;

  for (const line of lines) {
    const expression = expressions.get(line.line_dictionary_id);
    if (!expression) {
      linesWithoutExpression++;
      continue;
    }
    for (const ch of Array.from(expression.nom_text)) {
      if (/\s/.test(ch)) continue;
      if (!seen.has(ch)) {
        seen.add(ch);
        ordered.push(ch);
      }
    }
  }

  const outputDir = path.resolve(__dirname, "..", "public", "texts");
  fs.mkdirSync(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, "truyen-kieu-chars.json");
  fs.writeFileSync(
    outputPath,
    JSON.stringify(
      { source: "Truyện Kiều", lineCount: lines.length, characters: ordered },
      null,
      2,
    ),
  );

  console.log(`lines: ${lines.length}`);
  if (linesWithoutExpression > 0) {
    console.log(`lines missing expression: ${linesWithoutExpression}`);
  }
  console.log(`unique characters: ${ordered.length}`);
  console.log(`wrote ${path.relative(process.cwd(), outputPath)}`);
};

main();
