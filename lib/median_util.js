import _ from 'lodash';
import simplify from '/lib/external/simplify/1.2.2/simplify';

import {assert, Point} from '/lib/base';
import {svg} from '/lib/svg';

const size = 1024;
const rise = 900;
const num_to_match = 8;

let voronoi = undefined;

const filterMedian = (median, n) => {
  const distances = _.range(median.length - 1).map(
      (i) => Math.sqrt(Point.distance2(median[i], median[i + 1])));
  let total = 0;
  distances.map((x) => total += x);
  const result = [];
  let index = 0;
  let position = median[0];
  let total_so_far = 0;
  for (let i of _.range(n - 1)) {
    const target = i*total/(n - 1);
    while (total_so_far < target) {
      const step = Math.sqrt(Point.distance2(position, median[index + 1]));
      if (total_so_far + step < target) {
        index += 1;
        position = median[index];
        total_so_far += step;
      } else {
        const t = (target - total_so_far)/step;
        position = [(1 - t)*position[0] + t*median[index + 1][0],
                    (1 - t)*position[1] + t*median[index + 1][1]];
        total_so_far = target;
      }
    }
    result.push(Point.clone(position));
  }
  result.push(median[median.length - 1]);
  return result;
}

const findLongestShortestPath = (adjacency, vertices, node) => {
  const path = findPathFromFurthestNode(adjacency, vertices, node);
  return findPathFromFurthestNode(adjacency, vertices, path[0]);
}

const findPathFromFurthestNode = (adjacency, vertices, node, visited) => {
  visited = visited || {};
  visited[node] = true;
  let result = [];
  result.distance = 0;
  for (let neighbor of adjacency[node] || []) {
    if (!visited[neighbor]) {
      const candidate = findPathFromFurthestNode(
          adjacency, vertices, neighbor, visited);
      candidate.distance +=
          Math.sqrt(Point.distance2(vertices[node], vertices[neighbor]));
      if (candidate.distance > result.distance) {
        result = candidate;
      }
    }
  }
  result.push(node);
  return result;
}

const findStrokeMedian = (stroke) => {
  const paths = svg.convertSVGPathToPaths(stroke);
  assert(paths.length === 1, `Got stroke with multiple loops: ${stroke}`);

  let polygon = undefined;
  let diagram = undefined;
  for (let approximation of [16, 64]) {
    polygon = svg.getPolygonApproximation(paths[0], approximation);
    voronoi = voronoi || new Voronoi;
    const sites = polygon.map((point) => ({x: point[0], y: point[1]}));
    const bounding_box = {xl: -size, xr: size, yt: -size, yb: size};
    try {
      diagram = voronoi.compute(sites, bounding_box);
      break;
    } catch(error) {
      console.error(`WARNING: Voronoi computation failed at ${approximation}.`);
    }
  }
  // Voronoi failed. Synthesize a median by finding the polygon's two
  // farthest-apart vertices and sampling a straight line between them.
  // For straight strokes (horizontal bars, vertical lines, diagonals)
  // this approximates the centerline well; for curves/hooks it degrades
  // gracefully instead of collapsing to a two-point nub.
  if (!diagram) {
    console.warn('Voronoi computation failed, synthesizing fallback median');
    if (polygon && polygon.length >= 2) {
      let a = polygon[0], b = polygon[0], bestD = 0;
      for (let i = 0; i < polygon.length; i++) {
        for (let j = i + 1; j < polygon.length; j++) {
          const d = (polygon[i][0] - polygon[j][0]) ** 2
                  + (polygon[i][1] - polygon[j][1]) ** 2;
          if (d > bestD) { bestD = d; a = polygon[i]; b = polygon[j]; }
        }
      }
      const samples = 5;
      const out = [];
      for (let k = 0; k < samples; k++) {
        const t = k / (samples - 1);
        out.push([
          Math.round(a[0] + (b[0] - a[0]) * t),
          Math.round(a[1] + (b[1] - a[1]) * t),
        ]);
      }
      return out;
    }
    return [[0, 0], [100, 100]]; // Last resort fallback
  }

  diagram.vertices.map((x, i) => {
    x.include = svg.polygonContainsPoint(polygon, [x.x, x.y]);
    x.index = i;
  });
  const vertices = diagram.vertices.map((x) => [x.x, x.y].map(Math.round));
  const edges = diagram.edges.map((x) => [x.va.index, x.vb.index]).filter(
      (x) => diagram.vertices[x[0]].include && diagram.vertices[x[1]].include);
  voronoi.recycle(diagram);

  if (edges.length === 0) {
    console.warn('No valid edges found, using fallback median');
    if (polygon && polygon.length >= 2) {
      const start = polygon[0].map(Math.round);
      const end = polygon[Math.floor(polygon.length / 2)].map(Math.round);
      return [start, end];
    }
    return [[0, 0], [100, 100]];
  }
  const adjacency = {};
  for (let edge of edges) {
    adjacency[edge[0]] = adjacency[edge[0]] || [];
    adjacency[edge[0]].push(edge[1]);
    adjacency[edge[1]] = adjacency[edge[1]] || [];
    adjacency[edge[1]].push(edge[0]);
  }
  const root = edges[0][0];
  const path = findLongestShortestPath(adjacency, vertices, root);
  const points = path.map((i) => vertices[i]);

  const tolerance = 4;
  const simple = simplify(points.map((x) => ({x: x[0], y: x[1]})), tolerance);
  return simple.map((x) => [x.x, x.y]);
}

const normalizeForMatch = (median) => {
  return filterMedian(median, num_to_match).map(
      (x) => [x[0]/size, (rise - x[1])/size]);
}

const median_util = {
  findStrokeMedian: findStrokeMedian,
  normalizeForMatch: normalizeForMatch,
};

export {median_util};
