/**
 * Validate stroke data files for hanzi-writer compatibility.
 */

import * as fs from 'fs';
import * as path from 'path';

interface StrokeData {
  character: string;
  strokes: string[];
  medians: number[][][];
}

interface ValidationResult {
  file: string;
  character: string;
  valid: boolean;
  errors: string[];
  warnings: string[];
}

function validateSVGPath(pathData: string): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!pathData || pathData.trim() === '') {
    errors.push('Empty path');
    return { valid: false, errors };
  }

  // Must start with M (moveto)
  if (!pathData.trim().toUpperCase().startsWith('M')) {
    errors.push('Path must start with M command');
  }

  // Check for valid SVG commands
  const validCommands = /^[MmLlHhVvCcSsQqTtAaZz\s\d.,\-eE]+$/;
  if (!validCommands.test(pathData)) {
    errors.push('Invalid characters in path');
  }

  return { valid: errors.length === 0, errors };
}

function validateMedians(medians: number[][], strokeIndex: number): { valid: boolean; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!Array.isArray(medians) || medians.length === 0) {
    errors.push(`Stroke ${strokeIndex}: Empty medians`);
    return { valid: false, errors, warnings };
  }

  for (let i = 0; i < medians.length; i++) {
    const point = medians[i];

    if (!Array.isArray(point) || point.length !== 2) {
      errors.push(`Stroke ${strokeIndex}, point ${i}: Must be [x, y] array`);
      continue;
    }

    const [x, y] = point;

    if (typeof x !== 'number' || typeof y !== 'number') {
      errors.push(`Stroke ${strokeIndex}, point ${i}: Coordinates must be numbers`);
      continue;
    }

    // Check coordinate ranges
    if (x < 0 || x > 1024) {
      warnings.push(`Stroke ${strokeIndex}, point ${i}: x=${x} outside [0, 1024]`);
    }
    if (y < -200 || y > 1000) {
      warnings.push(`Stroke ${strokeIndex}, point ${i}: y=${y} outside [-200, 1000]`);
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

function validateStrokeData(data: StrokeData, filename: string): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check required fields
  if (!data.character) {
    errors.push('Missing "character" field');
  }

  if (!Array.isArray(data.strokes) || data.strokes.length === 0) {
    errors.push('Missing or empty "strokes" array');
  }

  if (!Array.isArray(data.medians) || data.medians.length === 0) {
    errors.push('Missing or empty "medians" array');
  }

  // Check stroke/median count match
  if (data.strokes && data.medians && data.strokes.length !== data.medians.length) {
    errors.push(`Stroke count (${data.strokes.length}) !== median count (${data.medians.length})`);
  }

  // Validate each stroke
  if (data.strokes) {
    for (let i = 0; i < data.strokes.length; i++) {
      const result = validateSVGPath(data.strokes[i]);
      errors.push(...result.errors.map(e => `Stroke ${i}: ${e}`));
    }
  }

  // Validate each median
  if (data.medians) {
    for (let i = 0; i < data.medians.length; i++) {
      const result = validateMedians(data.medians[i], i);
      errors.push(...result.errors);
      warnings.push(...result.warnings);
    }
  }

  return {
    file: filename,
    character: data.character || '?',
    valid: errors.length === 0,
    errors,
    warnings
  };
}

function main() {
  const dataDir = path.join(__dirname, '../data');

  if (!fs.existsSync(dataDir)) {
    console.log('No data directory found. Create stroke data files in data/');
    return;
  }

  const jsonFiles = fs.readdirSync(dataDir)
    .filter(f => f.endsWith('.json') && !f.includes('priority') && !f.includes('coverage'));

  if (jsonFiles.length === 0) {
    console.log('No stroke data JSON files found in data/');
    console.log('Files like priority-chars.json and coverage-report.json are excluded.');
    return;
  }

  console.log(`Validating ${jsonFiles.length} stroke data files...\n`);

  const results: ValidationResult[] = [];

  for (const file of jsonFiles) {
    try {
      const content = fs.readFileSync(path.join(dataDir, file), 'utf-8');
      const data = JSON.parse(content) as StrokeData;
      const result = validateStrokeData(data, file);
      results.push(result);

      const status = result.valid ? '✓' : '✗';
      console.log(`${status} ${result.character} (${file})`);

      if (result.errors.length > 0) {
        result.errors.forEach(e => console.log(`    ERROR: ${e}`));
      }
      if (result.warnings.length > 0 && result.warnings.length <= 3) {
        result.warnings.forEach(w => console.log(`    WARN: ${w}`));
      } else if (result.warnings.length > 3) {
        console.log(`    WARN: ${result.warnings.length} warnings (run with --verbose to see all)`);
      }
    } catch (error) {
      results.push({
        file,
        character: '?',
        valid: false,
        errors: [`Parse error: ${error}`],
        warnings: []
      });
      console.log(`✗ ${file}: Parse error`);
    }
  }

  // Summary
  const valid = results.filter(r => r.valid).length;
  const invalid = results.filter(r => !r.valid).length;

  console.log('\n' + '='.repeat(50));
  console.log('VALIDATION SUMMARY');
  console.log('='.repeat(50));
  console.log(`Total files: ${results.length}`);
  console.log(`Valid: ${valid}`);
  console.log(`Invalid: ${invalid}`);
}

main();
