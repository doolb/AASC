// 上游MIT核心的离线转换产物；请修改build-headless.js后重建。
var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: !0, configurable: !0, writable: !0, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key != "symbol" ? key + "" : key, value);
import { CollisionPair } from "../CollisionPair.mjs";
import { ContactSet } from "../ContactSet.mjs";
import { Vec3 } from "../Vec3.mjs";
import { ColliderType } from "../Collider.mjs";
import { BaseSolver } from "./BaseSolver.mjs";
import { GjkEpa } from "../narrowphase/GjkEpa.mjs";
const _XPBDSolver = class _XPBDSolver extends BaseSolver {
  constructor() {
    super();
    __publicField(this, "narrowPhase", new GjkEpa());
  }
  update(bodies, constraints, dt, gravity) {
    if (dt === 0)
      return;
    const h = dt / _XPBDSolver.numSubsteps;
    _XPBDSolver.h = h;
    const collisions = this.collectCollisionPairs(bodies, dt);
    for (let i = 0; i < _XPBDSolver.numSubsteps; i++) {
      const contacts = this.getContacts(collisions);
      for (let j = 0; j < bodies.length; j++)
        bodies[j].integrate(h, gravity);
      for (let j = 0; j < constraints.length; j++)
        constraints[j].solvePos(h);
      this.solvePositions(contacts, h);
      for (let j = 0; j < bodies.length; j++)
        bodies[j].update(h);
      for (let j = 0; j < constraints.length; j++)
        constraints[j].solveVel(h);
      this.solveVelocities(contacts, h);
    }
    for (const body of bodies)
      body.isDynamic && (body.checkSleepState(dt), !body.isSleeping && (body.collider.expandAABB(2 * dt * body.vel.length()), body.force.set(0, 0, 0), body.torque.set(0, 0, 0), body.updateGeometry()));
  }
  collectCollisionPairs(bodies, dt) {
    const collisions = [];
    for (let i = 0; i < bodies.length; i++) {
      const A = bodies[i];
      if (A.canCollide)
        for (let j = i + 1; j < bodies.length; j++) {
          const B = bodies[j];
          if (!B.canCollide || A.id == B.id || (!A.isDynamic || A.isSleeping) && (!B.isDynamic || B.isSleeping))
            continue;
          const aabb1 = A.collider.expanded_aabb, aabb2 = B.collider.expanded_aabb;
          switch (A.collider.colliderType) {
            case ColliderType.ConvexMesh:
              switch (B.collider.colliderType) {
                case ColliderType.ConvexMesh: {
                  aabb1.intersectsBox(aabb2) && collisions.push(new CollisionPair(A, B));
                  break;
                }
                case ColliderType.Plane: {
                  const PC = B.collider;
                  aabb1.intersectsPlane(PC.plane) && collisions.push(new CollisionPair(A, B));
                  break;
                }
                default:
                  break;
              }
              break;
          }
        }
    }
    return collisions;
  }
  getContacts(collisions) {
    const contacts = [];
    for (const collision of collisions) {
      const A = collision.A, B = collision.B;
      switch (A.collider.colliderType) {
        case ColliderType.ConvexMesh:
          switch (B.collider.colliderType) {
            case ColliderType.ConvexMesh: {
              this._meshMeshContact(contacts, A, B);
              break;
            }
            case ColliderType.Plane: {
              this._meshPlaneContact(contacts, A, B);
              break;
            }
            default:
              break;
          }
          break;
      }
    }
    return contacts;
  }
  _meshMeshContact(contacts, A, B) {
    const simplex = this.narrowPhase.GJK(A.collider, B.collider);
    if (simplex) {
      const EPA = this.narrowPhase.EPA(simplex, A.collider, B.collider, A.pose, B.pose);
      if (!EPA)
        return;
      const { normal, manifold, d } = EPA;
      if (d <= 0)
        return;
      for (const item of manifold) {
        const contact = new ContactSet(
          A,
          B,
          normal,
          item[0],
          item[1]
        );
        contacts.push(contact), this.debugContact(contact);
      }
      A.hasStableContact = manifold.length >= 4, B.hasStableContact = manifold.length >= 4;
    }
  }
  _meshPlaneContact(contacts, A, B) {
    const MC = A.collider, PC = B.collider, N = new Vec3().copy(PC.normal);
    let contactCount = 0;
    for (let i = 0; i < MC.uniqueIndices.length; i++) {
      const r1 = MC.vertices[MC.uniqueIndices[i]], p1 = MC.verticesWorldSpace[MC.uniqueIndices[i]], signedDistance = Vec3.dot(N, Vec3.sub(p1, B.pose.p)), p2 = Vec3.sub(p1, Vec3.mul(N, signedDistance)), r2 = B.worldToLocal(p2);
      if (-signedDistance <= 0)
        continue;
      contactCount++;
      const contact = new ContactSet(A, B, N, p1, p2, r1, r2);
      contacts.push(contact);
    }
    A.hasStableContact = contactCount >= 4, B.hasStableContact = contactCount >= 4;
  }
  solvePositions(contacts, h) {
    for (const contact of contacts)
      this._solvePenetration(contact, h), this._solveFriction(contact, h);
  }
  _solvePenetration(contact, h) {
    if (contact.update(), contact.d <= 0)
      return;
    const dx = Vec3.mul(contact.n, Math.max(0, contact.d - (contact.tolerance ?? 0))), delta_lambda = _XPBDSolver.applyBodyPairCorrection(
      contact.A,
      contact.B,
      dx,
      0,
      h,
      contact.p1,
      contact.p2,
      !1
    );
    contact.lambda_n += delta_lambda;
  }
  _solveFriction(contact, h) {
    contact.update();
    const p1prev = contact.A.prevPose.p.clone().add(contact.r1.clone().applyQuaternion(contact.A.prevPose.q)), p2prev = contact.B.prevPose.p.clone().add(contact.r2.clone().applyQuaternion(contact.B.prevPose.q)), dp = Vec3.sub(
      Vec3.sub(contact.p1, p1prev),
      Vec3.sub(contact.p2, p2prev)
    ), dp_t = Vec3.sub(
      dp,
      Vec3.mul(contact.n, dp.dot(contact.n))
    );
    dp_t.negate();
    const d_lambda_t = _XPBDSolver.applyBodyPairCorrection(
      contact.A,
      contact.B,
      dp_t,
      0,
      h,
      contact.p1,
      contact.p2,
      !1,
      !0
    );
    contact.lambda_t + d_lambda_t > contact.staticFriction * contact.lambda_n && _XPBDSolver.applyBodyPairCorrection(
      contact.A,
      contact.B,
      dp_t,
      0,
      h,
      contact.p1,
      contact.p2,
      !1
    );
  }
  solveVelocities(contacts, h) {
    for (const contact of contacts) {
      contact.update();
      const dv = new Vec3(), v = Vec3.sub(
        contact.A.getVelocityAt(contact.p1),
        contact.B.getVelocityAt(contact.p2)
      ), vn = Vec3.dot(v, contact.n), vt = Vec3.sub(v, Vec3.mul(contact.n, vn)), vt_len = vt.length();
      if (vt_len > 1e-6) {
        const Fn = -contact.lambda_n / (h * h), friction = Math.min(h * contact.dynamicFriction * Fn, vt_len);
        dv.sub(Vec3.normalize(vt).multiplyScalar(friction));
      }
      const threshold = Math.max(0.5, 2 * (this.gravityMagnitude ?? 9.81) * h, (contact.tolerance ?? 0) / h), e = Math.abs(contact.vn) <= threshold ? 0 : contact.e, vn_tilde = contact.vn, restitution = -vn + (contact.d >= 0 ? Math.max(-e * vn_tilde, 0) : -contact.d / h);
      dv.add(Vec3.mul(contact.n, restitution)), _XPBDSolver.applyBodyPairCorrection(
        contact.A,
        contact.B,
        dv,
        0,
        h,
        contact.p1,
        contact.p2,
        !0
      );
    }
  }
  static applyBodyPairCorrection(body0, body1, corr, compliance, dt, pos0 = null, pos1 = null, velocityLevel = !1, precalculateDeltaLambda = !1) {
    const C = corr.length();
    if (C < 1e-6)
      return 0;
    const n = Vec3.normalize(corr), w0 = body0 ? body0.getInverseMass(n, pos0) : 0, w1 = body1 ? body1.getInverseMass(n, pos1) : 0, w = w0 + w1;
    if (w == 0)
      return 0;
    const dlambda = -C / (w + compliance / dt / dt);
    return precalculateDeltaLambda || (n.multiplyScalar(-dlambda), body0 && body0.applyCorrection(n, pos0, velocityLevel), body1 && body1.applyCorrection(n.negate(), pos1, velocityLevel)), dlambda;
  }
};
__publicField(_XPBDSolver, "numSubsteps", 20), __publicField(_XPBDSolver, "h", 0);
let XPBDSolver = _XPBDSolver;
export {
  XPBDSolver
};
