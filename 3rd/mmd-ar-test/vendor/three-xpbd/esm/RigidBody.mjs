// 上游MIT核心的离线转换产物；请修改build-headless.js后重建。
var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: !0, configurable: !0, writable: !0, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key != "symbol" ? key + "" : key, value);
import { Pose } from "./Pose.mjs";
import { Vec3 } from "./Vec3.mjs";
import { Quat } from "./Quaternion.mjs";
import { Color, Euler } from "three";
const _RigidBody = class _RigidBody {
  constructor(collider, mesh) {
    __publicField(this, "id", 0);
    __publicField(this, "pose", new Pose());
    __publicField(this, "isDynamic", !0);
    __publicField(this, "canCollide", !0);
    __publicField(this, "hasStableContact", !1);
    __publicField(this, "canSleep", !0);
    __publicField(this, "isSleeping", !1);
    __publicField(this, "sleepTimer", 0);
    __publicField(this, "mesh");
    __publicField(this, "collider");
    __publicField(this, "vel", new Vec3(0, 0, 0));
    __publicField(this, "omega", new Vec3(0, 0, 0));
    __publicField(this, "invMass", 1);
    __publicField(this, "invInertia", new Vec3(1, 1, 1));
    __publicField(this, "force", new Vec3());
    __publicField(this, "torque", new Vec3());
    __publicField(this, "gravity", 1);
    __publicField(this, "staticFriction", 0.5);
    __publicField(this, "dynamicFriction", 0.4);
    __publicField(this, "restitution", 0.4);
    // 'private':
    __publicField(this, "prevPose", new Pose());
    __publicField(this, "velPrev", new Vec3(0, 0, 0));
    __publicField(this, "omegaPrev", new Vec3(0, 0, 0));
    return this.collider = collider, mesh && this.setMesh(mesh), this;
  }
  get mass() {
    return 1 / this.invMass;
  }
  get inertia() {
    return new Vec3().set(
      1 / this.invInertia.x,
      1 / this.invInertia.y,
      1 / this.invInertia.z
    );
  }
  setMesh(mesh, applyTransform = !0) {
    return this.mesh = mesh, mesh.userData.physicsBody = this, applyTransform && (this.pose = new Pose(new Vec3().copy(mesh.position), mesh.quaternion), this.prevPose.copy(this.pose)), mesh.castShadow = !0, mesh.receiveShadow = !0, this;
  }
  setWireframe(state = !1) {
    return this.mesh && (this.mesh.material.wireframe = !0), this;
  }
  setRandomColor() {
    if (this.mesh) {
      const mat = this.mesh.material;
      mat.color = new Color().setHSL(Math.random(), 1, 0.7);
    }
    return this;
  }
  setPos(x, y, z) {
    return this.pose.p.set(x, y, z), this.prevPose.copy(this.pose), this.updateGeometry(), this.updateCollider(), this;
  }
  setRotation(x, y, z) {
    return this.pose.q.setFromEuler(new Euler(x, y, z)), this.prevPose.copy(this.pose), this.updateGeometry(), this.updateCollider(), this;
  }
  setOmega(x, y, z) {
    return this.omega.set(x, y, z), this;
  }
  setVel(x, y, z) {
    return this.vel.set(x, y, z), this;
  }
  setRestitution(restitution) {
    return this.restitution = restitution, this;
  }
  setFriction(staticFriction, dynamicFriction) {
    return this.staticFriction = staticFriction, this.dynamicFriction = dynamicFriction, this;
  }
  setCanCollide(canCollide = !0) {
    return this.canCollide = canCollide, this;
  }
  setStatic() {
    return this.isDynamic = !1, this.gravity = 0, this.invMass = 0, this.invInertia = new Vec3(0), this.prevPose.copy(this.pose), this.updateGeometry(), this.updateCollider(), this;
  }
  setBox(size, density = 1) {
    let mass = size.x * size.y * size.z * density;
    return this.invMass = 1 / mass, mass /= 12, this.invInertia.set(
      1 / (size.y * size.y + size.z * size.z) / mass,
      1 / (size.z * size.z + size.x * size.x) / mass,
      1 / (size.x * size.x + size.y * size.y) / mass
    ), this;
  }
  setCylinder(radius, height, density = 1) {
    const r2 = Math.pow(height, 2), h2 = Math.pow(radius, 2), mass = Math.PI * r2 * height * density;
    this.invMass = 1 / mass;
    const I_axial = 0.5 * mass * r2, I_radial = 1 / 12 * mass * (3 * r2 + h2);
    return this.invInertia.set(
      1 / I_radial,
      1 / I_axial,
      1 / I_radial
    ), this;
  }
  getVelocityAt(pos) {
    return this.isDynamic ? Vec3.add(this.vel, Vec3.cross(this.omega, Vec3.sub(pos, this.pose.p))) : new Vec3(0, 0, 0);
  }
  getInverseMass(normal, pos = null) {
    if (!this.isDynamic)
      return 0;
    const n = new Vec3();
    pos === null ? n.copy(normal) : (n.subVectors(pos, this.pose.p), n.cross(normal)), this.pose.invRotate(n);
    let w = n.x * n.x * this.invInertia.x + n.y * n.y * this.invInertia.y + n.z * n.z * this.invInertia.z;
    return pos !== null && (w += this.invMass), w;
  }
  applyCorrection(corr, pos = null, velocityLevel = !1) {
    if (!this.isDynamic)
      return;
    const dq = new Vec3();
    pos === null ? dq.copy(corr) : (dq.subVectors(pos, this.pose.p).cross(corr), velocityLevel ? this.vel.addScaledVector(corr, this.invMass) : this.pose.p.addScaledVector(corr, this.invMass)), this.pose.invRotate(dq), dq.set(
      this.invInertia.x * dq.x,
      this.invInertia.y * dq.y,
      this.invInertia.z * dq.z
    ), this.pose.rotate(dq), velocityLevel ? this.omega.add(dq) : this.applyRotation(dq);
  }
  applyRotation(rot, scale = 1) {
    const phi = rot.length();
    phi * scale > 0.5 && (scale = 0.5 / phi);
    const dq = new Quat(
      rot.x * scale,
      rot.y * scale,
      rot.z * scale,
      0
    );
    dq.multiply(this.pose.q), this.pose.q.set(
      this.pose.q.x + 0.5 * dq.x,
      this.pose.q.y + 0.5 * dq.y,
      this.pose.q.z + 0.5 * dq.z,
      this.pose.q.w + 0.5 * dq.w
    ), this.pose.q.normalize();
  }
  integrate(dt, gravity) {
    this.isDynamic && (this.prevPose.copy(this.pose), !this.isSleeping && (this.vel.add(Vec3.mul(gravity, this.gravity * dt)), this.vel.add(Vec3.mul(this.force, this.invMass * dt)), this.pose.p.addScaledVector(this.vel, dt), this.omega.addScaledVector(this.torque.clone().multiply(this.invInertia), dt), this.applyRotation(this.omega, dt)));
  }
  update(dt) {
    if (!this.isDynamic || this.isSleeping)
      return;
    this.velPrev.copy(this.vel), this.omegaPrev.copy(this.omega), this.vel.subVectors(this.pose.p, this.prevPose.p), this.vel.multiplyScalar(1 / dt);
    const dq = new Quat();
    dq.multiplyQuaternions(this.pose.q, this.prevPose.q.clone().conjugate()), this.omega.set(
      dq.x * 2 / dt,
      dq.y * 2 / dt,
      dq.z * 2 / dt
    ), dq.w < 0 && this.omega.set(-this.omega.x, -this.omega.y, -this.omega.z), this.updateCollider();
  }
  applyForceW(force, worldPos = new Vec3(0, 0, 0)) {
    this.wake();
    const F = force.clone();
    this.force.add(F), this.torque.add(F.cross(this.pose.p.clone().sub(worldPos)));
  }
  updateGeometry() {
    this.mesh && (this.mesh.position.copy(this.pose.p), this.mesh.quaternion.copy(this.pose.q));
  }
  updateCollider() {
    this.isDynamic || this.collider.expandAABB(1), this.collider.updateGlobalPose(this.pose);
  }
  localToWorld(v) {
    return new Vec3().copy(v).applyQuaternion(this.pose.q).add(this.pose.p);
  }
  worldToLocal(v) {
    return new Vec3().copy(v).sub(this.pose.p).applyQuaternion(this.pose.q.clone().conjugate());
  }
  setCanSleep(state = !0) {
    return this.canSleep = state, this;
  }
  checkSleepState(dt) {
    if (!this.canSleep)
      return;
    const velLen = this.vel.lengthSq(), omegaLen = this.omega.lengthSq(), thresh = 1e-3;
    this.isSleeping ? (velLen > thresh || omegaLen > thresh) && this.wake() : this.hasStableContact && velLen < thresh && omegaLen < thresh && (this.sleepTimer > _RigidBody.sleepThreshold ? this.sleep() : this.sleepTimer += dt);
  }
  sleep() {
    if (this.isSleeping)
      return this;
    if (this.vel.set(0, 0, 0), this.omega.set(0, 0, 0), this.velPrev.set(0, 0, 0), this.omegaPrev.set(0, 0, 0), this.isSleeping = !0, _RigidBody.debugSleepState) {
      const mat = this.mesh?.material;
      mat.color = new Color(30583);
    }
    return this;
  }
  wake() {
    if (!this.isSleeping)
      return this;
    if (this.isSleeping = !1, this.sleepTimer = 0, _RigidBody.debugSleepState) {
      const mat = this.mesh?.material;
      mat.color = new Color(65535);
    }
    return this;
  }
};
__publicField(_RigidBody, "sleepThreshold", 0.2), // Seconds
__publicField(_RigidBody, "debugSleepState", !1);
let RigidBody = _RigidBody;
export {
  RigidBody
};
