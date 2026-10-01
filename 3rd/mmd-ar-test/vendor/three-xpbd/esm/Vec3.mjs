// 上游MIT核心的离线转换产物；请修改build-headless.js后重建。
import { Vector3 } from "three";
class Vec3 extends Vector3 {
  mul(s) {
    return this.multiplyScalar(s);
  }
  static mul(v, s) {
    return v.clone().multiplyScalar(s);
  }
  static div(v, s) {
    return v.clone().divideScalar(s);
  }
  static add(v1, v2) {
    return new Vec3().addVectors(v1, v2);
  }
  static sub(v1, v2) {
    return new Vec3().subVectors(v1, v2);
  }
  static normalize(v) {
    return v.clone().normalize();
  }
  static cross(v1, v2) {
    return new Vec3().crossVectors(v1, v2);
  }
  static dot(v1, v2) {
    return v1.dot(v2);
  }
}
export {
  Vec3
};
