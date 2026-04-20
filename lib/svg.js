import { assert, Point } from "/lib/base";

const svg = {};

// A normal-form SVG path string is a data string with the following properties:
//   - Every command in the path is in ['L', 'M', 'Q', 'Z'].
//   - Adjacent tokens in the path are separated by exactly one space.
//   - There is exactly one 'Z', and it is the last command.
//
// A segment is a section of a path, represented as an object that has a start,
// an end, and possibly a control, all of which are valid Points (that is, pairs
// of Numbers).
//
// A path is a list of segments which is non-empty and closed - that is, the end
// of the last segment on the path is the start of the first.

// Returns twice the area contained in the polygon. The result is positive iff
// the polygon winds in the counter-clockwise direction.
const get2xArea = (polygon) => {
  let area = 0;
  for (var i = 0; i < polygon.length; i++) {
    const p1 = polygon[i];
    const p2 = polygon[(i + 1) % polygon.length];
    area += (p2[0] + p1[0]) * (p2[1] - p1[1]);
  }
  return area;
};

// Takes a list of paths and orients them so that exterior contours are oriented
// counter-clockwise and interior contours clockwise.
const orientPaths = (paths, approximation_error) => {
  const polygons = paths.map(svg.getPolygonApproximation);
  for (var i = 0; i < paths.length; i++) {
    const path = paths[i];
    let contains = 0;
    for (let j = 0; j < paths.length; j++) {
      if (j === i) {
        continue;
      } else if (svg.polygonContainsPoint(polygons[j], path[0].start)) {
        contains += 1;
      }
    }
    const area = get2xArea(polygons[i]);
    // The path is an external path if it is contained in an even number of
    // other paths. It is counter-clockwise if its area is positive. The path
    // should be reversed if (CCW && internal) || (CW && external).
    const should_reverse = area > 0 !== (contains % 2 === 0);
    if (should_reverse) {
      for (let segment of path) {
        [segment.start, segment.end] = [segment.end, segment.start];
      }
      path.reverse();
    }
  }
  return paths;
};

// Takes a normal-form SVG path string and converts
// it to a list of Quadratic Bezier and Line paths.
// M a b     -> start: a b
// Q a b c d -> control: a b, end c d
// L a b     -> end: a b
// Z         -> halt
const splitPath = (path) => {
  assert(path.length > 0);
  assert(path[0] === "M", `Path did not start with M: ${path}`);
  assert(path[path.length - 1] === "Z", `Path did not end with Z: ${path}`);
  const terms = path.split(" ");
  const result = [];
  let start = undefined;
  let current = undefined;
  for (let i = 0; i < terms.length; i++) {
    const command = terms[i];
    assert(command.length > 0, `Path includes empty command: ${path}`);
    assert("LMQZ".indexOf(command) >= 0, command);
    if (command === "M" || command === "Z") {
      if (current !== undefined) {
        assert(Point.equal(current, start), `Path has open contour: ${path}`);
        assert(
          result[result.length - 1].length > 0,
          `Path has empty contour: ${path}`,
        );
        if (command === "Z") {
          assert(i === terms.length - 1, `Path ended early: ${path}`);
          return result;
        }
      }
      result.push([]);
      assert(i < terms.length - 2, `Missing point on path: ${path}`);
      start = [parseFloat(terms[i + 1], 10), parseFloat(terms[i + 2], 10)];
      assert(Point.valid(start));
      i += 2;
      current = Point.clone(start);
      continue;
    }
    let control = undefined;
    if (command === "Q") {
      assert(i < terms.length - 2, `Missing point on path: ${path}`);
      control = [parseFloat(terms[i + 1], 10), parseFloat(terms[i + 2], 10)];
      assert(Point.valid(control));
      i += 2;
    }
    // We read the next two coordinates since Q needs c d and L needs
    // a b. Both mark the end
    assert(i < terms.length - 2, `Missing point on path: ${path}`);
    const end = [parseFloat(terms[i + 1], 10), parseFloat(terms[i + 2], 10)];
    assert(Point.valid(end));
    i += 2;
    if (Point.equal(current, end)) {
      continue;
    }
    if (
      control !== undefined &&
      (Point.equal(control, current) || Point.equal(control, end))
    ) {
      control = undefined;
    }
    result[result.length - 1].push({
      start: Point.clone(current),
      control: control,
      end: end,
    });
    current = Point.clone(end);
  }
};

// Takes a TrueType font command list (as provided by opentype.js) and returns
// a normal-form SVG path string as defined above.
svg.convertCommandsToPath = (commands) => {
  const terms = [];
  for (let i = 0; i < commands.length; i++) {
    const command = commands[i];
    assert("LMQZ".indexOf(command.type) >= 0, command.type);
    if (command.type === "Z") {
      assert(i === commands.length - 1);
      break;
    }
    terms.push(command.type);
    assert((command.x1 !== undefined) === (command.type === "Q"));
    if (command.x1 !== undefined) {
      terms.push(command.x1);
      terms.push(command.y1);
    }
    assert(command.x !== undefined);
    terms.push(command.x);
    terms.push(command.y);
  }
  terms.push("Z");
  return terms.join(" ");
};

// Converts a normal-form SVG path string to a list of paths. The paths obey an
// orientation constraint: the external paths are oriented counter-clockwise,
// while the internal paths are oriented clockwise.
svg.convertSVGPathToPaths = (path) => {
  return orientPaths(splitPath(path));
};

// Takes the given list of paths and returns a normal-form SVG path string.
svg.convertPathsToSVGPath = (paths) => {
  const terms = [];
  for (let path of paths) {
    assert(path.length > 0);
    terms.push("M");
    terms.push(path[0].start[0]);
    terms.push(path[0].start[1]);
    for (let segment of path) {
      if (segment.control === undefined) {
        terms.push("L");
      } else {
        terms.push("Q");
        terms.push(segment.control[0]);
        terms.push(segment.control[1]);
      }
      terms.push(segment.end[0]);
      terms.push(segment.end[1]);
    }
  }
  terms.push("Z");
  return terms.join(" ");
};

// Returns the axis-aligned bounding box [[minX, minY], [maxX, maxY]] of every
// coordinate that appears in the path string. Tolerant of any standard
// absolute SVG command (the same set transformPath supports plus H/V).
svg.pathBoundingBox = (path) => {
  const coordsPerCommand = {M: 1, L: 1, Q: 2, C: 3, T: 1, S: 2};
  const terms = path.split(" ").filter((x) => x.length > 0);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let i = 0;
  while (i < terms.length) {
    const cmd = terms[i];
    if (cmd === "Z" || cmd === "z") { i += 1; continue; }
    const n = coordsPerCommand[cmd.toUpperCase()];
    assert(n !== undefined, `Unsupported SVG path command: ${cmd}`);
    for (let k = 0; k < n; k++) {
      const x = parseFloat(terms[i + 1 + 2 * k]);
      const y = parseFloat(terms[i + 2 + 2 * k]);
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    i += 1 + 2 * n;
  }
  return [[minX, minY], [maxX, maxY]];
};

// Returns one bounding box per closed contour in the path, in document order.
// Each contour starts at an M command and ends at the next M (or end of path).
svg.contourBoundingBoxes = (path) => {
  const coordsPerCommand = {M: 1, L: 1, Q: 2, C: 3, T: 1, S: 2};
  const terms = path.split(" ").filter((x) => x.length > 0);
  const result = [];
  let cur = null;
  const flush = () => {
    if (cur && isFinite(cur[0][0])) result.push(cur);
    cur = [[Infinity, Infinity], [-Infinity, -Infinity]];
  };
  flush();
  let i = 0;
  while (i < terms.length) {
    const cmd = terms[i];
    if (cmd === "Z" || cmd === "z") { i += 1; continue; }
    const upper = cmd.toUpperCase();
    if (upper === "M") flush();
    const n = coordsPerCommand[upper];
    assert(n !== undefined, `Unsupported SVG path command: ${cmd}`);
    for (let k = 0; k < n; k++) {
      const x = parseFloat(terms[i + 1 + 2 * k]);
      const y = parseFloat(terms[i + 2 + 2 * k]);
      if (x < cur[0][0]) cur[0][0] = x;
      if (x > cur[1][0]) cur[1][0] = x;
      if (y < cur[0][1]) cur[0][1] = y;
      if (y > cur[1][1]) cur[1][1] = y;
    }
    i += 1 + 2 * n;
  }
  if (cur && isFinite(cur[0][0])) result.push(cur);
  return result;
};

// Applies a point-to-point function to every coordinate pair in an SVG path
// string. Handles all absolute commands that appear in upstream makemeahanzi
// data (M, L, Q, C, T, S, Z). H/V/A and relative commands are not used by
// stored strokes. Assumes positive-determinant transforms.
svg.transformPath = (path, fn) => {
  const coordsPerCommand = {M: 1, L: 1, Q: 2, C: 3, T: 1, S: 2};
  const terms = path.split(" ").filter((x) => x.length > 0);
  const out = [];
  let i = 0;
  while (i < terms.length) {
    const cmd = terms[i];
    if (cmd === "Z" || cmd === "z") {
      out.push(cmd);
      i += 1;
      continue;
    }
    const upper = cmd.toUpperCase();
    const n = coordsPerCommand[upper];
    assert(n !== undefined, `Unsupported SVG path command: ${cmd}`);
    out.push(cmd);
    for (let k = 0; k < n; k++) {
      const x = parseFloat(terms[i + 1 + 2 * k]);
      const y = parseFloat(terms[i + 2 + 2 * k]);
      const [tx, ty] = fn([x, y]);
      out.push(tx, ty);
    }
    i += 1 + 2 * n;
  }
  return out.join(" ");
};

// Takes a path (a list of segments) and returns a polygon approximation to it.
// The polygon is given as a list of pairs of points.
//
// The approximation error is an upper-bound on the distance between consecutive
// points in the polygon approximation used to compute the area. The default
// error of 64 is chosen because the glyphs have a total size of 1024x1024.
svg.getPolygonApproximation = (path, approximation_error) => {
  const result = [];
  approximation_error = approximation_error || 64;
  for (let x of path) {
    const control = x.control || Point.midpoint(x.start, x.end);
    const distance = Math.sqrt(Point.distance2(x.start, x.end));
    const num_points = Math.floor(distance / approximation_error);
    for (let i = 0; i < num_points; i++) {
      const t = (i + 1) / (num_points + 1);
      const s = 1 - t;
      result.push([
        s * s * x.start[0] + 2 * s * t * control[0] + t * t * x.end[0],
        s * s * x.start[1] + 2 * s * t * control[1] + t * t * x.end[1],
      ]);
    }
    result.push(x.end);
  }
  return result;
};

// Returns true if the given point is contained inside the given polygon.
svg.polygonContainsPoint = (polygon, point) => {
  const x = point[0];
  const y = point[1];
  let crossings = 0;
  for (let i = 0; i < polygon.length; i++) {
    const segment = {
      start: polygon[i],
      end: polygon[(i + 1) % polygon.length],
    };
    if (
      (segment.start[0] < x && x < segment.end[0]) ||
      (segment.start[0] > x && x > segment.end[0])
    ) {
      const t = (x - segment.end[0]) / (segment.start[0] - segment.end[0]);
      const cy = t * segment.start[1] + (1 - t) * segment.end[1];
      if (y > cy) {
        crossings += 1;
      }
    } else if (segment.start[0] === x && segment.start[1] <= y) {
      if (segment.end[0] > x) {
        crossings += 1;
      }
      const last = polygon[(i + polygon.length - 1) % polygon.length];
      if (last[0] > x) {
        crossings += 1;
      }
    }
  }
  return crossings % 2 === 1;
};

export { svg };
