import * as THREE from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { ImuScene, makeDevice, followTranslation } from './imu-scene.mjs';

/** 右侧跟随相机；手柄使用固定交互相机，防止拖拽时观察位移反馈到射线。 */
export class SimulatorView extends ImuScene {
    constructor(container, simulator) {
        super(container); this.simulator = simulator; this.previous = simulator.p.clone();
        this.device = makeDevice('#ffba70'); this.device.quaternion.copy(simulator.q); this.scene.add(this.device);
        this.target = new THREE.Object3D(); this.target.quaternion.copy(simulator.q); this.scene.add(this.target);
        this.transform = new TransformControls(this.camera, this.renderer.domElement); this.transform.attach(this.target);
        this.transform.setSize(0.85); this.scene.add(this.transform);
        this.transform.addEventListener('dragging-changed', event => {
            this.controls.enabled = !event.value;
            if (event.value) {
                this.simulator.trajectory = null;
                this.dragCamera = this.camera.clone(); this.dragCamera.updateMatrixWorld(); this.transform.camera = this.dragCamera;
            } else this.transform.camera = this.camera;
        });
        this.transform.addEventListener('objectChange', () => {
            simulator.trajectory = null; simulator.setTarget(this.target.position, this.target.quaternion);
        });
    }
    setMode(mode) { this.transform.setMode(mode); }
    syncTarget() { this.target.position.copy(this.simulator.targetPosition); this.target.quaternion.copy(this.simulator.targetQuaternion); }
    render() {
        this.device.position.copy(this.simulator.p); this.device.quaternion.copy(this.simulator.q);
        followTranslation(this.camera, this.controls, this.device.position, this.previous);
        if (!this.transform.dragging) this.syncTarget();
        super.render();
    }
    dispose() { this.transform.detach(); this.transform.dispose(); super.dispose(); }
}
