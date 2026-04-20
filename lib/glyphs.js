import {assert, getPWD} from '/lib/base';
import {cjklib} from '/lib/cjklib';

const defaultGlyph = (character) => {
  if (!character) return;
  // Handle surrogate pairs (characters outside BMP like CJK Extension B)
  const charLength = [...character].length;
  if (charLength !== 1) {
    console.warn(`Character "${character}" has length ${charLength}, expected 1`);
    return;
  }
  const data = cjklib.getCharacterData(character) || {};
  const result = {
    character: character,
    codepoint: character.codePointAt(0),
    metadata: {
      frequency: data.frequency || 0,
      kangxi_index: data.kangxi_index || null,
    },
    stages: {},
    simplified: data.simplified || null,
    traditional: data.traditional || [],
  }
  return result;
}

const Glyphs = new Mongo.Collection('glyphs');
const Progress = new Mongo.Collection('progress');

Glyphs.clearDependencies = async (character) => {
  const stack = [character];
  const visited = {};
  visited[character] = true;
  while (stack.length > 0) {
    const current = stack.pop();
    const dependencies = await Glyphs.find({
      'stages.analysis.decomposition': {$regex: `.*${current}.*`},
      'stages.order': {$ne: null},
    }, {character: 1}).fetchAsync();
    dependencies.map((x) => x.character).filter((x) => !visited[x]).map((x) => {
      stack.push(x);
      visited[x] = true;
    });
  }
  delete visited[character];
  await Glyphs.updateAsync({character: {$in: Object.keys(visited)}},
                {$set: {'stages.order': null, 'stages.verified': null}},
                {multi: true});
}

Glyphs.get = async (character) => {
  const found = await Glyphs.findOneAsync({character: character});
  return found || defaultGlyph(character);
}

Glyphs.getAll = (characters) => Glyphs.find({character: {$in: characters}});

Glyphs.getNext = async (glyph, clause) => {
  clause = clause || {};
  const codepoint = glyph ? glyph.codepoint : undefined;
  const condition = Object.assign({codepoint: {$gt: codepoint}}, clause);
  const next = await Glyphs.findOneAsync(condition, {sort: {codepoint: 1}});
  return next ? next : await Glyphs.findOneAsync(clause, {sort: {codepoint: 1}});
}

Glyphs.getNextUnverified = async (glyph) => {
  return await Glyphs.getNext(glyph, {'stages.verified': null});
}

// Set of characters that were loaded from public/graphics.txt by
// scripts/import-hanzi.js. Loaded once at server startup so queries for
// "user-added Nôm only" don't have to rescan the file each call.
let preloadedHanSet = null;

const isCJKCodepoint = (cp) =>
  (cp >= 0x3400 && cp <= 0x9fff) ||   // CJK Ext A + Unified Ideographs
  (cp >= 0xf900 && cp <= 0xfaff) ||   // Compatibility Ideographs
  (cp >= 0x20000 && cp <= 0x323af) || // Ext B through Ext H
  (cp >= 0xe000 && cp <= 0xf8ff) ||   // PUA (Nôm font assignments)
  (cp >= 0xf0000 && cp <= 0xffffd);   // SPUA-A (Nôm font assignments)

const loadPreloadedHanSet = () => {
  if (preloadedHanSet) return preloadedHanSet;
  const set = new Set();
  if (Meteor.isServer) {
    const fs = require('fs');
    const path = require('path');
    const file = path.join(getPWD(), 'public', 'graphics.txt');
    if (fs.existsSync(file)) {
      const text = fs.readFileSync(file, 'utf8');
      for (const line of text.split('\n')) {
        if (!line) continue;
        const m = line.match(/"character"\s*:\s*"((?:[^"\\]|\\.)+)"/);
        if (m) {
          try { set.add(JSON.parse(`"${m[1]}"`)); } catch {}
        }
      }
    }
  }
  preloadedHanSet = set;
  return set;
};

// Returns the ordered list of character strings that were added to Mongo
// for this project — CJK characters not present in graphics.txt. Used as
// a browsing queue in the editor so you can jump through only your own
// Nôm contributions instead of the full 9.7k-glyph pile.
Glyphs.getUserAddedNomList = async () => {
  const excluded = loadPreloadedHanSet();
  const all = await Glyphs.find(
    {}, {fields: {character: 1, codepoint: 1}, sort: {codepoint: 1}},
  ).fetchAsync();
  const out = [];
  for (const g of all) {
    if (!g.character || typeof g.codepoint !== 'number') continue;
    if (!isCJKCodepoint(g.codepoint)) continue;
    if (excluded.has(g.character)) continue;
    out.push(g.character);
  }
  return out;
};

// Enriched browsing list for the character-browser panel. Each entry has
// strokeCount, hasCompleteOrder, hasPartialMedians so the UI can filter
// without a round trip per character.
const pathBboxDiag = (d) => {
  const nums = (d.match(/-?\d+(?:\.\d+)?/g) || []).map(parseFloat);
  if (nums.length < 4) return 0;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i + 1 < nums.length; i += 2) {
    const x = nums[i], y = nums[i + 1];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  return Math.hypot(maxX - minX, maxY - minY);
};
const pointsBboxDiag = (pts) => {
  if (!Array.isArray(pts) || pts.length < 2) return 0;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    if (!Array.isArray(p) || p.length < 2) continue;
    const x = Number(p[0]), y = Number(p[1]);
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  return Math.hypot(maxX - minX, maxY - minY);
};

Glyphs.getUserAddedNomBrowserList = async () => {
  const excluded = loadPreloadedHanSet();
  const all = await Glyphs.find({}).fetchAsync();
  const out = [];
  for (const g of all) {
    if (!g.character || typeof g.codepoint !== 'number') continue;
    if (!isCJKCodepoint(g.codepoint)) continue;
    if (excluded.has(g.character)) continue;

    const stages = g.stages || {};
    const corrected = (stages.strokes && stages.strokes.corrected) || [];
    const order = Array.isArray(stages.order) ? stages.order : [];
    const strokeCount = corrected.length;
    const hasCompleteOrder = strokeCount > 0 && order.length === strokeCount;

    let hasPartialMedians = false;
    if (hasCompleteOrder) {
      for (const entry of order) {
        const sIdx = entry && typeof entry.stroke === 'number' ? entry.stroke : null;
        if (sIdx === null || !corrected[sIdx]) continue;
        const strokeDiag = pathBboxDiag(corrected[sIdx]);
        const med = entry.median;
        if (!Array.isArray(med) || med.length < 2) { hasPartialMedians = true; break; }
        const medDiag = pointsBboxDiag(med);
        if (strokeDiag > 0 && medDiag / strokeDiag < 0.5) { hasPartialMedians = true; break; }
      }
    }

    out.push({
      character: g.character,
      codepoint: g.codepoint,
      strokeCount,
      hasCompleteOrder,
      hasPartialMedians,
      componentOnly: !!(g.metadata && g.metadata.componentOnly),
    });
  }
  out.sort((a, b) => a.codepoint - b.codepoint);
  return out;
};

Glyphs.getNextVerified = async (glyph) => {
  return await Glyphs.getNext(glyph, {'stages.verified': {$ne: null}});
}

Glyphs.getPrevious = async (glyph, clause) => {
  clause = clause || {};
  const codepoint = glyph ? glyph.codepoint : undefined;
  const condition = Object.assign({codepoint: {$lt: codepoint}}, clause);
  const previous = await Glyphs.findOneAsync(condition, {sort: {codepoint: -1}});
  return previous ? previous : await Glyphs.findOneAsync(clause, {sort: {codepoint: -1}});
}

Glyphs.getPreviousUnverified = async (glyph) => {
  return await Glyphs.getPrevious(glyph, {'stages.verified': null});
}

// Given an ordered list of characters and the current character, return the
// next character in the list whose glyph is not yet verified. Wraps around
// from the end of the list back to the beginning. Returns null if every
// character in the list is already verified.
Glyphs.getNextUnverifiedInList = async (characters, currentCharacter) => {
  if (!characters || characters.length === 0) return null;
  const verified = await Glyphs.find(
    {character: {$in: characters}, 'stages.verified': {$ne: null}},
    {fields: {character: 1}},
  ).fetchAsync();
  const verifiedSet = new Set(verified.map((g) => g.character));
  const startIndex = currentCharacter ? characters.indexOf(currentCharacter) : -1;
  for (let offset = 1; offset <= characters.length; offset++) {
    const ch = characters[(startIndex + offset) % characters.length];
    if (!verifiedSet.has(ch)) return await Glyphs.get(ch);
  }
  return null;
}

Glyphs.getPreviousVerified = async (glyph) => {
  return await Glyphs.getPrevious(glyph, {'stages.verified': {$ne: null}});
}

Glyphs.loadAll = async (characters) => {
  for (let character of characters) {
    const glyph = await Glyphs.get(character);
    if (!glyph.stages.verified) {
      await Glyphs.upsertAsync({character: glyph.character}, glyph);
    }
  }
  await Progress.refresh();
}

Glyphs.save = async (glyph) => {
  check(glyph.character, String);
  // Handle surrogate pairs (CJK Extension B characters have length 2 in JS)
  assert([...glyph.character].length === 1);
  const current = await Glyphs.get(glyph.character);
  if (current && current.stages.verified && !glyph.stages.verified) {
    await Glyphs.clearDependencies(glyph.character);
  }
  await Glyphs.syncDefinitionAndPinyin(glyph);
  if (glyph.stages.path && !glyph.stages.path.sentinel) {
    await Glyphs.upsertAsync({character: glyph.character}, glyph);
  } else {
    await Glyphs.removeAsync({character: glyph.character});
  }
  await Progress.refresh();
  if (Meteor.isServer) {
    await Glyphs.syncStrokeDataFile(glyph);
  }
}

// Writes (or removes) `public/stroke-data/<HEX>.json` for a single glyph and
// refreshes the manifest at `public/stroke-data/index.json`, so that the
// chunom-practice app picks up newly verified characters without any manual
// export step. No-op if the glyph has not yet reached the `verified` stage.
Glyphs.syncStrokeDataFile = async (glyph) => {
  const fs = require('fs');
  const path = require('path');
  const strokeDataDir = path.join(getPWD(), 'public', 'stroke-data');
  const filename = `${glyph.codepoint.toString(16).toUpperCase()}.json`;
  const filepath = path.join(strokeDataDir, filename);
  const record = Glyphs.buildStrokeDataRecord(glyph);
  try {
    let changed = false;
    if (!record) {
      if (fs.existsSync(filepath)) {
        fs.unlinkSync(filepath);
        changed = true;
      }
    } else {
      fs.mkdirSync(strokeDataDir, {recursive: true});
      const serialized = JSON.stringify(record);
      const existing = fs.existsSync(filepath)
        ? fs.readFileSync(filepath, 'utf8')
        : null;
      if (existing !== serialized) {
        fs.writeFileSync(filepath, serialized);
        changed = true;
      }
    }
    if (changed) Glyphs.refreshStrokeDataIndex(strokeDataDir);
  } catch (error) {
    console.error(`syncStrokeDataFile failed for ${glyph.character}:`, error);
  }
}

// Extracts the {character, strokes, medians} record that gets published to
// per-codepoint JSON files. Mirrors the logic in server/migration.js#dumpGlyph
// so the on-disk schema stays consistent. Returns null if the glyph is not
// ready for publication (not verified, or missing strokes/order).
Glyphs.buildStrokeDataRecord = (glyph) => {
  if (!glyph || !glyph.stages || !glyph.stages.verified) return null;
  const order = glyph.stages.order;
  const strokesStage = glyph.stages.strokes;
  if (!Array.isArray(order) || !strokesStage || !strokesStage.corrected) {
    return null;
  }
  const strokes = order.map((x) => strokesStage.corrected[x.stroke]);
  const medians = order.map((x) => x.median);
  if (strokes.some((x) => !x) || medians.some((x) => !x)) return null;
  return {character: glyph.character, strokes, medians};
}

Glyphs.refreshStrokeDataIndex = (strokeDataDir) => {
  const fs = require('fs');
  const path = require('path');
  const dir = strokeDataDir || path.join(getPWD(), 'public', 'stroke-data');
  const files = fs.readdirSync(dir).filter(
    (name) => name.endsWith('.json') && name !== 'index.json',
  ).sort();
  const characters = [];
  for (const file of files) {
    const codepoint = parseInt(file.replace(/\.json$/, ''), 16);
    if (Number.isNaN(codepoint)) continue;
    characters.push(String.fromCodePoint(codepoint));
  }
  const indexPath = path.join(dir, 'index.json');
  const serialized = JSON.stringify({count: characters.length, characters});
  const existing = fs.existsSync(indexPath)
    ? fs.readFileSync(indexPath, 'utf8')
    : null;
  if (existing !== serialized) {
    fs.writeFileSync(indexPath, serialized);
  }
}

// Back-fills `public/stroke-data/` from MongoDB: writes a per-codepoint JSON
// file for every glyph whose `stages.verified` is set. Useful after migrating,
// or to recover from a situation where on-disk files have drifted from the DB.
Glyphs.exportAllVerifiedToStrokeData = async () => {
  const verified = await Glyphs.find({'stages.verified': {$ne: null}}).fetchAsync();
  let written = 0;
  let skipped = 0;
  for (const glyph of verified) {
    const record = Glyphs.buildStrokeDataRecord(glyph);
    if (!record) {
      skipped++;
      continue;
    }
    await Glyphs.syncStrokeDataFile(glyph);
    written++;
  }
  return {written, skipped, total: verified.length};
}

Glyphs.syncDefinitionAndPinyin = async (glyph) => {
  const data = cjklib.getCharacterData(glyph.character);
  const base = cjklib.getCharacterData(data.simplified || glyph.character);
  const targets = [base.character].concat(base.traditional);
  if (targets.length === 1 || '干么着复'.indexOf(targets[0]) >= 0) {
    return;
  }
  const definition = glyph.metadata.definition || data.definition;
  const pinyin = glyph.metadata.pinyin || data.pinyin;
  await Glyphs.updateAsync({character: {$in: targets}}, {$set: {
    'metadata.definition': definition,
    'metadata.pinyin': pinyin,
  }}, {multi: true});
}

Progress.refresh = async () => {
  const total = await Glyphs.find().countAsync();
  const complete = await Glyphs.find({'stages.verified': {$ne: null}}).countAsync();
  await Progress.upsertAsync({}, {total: total, complete: complete, backup: false});
}

if (Meteor.isServer) {
  // Construct indices on the Glyphs table.
  Meteor.startup(async () => {
    await Glyphs.createIndexAsync({character: 1}, {unique: true});
    await Glyphs.createIndexAsync({codepoint: 1}, {unique: true});
    await Glyphs.createIndexAsync({'stages.verified': 1});

    // Refresh the Progress counter.
    await Progress.refresh();

    // Back-fill any verified glyphs that are missing from public/stroke-data/.
    // Subsequent verifications flow through Glyphs.save → syncStrokeDataFile,
    // so this only has work to do on first boot or after on-disk drift.
    try {
      const result = await Glyphs.exportAllVerifiedToStrokeData();
      console.log(`stroke-data sync: wrote ${result.written}, skipped ${result.skipped}, total verified ${result.total}`);
    } catch (error) {
      console.error('stroke-data sync failed:', error);
    }
  });

  // Register the methods above so they are available to the client.
  Meteor.methods({
    async getGlyph(character) {
      return await Glyphs.get(character);
    },
    async getNextGlyph(glyph) {
      return await Glyphs.getNext(glyph);
    },
    async getNextUnverifiedGlyph(glyph) {
      return await Glyphs.getNextUnverified(glyph);
    },
    async getNextVerifiedGlyph(glyph) {
      return await Glyphs.getNextVerified(glyph);
    },
    async getPreviousGlyph(glyph) {
      return await Glyphs.getPrevious(glyph);
    },
    async getPreviousUnverifiedGlyph(glyph) {
      return await Glyphs.getPreviousUnverified(glyph);
    },
    async getPreviousVerifiedGlyph(glyph) {
      return await Glyphs.getPreviousVerified(glyph);
    },
    async getNextUnverifiedGlyphInList(characters, currentCharacter) {
      check(characters, [String]);
      return await Glyphs.getNextUnverifiedInList(characters, currentCharacter);
    },
    async getUserAddedNomList() {
      return await Glyphs.getUserAddedNomList();
    },
    async getUserAddedNomBrowserList() {
      return await Glyphs.getUserAddedNomBrowserList();
    },
    async saveGlyph(glyph) {
      return await Glyphs.save(glyph);
    },
    async loadAllGlyphs(characters) {
      return await Glyphs.loadAll(characters);
    },
    async saveGlyphs(glyphs) {
      for (const glyph of glyphs) {
        await Glyphs.save(glyph);
      }
    },
    async exportAllVerifiedToStrokeData() {
      return await Glyphs.exportAllVerifiedToStrokeData();
    },
    // Fetches the digitizingvietnam.com character page and extracts any IDS
    // decomposition hints embedded in its etymology notes (which appear as
    // "<compA><IDS-op><compB>", e.g., "宁⿰字"). Returns an array of
    // canonical-form IDS strings (operator first, e.g., "⿰宁字"), deduped.
    async fetchDecompositionHint(character) {
      check(character, String);
      if (!character || [...character].length !== 1) {
        throw new Meteor.Error('bad-character', 'Expected a single character');
      }
      const url = 'https://www.digitizingvietnam.com/en/tools/han-nom-dictionaries/general'
        + '?q=' + encodeURIComponent(character);
      let res;
      try {
        res = await fetch(url, {
          headers: { 'User-Agent': 'make-me-a-chunom/1.0 (decomposition hint fetcher)' },
        });
      } catch (e) {
        throw new Meteor.Error('fetch-failed', String(e.message || e));
      }
      if (!res.ok) {
        throw new Meteor.Error('fetch-failed', `HTTP ${res.status}`);
      }
      const html = await res.text();
      const re = /(\p{Script=Han})(⿰|⿱|⿲|⿳|⿴|⿵|⿶|⿷|⿸|⿹|⿺|⿻)(\p{Script=Han})/gu;
      const seen = new Set();
      const hints = [];
      let m;
      while ((m = re.exec(html)) !== null) {
        const [_, a, op, b] = m;
        if (a === character || b === character) continue; // skip self
        const ids = op + a + b;
        if (seen.has(ids)) continue;
        seen.add(ids);
        hints.push(ids);
      }
      return hints;
    },
  });

  // Publish accessors that will get all glyphs in a list and get the progress.
  Meteor.publish('getAllGlyphs', function(characters) {
    return Glyphs.find({character: {$in: characters}});
  });
  Meteor.publish('getProgress', function() {
    return Progress.find({});
  });
}

export {Glyphs, Progress};
