#!/usr/bin/env node
// Generates public/stroke-data/index.json, a list of every character for which
// per-codepoint stroke data has been published. Consumers (e.g. chunom-practice)
// fetch this file to discover which characters are available on the CDN.

const fs = require("fs");
const path = require("path");

const strokeDataDir = path.resolve(__dirname, "..", "public", "stroke-data");

const files = fs
  .readdirSync(strokeDataDir)
  .filter((name) => name.endsWith(".json") && name !== "index.json")
  .sort();

const characters = [];
for (const file of files) {
  const codepoint = parseInt(file.replace(/\.json$/, ""), 16);
  if (Number.isNaN(codepoint)) continue;
  characters.push(String.fromCodePoint(codepoint));
}

const indexPath = path.join(strokeDataDir, "index.json");
fs.writeFileSync(
  indexPath,
  JSON.stringify({ count: characters.length, characters }),
);

console.log(`indexed ${characters.length} characters → ${path.relative(process.cwd(), indexPath)}`);
