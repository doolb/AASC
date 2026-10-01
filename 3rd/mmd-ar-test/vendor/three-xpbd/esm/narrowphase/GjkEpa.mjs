// 上游MIT核心的离线转换产物；请修改build-headless.js后重建。
var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: !0, configurable: !0, writable: !0, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key != "symbol" ? key + "" : key, value);
import { Matrix4, Plane, Vector4 } from "three";
import { MeshCollider } from "../Collider.mjs";
import { Vec3 } from "../Vec3.mjs";
import { Simplex } from "./Simplex.mjs";
import { Support } from "./Support.mjs";
import { Vec2 } from "../Vec2.mjs";
import { Quat } from "../Quaternion.mjs";
import { SutherlandHodgmanClipping } from "./SutherlandHodgmanClipping.mjs";
import { GrahamScan } from "./GrahamScan.mjs";
const _GjkEpa = class _GjkEpa {
  constructor() {
  }
  GJK(colliderA, colliderB) {
    const support = this.support(colliderA, colliderB, new Vec3(0, 1, 0)), simplex = new Simplex();
    simplex.push_front(support);
    const direction = support.point.clone().negate();
    for (let i = 0; i < _GjkEpa.MAX_GJK_ITERS; i++) {
      const support2 = this.support(colliderA, colliderB, direction);
      if (support2.point.dot(direction) <= 0)
        return;
      if (simplex.push_front(support2), this.nextSimplex(simplex, direction))
        return simplex;
    }
  }
  /**
   * Returns the vertex on the Minkowski difference
   */
  support(colliderA, colliderB, direction) {
    const witnessA = colliderA.findFurthestPoint(direction), witnessB = colliderB.findFurthestPoint(direction.clone().negate());
    return new Support(witnessA, witnessB);
  }
  nextSimplex(simplex, direction) {
    switch (simplex.size) {
      case 2:
        return this.Line(simplex, direction);
      case 3:
        return this.Triangle(simplex, direction);
      case 4:
        return this.Tetrahedron(simplex, direction);
    }
    return !1;
  }
  sameDirection(direction, ao) {
    return direction.dot(ao) > 0;
  }
  Line(simplex, direction) {
    const a = simplex.points[0], b = simplex.points[1], ab = new Vec3().subVectors(b.point, a.point), ao = a.point.clone().negate();
    return this.sameDirection(ab, ao) ? direction.copy(ab.clone().cross(ao).clone().cross(ab)) : (simplex.assign([a]), direction.copy(ao)), !1;
  }
  Triangle(simplex, direction) {
    const a = simplex.points[0], b = simplex.points[1], c = simplex.points[2], ab = new Vec3().subVectors(b.point, a.point), ac = new Vec3().subVectors(c.point, a.point), ao = a.point.clone().negate(), abc = ab.clone().cross(ac);
    if (this.sameDirection(abc.clone().cross(ac), ao))
      if (this.sameDirection(ac, ao))
        simplex.assign([a, c]), direction.copy(ac.clone().cross(ao).clone().cross(ac));
      else
        return simplex.assign([a, c]), this.Line(simplex, direction);
    else {
      if (this.sameDirection(ab.clone().cross(abc), ao))
        return simplex.assign([a, b]), this.Line(simplex, direction);
      this.sameDirection(abc, ao) ? direction.copy(abc) : (simplex.assign([a, c, b]), direction.copy(abc.negate()));
    }
    return !1;
  }
  Tetrahedron(simplex, direction) {
    const a = simplex.points[0], b = simplex.points[1], c = simplex.points[2], d = simplex.points[3], ab = new Vec3().subVectors(b.point, a.point), ac = new Vec3().subVectors(c.point, a.point), ad = new Vec3().subVectors(d.point, a.point), ao = a.point.clone().negate(), abc = ab.clone().cross(ac), acd = ac.clone().cross(ad), adb = ad.clone().cross(ab);
    return this.sameDirection(abc, ao) ? (simplex.assign([a, b, c]), this.Triangle(simplex, direction)) : this.sameDirection(acd, ao) ? (simplex.assign([a, c, d]), this.Triangle(simplex, direction)) : this.sameDirection(adb, ao) ? (simplex.assign([a, d, b]), this.Triangle(simplex, direction)) : !0;
  }
  /**
   * EPA (Expanding Polytope Algorithm)
   * 
   * https://github.com/IainWinter/IwEngine/blob/master/IwEngine/src/physics/impl/GJK.cpp
   */
  EPA(simplex, colliderA, colliderB, transformA, transformB) {
    const polytope = [];
    for (let i = 0; i < simplex.size; i++)
      polytope.push(simplex.points[i]);
    const faces = [
      0,
      1,
      2,
      0,
      3,
      1,
      0,
      2,
      3,
      1,
      3,
      2
    ];
    let {
      normals,
      minTriangle: minFace,
      polygon: minPolygon
    } = this.getFaceNormals(polytope, faces);
    const minNormal = new Vec3();
    let minDistance = 1 / 0, iterations = 0;
    for (; minDistance == 1 / 0 && (minNormal.set(normals[minFace].x, normals[minFace].y, normals[minFace].z), minDistance = normals[minFace].w, !(iterations++ > _GjkEpa.MAX_EPA_ITERS)); ) {
      const witnessA = colliderA.findFurthestPoint(minNormal), witnessB = colliderB.findFurthestPoint(minNormal.clone().negate()), support = new Support(witnessA, witnessB), sDistance = minNormal.dot(support.point);
      if (Math.abs(sDistance - minDistance) > 1e-3) {
        minDistance = 1 / 0;
        const uniqueEdges = [];
        for (let i = 0; i < normals.length; i++) {
          const n = new Vec3(normals[i].x, normals[i].y, normals[i].z);
          if (this.sameDirection(n, support.point)) {
            const f = i * 3;
            this.addIfUniqueEdge(uniqueEdges, faces, f + 0, f + 1), this.addIfUniqueEdge(uniqueEdges, faces, f + 1, f + 2), this.addIfUniqueEdge(uniqueEdges, faces, f + 2, f + 0), faces[f + 2] = faces[faces.length - 1], faces.pop(), faces[f + 1] = faces[faces.length - 1], faces.pop(), faces[f + 0] = faces[faces.length - 1], faces.pop(), normals[i].copy(normals[normals.length - 1]), normals.pop(), i--;
          }
        }
        if (uniqueEdges.length == 0)
          break;
        const newFaces = [];
        for (const [edge1, edge2] of uniqueEdges)
          newFaces.push(edge1), newFaces.push(edge2), newFaces.push(polytope.length);
        polytope.push(support);
        const {
          normals: newNormals,
          minTriangle: newMinFace,
          polygon: newPolygon
        } = this.getFaceNormals(polytope, newFaces);
        let newMinDistance = 1 / 0;
        for (let i = 0; i < normals.length; i++)
          normals[i].w < newMinDistance && (newMinDistance = normals[i].w, minFace = i, minPolygon = [polytope[faces[i * 3]], polytope[faces[i * 3 + 1]], polytope[faces[i * 3 + 2]]]);
        if (!newNormals.length || !normals.length) return;
        newNormals[newMinFace].w < newMinDistance && (minFace = newMinFace + normals.length, minPolygon = newPolygon), faces.push(...newFaces), normals.push(...newNormals);
      }
    }
    if (!Number.isFinite(minDistance) || minPolygon.length !== 3)
      return;
    const manifold = [], contact_facesA = [], contact_facesB = [], localNormalA = minNormal.clone().applyQuaternion(transformA.q.clone().conjugate()), localNormalB = minNormal.clone().applyQuaternion(transformB.q.clone().conjugate());
    if (colliderA instanceof MeshCollider)
      for (let i = 0; i < colliderA.faces.length; i++) {
        const face = colliderA.faces[i];
        if (Vec3.dot(face.normal, localNormalA) > 0.999999) {
          const posDot = Vec3.dot(face.center, localNormalA);
          posDot > 0 && contact_facesA.push({ face, dist: posDot });
        }
      }
    if (colliderB instanceof MeshCollider)
      for (let i = 0; i < colliderB.faces.length; i++) {
        const face = colliderB.faces[i];
        if (Vec3.dot(face.normal, localNormalB) < -0.999999) {
          const posDot = Vec3.dot(face.center, localNormalB);
          posDot < 0 && contact_facesB.push({ face, dist: posDot });
        }
      }
    if (contact_facesA.length && contact_facesB.length) {
      const transformMatrix = new Matrix4();
      transformMatrix.makeTranslation(0, 0, 0), transformMatrix.makeRotationFromQuaternion(new Quat().setFromUnitVectors(minNormal, new Vec3(0, 0, 1)));
      let projectedPoints2D_A = [], projectedPoints2D_B = [];
      contact_facesA.sort((a, b) => b.dist - a.dist), contact_facesB.sort((a, b) => a.dist - b.dist);
      for (let j = 0; j < contact_facesA.length; j++)
        for (let i = 0; i < 3; i++) {
          const v3d = colliderA.verticesWorldSpace[contact_facesA[j].face.indices[i]].clone().applyMatrix4(transformMatrix), v2d = new Vec2(v3d.x, v3d.y);
          let v2d_unique = !0;
          for (const vertex of projectedPoints2D_A)
            vertex.distanceTo(v2d) < 1e-3 && (v2d_unique = !1);
          v2d_unique && projectedPoints2D_A.push(v2d);
        }
      for (let j = 0; j < contact_facesB.length; j++)
        for (let i = 0; i < 3; i++) {
          const v3d = colliderB.verticesWorldSpace[contact_facesB[j].face.indices[i]].clone().applyMatrix4(transformMatrix), v2d = new Vec2(v3d.x, v3d.y);
          let v2d_unique = !0;
          for (const vertex of projectedPoints2D_B)
            vertex.distanceTo(v2d) < 1e-3 && (v2d_unique = !1);
          v2d_unique && projectedPoints2D_B.push(v2d);
        }
      const gs = new GrahamScan();
      projectedPoints2D_A = gs.setPoints(projectedPoints2D_A).getHull(), projectedPoints2D_B = gs.setPoints(projectedPoints2D_B).getHull();
      let clippedPolygon2D = SutherlandHodgmanClipping(projectedPoints2D_B, projectedPoints2D_A);
      const inverseTransformMatrix = transformMatrix.clone().invert(), worldFaceNormal_A = contact_facesA[0].face.normal.clone().applyQuaternion(transformA.q), worldFaceNormal_B = contact_facesB[0].face.normal.clone().applyQuaternion(transformB.q), worldPoint_A = colliderA.verticesWorldSpace[contact_facesA[0].face.indices[0]], worldPoint_B = colliderB.verticesWorldSpace[contact_facesB[0].face.indices[0]], planeA = new Plane(worldFaceNormal_A, -Vec3.dot(worldFaceNormal_A, worldPoint_A)), planeB = new Plane(worldFaceNormal_B, -Vec3.dot(worldFaceNormal_B, worldPoint_B)), clippedPolygon3D_A = [], clippedPolygon3D_B = [];
      for (const point2D of clippedPolygon2D) {
        const point3DHomogeneous = new Vec3(point2D.x, point2D.y, 0).applyMatrix4(inverseTransformMatrix), point3D_A = new Vec3(), point3D_B = new Vec3();
        planeA.projectPoint(point3DHomogeneous, point3D_A), planeB.projectPoint(point3DHomogeneous, point3D_B), manifold.push([point3D_A, point3D_B]), clippedPolygon3D_A.push(point3D_A), clippedPolygon3D_B.push(point3D_B);
      }
    }
    if (!manifold.length) {
      const contactPoint = Vec3.mul(minNormal, minDistance), barycentric = this.computeBarycentricCoordinates(contactPoint, minPolygon);
      if (!barycentric.toArray().every(Number.isFinite)) return;
      let a = new Vec3().addScaledVector(minPolygon[0].witnessA, barycentric.x), b = new Vec3().addScaledVector(minPolygon[1].witnessA, barycentric.y), c = new Vec3().addScaledVector(minPolygon[2].witnessA, barycentric.z);
      const p1 = Vec3.add(a, b).add(c);
      a = new Vec3().addScaledVector(minPolygon[0].witnessB, barycentric.x), b = new Vec3().addScaledVector(minPolygon[1].witnessB, barycentric.y), c = new Vec3().addScaledVector(minPolygon[2].witnessB, barycentric.z);
      const p2 = Vec3.add(a, b).add(c);
      manifold.push([p1, p2]);
    }
    return {
      normal: minNormal.negate(),
      manifold,
      d: minDistance
    };
  }
  computeBarycentricCoordinates(P, polygon) {
    const A = polygon[0].point, B = polygon[1].point, C = polygon[2].point, v0 = B.clone().sub(A), v1 = C.clone().sub(A), v2 = P.clone().sub(A), dot00 = v0.dot(v0), dot01 = v0.dot(v1), dot02 = v0.dot(v2), dot11 = v1.dot(v1), dot12 = v1.dot(v2), denom = dot00 * dot11 - dot01 * dot01, v = (dot11 * dot02 - dot01 * dot12) / denom, w = (dot00 * dot12 - dot01 * dot02) / denom, u = 1 - v - w;
    return new Vec3(u, v, w);
  }
  getFaceNormals(polytope, faces) {
    const normals = [];
    let minTriangle = 0, minDistance = 1 / 0, polygon = [];
    for (let i = 0; i < faces.length; i += 3) {
      const a = polytope[faces[i + 0]], b = polytope[faces[i + 1]], c = polytope[faces[i + 2]], normal = new Vec3().subVectors(b.point, a.point).cross(c.point.clone().sub(a.point)).normalize();
      let distance = normal.dot(a.point);
      distance < 0 && (normal.negate(), distance *= -1), normals.push(new Vector4(
        normal.x,
        normal.y,
        normal.z,
        distance
      )), distance < minDistance && (minTriangle = i / 3, minDistance = distance, polygon[0] = a, polygon[1] = b, polygon[2] = c);
    }
    return {
      normals,
      minTriangle,
      polygon
    };
  }
  addIfUniqueEdge(edges, faces, a, b) {
    const reverse = edges.find((edge) => edge[0] === faces[b] && edge[1] === faces[a]);
    if (reverse !== void 0) {
      const index = edges.indexOf(reverse);
      edges.splice(index, 1);
    } else
      edges.push([faces[a], faces[b]]);
  }
};
__publicField(_GjkEpa, "MAX_GJK_ITERS", 16), __publicField(_GjkEpa, "MAX_EPA_ITERS", 16);
let GjkEpa = _GjkEpa;
export {
  GjkEpa
};
