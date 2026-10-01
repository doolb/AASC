// 上游MIT核心的离线转换产物；请修改build-headless.js后重建。
var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: !0, configurable: !0, writable: !0, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key != "symbol" ? key + "" : key, value);
import { Vec3 } from "./Vec3.mjs";
import { Quat } from "./Quaternion.mjs";
class Pose {
  constructor(p = new Vec3(0, 0, 0), q = new Quat()) {
    __publicField(this, "p");
    __publicField(this, "q");
    this.p = p.clone(), this.q = q.clone();
  }
  copy(other) {
    this.p.copy(other.p), this.q.copy(other.q);
  }
  clone() {
    return new Pose(this.p, this.q);
  }
  translate(v) {
    v.add(this.p);
  }
  invTranslate(v) {
    v.sub(this.p);
  }
  rotate(v) {
    v.applyQuaternion(this.q);
  }
  invRotate(v) {
    const inv = this.q.clone().conjugate();
    v.applyQuaternion(inv);
  }
  transform(v) {
    v.applyQuaternion(this.q), v.add(this.p);
  }
  invTransform(v) {
    v.sub(this.p), this.invRotate(v);
  }
  transformPose(pose) {
    pose.q.multiplyQuaternions(this.q, pose.q), this.rotate(pose.p), pose.p.add(this.p);
  }
}
export {
  Pose
};
