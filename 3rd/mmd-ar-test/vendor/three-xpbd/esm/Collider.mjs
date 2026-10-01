// 上游MIT核心的离线转换产物；请修改build-headless.js后重建。
var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: !0, configurable: !0, writable: !0, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key != "symbol" ? key + "" : key, value);
import * as THREE from "three";
import { Face } from "./Face.mjs";
import { Vec3 } from "./Vec3.mjs";
import { Vec2 } from "./Vec2.mjs";
import { Box3 } from "three";
import { ConvexGeometry } from "../support/ConvexGeometry.mjs";
var ColliderType = /* @__PURE__ */ ((ColliderType2) => (ColliderType2[ColliderType2.Box = 0] = "Box", ColliderType2[ColliderType2.Plane = 1] = "Plane", ColliderType2[ColliderType2.Sphere = 2] = "Sphere", ColliderType2[ColliderType2.ConvexMesh = 3] = "ConvexMesh", ColliderType2))(ColliderType || {});
class Collider {
  constructor() {
    __publicField(this, "colliderType", 2 /* Sphere */);
    __publicField(this, "vertices", []);
    __publicField(this, "verticesWorldSpace", []);
    __publicField(this, "indices", []);
    __publicField(this, "uniqueIndices", []);
    // relativePos: Vec3 = new Vec3(0.0, 0.0, 0.0);
    __publicField(this, "aabb", new Box3());
    __publicField(this, "expanded_aabb", new Box3());
  }
  expandAABB(scalar) {
    this.expanded_aabb.copy(this.aabb).expandByScalar(scalar);
  }
  updateGlobalPose(pose) {
  }
  /* GJK */
  findFurthestPoint(dir) {
    return new Vec3();
  }
}
class BoxCollider extends Collider {
  constructor(size) {
    super();
    __publicField(this, "size", new Vec3(1, 1, 1));
    this.size = size;
  }
}
class PlaneCollider extends Collider {
  /**
   * @TODO plane distance / constant
   */
  constructor(size, normal) {
    super();
    __publicField(this, "colliderType", 1 /* Plane */);
    __publicField(this, "size", new Vec2(1, 1));
    __publicField(this, "normal", new Vec3(0, 1, 0));
    __publicField(this, "normalRef", new Vec3(0, 1, 0));
    __publicField(this, "plane", new THREE.Plane(new Vec3(0, 1, 0)));
    this.size = size, normal && (this.normal = normal.normalize(), this.plane = new THREE.Plane(normal));
  }
  updateGlobalPose(pose) {
  }
}
class SphereCollider extends Collider {
  constructor(diameter) {
    super();
    __publicField(this, "colliderType", 2 /* Sphere */);
    __publicField(this, "radius", 1);
    this.radius = 0.5 * diameter;
  }
}
class MeshCollider extends Collider {
  constructor() {
    super(...arguments);
    __publicField(this, "colliderType", 3 /* ConvexMesh */);
    __publicField(this, "faces", []);
  }
  setGeometry(geometry) {
    const vertices = [], positionAttribute = geometry.getAttribute("position");
    for (let i = 0; i < positionAttribute.count; i++) {
      const vertex = new Vec3();
      vertex.fromBufferAttribute(positionAttribute, i), vertices.push(vertex);
    }
    const convexHull = new ConvexGeometry(vertices), hullPositionAttribute = convexHull.getAttribute("position");
    for (let i = 0; i < hullPositionAttribute.count; i++) {
      const vertex = new Vec3();
      vertex.fromBufferAttribute(hullPositionAttribute, i), this.vertices.push(vertex), this.indices.push(i), this.uniqueIndices.push(i);
    }
    for (let i = 0; i < this.vertices.length; i += 3) {
      const a = this.vertices[i + 0], b = this.vertices[i + 1], c = this.vertices[i + 2], center = new Vec3().addVectors(a, b).add(c).divideScalar(3), normal = new Vec3().subVectors(b, a).cross(c.clone().sub(a)).normalize();
      this.faces.push(new Face(
        [a, b, c],
        [i + 0, i + 1, i + 2],
        center,
        normal
      ));
    }
    for (let i = 0; i < this.vertices.length; i++)
      this.verticesWorldSpace[i] = this.vertices[i].clone();
    return convexHull.dispose(), this;
  }
  updateGlobalPose(pose) {
    const min = new Vec3(1 / 0, 1 / 0, 1 / 0), max = new Vec3(-1 / 0, -1 / 0, -1 / 0);
    for (let i = 0; i < this.vertices.length; i++) {
      const v = this.vertices[i];
      this.verticesWorldSpace[i].copy(v).applyQuaternion(pose.q).add(pose.p), min.min(this.verticesWorldSpace[i]), max.max(this.verticesWorldSpace[i]);
    }
    this.aabb.set(min, max);
  }
  /* GJK */
  findFurthestPoint(dir) {
    const maxPoint = new Vec3();
    let maxDist = -1 / 0;
    for (const vertex of this.verticesWorldSpace) {
      const distance = vertex.dot(dir);
      distance > maxDist && (maxDist = distance, maxPoint.copy(vertex));
    }
    return maxPoint;
  }
}
export {
  BoxCollider,
  Collider,
  ColliderType,
  MeshCollider,
  PlaneCollider,
  SphereCollider
};
