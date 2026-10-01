// 上游MIT核心的离线转换产物；请修改build-headless.js后重建。
var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: !0, configurable: !0, writable: !0, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key != "symbol" ? key + "" : key, value);
import { Vec3 } from "./Vec3.mjs";
class ContactSet {
  // Current constraint force (normal direction) == -contact.lambda_n / (h * h);
  constructor(A, B, normal, p1, p2, r1, r2) {
    __publicField(this, "A");
    __publicField(this, "B");
    // plane: Plane;
    __publicField(this, "lambda", 0);
    //  λ   - lambda
    __publicField(this, "lambda_n", 0);
    //  λn  - lambda N (normal)
    __publicField(this, "lambda_t", 0);
    //  λn  - lambda T (tangential)
    /**
     * Contact point (world, on A)
     */
    __publicField(this, "p1", new Vec3(0, 0, 0));
    /**
     * Contact point (world, on B)
     */
    __publicField(this, "p2", new Vec3(0, 0, 0));
    /**
     * Contact point (local on A)
     */
    __publicField(this, "r1", new Vec3(0, 0, 0));
    /**
     * Contact point (local on B)
     */
    __publicField(this, "r2", new Vec3(0, 0, 0));
    /**
     * Contact normal
     */
    __publicField(this, "n", new Vec3(0, 0, 0));
    /**
     * Penetration depth
     */
    __publicField(this, "d", 0);
    /**
     * Relative velocity
     */
    __publicField(this, "vrel", new Vec3(0, 0, 0));
    /**
     * Normal velocity
     */
    __publicField(this, "vn", 0);
    __publicField(this, "e", 0);
    // Coefficient of restitution
    __publicField(this, "staticFriction", 0);
    __publicField(this, "dynamicFriction", 0);
    __publicField(this, "F", new Vec3(0, 0, 0));
    // Current constraint force
    __publicField(this, "Fn", 0);
    if (A === B || A.id == B.id)
      throw new Error("Cannot create a ContactSet with the same body");
    this.A = A, this.B = B, this.p1 = p1, this.p2 = p2, this.r1 = r1 ?? this.A.worldToLocal(p1), this.r2 = r2 ?? this.B.worldToLocal(p2), this.n = normal.clone(), this.vrel = Vec3.sub(
      this.A.getVelocityAt(this.p1),
      this.B.getVelocityAt(this.p2)
    ), this.vn = this.vrel.dot(this.n), this.e = (A.restitution + B.restitution) / 2, this.staticFriction = (A.staticFriction + B.staticFriction) / 2, this.dynamicFriction = (A.dynamicFriction + B.dynamicFriction) / 2, this.update();
  }
  update() {
    const A = this.A, B = this.B, p1 = A.pose.p.clone().add(this.r1.clone().applyQuaternion(A.pose.q)), p2 = B.pose.p.clone().add(this.r2.clone().applyQuaternion(B.pose.q));
    this.p1 = p1, this.p2 = p2, this.d = -Vec3.dot(Vec3.sub(this.p1, this.p2), this.n);
  }
}
export {
  ContactSet
};
