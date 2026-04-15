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
    }
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
