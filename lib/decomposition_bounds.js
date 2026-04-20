import {assert, Point} from '/lib/base';

const rad2 = 1/2;

// For each compound IDS character, the bounding boxes its children occupy
// within the parent's bounds. Bounds are expressed as [origin, size] pairs
// in unit-square coordinates and are scaled to the parent's actual bounds
// by augmentTreeWithBoundsData.
const compound_bounds = {
  '⿰': [[[0, 0], [1/2, 1]], [[1/2, 0], [1/2, 1]]],
  '⿱': [[[0, 0], [1, 1/2]], [[0, 1/2], [1, 1/2]]],
  '⿴': [[[0, 0], [1, 1]], [[(1 - rad2)/2, (1 - rad2)/2], [rad2, rad2]]],
  '⿵': [[[0, 0], [1, 1]], [[(1 - rad2)/2, 1 - rad2], [rad2, rad2]]],
  '⿶': [[[0, 0], [1, 1]], [[(1 - rad2)/2, 0], [rad2, rad2]]],
  '⿷': [[[0, 0], [1, 1]], [[1 - rad2, (1 - rad2)/2], [rad2, rad2]]],
  '⿸': [[[0, 0], [1, 1 - rad2]], [[1 - rad2, 1 - rad2], [rad2, rad2]]],
  '⿹': [[[0, 0], [1, 1]], [[0, 1 - rad2], [rad2, rad2]]],
  '⿺': [[[0, 0], [1, 1]], [[1 - rad2, 0], [rad2, rad2]]],
  '⿻': [[[0, 0], [1, 1]], [[0, 0], [1, 1]]],
  '⿳': [[[0, 0], [1, 1/3]], [[0, 1/3], [1, 1/3]], [[0, 2/3], [1, 1/3]]],
  '⿲': [[[0, 0], [1/3, 1]], [[1/3, 0], [1/3, 1]], [[2/3, 0], [1/3, 1]]],
};

// Walks a decomposition tree, attaching a `bounds` field to each node based on
// the compound layout rules above. The root takes the supplied bounds; pass
// [[0,0],[1,1]] for unit-square placement or [[0,0],[1024,1024]] for direct
// SVG coordinates.
const augmentTreeWithBoundsData = (tree, bounds) => {
  tree.bounds = bounds;
  if (tree.type === 'compound') {
    const diff = Point.subtract(bounds[1], bounds[0]);
    const targets = compound_bounds[tree.value];
    assert(targets && targets.length === tree.children.length);
    for (let i = 0; i < targets.length; i++) {
      const target = [targets[i][0], Point.add(targets[i][0], targets[i][1])];
      const child_bounds = target.map(
          (x) => [x[0]*diff[0] + bounds[0][0], x[1]*diff[1] + bounds[0][1]]);
      augmentTreeWithBoundsData(tree.children[i], child_bounds);
    }
  } else {
    assert(!tree.children);
  }
  return tree;
};

// Returns all character-typed leaf nodes with a known value (not '?').
const collectComponentNodes = (tree, result) => {
  result = result || [];
  if (tree.type === 'character' && tree.value !== '?') {
    result.push(tree);
  }
  for (let child of tree.children || []) {
    collectComponentNodes(child, result);
  }
  return result;
};

// Returns a function mapping points from the source bounds to the target
// bounds via an axis-aligned affine transform.
const getAffineTransform = (source, target) => {
  const sdiff = Point.subtract(source[1], source[0]);
  const tdiff = Point.subtract(target[1], target[0]);
  const ratio = [tdiff[0]/sdiff[0], tdiff[1]/sdiff[1]];
  return (point) => [ratio[0]*(point[0] - source[0][0]) + target[0][0],
                     ratio[1]*(point[1] - source[0][1]) + target[0][1]];
};

// IDS compounds whose children split the parent region along a single axis.
// Maps the IDS character to the axis index (0 = x, 1 = y).
const axial_compounds = {
  '⿰': 0, '⿲': 0,
  '⿱': 1, '⿳': 1,
};

const unionBboxes = (bboxes) => {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const b of bboxes) {
    if (b[0][0] < minX) minX = b[0][0];
    if (b[0][1] < minY) minY = b[0][1];
    if (b[1][0] > maxX) maxX = b[1][0];
    if (b[1][1] > maxY) maxY = b[1][1];
  }
  return [[minX, minY], [maxX, maxY]];
};

// Walks a decomposition tree and assigns each node a `bounds` field derived
// from the actual contour bboxes of the parent path. At each compound node,
// the assigned contour set is partitioned among children: axial compounds
// (⿰⿲⿱⿳) split by the relevant axis using the parent bbox midpoints; other
// compounds fall back to the mechanical compound_bounds proportions.
//
// Returns true if every leaf node received at least one contour; false if the
// path's contour count is too small to populate the tree, in which case the
// caller should fall back to mechanical bounds.
const augmentTreeWithBoundsFromPath = (tree, contourBboxes) => {
  let success = true;
  const assign = (node, indices) => {
    if (indices.length === 0) {
      success = false;
      node.bounds = null;
      return;
    }
    node.bounds = unionBboxes(indices.map((i) => contourBboxes[i]));
    if (node.type !== 'compound') return;
    const axis = axial_compounds[node.value];
    const children = node.children || [];
    if (axis !== undefined) {
      const numChildren = children.length;
      const min = node.bounds[0][axis];
      const max = node.bounds[1][axis];
      const span = max - min;
      const groups = Array.from({length: numChildren}, () => []);
      for (const i of indices) {
        const c = (contourBboxes[i][0][axis] + contourBboxes[i][1][axis]) / 2;
        let bucket = span > 0
          ? Math.floor(((c - min) / span) * numChildren)
          : 0;
        if (bucket < 0) bucket = 0;
        if (bucket >= numChildren) bucket = numChildren - 1;
        groups[bucket].push(i);
      }
      children.forEach((child, k) => assign(child, groups[k]));
    } else {
      // Non-axial compound (⿴ ⿵ etc.) — fall back to mechanical proportions
      // of the parent's path-derived bounds.
      augmentTreeWithBoundsData(node, node.bounds);
    }
  };
  assign(tree, contourBboxes.map((_, i) => i));
  return success;
};

export {
  compound_bounds,
  augmentTreeWithBoundsData,
  augmentTreeWithBoundsFromPath,
  collectComponentNodes,
  getAffineTransform,
};
