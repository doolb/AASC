import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export function makeDevice(color = '#65d8c8', wireframe = false) {
    const group = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.58, 0.055),
        new THREE.MeshStandardMaterial({ color, metalness: 0.15, roughness: 0.4, wireframe }));
    group.add(body, new THREE.AxesHelper(0.42));
    const face = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.42, 0.008), new THREE.MeshStandardMaterial({ color: '#142739', wireframe }));
    face.position.set(0, 0.025, 0.031); group.add(face);
    return group;
}

/** 位移同时作用到观察位置和目标，只改变观察，不修改物体或传感器坐标。 */
export function followTranslation(camera, controls, current, previous) {
    const delta = current.clone().sub(previous);
    camera.position.add(delta); controls.target.add(delta); previous.copy(current);
}

export class ImuScene {
    constructor(container) {
        this.container = container; this.devices = new Map(); this.followId = null; this.followPrevious = null;
        this.scene = new THREE.Scene(); this.scene.background = new THREE.Color('#101c2a');
        this.renderer = new THREE.WebGLRenderer({ antialias: true }); this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
        this.renderer.setClearColor('#101c2a'); container.append(this.renderer.domElement);
        this.camera = new THREE.PerspectiveCamera(48, 1, 0.01, 10000); this.camera.position.set(2.4, 2, 3.3);
        this.controls = new OrbitControls(this.camera, this.renderer.domElement); this.controls.enableDamping = true;
        this.scene.add(new THREE.HemisphereLight('#d8edff', '#344a56', 2.5));
        const light = new THREE.DirectionalLight('#ffffff', 2); light.position.set(3, 5, 4); this.scene.add(light);
        const grid = new THREE.GridHelper(12, 24, '#487a90', '#223e51'); grid.position.y = -0.36; this.scene.add(grid);
        this.scene.add(new THREE.AxesHelper(1));
        this.resizeObserver = new ResizeObserver(() => this.resize()); this.resizeObserver.observe(container); this.resize();
    }
    resize() { const { clientWidth: width, clientHeight: height } = this.container;
        if (!width || !height) return; this.renderer.setSize(width, height); this.camera.aspect = width / height; this.camera.updateProjectionMatrix(); }
    update(id, pose, color, online = true) {
        if (!pose) return;
        let entry = this.devices.get(id);
        if (!entry) {
            const object = makeDevice(color); this.scene.add(object);
            const points = new Float32Array(600 * 3);
            const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.BufferAttribute(points, 3));
            geometry.setDrawRange(0, 0);
            const trail = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color })); trail.frustumCulled = false;
            this.scene.add(trail); entry = { object, trail, points, count: 0, last: null }; this.devices.set(id, entry);
        }
        entry.object.position.fromArray(pose.position); entry.object.quaternion.fromArray(pose.quaternion);
        entry.object.traverse(node => { if (node.material?.color && node.type === 'Mesh') node.material.opacity = online ? 1 : 0.35;
            if (node.material) node.material.transparent = !online; });
        if (!entry.last || entry.last.distanceToSquared(entry.object.position) > 0.0001) {
            if (entry.count >= 600) { entry.points.copyWithin(0, 3); entry.count = 599; }
            entry.object.position.toArray(entry.points, entry.count * 3); entry.count += 1;
            entry.trail.geometry.attributes.position.needsUpdate = true; entry.trail.geometry.setDrawRange(0, entry.count);
            entry.last = entry.object.position.clone();
        }
        if (this.followId === id) {
            this.followPrevious ??= entry.object.position.clone();
            followTranslation(this.camera, this.controls, entry.object.position, this.followPrevious);
        }
    }
    follow(id) { this.followId = id; this.followPrevious = null;
        const entry = this.devices.get(id); if (!entry) return;
        const delta = entry.object.position.clone().sub(this.controls.target);
        this.camera.position.add(delta); this.controls.target.copy(entry.object.position); }
    clearTrails() { for (const entry of this.devices.values()) { entry.count = 0; entry.last = null; entry.trail.geometry.setDrawRange(0, 0); } }
    render() { this.controls.update(); this.renderer.render(this.scene, this.camera); }
    dispose() { this.resizeObserver.disconnect(); this.controls.dispose();
        this.scene.traverse(node => { node.geometry?.dispose(); if (Array.isArray(node.material)) node.material.forEach(material => material.dispose()); else node.material?.dispose(); });
        this.renderer.dispose(); this.renderer.domElement.remove(); }
}
