import {getAnimationData} from '/lib/animation';
import {assert, getPWD, Point} from '/lib/base';
import {cjklib} from '/lib/cjklib';
import {Glyphs} from '/lib/glyphs';
import {fixStrokes} from '/lib/stroke_caps/fixStrokes';
import {stroke_extractor} from '/lib/stroke_extractor';
import {svg} from '/lib/svg';
import _ from 'lodash';

const addFrequencyField = (glyph) => {
  const data = cjklib.getCharacterData(glyph.character);
  glyph.metadata.frequency = data.frequency;
  Glyphs.save(glyph);
}

const addSimplifiedAndTraditionalFields = (glyph) => {
  const data = cjklib.getCharacterData(glyph.character);
  glyph.simplified = data.simplified;
  glyph.traditional = data.traditional;
  Glyphs.save(glyph);
}

const addStrokeCaps = (glyph) => {
  const raw = glyph.stages.strokes;
  if (raw.raw || raw.corrected) return;
  glyph.stages.strokes = {corrected: fixStrokes(raw), raw};
  Glyphs.save(glyph);
}

const checkStrokeExtractorStability = (glyph) => {
  const strokes = stroke_extractor.getStrokes(
      glyph.stages.path, glyph.stages.bridges);
  if (!_.isEqual(strokes.strokes.sort(), glyph.stages.strokes.sort())) {
    console.log(`Different strokes for ${glyph.character}`);
  }
}

const convertOldPathSchemaToSVGPath = (path) => {
  const terms = [];
  for (let segment of path) {
    assert('LMQZ'.indexOf(segment.type) >= 0, segment.type);
    terms.push(segment.type);
    if (segment.x1 !== undefined) {
      terms.push(segment.x1);
      terms.push(segment.y1);
    }
    if (segment.x !== undefined) {
      terms.push(segment.x);
      terms.push(segment.y);
    }
  }
  return terms.join(' ');
}

const dumpGlyph = (dictionary, graphics) => (glyph) => {
  // Log all glyphs being processed (for debugging)
  if (glyph.codepoint > 0xFFFF) {
    console.log(`Checking glyph: ${glyph.character} (U+${glyph.codepoint.toString(16).toUpperCase()}), verified: ${JSON.stringify(glyph.stages.verified)}`);
  }

  if (!glyph.stages.verified) {
    return;
  }
  const analysis = glyph.stages.analysis;
  const order = glyph.stages.order;

  // Debug logging for Extension B characters (codepoint > 0xFFFF)
  if (glyph.codepoint > 0xFFFF) {
    console.log(`Processing Extension B character: ${glyph.character} (U+${glyph.codepoint.toString(16).toUpperCase()})`);
  }

  if (!order || !Array.isArray(order)) {
    console.error(`Missing or invalid order for ${glyph.character}`);
    return;
  }

  if (!glyph.stages.strokes || !glyph.stages.strokes.corrected) {
    console.error(`Missing strokes.corrected for ${glyph.character}`);
    return;
  }

  const data = cjklib.getCharacterData(glyph.character);
  const pinyin = (glyph.metadata.pinyin || data.pinyin || '')
                     .split(',').map((x) => x.trim()).filter((x) => x);
  const strokes = order.map((x) => glyph.stages.strokes.corrected[x.stroke]);
  const medians = order.map((x) => x.median);

  // Check for missing strokes or medians
  const missingStrokes = strokes.filter((x, i) => !x);
  const missingMedians = medians.filter((x, i) => !x);
  if (missingStrokes.length > 0) {
    console.error(`Missing ${missingStrokes.length} strokes for ${glyph.character}`);
    return;
  }
  if (missingMedians.length > 0) {
    console.error(`Missing ${missingMedians.length} medians for ${glyph.character}`);
    return;
  }

  strokes.map((x) => assert(x));
  medians.map((x) => assert(x));
  const has_etymology =
      analysis.etymology.hint || (analysis.etymology.type === 'pictophonetic');

  dictionary.write(JSON.stringify({
    character: glyph.character,
    definition: glyph.metadata.definition || data.definition,
    pinyin: pinyin,
    decomposition: analysis.decomposition || '？',
    etymology: has_etymology ? analysis.etymology : undefined,
    radical: analysis.radical,
    matches: order.map((x) => x.match),
  }) + '\n');
  graphics.write(JSON.stringify({
    character: glyph.character,
    strokes: strokes,
    medians: medians,
  }) + '\n');

  // Log successful export for Extension B characters
  if (glyph.codepoint > 0xFFFF) {
    console.log(`Successfully exported: ${glyph.character}`);
  }
}

const fixBrokenMedians = (glyph, threshold) => {
  threshold = threshold || 16;
  for (let stroke of glyph.stages.order) {
    const distance = Math.sqrt(Point.distance2(
        stroke.median[0], stroke.median[stroke.median.length - 1]));
    if (distance < threshold) {
      console.log(`Found broken median in ${glyph.character}`);
      const paths = svg.convertSVGPathToPaths(
          glyph.stages.strokes[stroke.stroke]);
      assert(paths.length === 1);
      const polygon = svg.getPolygonApproximation(paths[0], threshold);
      let best_point = null;
      let best_value = -Infinity;
      for (let point of polygon) {
        const value = Point.distance2(point, stroke.median[0])
        if (value > best_value) {
          best_point = point;
          best_value = value;
        }
      }
      assert(best_point !== null);
      stroke.median = [best_point, stroke.median[0]];
      Glyphs.save(glyph);
    }
  }
}

const migrateOldGlyphSchemaToNew = (glyph) => {
  const codepoint = parseInt(glyph.name.substr(3), 16);
  const character = String.fromCodePoint(codepoint);
  const data = cjklib.getCharacterData(character);
  assert(glyph.manual && glyph.manual.verified !== undefined,
         `Glyph ${character} was not verified.`);
  // Pull definition and pinyin from simplified character, if available.
  let definition = undefined;
  let pinyin = undefined;
  if (data.simplified) {
    const simplified = Glyphs.get(data.simplified);
    const metadata = (simplified || {metadata: {}}).metadata;
    const base = cjklib.getCharacterData(data.simplified);
    definition = metadata.definition || base.definition;
    pinyin = metadata.pinyin || base.pinyin;
  }
  const result = {
    character: character,
    codepoint: codepoint,
    metadata: {
      definition: definition,
      frequency: data.frequency,
      kangxi_index: data.kangxi_index,
      pinyin: pinyin,
      strokes: undefined,
    },
    stages: {
      path: convertOldPathSchemaToSVGPath(glyph.path),
      bridges: glyph.manual.bridges,
      strokes: glyph.derived.strokes,
      analysis: undefined,
      order: undefined,
      verified: undefined,
    },
    simplified: data.simplified,
    traditional: data.traditional,
  };
  assert(result.stages.path !== undefined);
  assert(result.stages.bridges !== undefined);
  assert(result.stages.strokes !== undefined);
  return result;
}

// Meteor methods that make use of the migration system follow.

const dumpToNewSchemaJSON = async () => {
  const fs = require('fs');
  const path = require('path');
  const pwd = getPWD();

  // Export to separate files (don't overwrite main graphics.txt!)
  const dictionaryPath = path.join(pwd, 'public', 'dictionary_export.txt');
  const graphicsPath = path.join(pwd, 'public', 'graphics_export.txt');
  console.log(`Writing export files to: ${graphicsPath}`);

  const dictionary = fs.createWriteStream(dictionaryPath);
  const graphics = fs.createWriteStream(graphicsPath);
  await runMigration(dumpGlyph(dictionary, graphics), (() => {
    dictionary.end();
    graphics.end();
    console.log('Export complete. Files written to:');
    console.log(`  - ${dictionaryPath}`);
    console.log(`  - ${graphicsPath}`);
    console.log('Use "task stroke:export" to merge into main graphics.txt');
  }));
}

const exportSVGs = () => {
  // SSR package no longer available in Meteor 3.x
  console.log('exportSVGs is disabled - SSR not available');
  return;
}

const loadFromOldSchemaJSON = (filename) => {
  const fs = require('fs');
  const path = require('path');
  const filepath = path.join(getPWD(), 'public', filename);
  fs.readFile(filepath, 'utf8', Meteor.bindEnvironment((error, data) => {
    if (error) throw error;
    const lines = data.split('\n').filter((x) => x.length > 0);
    console.log(`Loaded ${lines.length} old-schema glyphs.`);
    let migrated = 0;
    let definition = 0;
    let pinyin = 0;
    for (var line of lines) {
      try {
        const old_glyph = JSON.parse(line);
        const new_glyph = migrateOldGlyphSchemaToNew(old_glyph);
        const glyph = Glyphs.get(new_glyph.character);
        if (glyph && glyph.stages.verified) {
          console.log(`Glyph already verified: ${glyph.character}`);
          continue;
        }
        Glyphs.save(new_glyph);
        migrated += 1;
        definition += new_glyph.metadata.definition ? 1 : 0;
        pinyin += new_glyph.metadata.pinyin ? 1 : 0;
      } catch (error) {
        console.error(error);
      }
    }
    console.log(`Successfully migrated ${migrated} glyphs.`);
    console.log(`Pulled definitions for ${definition} glyphs.`);
    console.log(`Pulled pinyin for ${pinyin} glyphs.`);
  }));
}

// Runs the given per-glyph callback for each glyph in the database.
// When all the glyphs are migrated, runs the completion callback.
const runMigration = async (per_glyph_callback, completion_callback) => {
  console.log('Running migration...');
  if (per_glyph_callback) {
    const codepoints = await Glyphs.find({}, {fields: {codepoint: 1}, sort: {codepoint: 1}}).fetchAsync();
    console.log(`Found ${codepoints.length} total glyphs in database`);

    // Count verified glyphs
    const verifiedCount = await Glyphs.find({'stages.verified': {$ne: null}}).countAsync();
    console.log(`Found ${verifiedCount} verified glyphs`);

    for (let i = 0; i < codepoints.length; i++) {
      const glyph = await Glyphs.findOneAsync({codepoint: codepoints[i].codepoint});
      assert(glyph, 'Glyphs changed during migration!');
      per_glyph_callback(glyph);
      if ((i + 1) % 1000 === 0) {
        console.log(`Migrated ${i + 1} glyphs.`);
      }
    }
  }
  if (completion_callback) {
    completion_callback();
  }
  console.log('Migration complete.');
}

Meteor.methods({
  'export': () => {
    cjklib.promise.then(Meteor.bindEnvironment(dumpToNewSchemaJSON))
                  .catch(console.error.bind(console));
  },
  'exportSVGs': exportSVGs,
  'loadFromOldSchemaJSON': (filename) => {
    cjklib.promise.then(
        Meteor.bindEnvironment(() => loadFromOldSchemaJSON(filename)))
                  .catch(console.error.bind(console));
  },
});

// HTTP endpoint to trigger export (for automation from external apps)
import { WebApp } from 'meteor/webapp';

WebApp.connectHandlers.use('/api/export', async (req, res) => {
  // Only allow POST
  if (req.method !== 'POST') {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false, error: 'Method not allowed' }));
    return;
  }

  try {
    await cjklib.promise;
    await dumpToNewSchemaJSON();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, message: 'Export completed' }));
  } catch (error) {
    console.error('Export API error:', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false, error: error.message }));
  }
});

Meteor.startup(() => {
  // SSR package no longer available in Meteor 3.x
  // SSR.compileTemplate('animation', Assets.getText('animation.html'));
  const completion_callback = undefined;
  const per_glyph_callback = undefined;
  if (!per_glyph_callback && !completion_callback) {
    return;
  }
  console.log('Preparing for migration...');
  const migration = () => runMigration(per_glyph_callback, completion_callback);
  cjklib.promise.then(Meteor.bindEnvironment(migration))
                .catch(console.error.bind(console));
});
