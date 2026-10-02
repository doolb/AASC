import { normalizeWindSettings, windFlowDirection, createWindState, advanceWindState } from '../../../mmd-physics-wind.mjs';
import {
	Bone,
	BoxGeometry,
	CapsuleGeometry,
	Color,
	Euler,
	Matrix4,
	Mesh,
	MeshBasicMaterial,
	Object3D,
	Quaternion,
	SphereGeometry,
	Vector3
} from 'three';

/**
 * Dependencies
 *  - Ammo.js https://github.com/kripken/ammo.js
 *
 * MMDPhysics calculates physics with Ammo(Bullet based JavaScript Physics engine)
 * for MMD model loaded by MMDLoader.
 *
 * TODO
 *  - Physics in Worker
 */

/* global Ammo */

class MMDPhysics {

	/**
	 * @param {THREE.SkinnedMesh} mesh
	 * @param {Array<Object>} rigidBodyParams
	 * @param {Array<Object>} (optional) constraintParams
	 * @param {Object} params - (optional)
	 * @param {Number} params.unitStep - Default is 1 / 65.
	 * @param {Integer} params.maxStepNum - Default is 3.
	 * @param {Vector3} params.gravity - Default is ( 0, - 9.8 * 10, 0 )
	 */
	constructor( mesh, rigidBodyParams, constraintParams = [], params = {} ) {

		if ( typeof Ammo === 'undefined' ) {

			throw new Error( 'THREE.MMDPhysics: Import ammo.js https://github.com/kripken/ammo.js' );

		}

		this.manager = new ResourceManager();

		this.mesh = mesh;

		/*
		 * I don't know why but 1/60 unitStep easily breaks models
		 * so I set it 1/65 so far.
		 * Don't set too small unitStep because
		 * the smaller unitStep can make the performance worse.
		 */
		this.unitStep = ( params.unitStep !== undefined ) ? params.unitStep : 1 / 90;
		this.maxStepNum = ( params.maxStepNum !== undefined ) ? params.maxStepNum : 3;
		this.gravity = new Vector3( 0, - 9.8 * 10, 0 );

		if ( params.gravity !== undefined ) this.gravity.copy( params.gravity );

		this.world = params.world !== undefined ? params.world : null; // experimental

		this.bodies = [];
		this.constraints = [];
        this.windSettings = normalizeWindSettings();
        this.windState = createWindState();
        this.windDirection = windFlowDirection(this.windSettings);
        this.windBodies = null;
        this.windSceneQuaternion = new Quaternion();
        this.windScratch = { force: new Vector3(), direction: new Vector3(), lever: new Vector3(), torque: new Vector3(),
            frameQuaternion: new Quaternion(), quaternion: new Quaternion() };
        this.stabilityUnitStep = null;
        this.stabilityReferenceHz = 45;
        this.stabilityAppliedReferenceHz = null;
        // 每个物理实例独占历史；初始化失败时也有可释放的完整状态。
        this.anchorSamples = [];
        this.physicsRemainder = 0;
        this.physicsSampleTime = 0;
        this.physicsStepTime = 0;
        this.interpolationUnitStep = this.unitStep;
        // 独立网页诊断的可选观察入口，未选中骨骼时保持null。
        this.onDiagnosticSubstep = null;

        this.disposed = false;
        try { this._init(mesh, rigidBodyParams, constraintParams); }
        catch (error) {
            try { this.dispose(); } catch (cleanupError) { console.warn('清理初始化失败的物理:', cleanupError.message); }
            throw error;
        }

	}

	/**
	 * Advances Physics calculation and updates bones.
	 *
	 * @param {Number} delta - time in second
	 * @return {MMDPhysics}
	 */
	update( delta ) {
        // 高频画面帧允许没有物理子步，非法/零时间不采样也不推进。
        if (!Number.isFinite(delta) || delta <= 0) return this;
        if (this.windSettings.enabled) this.mesh.getWorldQuaternion(this.windSceneQuaternion);

		const manager = this.manager;
		const mesh = this.mesh;

		// rigid bodies and constrains are for
		// mesh's world scale (1, 1, 1).
		// Convert to (1, 1, 1) if it isn't.

		let isNonDefaultScale = false;

		const position = manager.allocThreeVector3();
		const quaternion = manager.allocThreeQuaternion();
		const scale = manager.allocThreeVector3();

		mesh.matrixWorld.decompose( position, quaternion, scale );

		// 本地补丁：旋转矩阵分解会产生微小尺度误差，不能因此脱离中心枢轴。
		// 单位缩放允许 0.001 误差；超过容差才执行原有的尺度转换。
		const scaleTolerance = 0.001;
		if ( Math.abs( scale.x - 1 ) > scaleTolerance ||
			Math.abs( scale.y - 1 ) > scaleTolerance ||
			Math.abs( scale.z - 1 ) > scaleTolerance ) {

			isNonDefaultScale = true;

		}

		let parent;

		if ( isNonDefaultScale ) {

			parent = mesh.parent;

			if ( parent !== null ) mesh.parent = null;

			scale.copy( this.mesh.scale );

			mesh.scale.set( 1, 1, 1 );
			mesh.updateMatrixWorld( true );

		}

		// calculate physics and update bones

        try {
            this._updateRigidBodies();
            this._stepSimulation(delta);
            // 骨骼只在所有子步完成后回写一次，VMD/IK仍按画面帧推进。
            this._updateBones();
        } finally {

		// restore mesh if converted above

		if ( isNonDefaultScale ) {

			if ( parent !== null ) mesh.parent = parent;

			mesh.scale.copy( scale );

		}

		manager.freeThreeVector3( scale );
		manager.freeThreeQuaternion( quaternion );
		manager.freeThreeVector3( position );
        }

		return this;

	}

	/**
	 * Resets rigid bodies transorm to current bone's.
	 *
	 * @return {MMDPhysics}
	 */
	reset() {

		for ( let i = 0, il = this.bodies.length; i < il; i ++ ) {

			this.bodies[ i ].reset();

		}

        this.resetAnchorInterpolation();
		return this;

	}

	/**
	 * Warm ups Rigid bodies. Calculates cycles steps.
	 *
	 * @param {Integer} cycles
	 * @return {MMDPhysics}
	 */
	warmup( cycles ) {

		for ( let i = 0; i < cycles; i ++ ) {

			this.update( 1 / 60 );

		}

		return this;

	}

	/**
	 * Sets gravity.
	 *
	 * @param {Vector3} gravity
	 * @return {MMDPhysicsHelper}
	 */
	setGravity( gravity ) {

        const vector = this.manager.allocVector3();
        try {
            vector.setValue(gravity.x, gravity.y, gravity.z);
            this.world.setGravity(vector);
        } finally { this.manager.freeVector3(vector); }
		this.gravity.copy( gravity );

		return this;

	}

	/**
	 * Creates MMDPhysicsHelper
	 *
	 * @return {MMDPhysicsHelper}
	 */
	createHelper() {

		return new MMDPhysicsHelper( this.mesh, this );

	}

	// private methods

    // 构造失败也恢复网格变换；部分创建的对象由构造器 catch 统一释放。
    _init(mesh, rigidBodyParams, constraintParams) {
        const parent = mesh.parent;
        const position = mesh.position.clone();
        const quaternion = mesh.quaternion.clone();
        const scale = mesh.scale.clone();
        try {
            mesh.parent = null;
            mesh.position.set(0, 0, 0);
            mesh.quaternion.set(0, 0, 0, 1);
            mesh.scale.set(1, 1, 1);
            mesh.updateMatrixWorld(true);
            if (this.world === null) {
                this.world = this._createWorld();
                this.setGravity(this.gravity);
            }
            this._initRigidBodies(rigidBodyParams);
            this._initConstraints(constraintParams);
        } finally {
            mesh.parent = parent;
            mesh.position.copy(position);
            mesh.quaternion.copy(quaternion);
            mesh.scale.copy(scale);
            mesh.updateMatrixWorld(true);
        }
        this.reset();
    }

    dispose() {
        if (this.disposed) return this;
        this.disposed = true;
        try { this.manager.dispose(this.world); }
        finally {
            this.anchorSamples.length = 0;
            this.physicsRemainder = 0;
            this.physicsSampleTime = 0;
            this.physicsStepTime = 0;
            this.onDiagnosticSubstep = null;
            this.windBodies = null;
            this.windScratch = null;
            this.bodies.length = 0;
            this.constraints.length = 0;
            this.world = null;
            this.mesh = null;
        }
        return this;
    }

	_createWorld() {

        const manager = this.manager;

		const config = manager.own(new Ammo.btDefaultCollisionConfiguration());
		const dispatcher = manager.own(new Ammo.btCollisionDispatcher( config ));
		const cache = manager.own(new Ammo.btDbvtBroadphase());
		const solver = manager.own(new Ammo.btSequentialImpulseConstraintSolver());
		const world = manager.own(new Ammo.btDiscreteDynamicsWorld( dispatcher, cache, solver, config ));
		return world;

	}

	_initRigidBodies( rigidBodies ) {

		for ( let i = 0, il = rigidBodies.length; i < il; i ++ ) {

			this.bodies.push( new RigidBody(
				this.mesh, this.world, rigidBodies[ i ], this.manager ) );

		}

	}

	_initConstraints( constraints ) {

		for ( let i = 0, il = constraints.length; i < il; i ++ ) {

			const params = constraints[ i ];
			const bodyA = this.bodies[ params.rigidBodyIndex1 ];
			const bodyB = this.bodies[ params.rigidBodyIndex2 ];
			this.constraints.push( new Constraint( this.mesh, this.world, bodyA, bodyB, params, this.manager ) );

		}

	}

    // getter返回的origin/rotation是借用值，只复制分量，绝不销毁借用包装。
    _readAnchorTransform(form, position, quaternion) {
        const origin = form.getOrigin();
        const rotation = form.getRotation();
        position.set(origin.x(), origin.y(), origin.z());
        quaternion.set(rotation.x(), rotation.y(), rotation.z(), rotation.w()).normalize();
    }

    // 原库STOP_ERP=0.475以65Hz为参考；归一单位时间的误差衰减，而不修改弹簧/质量。
    // 参考Hz运行时可调（默认45）：unitStep或参考值任一变化都重算六轴纠错率。
    _refreshConstraintStability() {
        if (this.stabilityUnitStep === this.unitStep
            && this.stabilityAppliedReferenceHz === this.stabilityReferenceHz) return;
        const reference = Number(this.stabilityReferenceHz);
        const referenceHz = Number.isFinite(reference) && reference > 0 ? reference : 45;
        const stopErp = 1 - Math.pow(1 - 0.475, referenceHz * this.unitStep);
        for (const entry of this.constraints) {
            if (typeof entry.constraint.setParam !== 'function') continue;
            for (let axis = 0; axis < 6; axis += 1) entry.constraint.setParam(2, stopErp, axis);
        }
        this.stabilityUnitStep = this.unitStep;
        this.stabilityAppliedReferenceHz = this.stabilityReferenceHz;
    }

    // 运行时实时改基准：立即重算六轴，不等待变频/复位；非法值按45。
    setStabilityReferenceHz(value) {
        const reference = Number(value);
        this.stabilityReferenceHz = Number.isFinite(reference) && reference > 0 ? reference : 45;
        this._refreshConstraintStability();
        return this.stabilityReferenceHz;
    }

    setWindSettings(value) {
        this.windSettings = normalizeWindSettings(value);
        this.windDirection = windFlowDirection(this.windSettings);
        // 关闭立刻停止新施力，保留刚体已有速度；下次开启从0缓动。
        if (!this.windSettings.enabled) this.windState.strength = 0;
        return { ...this.windSettings };
    }

    _applyWind(seconds) {
        if (this.disposed || !this.windSettings.enabled) return;
        const strength = advanceWindState(this.windState, seconds, this.windSettings);
        if (strength <= 0) return;
        // 第一次开启才筛选受风刚体；关闭时完全不遍历。模型切换由新物理实例重新建立缓存。
        if (!this.windBodies) this.windBodies = this.bodies.filter((entry) => entry.params.type !== 0
            && Number.isFinite(entry.params.weight) && entry.params.weight > 0);
        const scratch = this.windScratch;
        const direction = this.windDirection;
        // 原MMDPhysics非单位缩放时会暂时脱离父级。将场景风向换到当前物理坐标，
        // 保证经纬度和灯光同属场景方向，角色旋转/缩放不带动外部风。
        scratch.frameQuaternion.copy(this.windSceneQuaternion).invert();
        scratch.direction.set(direction.x, direction.y, direction.z).applyQuaternion(scratch.frameQuaternion);
        this.mesh.getWorldQuaternion(scratch.frameQuaternion);
        scratch.direction.applyQuaternion(scratch.frameQuaternion);
        let force = null;
        let torque = null;
        try {
            force = this.manager.allocVector3();
            torque = this.manager.allocVector3();
            for (const entry of this.windBodies) {
                scratch.force.copy(scratch.direction).multiplyScalar(entry.params.weight * 10 * strength);
                if (!entry.positionDriven) {
                    force.setValue(scratch.force.x, scratch.force.y, scratch.force.z);
                    entry.body.applyCentralForce(force);
                    continue;
                }
                // type2位置由骨骼锚点驱动：只添加近似风致力矩，不改线性因子/目标速度。
                // 借用的Bullet姿态只读分量；等效力臂来自骨骼到刚体COM的偏移，不制造虚构偏移。
                const rotation = entry.body.getCenterOfMassTransform().getRotation();
                scratch.quaternion.set(rotation.x(), rotation.y(), rotation.z(), rotation.w()).normalize();
                scratch.lever.copy(entry.windLever).applyQuaternion(scratch.quaternion);
                scratch.torque.crossVectors(scratch.lever, scratch.force);
                scratch.torque.applyQuaternion(scratch.quaternion.invert());
                const inertia = entry.windInertia;
                // 局部各轴角加速度上限12rad/s²，极小/零惯量时力矩同步趋零，避免小物件被风吹炸。
                for (const axis of ['x', 'y', 'z']) {
                    const limit = Number.isFinite(inertia[axis]) ? Math.max(0, inertia[axis]) * 12 : 0;
                    scratch.torque[axis] = Math.min(limit, Math.max(-limit, scratch.torque[axis]));
                }
                scratch.torque.applyQuaternion(scratch.quaternion.invert());
                torque.setValue(scratch.torque.x, scratch.torque.y, scratch.torque.z);
                entry.body.applyTorque(torque);
            }
        } finally {
            if (torque) this.manager.freeVector3(torque);
            if (force) this.manager.freeVector3(force);
        }
    }

    resetAnchorInterpolation() {
        if (this.disposed) return this;
        this._refreshConstraintStability();
        // 复位和恢复只重建驱动历史，不修改动态刚体速度、力或姿态。
        if (this.anchorSamples.length === 0) {
            this.anchorSamples = this.bodies
                .filter((entry) => (entry.params.type === 0 && entry.params.boneIndex !== -1) || entry.positionDriven)
                .map((entry) => ({ entry, previousPosition: new Vector3(), position: new Vector3(),
                    previousQuaternion: new Quaternion(), quaternion: new Quaternion(),
                    stepPosition: new Vector3(), stepQuaternion: new Quaternion() }));
        }
        for (const sample of this.anchorSamples) {
            this._readAnchorTransform(sample.entry.body.getCenterOfMassTransform(), sample.position, sample.quaternion);
            sample.previousPosition.copy(sample.position);
            sample.previousQuaternion.copy(sample.quaternion);
        }
        this.physicsRemainder = 0;
        this.physicsSampleTime = 0;
        this.physicsStepTime = 0;
        this.interpolationUnitStep = this.unitStep;
        return this;
    }

    _updateRigidBodies() {
        // 调节频率时从实际锚点姿态重新计时，随后再采集本帧骨骼目标。
        if (this.interpolationUnitStep !== this.unitStep) this.resetAnchorInterpolation();
        for (const sample of this.anchorSamples) {
            sample.previousPosition.copy(sample.position);
            sample.previousQuaternion.copy(sample.quaternion);
            const form = sample.entry._getBoneTransform();
            try { this._readAnchorTransform(form, sample.position, sample.quaternion); }
            finally { this.manager.freeTransform(form); }
        }
    }

    _applyAnchorTargets(alpha, form, velocity) {
        for (const sample of this.anchorSamples) {
            sample.stepPosition.lerpVectors(sample.previousPosition, sample.position, alpha);
            if (sample.entry.positionDriven) {
                // 只指定本步终点所需线速度，不能先跳到终点再积分，否则会重复移动。
                // 当前COM是借用值；角速度与姿态不被改写，仍由Ammo处理旋转及接触。
                const origin = sample.entry.body.getCenterOfMassTransform().getOrigin();
                velocity.setValue((sample.stepPosition.x - origin.x()) / this.unitStep,
                    (sample.stepPosition.y - origin.y()) / this.unitStep,
                    (sample.stepPosition.z - origin.z()) / this.unitStep);
                sample.entry.body.setLinearVelocity(velocity);
                continue;
            }
            sample.stepQuaternion.slerpQuaternions(sample.previousQuaternion, sample.quaternion, alpha);
            this.manager.setOriginFromThreeVector3(form, sample.stepPosition);
            this.manager.setBasisFromThreeQuaternion(form, sample.stepQuaternion);
            // 只写运动学MotionState。每次单步调用前Bullet会读取目标并计算线/角速度。
            // type1不被覆盖；type2位置驱动不通用清零任何刚体速度。
            sample.entry.body.getMotionState().setWorldTransform(form);
        }
    }

    _stepSimulation(delta) {
        const h = this.unitStep;
        const previousTime = this.physicsSampleTime;
        this.physicsSampleTime += delta;
        this.physicsRemainder += delta;
        // 只补偿浮点边界误差；不足一步的画面帧不强制模拟，余量跨帧保存。
        const due = Math.floor(this.physicsRemainder / h + 1e-9);
        const steps = Math.min(due, this.maxStepNum);
        const skipped = due - steps;
        // 超预算丢弃整步而非形成无限积压，同时推进采样时钟，使插值比例仍对应真实时间。
        this.physicsStepTime += skipped * h;
        this.physicsRemainder -= skipped * h;
        if (steps === 0) return;
        let form = null;
        let velocity = null;
        try {
            form = this.anchorSamples.length ? this.manager.allocTransform() : null;
            if (this.anchorSamples.some((sample) => sample.entry.positionDriven)) velocity = this.manager.allocVector3();
            // 受控平移必须到达目标，暂时跳过其线性阻尼；旋转阻尼原值保留。
            // 即使原始线性阻尼为1也能驱动，finally恢复参数，不影响其余动态刚体。
            for (const sample of this.anchorSamples) {
                if (sample.entry.positionDriven) sample.entry.body.setDamping(0, sample.entry.params.rotationDamping);
            }
            for (let index = 0; index < steps; index += 1) {
                const nextTime = this.physicsStepTime + h;
                const alpha = Math.min(1, Math.max(0, (nextTime - previousTime) / delta));
                if (form) this._applyAnchorTargets(alpha, form, velocity);
                // 外层负责固定时钟，maxSubSteps=0让Bullet恰好求解一次，避免重复内部拆步。
                // 风按真实子步施力，由Bullet积分；未注入风模块的测试仍走原步进。
                this._applyWind?.(h);
                this.world.stepSimulation(h, 0, h);
                this.onDiagnosticSubstep?.();
                this.physicsStepTime = nextTime;
                this.physicsRemainder = Math.max(0, this.physicsRemainder - h);
            }
        } finally {
            try {
                for (const sample of this.anchorSamples) {
                    if (sample.entry.positionDriven) sample.entry.body.setDamping(
                        sample.entry.params.positionDamping, sample.entry.params.rotationDamping);
                }
            } finally {
                // 参数恢复异常也必须归还临时值，避免下一次切换累积native分配。
                if (velocity) this.manager.freeVector3(velocity);
                if (form) this.manager.freeTransform(form);
            }
        }
    }

	_updateBones() {

		for ( let i = 0, il = this.bodies.length; i < il; i ++ ) {

			this.bodies[ i ].updateBone();

		}

	}

}

/**
 * This manager's responsibilies are
 *
 * 1. manage Ammo.js and Three.js object resources and
 *    improve the performance and the memory consumption by
 *    reusing objects.
 *
 * 2. provide simple Ammo object operations.
 */
class ResourceManager {

	constructor() {

		// for Three.js
		this.threeVector3s = [];
		this.threeMatrix4s = [];
		this.threeQuaternions = [];
		this.threeEulers = [];

		// for Ammo.js
		this.transforms = [];
		this.quaternions = [];
		this.vector3s = [];
        // 所有权仅登记 new 出来的对象；getter 返回值和外部传入 world 不属于此实例。
        this.nativeObjects = new Map();
        this.attachedBodies = new Set();
        this.attachedConstraints = new Set();
        this.disposed = false;

	}

    own(object) {
        if (this.disposed) throw new Error('物理资源池已释放');
        this.nativeObjects.set(object, object);
        return object;
    }

    release(object) {
        if (!this.nativeObjects.delete(object)) return;
        Ammo.destroy(object);
    }

    dispose(world) {
        if (this.disposed) return;
        this.disposed = true;
        const errors = [];
        const attempt = (action) => {
            try { action(); } catch (error) { errors.push(error); }
        };
        // 先断开 native 引用，约束早于刚体；逆创建顺序保证刚体早于状态/形状、world早于依赖。
        for (const constraint of this.attachedConstraints) attempt(() => world.removeConstraint(constraint));
        for (const body of this.attachedBodies) attempt(() => world.removeRigidBody(body));
        for (const object of [...this.nativeObjects.keys()].reverse()) attempt(() => this.release(object));
        this.attachedConstraints.clear();
        this.attachedBodies.clear();
        for (const pool of [this.transforms, this.quaternions, this.vector3s,
            this.threeVector3s, this.threeMatrix4s, this.threeQuaternions, this.threeEulers]) pool.length = 0;
        if (errors.length) throw new AggregateError(errors, '释放 Ammo 物理资源失败');
    }

	allocThreeVector3() {

		return ( this.threeVector3s.length > 0 )
			? this.threeVector3s.pop()
			: new Vector3();

	}

	freeThreeVector3( v ) {

		this.threeVector3s.push( v );

	}

	allocThreeMatrix4() {

		return ( this.threeMatrix4s.length > 0 )
			? this.threeMatrix4s.pop()
			: new Matrix4();

	}

	freeThreeMatrix4( m ) {

		this.threeMatrix4s.push( m );

	}

	allocThreeQuaternion() {

		return ( this.threeQuaternions.length > 0 )
			? this.threeQuaternions.pop()
			: new Quaternion();

	}

	freeThreeQuaternion( q ) {

		this.threeQuaternions.push( q );

	}

	allocThreeEuler() {

		return ( this.threeEulers.length > 0 )
			? this.threeEulers.pop()
			: new Euler();

	}

	freeThreeEuler( e ) {

		this.threeEulers.push( e );

	}

	allocTransform() {

		return ( this.transforms.length > 0 )
			? this.transforms.pop()
			: this.own(new Ammo.btTransform());

	}

	freeTransform( t ) {

		this.transforms.push( t );

	}

	allocQuaternion() {

		return ( this.quaternions.length > 0 )
			? this.quaternions.pop()
			: this.own(new Ammo.btQuaternion());

	}

	freeQuaternion( q ) {

		this.quaternions.push( q );

	}

	allocVector3() {

		return ( this.vector3s.length > 0 )
			? this.vector3s.pop()
			: this.own(new Ammo.btVector3());

	}

	freeVector3( v ) {

		this.vector3s.push( v );

	}

	setIdentity( t ) {

		t.setIdentity();

	}

	getBasis( t ) {

		var q = this.allocQuaternion();
		t.getBasis().getRotation( q );
		return q;

	}

	getBasisAsMatrix3( t ) {

		var q = this.getBasis( t );
		var m = this.quaternionToMatrix3( q );
		this.freeQuaternion( q );
		return m;

	}

	getOrigin( t ) {

		return t.getOrigin();

	}

	setOrigin( t, v ) {

		t.getOrigin().setValue( v.x(), v.y(), v.z() );

	}

	copyOrigin( t1, t2 ) {

		var o = t2.getOrigin();
		this.setOrigin( t1, o );

	}

	setBasis( t, q ) {

		t.setRotation( q );

	}

	setBasisFromMatrix3( t, m ) {

		var q = this.matrix3ToQuaternion( m );
		this.setBasis( t, q );
		this.freeQuaternion( q );

	}

	setOriginFromArray3( t, a ) {

		t.getOrigin().setValue( a[ 0 ], a[ 1 ], a[ 2 ] );

	}

	setOriginFromThreeVector3( t, v ) {

		t.getOrigin().setValue( v.x, v.y, v.z );

	}

	setBasisFromArray3( t, a ) {

		var thQ = this.allocThreeQuaternion();
		var thE = this.allocThreeEuler();
		thE.set( a[ 0 ], a[ 1 ], a[ 2 ] );
		this.setBasisFromThreeQuaternion( t, thQ.setFromEuler( thE ) );

		this.freeThreeEuler( thE );
		this.freeThreeQuaternion( thQ );

	}

	setBasisFromThreeQuaternion( t, a ) {

		var q = this.allocQuaternion();

		q.setX( a.x );
		q.setY( a.y );
		q.setZ( a.z );
		q.setW( a.w );
		this.setBasis( t, q );

		this.freeQuaternion( q );

	}

	multiplyTransforms( t1, t2 ) {

		var t = this.allocTransform();
		this.setIdentity( t );

		var m1 = this.getBasisAsMatrix3( t1 );
		var m2 = this.getBasisAsMatrix3( t2 );

		var o1 = this.getOrigin( t1 );
		var o2 = this.getOrigin( t2 );

		var v1 = this.multiplyMatrix3ByVector3( m1, o2 );
		var v2 = this.addVector3( v1, o1 );
		this.setOrigin( t, v2 );

		var m3 = this.multiplyMatrices3( m1, m2 );
		this.setBasisFromMatrix3( t, m3 );

		this.freeVector3( v1 );
		this.freeVector3( v2 );

		return t;

	}

	inverseTransform( t ) {

		var t2 = this.allocTransform();

		var m1 = this.getBasisAsMatrix3( t );
		var o = this.getOrigin( t );

		var m2 = this.transposeMatrix3( m1 );
		var v1 = this.negativeVector3( o );
		var v2 = this.multiplyMatrix3ByVector3( m2, v1 );

		this.setOrigin( t2, v2 );
		this.setBasisFromMatrix3( t2, m2 );

		this.freeVector3( v1 );
		this.freeVector3( v2 );

		return t2;

	}

	multiplyMatrices3( m1, m2 ) {

		var m3 = [];

		var v10 = this.rowOfMatrix3( m1, 0 );
		var v11 = this.rowOfMatrix3( m1, 1 );
		var v12 = this.rowOfMatrix3( m1, 2 );

		var v20 = this.columnOfMatrix3( m2, 0 );
		var v21 = this.columnOfMatrix3( m2, 1 );
		var v22 = this.columnOfMatrix3( m2, 2 );

		m3[ 0 ] = this.dotVectors3( v10, v20 );
		m3[ 1 ] = this.dotVectors3( v10, v21 );
		m3[ 2 ] = this.dotVectors3( v10, v22 );
		m3[ 3 ] = this.dotVectors3( v11, v20 );
		m3[ 4 ] = this.dotVectors3( v11, v21 );
		m3[ 5 ] = this.dotVectors3( v11, v22 );
		m3[ 6 ] = this.dotVectors3( v12, v20 );
		m3[ 7 ] = this.dotVectors3( v12, v21 );
		m3[ 8 ] = this.dotVectors3( v12, v22 );

		this.freeVector3( v10 );
		this.freeVector3( v11 );
		this.freeVector3( v12 );
		this.freeVector3( v20 );
		this.freeVector3( v21 );
		this.freeVector3( v22 );

		return m3;

	}

	addVector3( v1, v2 ) {

		var v = this.allocVector3();
		v.setValue( v1.x() + v2.x(), v1.y() + v2.y(), v1.z() + v2.z() );
		return v;

	}

	dotVectors3( v1, v2 ) {

		return v1.x() * v2.x() + v1.y() * v2.y() + v1.z() * v2.z();

	}

	rowOfMatrix3( m, i ) {

		var v = this.allocVector3();
		v.setValue( m[ i * 3 + 0 ], m[ i * 3 + 1 ], m[ i * 3 + 2 ] );
		return v;

	}

	columnOfMatrix3( m, i ) {

		var v = this.allocVector3();
		v.setValue( m[ i + 0 ], m[ i + 3 ], m[ i + 6 ] );
		return v;

	}

	negativeVector3( v ) {

		var v2 = this.allocVector3();
		v2.setValue( - v.x(), - v.y(), - v.z() );
		return v2;

	}

	multiplyMatrix3ByVector3( m, v ) {

		var v4 = this.allocVector3();

		var v0 = this.rowOfMatrix3( m, 0 );
		var v1 = this.rowOfMatrix3( m, 1 );
		var v2 = this.rowOfMatrix3( m, 2 );
		var x = this.dotVectors3( v0, v );
		var y = this.dotVectors3( v1, v );
		var z = this.dotVectors3( v2, v );

		v4.setValue( x, y, z );

		this.freeVector3( v0 );
		this.freeVector3( v1 );
		this.freeVector3( v2 );

		return v4;

	}

	transposeMatrix3( m ) {

		var m2 = [];
		m2[ 0 ] = m[ 0 ];
		m2[ 1 ] = m[ 3 ];
		m2[ 2 ] = m[ 6 ];
		m2[ 3 ] = m[ 1 ];
		m2[ 4 ] = m[ 4 ];
		m2[ 5 ] = m[ 7 ];
		m2[ 6 ] = m[ 2 ];
		m2[ 7 ] = m[ 5 ];
		m2[ 8 ] = m[ 8 ];
		return m2;

	}

	quaternionToMatrix3( q ) {

		var m = [];

		var x = q.x();
		var y = q.y();
		var z = q.z();
		var w = q.w();

		var xx = x * x;
		var yy = y * y;
		var zz = z * z;

		var xy = x * y;
		var yz = y * z;
		var zx = z * x;

		var xw = x * w;
		var yw = y * w;
		var zw = z * w;

		m[ 0 ] = 1 - 2 * ( yy + zz );
		m[ 1 ] = 2 * ( xy - zw );
		m[ 2 ] = 2 * ( zx + yw );
		m[ 3 ] = 2 * ( xy + zw );
		m[ 4 ] = 1 - 2 * ( zz + xx );
		m[ 5 ] = 2 * ( yz - xw );
		m[ 6 ] = 2 * ( zx - yw );
		m[ 7 ] = 2 * ( yz + xw );
		m[ 8 ] = 1 - 2 * ( xx + yy );

		return m;

	}

	matrix3ToQuaternion( m ) {

		var t = m[ 0 ] + m[ 4 ] + m[ 8 ];
		var s, x, y, z, w;

		if ( t > 0 ) {

			s = Math.sqrt( t + 1.0 ) * 2;
			w = 0.25 * s;
			x = ( m[ 7 ] - m[ 5 ] ) / s;
			y = ( m[ 2 ] - m[ 6 ] ) / s;
			z = ( m[ 3 ] - m[ 1 ] ) / s;

		} else if ( ( m[ 0 ] > m[ 4 ] ) && ( m[ 0 ] > m[ 8 ] ) ) {

			s = Math.sqrt( 1.0 + m[ 0 ] - m[ 4 ] - m[ 8 ] ) * 2;
			w = ( m[ 7 ] - m[ 5 ] ) / s;
			x = 0.25 * s;
			y = ( m[ 1 ] + m[ 3 ] ) / s;
			z = ( m[ 2 ] + m[ 6 ] ) / s;

		} else if ( m[ 4 ] > m[ 8 ] ) {

			s = Math.sqrt( 1.0 + m[ 4 ] - m[ 0 ] - m[ 8 ] ) * 2;
			w = ( m[ 2 ] - m[ 6 ] ) / s;
			x = ( m[ 1 ] + m[ 3 ] ) / s;
			y = 0.25 * s;
			z = ( m[ 5 ] + m[ 7 ] ) / s;

		} else {

			s = Math.sqrt( 1.0 + m[ 8 ] - m[ 0 ] - m[ 4 ] ) * 2;
			w = ( m[ 3 ] - m[ 1 ] ) / s;
			x = ( m[ 2 ] + m[ 6 ] ) / s;
			y = ( m[ 5 ] + m[ 7 ] ) / s;
			z = 0.25 * s;

		}

		var q = this.allocQuaternion();
		q.setX( x );
		q.setY( y );
		q.setZ( z );
		q.setW( w );
		return q;

	}

}

/**
 * @param {THREE.SkinnedMesh} mesh
 * @param {Ammo.btDiscreteDynamicsWorld} world
 * @param {Object} params
 * @param {ResourceManager} manager
 */
class RigidBody {

	constructor( mesh, world, params, manager ) {

		this.mesh = mesh;
		this.world = world;
		this.params = params;
		this.manager = manager;

		this.body = null;
		this.bone = null;
		this.boneOffsetForm = null;
		this.boneOffsetFormInverse = null;

		this._init();

	}

	/**
	 * Resets rigid body transform to the current bone's.
	 *
	 * @return {RigidBody}
	 */
	reset() {

		this._setTransformFromBone();
		return this;

	}

	/**
	 * Updates rigid body's transform from the current bone.
	 *
	 * @return {RidigBody}
	 */
	updateFromBone() {

		if ( this.params.boneIndex !== - 1 && this.params.type === 0 ) {

			this._setTransformFromBone();

		}

		return this;

	}

	/**
	 * Updates bone from the current ridid body's transform.
	 *
	 * @return {RidigBody}
	 */
	updateBone() {

		if ( this.params.type === 0 || this.params.boneIndex === - 1 ) {

			return this;

		}

		this._updateBoneRotation();

		if ( this.params.type === 1 ) {

			this._updateBonePosition();

		}

		this.bone.updateMatrixWorld( true );

		if ( this.params.type === 2 && !this.positionDriven ) {

			this._setPositionFromBone();

		}

		return this;

	}

	// private methods

	_init() {

		function generateShape( p ) {

			switch ( p.shapeType ) {

				case 0:
					return manager.own(new Ammo.btSphereShape( p.width ));

				case 1:
					{
                    const size = manager.allocVector3();
                    try {
                        size.setValue(p.width, p.height, p.depth);
                        return manager.own(new Ammo.btBoxShape(size));
                    } finally { manager.freeVector3(size); }
                }

				case 2:
					return manager.own(new Ammo.btCapsuleShape( p.width, p.height ));

				default:
					throw new Error( 'unknown shape type ' + p.shapeType );

			}

		}

		const manager = this.manager;
		const params = this.params;
		const bones = this.mesh.skeleton.bones;
		const bone = ( params.boneIndex === - 1 )
			? new Bone()
			: bones[ params.boneIndex ];

		const shape = generateShape( params );
		const weight = ( params.type === 0 ) ? 0 : params.weight;
		const localInertia = manager.allocVector3();
		localInertia.setValue( 0, 0, 0 );

		if ( weight !== 0 ) {

			shape.calculateLocalInertia( weight, localInertia );

		}

		const boneOffsetForm = manager.allocTransform();
		manager.setIdentity( boneOffsetForm );
		manager.setOriginFromArray3( boneOffsetForm, params.position );
		manager.setBasisFromArray3( boneOffsetForm, params.rotation );

		const vector = manager.allocThreeVector3();
		const boneForm = manager.allocTransform();
		manager.setIdentity( boneForm );
		manager.setOriginFromThreeVector3( boneForm, bone.getWorldPosition( vector ) );

		const form = manager.multiplyTransforms( boneForm, boneOffsetForm );
		const state = manager.own(new Ammo.btDefaultMotionState( form ));

		const info = manager.own(new Ammo.btRigidBodyConstructionInfo( weight, state, shape, localInertia ));
		info.set_m_friction( params.friction );
		info.set_m_restitution( params.restitution );

        let body;
        try { body = manager.own(new Ammo.btRigidBody(info)); }
        finally { manager.release(info); }

		if ( params.type === 0 ) {

			body.setCollisionFlags( body.getCollisionFlags() | 2 );

			/*
			 * It'd be better to comment out this line though in general I should call this method
			 * because I'm not sure why but physics will be more like MMD's
			 * if I comment out.
			 */
			body.setActivationState( 4 );

		}

		body.setDamping( params.positionDamping, params.rotationDamping );
		body.setSleepingThresholds( 0, 0 );
        // type2有骨骼时位置随骨骼、旋转随物理：屏蔽自由平移力，保留原质量及角惯量。
        // 无骨骼的type2没有位置目标，必须继续作为自由动态刚体。
        this.positionDriven = params.type === 2 && params.boneIndex !== -1;
        if (this.positionDriven) {
            const factor = manager.allocVector3();
            try { factor.setValue(0, 0, 0); body.setLinearFactor(factor); }
            finally { manager.freeVector3(factor); }
        }

		this.world.addRigidBody( body, 1 << params.groupIndex, params.groupTarget );
        manager.attachedBodies.add(body);

		this.body = body;
        if (this.positionDriven) {
            this.windInertia = new Vector3(localInertia.x(), localInertia.y(), localInertia.z());
            const offsetRotation = new Quaternion().setFromEuler(new Euler(...params.rotation));
            this.windLever = new Vector3(...params.position).applyQuaternion(offsetRotation.invert()).clampLength(0, 1);
        }
		this.bone = bone;
		this.boneOffsetForm = boneOffsetForm;
		this.boneOffsetFormInverse = manager.inverseTransform( boneOffsetForm );

		manager.freeVector3( localInertia );
		manager.freeTransform( form );
		manager.freeTransform( boneForm );
		manager.freeThreeVector3( vector );

	}

	_getBoneTransform() {

		const manager = this.manager;
		const p = manager.allocThreeVector3();
		const q = manager.allocThreeQuaternion();
		const s = manager.allocThreeVector3();

		this.bone.matrixWorld.decompose( p, q, s );

		const tr = manager.allocTransform();
		manager.setOriginFromThreeVector3( tr, p );
		manager.setBasisFromThreeQuaternion( tr, q );

		const form = manager.multiplyTransforms( tr, this.boneOffsetForm );

		manager.freeTransform( tr );
		manager.freeThreeVector3( s );
		manager.freeThreeQuaternion( q );
		manager.freeThreeVector3( p );

		return form;

	}

	_getWorldTransformForBone() {

		const manager = this.manager;
		const tr = this.body.getCenterOfMassTransform();
		return manager.multiplyTransforms( tr, this.boneOffsetFormInverse );

	}

	_setTransformFromBone() {

		const manager = this.manager;
		const form = this._getBoneTransform();

		// TODO: check the most appropriate way to set
		//this.body.setWorldTransform( form );
		this.body.setCenterOfMassTransform( form );
		this.body.getMotionState().setWorldTransform( form );

		manager.freeTransform( form );

	}

	_setPositionFromBone() {

		const manager = this.manager;
		const form = this._getBoneTransform();

		const tr = manager.allocTransform();
		this.body.getMotionState().getWorldTransform( tr );
		manager.copyOrigin( tr, form );

		// TODO: check the most appropriate way to set
		//this.body.setWorldTransform( tr );
		this.body.setCenterOfMassTransform( tr );
		this.body.getMotionState().setWorldTransform( tr );

		manager.freeTransform( tr );
		manager.freeTransform( form );

	}

    _updateBoneRotation() {
        const manager = this.manager;
        const form = this._getWorldTransformForBone();
        const rotation = manager.getBasis(form);
        const worldQuaternion = manager.allocThreeQuaternion();
        const parentQuaternion = manager.allocThreeQuaternion();
        try {
            worldQuaternion.set(rotation.x(), rotation.y(), rotation.z(), rotation.w());
            // 父骨骼可能刚被物理回写或动作恢复。getWorldQuaternion更新祖先及父级自身，
            // 不遍历整个模型；世界目标必须由父世界旋转的逆换算为局部旋转。
            if (this.bone.parent) this.bone.parent.getWorldQuaternion(parentQuaternion).invert();
            else parentQuaternion.identity();
            this.bone.quaternion.copy(parentQuaternion.multiply(worldQuaternion).normalize());
        } finally {
            // 只归还本次取得的池对象，不清理借用刚体、不改速度、质量或关节参数。
            manager.freeThreeQuaternion(parentQuaternion);
            manager.freeThreeQuaternion(worldQuaternion);
            manager.freeQuaternion(rotation);
            manager.freeTransform(form);
        }
    }

	_updateBonePosition() {

		const manager = this.manager;

		const tr = this._getWorldTransformForBone();

		const thV = manager.allocThreeVector3();

		const o = manager.getOrigin( tr );
		thV.set( o.x(), o.y(), o.z() );

		if ( this.bone.parent ) {

			this.bone.parent.worldToLocal( thV );

		}

		this.bone.position.copy( thV );

		manager.freeThreeVector3( thV );

		manager.freeTransform( tr );

	}

}

//

class Constraint {

	/**
	 * @param {THREE.SkinnedMesh} mesh
	 * @param {Ammo.btDiscreteDynamicsWorld} world
	 * @param {RigidBody} bodyA
	 * @param {RigidBody} bodyB
	 * @param {Object} params
	 * @param {ResourceManager} manager
	 */
	constructor( mesh, world, bodyA, bodyB, params, manager ) {

		this.mesh = mesh;
		this.world = world;
		this.bodyA = bodyA;
		this.bodyB = bodyB;
		this.params = params;
		this.manager = manager;

		this.constraint = null;

		this._init();

	}

	// private method

	_init() {

		const manager = this.manager;
		const params = this.params;
		const bodyA = this.bodyA;
		const bodyB = this.bodyB;

		const form = manager.allocTransform();
		manager.setIdentity( form );
		manager.setOriginFromArray3( form, params.position );
		manager.setBasisFromArray3( form, params.rotation );

		const formA = manager.allocTransform();
		const formB = manager.allocTransform();

		bodyA.body.getMotionState().getWorldTransform( formA );
		bodyB.body.getMotionState().getWorldTransform( formB );

		const formInverseA = manager.inverseTransform( formA );
		const formInverseB = manager.inverseTransform( formB );

		const formA2 = manager.multiplyTransforms( formInverseA, form );
		const formB2 = manager.multiplyTransforms( formInverseB, form );

		const constraint = manager.own(new Ammo.btGeneric6DofSpringConstraint( bodyA.body, bodyB.body, formA2, formB2, true ));

		const lll = manager.allocVector3();
		const lul = manager.allocVector3();
		const all = manager.allocVector3();
		const aul = manager.allocVector3();

		lll.setValue( params.translationLimitation1[ 0 ],
		              params.translationLimitation1[ 1 ],
		              params.translationLimitation1[ 2 ] );
		lul.setValue( params.translationLimitation2[ 0 ],
		              params.translationLimitation2[ 1 ],
		              params.translationLimitation2[ 2 ] );
		all.setValue( params.rotationLimitation1[ 0 ],
		              params.rotationLimitation1[ 1 ],
		              params.rotationLimitation1[ 2 ] );
		aul.setValue( params.rotationLimitation2[ 0 ],
		              params.rotationLimitation2[ 1 ],
		              params.rotationLimitation2[ 2 ] );

		constraint.setLinearLowerLimit( lll );
		constraint.setLinearUpperLimit( lul );
		constraint.setAngularLowerLimit( all );
		constraint.setAngularUpperLimit( aul );

		for ( let i = 0; i < 3; i ++ ) {

			if ( params.springPosition[ i ] !== 0 ) {

				constraint.enableSpring( i, true );
				constraint.setStiffness( i, params.springPosition[ i ] );

			}

		}

		for ( let i = 0; i < 3; i ++ ) {

			if ( params.springRotation[ i ] !== 0 ) {

				constraint.enableSpring( i + 3, true );
				constraint.setStiffness( i + 3, params.springRotation[ i ] );

			}

		}

		/*
		 * Currently(10/31/2016) official ammo.js doesn't support
		 * btGeneric6DofSpringConstraint.setParam method.
		 * You need custom ammo.js (add the method into idl) if you wanna use.
		 * By setting this parameter, physics will be more like MMD's
		 */
		if ( constraint.setParam !== undefined ) {

			for ( let i = 0; i < 6; i ++ ) {

				constraint.setParam( 2, 0.475, i );

			}

		}

		this.world.addConstraint( constraint, true );
        manager.attachedConstraints.add(constraint);
		this.constraint = constraint;

		manager.freeTransform( form );
		manager.freeTransform( formA );
		manager.freeTransform( formB );
		manager.freeTransform( formInverseA );
		manager.freeTransform( formInverseB );
		manager.freeTransform( formA2 );
		manager.freeTransform( formB2 );
		manager.freeVector3( lll );
		manager.freeVector3( lul );
		manager.freeVector3( all );
		manager.freeVector3( aul );

	}

}

//

const _position = new Vector3();
const _quaternion = new Quaternion();
const _scale = new Vector3();
const _matrixWorldInv = new Matrix4();

class MMDPhysicsHelper extends Object3D {

	/**
	 * Visualize Rigid bodies
	 *
	 * @param {THREE.SkinnedMesh} mesh
	 * @param {Physics} physics
	 */
	constructor( mesh, physics ) {

		super();

		this.root = mesh;
		this.physics = physics;

		this.matrix.copy( mesh.matrixWorld );
		this.matrixAutoUpdate = false;

		this.materials = [];

		this.materials.push(
			new MeshBasicMaterial( {
				color: new Color( 0xff8888 ),
				wireframe: true,
				depthTest: false,
				depthWrite: false,
				opacity: 0.25,
				transparent: true
			} )
		);

		this.materials.push(
			new MeshBasicMaterial( {
				color: new Color( 0x88ff88 ),
				wireframe: true,
				depthTest: false,
				depthWrite: false,
				opacity: 0.25,
				transparent: true
			} )
		);

		this.materials.push(
			new MeshBasicMaterial( {
				color: new Color( 0x8888ff ),
				wireframe: true,
				depthTest: false,
				depthWrite: false,
				opacity: 0.25,
				transparent: true
			} )
		);

		this._init();

	}


	/**
	 * Frees the GPU-related resources allocated by this instance. Call this method whenever this instance is no longer used in your app.
	 */
	dispose() {

		const materials = this.materials;
		const children = this.children;

		for ( let i = 0; i < materials.length; i ++ ) {

			materials[ i ].dispose();

		}

		for ( let i = 0; i < children.length; i ++ ) {

			const child = children[ i ];

			if ( child.isMesh ) child.geometry.dispose();

		}

	}

	/**
	 * Updates Rigid Bodies visualization.
	 */
	updateMatrixWorld( force ) {

		var mesh = this.root;

		if ( this.visible ) {

			var bodies = this.physics.bodies;

			_matrixWorldInv
				.copy( mesh.matrixWorld )
				.decompose( _position, _quaternion, _scale )
				.compose( _position, _quaternion, _scale.set( 1, 1, 1 ) )
				.invert();

			for ( var i = 0, il = bodies.length; i < il; i ++ ) {

				var body = bodies[ i ].body;
				var child = this.children[ i ];

				var tr = body.getCenterOfMassTransform();
				var origin = tr.getOrigin();
				var rotation = tr.getRotation();

				child.position
					.set( origin.x(), origin.y(), origin.z() )
					.applyMatrix4( _matrixWorldInv );

				child.quaternion
					.setFromRotationMatrix( _matrixWorldInv )
					.multiply(
						_quaternion.set( rotation.x(), rotation.y(), rotation.z(), rotation.w() )
					);

			}

		}

		this.matrix
			.copy( mesh.matrixWorld )
			.decompose( _position, _quaternion, _scale )
			.compose( _position, _quaternion, _scale.set( 1, 1, 1 ) );

		super.updateMatrixWorld( force );

	}

	// private method

	_init() {

		var bodies = this.physics.bodies;

		function createGeometry( param ) {

			switch ( param.shapeType ) {

				case 0:
					return new SphereGeometry( param.width, 16, 8 );

				case 1:
					return new BoxGeometry( param.width * 2, param.height * 2, param.depth * 2, 8, 8, 8 );

				case 2:
					return new CapsuleGeometry( param.width, param.height, 8, 16 );

				default:
					return null;

			}

		}

		for ( var i = 0, il = bodies.length; i < il; i ++ ) {

			var param = bodies[ i ].params;
			this.add( new Mesh( createGeometry( param ), this.materials[ param.type ] ) );

		}

	}

}

export { MMDPhysics };

/* aasc-shared:addPhysicsLifecycle */

/* aasc-shared:addPhysicsSubsteps */

/* aasc-shared:addPhysicsStability */

/* aasc-shared:addPhysicsWind */
