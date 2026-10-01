// 上游MIT核心的离线转换产物；请修改build-headless.js后重建。
var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: !0, configurable: !0, writable: !0, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key != "symbol" ? key + "" : key, value);
import { Vec3 } from "../Vec3.mjs";
class Support {
  constructor(witnessA, witnessB) {
    __publicField(this, "point");
    __publicField(this, "witnessA");
    __publicField(this, "witnessB");
    this.witnessA = witnessA, this.witnessB = witnessB, this.point = new Vec3().subVectors(
      witnessA,
      witnessB
    );
  }
}
export {
  Support
};
