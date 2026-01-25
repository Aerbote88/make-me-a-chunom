import {assert} from '/lib/base';
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
  assert(glyph.character.length === 1);
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
