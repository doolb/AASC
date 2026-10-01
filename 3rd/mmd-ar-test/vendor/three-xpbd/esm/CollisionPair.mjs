// 上游MIT核心的离线转换产物；请修改build-headless.js后重建。
import { Vec3 } from "./Vec3.mjs";
class CollisionPair {
  constructor(A, B) {
    this.A = A;
    this.B = B;
    if (A === B || A.id == B.id)
      throw new Error("Cannot create a CollisionPair with the same body");
    Vec3.sub(A.vel, B.vel).lengthSq() > 0.01 && (A.wake(), B.wake());
  }
}
export {
  CollisionPair
};
