import { AbstractStage } from "/client/lib/abstract";
import { assert, Point } from "/lib/base";
import { stroke_extractor, Endpoint } from "/lib/stroke_extractor";

const bridgeKey = (bridge) => bridge.map(Point.key).join("-");
// p1,p2,p3-p4,p2,p3
const removeBridge = (bridges, bridge) => {
  const keys = {};
  keys[bridgeKey(bridge)] = true;
  keys[bridgeKey([bridge[1], bridge[0]])] = true;
  return bridges.filter((bridge) => !keys[bridgeKey(bridge)]);
};

class BridgesStage extends AbstractStage {
  constructor(glyph) {
    super("bridges");
    const bridges = stroke_extractor.getBridges(glyph.stages.path);
    this.original = bridges.bridges;
    this.adjusted = glyph.stages.bridges || this.original;
    this.endpoints = bridges.endpoints.reduce((x, y) => x.concat(y), []);
    this.path = glyph.stages.path;
    this.selected_point = undefined;
    this.temp_point = undefined;
  }
  handleClickOnBridge(bridge) {
    this.adjusted = removeBridge(this.adjusted, bridge);
  }
  handleClickOnPoint(point) {
    if (this.selected_point === undefined) {
      this.selected_point = point;
      return;
    } else if (Point.equal(point, this.selected_point)) {
      this.selected_point = undefined;
      return;
    } //else if (Point.equal(point, this.temp_point)) {
    //   this.selected_point = this.temp_point;
    //   let points = Session.get("stage.points");
    //   points.push({
    //     cls: "selectable",
    //     cx: this.selected_point[0],
    //     cy: this.selected_point[1],
    //     fill: "green",
    //     stroke: "black",
    //   });
    //   Session.set("stage.points", points);
    //   return;
    // }
    const bridge = [point, this.selected_point];
    this.selected_point = undefined;
    const without = removeBridge(this.adjusted, bridge);
    if (without.length < this.adjusted.length) {
      return;
    }
    this.adjusted.push(bridge);
  }

  handleEvent(event, template) {
    if (template.x1 !== undefined) {
      const bridge = [
        [template.x1, template.y1],
        [template.x2, template.y2],
      ];
      this.handleClickOnBridge(bridge);
    } else if (template.cx !== undefined) {
      this.handleClickOnPoint([template.cx, template.cy]);
    }
  }

  createPoint(event) {
    const svg = $("svg g");
    var p = new DOMPoint(event.pageX, event.pageY);

    var sp = p.matrixTransform(svg[0].getScreenCTM().inverse());
    sp = [sp.x, sp.y];
    console.log(sp);

    var min = Infinity;
    var closest = this.endpoints[0].point;
    this.temp_points = closest;

    var idx = 0;

    let t = 0;
    this.endpoints.forEach((e, i) => {
      let seg = e.segments[0];
      let c;
      [c, t] = closestPointToBezier(seg.start, seg.end, seg.control, sp);
      let d = Point.distance2(c, sp);

      if (d < min) {
        min = d;
        closest = c;
        idx = i;
      }
    });

    let start = this.endpoints[idx].segments[0].start;
    let end = this.endpoints[idx].segments[0].end;
    let control = this.endpoints[idx].segments[0].control;

    let points = Session.get("stage.points");
    let sector = this.endpoints[idx].index[0];
    let endpoint_idx = this.endpoints[idx].index[1];
    let exterior = sector % 2 == 0; //exterior paths are anti-clockwise
    let newIndex = [sector, exterior ? endpoint_idx - 1 : endpoint_idx + 1];

    this.endpoints.splice(
      newIndex[1],
      0,
      new Endpoint(
        [
          [
            {
              start: start,
              control: Point.add(
                Point.scale(1 - t, start),
                Point.scale(t, control),
              ),
              end: closest,
            },
            {
              start: closest,
              control: Point.add(
                Point.scale(1 - t, closest),
                Point.scale(t, end),
              ),
              end: end,
            },
          ],
        ],
        newIndex,
        true,
      ),
    );
    // console.log(this.endpoints[idx]);
    // console.log(newIndex[1]);
    // console.log(this.endpoints);

    points.push({
      cls: "selectable",
      cx: closest[0],
      cy: closest[1],
      fill: "green",
      stroke: "black",
    });
    points.push({
      cls: "selectable",
      cx: start[0],
      cy: start[1],
      fill: "orange",
      stroke: "black",
    });
    points.push({
      cls: "selectable",
      cx: end[0],
      cy: end[1],
      fill: "orange",
      stroke: "black",
    });
    // points.push({
    //   cls: "selectable",
    //   cx: this.endpoints[idx].point[0],
    //   cy: this.endpoints[idx].point[1],
    //   fill: "purple",
    //   stroke: "black",
    // });
    Session.set("stage.points", points);

    const entry = {
      cls: "success",
      message: `Create a point at (${closest[0].toFixed(2)},${closest[1].toFixed(2)})\n`,
    };

    let statuses = Session.get("stage.status");
    statuses.push(entry);
    Session.set("stage.status", statuses);
  }

  refreshUI() {
    Session.set("stage.paths", [
      { d: this.path, fill: "gray", stroke: "gray" },
    ]);
    const keys = {};
    this.original.map((bridge) => {
      keys[bridgeKey(bridge)] = true;
      keys[bridgeKey([bridge[1], bridge[0]])] = true;
    });
    Session.set(
      "stage.lines",
      this.adjusted.map((bridge) => ({
        cls: "selectable",
        stroke: keys[bridgeKey(bridge)] ? "red" : "purple",
        x1: bridge[0][0],
        y1: bridge[0][1],
        x2: bridge[1][0],
        y2: bridge[1][1],
      })),
    );
    Session.set(
      "stage.points",
      this.endpoints.map((endpoint) => {
        let color = endpoint.corner ? "red" : "black";
        if (
          this.selected_point &&
          Point.equal(endpoint.point, this.selected_point)
        ) {
          color = "purple";
        }
        return {
          cls: "selectable",
          cx: endpoint.point[0],
          cy: endpoint.point[1],
          fill: color,
          stroke: color,
        };
      }),
    );
    const strokes = stroke_extractor.getStrokes(this.path, this.adjusted);
    const n = strokes.strokes.length;
    const message = `Extracted ${n} stroke${n == 1 ? "" : "s"}.`;
    const entry = { cls: "success", message: message };
    Session.set("stage.status", strokes.log.concat([entry]));
  }
}

//NOTE: this only works for quadratic and linear beziers.
function bezierPoint(t, start, end, control = undefined) {
  var x, y;
  if (control === undefined) {
    [x, y] = Point.add(Point.scale(end, t), Point.scale(start, 1 - t));
  } else {
    x =
      (1 - t) * (1 - t) * start[0] +
      2 * (1 - t) * t * control[0] +
      t * t * end[0];
    y =
      (1 - t) * (1 - t) * start[1] +
      2 * (1 - t) * t * control[1] +
      t * t * end[1];
  }
  return [x, y];
}

function closestPointToBezier(start, end, control, target) {
  var t;
  var precision = 100; //number of iterations
  const epsilon = 1e-6; //threshold
  var low = 0;
  var high = 1;

  for (let i = 0; i < precision; i++) {
    var mid = (low + high) / 2;
    var d_low = Point.distance2(bezierPoint(low, start, end, control), target);
    var d_mid = Point.distance2(bezierPoint(mid, start, end, control), target);
    var d_high = Point.distance2(
      bezierPoint(high, start, end, control),
      target,
    );

    if (d_mid < epsilon) {
      t = mid;
    }

    if (d_low < d_high) {
      high = mid;
    } else {
      low = mid;
    }
  }
  t = (low + high) / 2;
  return [bezierPoint(t, start, end, control), t];
}

function getBounds(start, end, control = undefined) {
  let maxx, maxy, minx, miny;

  // eazy win we already have the diagonal of a box
  if (control === undefined) {
    [maxx, minx] = start[0] > end[0] ? [start[0], end[0]] : [end[0], start[0]];
    [maxy, miny] = start[1] > end[1] ? [start[1], end[1]] : [end[1], start[1]];
  }
  // For quadratics, we need to find the extrama first
  let extrema = getExtrema(start, end, control);
  [maxx, maxy] = extrema.max;
  [minx, miny] = extrema.min;

  // rect:
  // A-B
  // | |
  // C-D
  // is defined as [A,B,C,D]
  return [
    [minx, miny],
    [maxx, miny],
    [minx, maxy],
    [maxx, maxy],
  ];
}

function getExtrema(start, end, control) {
  // For linear beziers,
  // there are only two possible extrema: t=1 and t=0
  // so we just evaluate them and see which is bigger
  if (control === undefined) {
    let p1 = bezierPoint(1, start, end);
    let p0 = bezierPoint(0, start, end);
    return p1[1] > p0[0]
      ? {
          max: p1,
          min: p0,
        }
      : {
          max: p0,
          min: p1,
        };
  }

  // For quadratic beziers,
  // there are three possible extrema: t=0, t=1
  // or B'(t) = 0, but only two will be real extrema
  // (one minimum and one maximum)

  // compute t1 (t=0) and t2 (t=1)
  console.log(start);
  console.log(end);
  console.log(control);
  let t1 = 1;
  let t2 = 0;
  let p1 = bezierPoint(1, start, end, control);
  let p2 = bezierPoint(0, start, end, control);

  // This variable is used to check if t3 is the
  // minima or maxima. true if y1 < y2
  let reverse = p1[1] < p2[1] ? true : false;

  let t3 = -start[1] / (control[1] - end[1]);

  // check if our solution is within 0 to 1
  console.log("FINDING SHIT:");
  console.log(t1);
  console.log(t2);
  if (t3 > 0 && t3 < 1) {
    // It is, so we have either a new min or max
    let extrema = bezierPoint(t3);
    console.log(t3);
    // If y1 > y2
    if (reverse) {
      if (extrema[1] > p1[1]) {
        return { max: extrema, min: p1 };
      }
      if (extrema[1] < p2[1]) {
        return { max: p1, min: extrema };
      }
    } else {
      if (extrema[1] < p1[1]) {
        return { max: p1, min: extrema };
      }
      if (extrema[1] > p2[1]) {
        return { max: extrema, min: p2 };
      }
    }
  }

  // no early return means that there is no solution to B'(t) = 0,
  // meaning that we can just return p1 and p2 and our max and min
  return reverse ? { max: p1, min: p2 } : { max: p2, min: p1 };
}

// Linear first derivative, i dont think i need this rn
// // For linear beziers, the derivative is a constant
// // since there is no rate of change in the gradient
// if ((control = undefined)) {
//     // rize over run to find the gradient
//     let m = (end[1] - start[1]) / (end[0] - start[0]);
//     // gradient is the first derivative
//     return (_t) => m;
// }

export { BridgesStage };
