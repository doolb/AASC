import { BoxGeometry, CapsuleGeometry, SphereGeometry, Vector3 } from 'three';
import { RigidBody } from './vendor/three-xpbd/esm/RigidBody.mjs';
import { MeshCollider } from './vendor/three-xpbd/esm/Collider.mjs';
import { XPBDSolver } from './vendor/three-xpbd/esm/solver/XPBDSolver.mjs';
import { createXpbdBody } from './web-xpbd-rigid.mjs';
import { XpbdPmxPhysics } from './web-xpbd-physics.mjs';
import { createThreeXpbdJoint } from './web-three-xpbd-joint.mjs';

// 实际运行上游RigidBody / GJK-EPA / 位置与速度摩擦，PMX适配只处理数据和调度。
// 球/胶囊用低面数凸体近似，上游不提供解析球/胶囊接触，不能等同现有XPBD碰撞。
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function createBody(params, index, position, quaternion) {
    const metadata = createXpbdBody(params, index, position, quaternion);
    const geometryFactories = {
        0: () => new SphereGeometry(params.width, 8, 6),
        1: () => new BoxGeometry(params.width * 2, params.height * 2, params.depth * 2),
        2: () => params.height > 0 ? new CapsuleGeometry(params.width, params.height, 3, 8) : new SphereGeometry(params.width, 8, 6)
    };
    const geometry = geometryFactories[params.shapeType]();
    const collider = new MeshCollider();
    try { collider.setGeometry(geometry); }
    finally { geometry.dispose(); }
    const body = new RigidBody(collider);
    body.id = index + 1; body.index = index; body.params = params;
    body.dynamic = metadata.dynamic; body.isDynamic = metadata.dynamic;
    body.canSleep = false; body.positionDriven = metadata.positionDriven;
    body.inverseMass = metadata.inverseMass; body.invMass = metadata.inverseMass;
    body.invInertia.copy(metadata.inverseInertia); body.inverseInertia = body.invInertia;
    Object.defineProperty(body, 'inertia', { value: metadata.inertia });
    body.contactTolerance = metadata.contactTolerance;
    body.position = body.pose.p; body.quaternion = body.pose.q;
    body.previousPosition = body.prevPose.p; body.previousQuaternion = body.prevPose.q;
    body.velocity = body.vel; body.position.copy(position); body.quaternion.copy(quaternion);
    body.prevPose.copy(body.pose); body.updateCollider();
    body.staticFriction = body.dynamicFriction = clamp(params.friction, 0, 10);
    body.restitution = clamp(params.restitution, 0, 1);
    // 运动学type0也保留实际驱动速度，接触摩擦不能把它当成完全静止。
    body.getVelocityAt = (point) => new Vector3().crossVectors(body.omega,
        new Vector3().subVectors(point, body.position)).add(body.velocity);
    const integrate = body.integrate;
    const torque = new Vector3();
    body.integrate = (h, gravity) => {
        if (!body.dynamic) return;
        body.velocity.multiplyScalar(Math.pow(1 - clamp(params.positionDamping, 0, 1), h));
        body.omega.multiplyScalar(Math.pow(1 - clamp(params.rotationDamping, 0, 1), h));
        // PMX风力矩在世界空间；上游直接分量乘局部惯量，需在包装层转到局部再转回。
        torque.copy(body.torque).applyQuaternion(body.quaternion.clone().invert())
            .multiply(body.inverseInertia).applyQuaternion(body.quaternion);
        body.omega.addScaledVector(torque, h); body.torque.set(0, 0, 0);
        body.gravity = body.positionDriven ? 0 : 1;
        integrate.call(body, h, gravity);
    };
    body.dispose = () => {
        collider.vertices.length = 0; collider.verticesWorldSpace.length = 0;
        collider.faces.length = 0; collider.indices.length = 0; collider.uniqueIndices.length = 0;
    };
    return body;
}

function createSolver(bodies, joints) {
    const upstream = new XPBDSolver();
    const excluded = new Set(joints.map(({ a, b }) => Math.min(a.index, b.index) * bodies.length + Math.max(a.index, b.index)));
    const sorted = bodies.slice();
    let contacts = [], pairs = 0, steps = 0;
    const collectPairs = () => {
        sorted.sort((a, b) => a.collider.aabb.min.x - b.collider.aabb.min.x);
        const candidates = [];
        for (let i = 0; i < sorted.length; i += 1) {
            const a = sorted[i];
            for (let j = i + 1; j < sorted.length; j += 1) {
                const b = sorted[j];
                if (b.collider.aabb.min.x > a.collider.aabb.max.x) break;
                if ((!a.dynamic && !b.dynamic) || !a.canCollide || !b.canCollide
                    || !(a.params.groupTarget & (1 << b.params.groupIndex))
                    || !(b.params.groupTarget & (1 << a.params.groupIndex))
                    || excluded.has(Math.min(a.index, b.index) * bodies.length + Math.max(a.index, b.index))
                    || !a.collider.aabb.intersectsBox(b.collider.aabb)) continue;
                candidates.push({ A: a, B: b });
            }
        }
        return candidates;
    };
    const reset = () => {
        contacts = []; pairs = 0; steps = 0;
        for (const body of bodies) {
            body.prevPose.copy(body.pose); body.velPrev.set(0, 0, 0); body.omegaPrev.set(0, 0, 0);
            body.isSleeping = false; body.hasStableContact = false; body.updateCollider();
        }
    };
    return {
        step(h, gravity, applyTargets) {
            XPBDSolver.h = h; upstream.gravityMagnitude = gravity.length();
            for (const body of bodies) { body.prevPose.copy(body.pose); body.integrate(h, gravity); }
            applyTargets(h);
            for (const body of bodies) body.updateCollider();
            const candidates = collectPairs(); pairs = candidates.length;
            contacts = upstream.getContacts(candidates);
            for (const contact of contacts) {
                contact.a = contact.A; contact.b = contact.B;
                contact.tolerance = Math.min(contact.A.contactTolerance, contact.B.contactTolerance);
            }
            for (const joint of joints) joint.solvePos(h);
            upstream.solvePositions(contacts, h);
            for (const body of bodies) body.update(h);
            for (const joint of joints) joint.solveVel(h);
            upstream.solveVelocities(contacts, h);
            for (const body of bodies) {
                body.force.set(0, 0, 0); body.torque.set(0, 0, 0); body.updateCollider();
            }
            steps += 1;
        },
        reset,
        dispose() { contacts = []; sorted.length = 0; excluded.clear(); },
        get contacts() { return contacts; },
        getState() { return { contacts: contacts.length, collisionPairs: pairs, totalSubsteps: steps,
            source: 'markeasting/THREE-XPBD', collision: 'convex-gjk-epa' }; }
    };
}

const backend = Object.freeze({ engine: 'three-xpbd', createBody, createJoint: createThreeXpbdJoint, createSolver });

export class ThreeXpbdPmxPhysics extends XpbdPmxPhysics {
    constructor(mesh, bodies, joints, options = {}) {
        super(mesh, bodies, joints, { ...options, xpbdBackend: backend });
    }
}
