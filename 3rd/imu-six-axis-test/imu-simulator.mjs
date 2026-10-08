import { Quaternion, Vector3 } from 'three';
import { GRAVITY, REST_ORIENTATION, rotationStep } from './imu-engine.mjs';

/** 固定种子使噪声实验可重复；随机游走按sqrt(dt)缩放，单位为每sqrt(秒)。 */
export function seededRandom(seed = 42) {
    let state = seed >>> 0;
    return () => { state += 0x6D2B79F5; let value = state;
        value = Math.imul(value ^ value >>> 15, value | 1);
        value ^= value + Math.imul(value ^ value >>> 7, value | 61);
        return ((value ^ value >>> 14) >>> 0) / 4294967296; };
}

export class ImuSimulator {
    constructor(seed = 42) {
        this.random = seededRandom(seed);
        this.p = new Vector3(); this.v = new Vector3(); this.q = REST_ORIENTATION.clone(); this.omega = new Vector3();
        this.targetPosition = this.p.clone(); this.targetQuaternion = this.q.clone(); this.time = 0;
        this.noise = { gyro: 0.0005, accel: 0.025, gyroBias: 0.004, accelBias: 0.02, walk: 0, drop: 0, jitter: 0 };
        this.gyroWalk = [0, 0, 0]; this.accelWalk = [0, 0, 0]; this.trajectory = null;
    }
    gaussian() { return Math.sqrt(-2 * Math.log(Math.max(1e-9, this.random()))) * Math.cos(2 * Math.PI * this.random()); }
    setTarget(position, quaternion) { this.targetPosition.copy(position); this.targetQuaternion.copy(quaternion).normalize(); }
    reset() { this.p.set(0, 0, 0); this.v.set(0, 0, 0); this.q.copy(REST_ORIENTATION); this.omega.set(0, 0, 0);
        this.targetPosition.copy(this.p); this.targetQuaternion.copy(this.q); this.trajectory = null; }
    startTrajectory(name) { this.trajectory = { name, start: this.time, origin: this.p.clone(), orientation: this.q.clone() }; }
    updateTrajectory() {
        if (!this.trajectory) return;
        const { name, start, origin, orientation } = this.trajectory;
        const t = this.time - start;
        const targets = {
            translate: () => this.targetPosition.copy(origin).add(new Vector3(1.2 * Math.sin(t * 0.7), 0, 0)),
            rotate: () => this.targetQuaternion.copy(orientation).multiply(rotationStep(new Vector3(0, 0.7, 0), t)),
            combined: () => { this.targetPosition.copy(origin).add(new Vector3(Math.sin(t), 0.3 * Math.sin(t * 0.5), Math.cos(t) - 1));
                this.targetQuaternion.copy(orientation).multiply(rotationStep(new Vector3(0.25, 0.4, 0.2), t)); }
        };
        targets[name]?.();
    }
    step(dt = 0.01) {
        this.time += dt; this.updateTrajectory();
        const acceleration = this.targetPosition.clone().sub(this.p).multiplyScalar(30).addScaledVector(this.v, -11).clampLength(0, 8);
        if (this.v.length() > 2 && acceleration.dot(this.v) > 0) acceleration.addScaledVector(this.v, -acceleration.dot(this.v) / this.v.lengthSq());
        const difference = this.q.clone().invert().multiply(this.targetQuaternion);
        if (difference.w < 0) difference.set(-difference.x, -difference.y, -difference.z, -difference.w);
        const imaginary = new Vector3(difference.x, difference.y, difference.z);
        const desired = imaginary.length() < 1e-10 ? new Vector3() : imaginary.normalize().multiplyScalar(2 * Math.acos(Math.min(1, difference.w)) * 6).clampLength(0, 3);
        const nextOmega = this.omega.clone().addScaledVector(desired.sub(this.omega).clampLength(0, 10), dt);
        const rate = this.omega.clone().add(nextOmega).multiplyScalar(0.5);
        const midpoint = this.q.clone().multiply(rotationStep(rate, dt / 2));
        this.q.multiply(rotationStep(rate, dt)).normalize(); this.omega.copy(nextOmega);
        this.p.addScaledVector(this.v, dt).addScaledVector(acceleration, 0.5 * dt * dt); this.v.addScaledVector(acceleration, dt);
        const force = acceleration.clone().add(new Vector3(0, GRAVITY, 0)).applyQuaternion(midpoint.invert()).toArray();
        const gyro = rate.toArray();
        for (let axis = 0; axis < 3; axis += 1) {
            this.gyroWalk[axis] += this.gaussian() * this.noise.walk * Math.sqrt(dt);
            this.accelWalk[axis] += this.gaussian() * this.noise.walk * Math.sqrt(dt);
            gyro[axis] += this.noise.gyroBias * [1, -0.6, 0.4][axis] + this.gyroWalk[axis] + this.gaussian() * this.noise.gyro;
            force[axis] += this.noise.accelBias * [1, -0.5, 0.3][axis] + this.accelWalk[axis] + this.gaussian() * this.noise.accel;
        }
        if (this.random() < this.noise.drop) return null;
        return { time: this.time, gyro, accel: force, kind: 'gravity' };
    }
    nextInterval() { return Math.max(0.003, 0.01 * (1 + (this.random() * 2 - 1) * this.noise.jitter)); }
    truth() { return { position: this.p.toArray(), velocity: this.v.toArray(), quaternion: this.q.toArray() }; }
}
