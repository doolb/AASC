'use strict';

// 只补丁构建出的独立网页 vendor 副本；固定版本锚点不符时停止构建，避免遗漏 native 释放。
function once(source, anchor, replacement) {
    if (source.split(anchor).length !== 2) throw new Error(`物理生命周期缺少唯一锚点：${anchor.slice(0, 90)}`);
    return source.replace(anchor, replacement);
}

function addPhysicsLifecycle(source) {
    let output = once(source, '\t\tthis.vector3s = [];', `\t\tthis.vector3s = [];
        // 所有权仅登记 new 出来的对象；getter 返回值和外部传入 world 不属于此实例。
        this.nativeObjects = new Map();
        this.attachedBodies = new Set();
        this.attachedConstraints = new Set();
        this.disposed = false;`);
    output = once(output, '\tallocThreeVector3() {', `    own(object) {
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

\tallocThreeVector3() {`);
    for (const type of ['btTransform', 'btQuaternion', 'btVector3']) {
        output = once(output, `: new Ammo.${type}();`, `: this.own(new Ammo.${type}());`);
    }
    const allocations = [
        'btDefaultCollisionConfiguration()', 'btCollisionDispatcher( config )', 'btDbvtBroadphase()',
        'btSequentialImpulseConstraintSolver()', 'btDiscreteDynamicsWorld( dispatcher, cache, solver, config )',
        'btSphereShape( p.width )', 'btCapsuleShape( p.width, p.height )', 'btDefaultMotionState( form )',
        'btRigidBodyConstructionInfo( weight, state, shape, localInertia )', 'btRigidBody( info )',
        'btGeneric6DofSpringConstraint( bodyA.body, bodyB.body, formA2, formB2, true )'
    ];
    for (const expression of allocations) {
        output = once(output, `new Ammo.${expression}`, `manager.own(new Ammo.${expression})`);
    }
    output = once(output, '\t_createWorld() {', '\t_createWorld() {\n\n        const manager = this.manager;');
    output = once(output, '\t\tthis.world.setGravity( new Ammo.btVector3( gravity.x, gravity.y, gravity.z ) );', `        const vector = this.manager.allocVector3();
        try {
            vector.setValue(gravity.x, gravity.y, gravity.z);
            this.world.setGravity(vector);
        } finally { this.manager.freeVector3(vector); }`);
    output = once(output, 'return new Ammo.btBoxShape( new Ammo.btVector3( p.width, p.height, p.depth ) );', `{
                    const size = manager.allocVector3();
                    try {
                        size.setValue(p.width, p.height, p.depth);
                        return manager.own(new Ammo.btBoxShape(size));
                    } finally { manager.freeVector3(size); }
                }`);
    output = once(output, '\t\tconst body = manager.own(new Ammo.btRigidBody( info ));', `        let body;
        try { body = manager.own(new Ammo.btRigidBody(info)); }
        finally { manager.release(info); }`);
    output = once(output, '\t\tthis.world.addRigidBody( body, 1 << params.groupIndex, params.groupTarget );', `\t\tthis.world.addRigidBody( body, 1 << params.groupIndex, params.groupTarget );
        manager.attachedBodies.add(body);`);
    output = once(output, '\t\tthis.world.addConstraint( constraint, true );', `\t\tthis.world.addConstraint( constraint, true );
        manager.attachedConstraints.add(constraint);`);
    output = once(output, '\t\tthis._init( mesh, rigidBodyParams, constraintParams );', `        this.disposed = false;
        try { this._init(mesh, rigidBodyParams, constraintParams); }
        catch (error) {
            try { this.dispose(); } catch (cleanupError) { console.warn('清理初始化失败的物理:', cleanupError.message); }
            throw error;
        }`);
    const start = output.indexOf('\t_init( mesh, rigidBodyParams, constraintParams ) {');
    const end = output.indexOf('\t_createWorld() {', start);
    if (start < 0 || end < 0) throw new Error('缺少物理初始化/世界创建边界');
    output = output.slice(0, start) + `    // 构造失败也恢复网格变换；部分创建的对象由构造器 catch 统一释放。
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
            this.bodies.length = 0;
            this.constraints.length = 0;
            this.world = null;
            this.mesh = null;
        }
        return this;
    }

` + output.slice(end);
    // 每个 new 都必须有明确所有者，包括异常时尚未加入 bodies/constraints 的部分。
    if ((output.match(/new Ammo\./gu) || []).length !== 15) throw new Error('固定物理库的 Ammo 分配数量发生变化');
    return output;
}

function addAnimationLifecycle(source, physicsUrl = '../animation/MMDPhysics.js') {
    let output = once(source, "'../animation/MMDPhysics.js'", `'${physicsUrl}'`);
    output = once(output, '\t\t\t\tthis.objects.delete( mesh );', `                // remove 原本只删 JS 记录；必须在记录丢失前释放其独占物理。
                this.objects.get(mesh)?.physics?.dispose();
\t\t\t\tthis.objects.delete( mesh );`);
    const start = output.indexOf('\t\tobjects.physics = this._createMMDPhysics( mesh, params );');
    const end = output.indexOf('\n\t}\n\n\t_animateMesh(', start);
    if (start < 0 || end < 0) throw new Error('缺少 helper 物理初始化边界');
    const setup = output.slice(start, end);
    output = output.slice(0, start) + `        try {
${setup}
        } catch (error) {
            // 构造成功后预热或 IK 失败同样需要清理；构造器失败则由物理自身清理。
            try { objects.physics?.dispose(); }
            catch (cleanupError) { console.warn('清理 helper 物理失败:', cleanupError.message); }
            delete objects.physics;
            throw error;
        }
` + output.slice(end);
    return output;
}

module.exports = { addPhysicsLifecycle, addAnimationLifecycle };

// 正式源码已包含此功能时复用共享实现，仅更新构建指纹。
module.exports = require('./web-production-shared').reuseAdapters(module.exports);
