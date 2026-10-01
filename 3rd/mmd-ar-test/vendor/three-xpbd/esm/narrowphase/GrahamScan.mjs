// 上游MIT核心的离线转换产物；请修改build-headless.js后重建。
var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: !0, configurable: !0, writable: !0, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key != "symbol" ? key + "" : key, value);
import { Vec2 } from "../Vec2.mjs";
const X = 0, Y = 1, REMOVED = -1;
class GrahamScan {
  constructor() {
    __publicField(this, "points", []);
    this.points = [];
  }
  setPoints(points) {
    return this.points = points.map((v) => v.toArray()), this;
  }
  getHull() {
    const pivot = this.preparePivotPoint();
    let indexes = Array.from(this.points, (point, i) => i);
    const angles = Array.from(this.points, (point) => this.getAngle(pivot, point)), distances = Array.from(this.points, (point) => this.euclideanDistanceSquared(pivot, point));
    indexes.sort((i, j) => {
      const angleA = angles[i], angleB = angles[j];
      if (angleA === angleB) {
        const distanceA = distances[i], distanceB = distances[j];
        return distanceA - distanceB;
      }
      return angleA - angleB;
    });
    for (let i = 1; i < indexes.length - 1; i++)
      angles[indexes[i]] === angles[indexes[i + 1]] && (indexes[i] = REMOVED);
    const hull = [];
    for (let i = 0; i < indexes.length; i++) {
      const index = indexes[i], point = this.points[index];
      if (index !== REMOVED)
        if (hull.length < 3)
          hull.push(point);
        else {
          for (; this.checkOrientation(hull[hull.length - 2], hull[hull.length - 1], point) > 0; )
            hull.pop();
          hull.push(point);
        }
    }
    return hull.length < 3 ? [] : hull.map((v) => new Vec2(v[0], v[1]));
  }
  /**
   * Check the orientation of 3 points in the order given.
   *
   * It works by comparing the slope of P1->P2 vs P2->P3. If P1->P2 > P2->P3, orientation is clockwise; if
   * P1->P2 < P2->P3, counter-clockwise. If P1->P2 == P2->P3, points are co-linear.
   */
  checkOrientation(p1, p2, p3) {
    return (p2[Y] - p1[Y]) * (p3[X] - p2[X]) - (p3[Y] - p2[Y]) * (p2[X] - p1[X]);
  }
  getAngle(a, b) {
    return Math.atan2(b[Y] - a[Y], b[X] - a[X]);
  }
  euclideanDistanceSquared(p1, p2) {
    const a = p2[X] - p1[X], b = p2[Y] - p1[Y];
    return a * a + b * b;
  }
  preparePivotPoint() {
    let pivot = this.points[0], pivotIndex = 0;
    for (let i = 1; i < this.points.length; i++) {
      const point = this.points[i];
      (point[Y] < pivot[Y] || point[Y] === pivot[Y] && point[X] < pivot[X]) && (pivot = point, pivotIndex = i);
    }
    return pivot;
  }
}
export {
  GrahamScan
};
