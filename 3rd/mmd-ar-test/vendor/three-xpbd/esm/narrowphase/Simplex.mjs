// 上游MIT核心的离线转换产物；请修改build-headless.js后重建。
var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: !0, configurable: !0, writable: !0, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key != "symbol" ? key + "" : key, value);
class Simplex {
  constructor() {
    __publicField(this, "points", []);
    __publicField(this, "size", 0);
    this.points = [], this.size = 0;
  }
  assign(points) {
    for (const i in points) {
      const v = points[i];
      this.points[i] = v;
    }
    return this.size = points.length, this;
  }
  push_front(point) {
    this.points = [point, this.points[0], this.points[1], this.points[2]], this.size = Math.min(this.size + 1, this.points.length);
  }
}
export {
  Simplex
};
