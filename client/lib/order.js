import _ from 'lodash';
import {AbstractStage} from '/client/lib/abstract';
import {assert, Point} from '/lib/base';
import {
  augmentTreeWithBoundsData,
  collectComponentNodes,
  getAffineTransform,
} from '/lib/decomposition_bounds';
import {decomposition_util} from '/lib/decomposition_util';
import {Glyphs} from '/lib/glyphs';
import {Hungarian} from '/lib/hungarian';
import {median_util} from '/lib/median_util';

let stage = undefined;

const Order = new Mongo.Collection('order')._collection;

const buildStrokeOrder = (tree, log) => {
  if (tree.type === 'character') {
    if (!tree.medians) {
      log.push(`Missing component: ${tree.value}`);
      return [];
    }
    return tree.medians.map((x) => ({median: x, node: tree}));
  }
  const parts = tree.children.map((x) => buildStrokeOrder(x, log));
  const child = tree.children[0].value;
  if (tree.value === '⿻') {
    log.push('Cannot infer stroke order for compound ⿻.');
  } else if (tree.value === '⿴') {
    assert(parts.length === 2);
    if (parts[0].length !== 3) {
      log.push('Compound ⿴ requires first component 囗. ' +
               `Got ${child} instead.`);
    } else {
      return parts[0].slice(0, 2).concat(parts[1]).concat([parts[0][2]]);
    }
  } else if (tree.value === '⿷') {
    assert(parts.length === 2);
    if (parts[0].length !== 2) {
      log.push('Compound ⿷ requires first component ⼕ or ⼖. ' +
               `Got ${child} instead.`);
    } else {
      return parts[0].slice(0, 1).concat(parts[1]).concat([parts[0][1]]);
    }
  } else if (tree.value === '⿶' ||
             (tree.value === '⿺' && '辶廴乙'.indexOf(child) >= 0)) {
    assert(parts.length === 2);
    return parts[1].concat(parts[0]);
  }
  const result = [];
  parts.map((x) => x.map((y) => result.push(y)));
  return result;
}

const matchStrokes = (character, components) => {
  const normalize = median_util.normalizeForMatch;
  const sources = character.map(normalize);
  const targets = [];
  components.map((x) => {
    const transform = getAffineTransform([[0, 0], [1, 1]], x.node.bounds);
    const target = normalize(x.median).map(transform);
    targets.push(target);
  });

  const matrix = [];
  const missing_penalty = 1024;
  const n = Math.max(sources.length, targets.length);
  for (let i = 0; i < n; i++) {
    matrix.push([]);
    for (let j = 0; j < n; j++) {
      if (i < sources.length && j < targets.length) {
        matrix[i].push(scoreStrokes(sources[i], targets[j]));
      } else {
        let top_left_penalty = 0;
        if (j >= targets.length) {
          // We want strokes that are not matched with components to be sorted
          // by their proximity to the top-left corner of the glyph. We compute
          // a penalty which is smaller for strokes closer to this corner,
          // then multiply the penalty by j so that those strokes come first.
          const direction = [0.01, 0.02];
          top_left_penalty = -j*Math.min(
              Point.dot(direction, sources[i][0]),
              Point.dot(direction, sources[i][sources[i].length - 1]));
        }
        matrix[i].push(-missing_penalty - top_left_penalty);
      }
    }
  }
  return new Hungarian(matrix).x_match;
}

const maybeReverse = (median, match) => {
  const diff1 = Point.subtract(median[median.length - 1], median[0]);
  let diff2 = [1, -2]
  if (match) {
    const target = match.median;
    diff2 = Point.subtract(target[target.length - 1], target[0]);
  }
  if (Point.dot(diff1, diff2) < 0) {
    median.reverse();
  }
  return median;
}

const scoreStrokes = (stroke1, stroke2) => {
  assert(stroke1.length === stroke2.length);
  let option1 = 0;
  let option2 = 0;
  _.range(stroke1.length).map((i) => {
    option1 -= Point.distance2(stroke1[i], stroke2[i]);
    option2 -= Point.distance2(stroke1[i], stroke2[stroke2.length - i - 1]);
  });
  return Math.max(option1, option2);
}

class OrderStage extends AbstractStage {
  constructor(glyph) {
    super('order');
    this.adjusted = glyph.stages.order;
    this.medians = glyph.stages.strokes.raw.map(median_util.findStrokeMedian);
    this.strokes = glyph.stages.strokes.corrected;

    const tree = decomposition_util.convertDecompositionToTree(
        glyph.stages.analysis.decomposition);
    this.tree = augmentTreeWithBoundsData(tree, [[0, 0], [1, 1]]);

    this.indices = {null: -1};
    this.components = [];
    this.paths = [];
    collectComponentNodes(this.tree).map((x, i) => {
      this.indices[JSON.stringify(x.path)] = i;
      this.components.push(x.value);
      this.paths.push(x.path);
    });

    // Median-edit sub-mode. When a stroke is being edited, its median is
    // being replaced by draft waypoints authored via clicks on the glyph
    // canvas. Saving commits the draft into this.adjusted[N].median.
    this.editingStrokeIndex = null;
    this.draftMedian = null;

    stage = this;
  }
  isEditingMedian() {
    return this.editingStrokeIndex !== null;
  }
  onStartEditMedian(strokeIndex) {
    this.editingStrokeIndex = strokeIndex;
    this.draftMedian = [];
    const current = this.adjusted.find((x) => x.stroke === strokeIndex);
    if (current && Array.isArray(current.median)) {
      this.draftMedian = current.median.map((p) => [p[0], p[1]]);
    }
    this.forceRefresh();
  }
  onMedianClick(x, y) {
    if (!this.isEditingMedian()) return;
    this.draftMedian.push([Math.round(x), Math.round(y)]);
    this.forceRefresh();
  }
  onUndoMedianPoint() {
    if (!this.isEditingMedian() || !this.draftMedian.length) return;
    this.draftMedian.pop();
    this.forceRefresh();
  }
  onClearMedian() {
    if (!this.isEditingMedian()) return;
    this.draftMedian = [];
    this.forceRefresh();
  }
  onSaveMedian() {
    if (!this.isEditingMedian()) return;
    if (this.draftMedian.length < 2) return;
    const target = this.adjusted.find((x) => x.stroke === this.editingStrokeIndex);
    if (target) target.median = this.draftMedian.map((p) => [p[0], p[1]]);
    this.editingStrokeIndex = null;
    this.draftMedian = null;
    this.forceRefresh();
  }
  onCancelEditMedian() {
    this.editingStrokeIndex = null;
    this.draftMedian = null;
    this.forceRefresh();
  }
  handleEvent(event, template) {
    const element = this.adjusted.filter(
        (x) => x.stroke === template.stroke_index)[0];
    const old_index = this.indices[JSON.stringify(element.match || null)];
    const new_index = ((old_index + 2) % (this.components.length + 1)) - 1;
    element.match = this.paths[new_index];
  }
  onAllComponentsReady() {
    if (this.adjusted) {
      return;
    }
    const nodes = collectComponentNodes(this.tree);
    nodes.map((node) => {
      const glyph = Glyphs.findOne({character: node.value});
      node.medians = glyph.stages.order.map((x) => x.median);
    });
    const log = [];
    const order = buildStrokeOrder(this.tree, log);
    const matching = matchStrokes(this.medians, order);
    const indices = _.range(this.medians.length).sort(
        (a, b) => matching[a] - matching[b]);
    this.adjusted = indices.map((x) => {
      const match = order[matching[x]];
      return {
        match: match ? match.node.path : undefined,
        median: maybeReverse(this.medians[x], match),
        stroke: x,
      };
    });
    this.forceRefresh(true /* from_construct_stage */);
  }
  onReverseStroke(stroke) {
    const element = this.adjusted.filter((x) => x.stroke === stroke)[0];
    element.median.reverse();
    this.forceRefresh();
  }
  onSort(old_index, new_index) {
    const elements = this.adjusted.splice(old_index, 1);
    assert(elements.length === 1);
    this.adjusted.splice(new_index, 0, elements[0]);
    this.forceRefresh();
  }
  refreshUI() {
    let status = this.adjusted ? [] : [{
      cls: 'error',
      message: 'Loading component data...',
    }];
    if (this.isEditingMedian()) {
      const n = (this.draftMedian || []).length;
      status = [{
        cls: 'info',
        message: `Editing median for stroke ${this.editingStrokeIndex} — click along the stroke to place waypoints (${n} placed; need ≥ 2).`,
      }];
    }
    Session.set('stage.status', status);
    Session.set('stages.order.colors', this.colors);
    Session.set('stages.order.components', this.components);
    Session.set('stages.order.indices', this.indices);
    Session.set('stages.order.order', this.adjusted);
    Session.set('stages.order.editingStrokeIndex', this.editingStrokeIndex);
    Session.set('stages.order.draftMedian',
        this.draftMedian ? this.draftMedian.map((p) => [p[0], p[1]]) : null);
    // Flag entries whose median covers noticeably less than its stroke's
    // bounding box — surfaces "partial median" cases in the permutation
    // list so they're easy to spot.
    const parsePts = (d) => {
      const nums = (d.match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
      const p = [];
      for (let i = 0; i + 1 < nums.length; i += 2) p.push([nums[i], nums[i + 1]]);
      return p;
    };
    const bbox = (pts) => {
      if (!pts || pts.length < 2) return 0;
      let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
      for (const [x, y] of pts) {
        if (x < a) a = x; if (x > c) c = x;
        if (y < b) b = y; if (y > d) d = y;
      }
      return Math.hypot(c - a, d - b);
    };

    Order.remove({});
    (this.adjusted || []).map((x, i) => {
      const key = JSON.stringify(x.match || null);
      const color = this.colors[this.indices[key]] || 'lightgray';
      const glyph = {
        lines: [{
          x1: x.median[0][0],
          y1: x.median[0][1],
          x2: x.median[x.median.length - 1][0],
          y2: x.median[x.median.length - 1][1],
        }],
        paths: [{d: this.strokes[x.stroke]}],
      };
      const lighten = (color, alpha) => {
        const c = parseInt(color.substr(1), 16);
        return `rgba(${c >> 16}, ${(c >> 8) & 0xFF}, ${c & 0xFF}, ${alpha})`;
      };
      const strokeDiag = bbox(parsePts(this.strokes[x.stroke] || ''));
      const medDiag = bbox(x.median);
      const isPartial = strokeDiag > 0 && medDiag / strokeDiag < 0.5;
      Order.insert({
        background: lighten(color, 0.1),
        color: color,
        glyph: glyph,
        index: i,
        stroke_index: x.stroke,
        isPartial,
      });
    });
  }
}

Template.order_stage.events({
  'click .permutation .entry .reverse': function(event) {
    stage && stage.onReverseStroke(this.stroke_index);
  },
  'click .permutation .entry .edit-median': function(event) {
    event.preventDefault();
    Session.set('stages.order.hoverStrokeIndex', null);
    stage && stage.onStartEditMedian(this.stroke_index);
  },
  'mouseenter .permutation .entry .edit-median': function(event) {
    Session.set('stages.order.hoverStrokeIndex', this.stroke_index);
  },
  'mouseleave .permutation .entry .edit-median': function(event) {
    Session.set('stages.order.hoverStrokeIndex', null);
  },
  'click .median-edit-bar .save-median': function(event) {
    event.preventDefault();
    stage && stage.onSaveMedian();
  },
  'click .median-edit-bar .undo-median': function(event) {
    event.preventDefault();
    stage && stage.onUndoMedianPoint();
  },
  'click .median-edit-bar .clear-median': function(event) {
    event.preventDefault();
    stage && stage.onClearMedian();
  },
  'click .median-edit-bar .cancel-median': function(event) {
    event.preventDefault();
    stage && stage.onCancelEditMedian();
  },
});

Template.order_stage.onRendered(function() {
  import('sortablejs').then((module) => {
    const Sortable = module.default;
    const el = this.find('.sortable-list');
    if (el && !el._sortable) {
      el._sortable = Sortable.create(el, {
        animation: 150,
        onEnd: function(evt) {
          if (stage && evt.oldIndex !== evt.newIndex) {
            stage.onSort(evt.oldIndex, evt.newIndex);
          }
        }
      });
    }
  });
});

Template.order_stage.helpers({
  character: () => {
    const colors = Session.get('stages.order.colors');
    const indices = Session.get('stages.order.indices');
    const order = Session.get('stages.order.order');
    const character = Session.get('editor.glyph');
    const editingIdx = Session.get('stages.order.editingStrokeIndex');
    const draft = Session.get('stages.order.draftMedian');
    const hoverIdx = Session.get('stages.order.hoverStrokeIndex');
    const result = {paths: [], lines: [], points: []};
    if (!colors || !indices || !order || !character) {
      return result;
    }
    for (let element of order) {
      const index = indices[JSON.stringify(element.match || null)];
      const color = colors[index % colors.length];
      const isEditingThis = editingIdx === element.stroke;
      const isHoveredThis = !isEditingThis && hoverIdx === element.stroke;
      result.paths.push({
        cls: isEditingThis ? '' : 'selectable',
        d: character.stages.strokes.corrected[element.stroke],
        fill: isEditingThis
          ? '#fef3c7'
          : isHoveredThis
            ? '#fed7aa'
            : (index < 0 ? 'lightgray' : color),
        stroke: isEditingThis
          ? '#f59e0b'
          : isHoveredThis
            ? '#ea580c'
            : (index < 0 ? 'lightgray' : 'black'),
        stroke_index: element.stroke,
      });
    }
    // Choose which median to overlay: draft (while editing) or the stored
    // median of the hovered stroke.
    let overlay = null;
    if (editingIdx !== undefined && editingIdx !== null && Array.isArray(draft)) {
      overlay = draft;
    } else if (hoverIdx !== undefined && hoverIdx !== null) {
      const entry = order.find((e) => e && e.stroke === hoverIdx);
      if (entry && Array.isArray(entry.median)) overlay = entry.median;
    }
    if (overlay) {
      for (let i = 0; i + 1 < overlay.length; i++) {
        result.lines.push({
          x1: overlay[i][0], y1: overlay[i][1],
          x2: overlay[i + 1][0], y2: overlay[i + 1][1],
        });
      }
      overlay.forEach((p, i) => {
        const isHead = i === 0;
        const isTail = i === overlay.length - 1 && overlay.length > 1;
        result.points.push({
          cx: p[0], cy: p[1], r: 18,
          fill: isHead ? '#16a34a' : isTail ? '#dc2626' : '#ef4444',
          stroke: 'white',
        });
      });
    }
    return result;
  },
  components: () => {
    const colors = Session.get('stages.order.colors');
    const components = Session.get('stages.order.components');
    const result = [];
    if (!colors || !components) {
      return result;
    }
    for (let index = 0; index < components.length; index++) {
      const color = colors[index % colors.length];
      const glyph = Glyphs.findOne({character: components[index]});
      if (!glyph) {
        continue;
      }
      const component = [];
      for (let stroke of glyph.stages.strokes.corrected) {
        component.push({d: stroke, fill: color, stroke: 'black'});
      }
      result.push({glyph: {paths: component}, top: `${138*index + 8}px`});
    }
    return result;
  },
  items: () => {
    const order = Session.get('stages.order.order');
    return Order.find({}, {limit: (order || []).length});
  },
  options: () => {
    return {
      onSort: (event) => {
        // Suppress the two errors that will be printed when the Sortable
        // plugin tries to persist the sort result to the server.
        Meteor._suppress_log(2);
        stage && stage.onSort(event.oldIndex, event.newIndex);
      },
    }
  },
  editingMedian: () => {
    const idx = Session.get('stages.order.editingStrokeIndex');
    return idx !== undefined && idx !== null;
  },
  editingStrokeIndex: () => Session.get('stages.order.editingStrokeIndex'),
  draftCount: () => (Session.get('stages.order.draftMedian') || []).length,
  oneDraftPoint: () => (Session.get('stages.order.draftMedian') || []).length === 1,
  canSaveMedian: () => (Session.get('stages.order.draftMedian') || []).length >= 2,
  saveButtonAttrs: () => {
    const n = (Session.get('stages.order.draftMedian') || []).length;
    return n >= 2 ? {} : {disabled: 'disabled'};
  },
});

Meteor.startup(() => {
  Tracker.autorun(() => {
    const components = Session.get('stages.order.components') || [];
    Meteor.subscribe('getAllGlyphs', components);
  });
  Tracker.autorun(() => {
    const components = Session.get('stages.order.components') || [];
    const found = components.filter((x) => Glyphs.findOne({character: x}));
    if (found.length === components.length &&
        Session.get('stage.type') === 'order') {
      stage.onAllComponentsReady();
    }
  });
});

export {OrderStage};
