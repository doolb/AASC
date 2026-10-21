import { Quaternion, Vector3 } from 'three';
import { ImuEngine, REST_ORIENTATION } from './imu-engine.mjs';
import { ImuSimulator } from './imu-simulator.mjs';
import { SimulatorView } from './imu-simulator-view.mjs';
import { ImuScene } from './imu-scene.mjs';
import { PhoneInput } from './imu-phone.mjs';
import { RoomClient } from './imu-room.mjs';

const element = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
let source = params.get('source') === 'remote' || params.get('role') === 'remote' ? 'remote'
    : params.get('role') === 'phone' ? 'phone' : 'simulator';
const DEFAULT_ROOM = 'AASCIMU1';
let engine = new ImuEngine({ simulatorAutoRest: source === 'simulator', remoteAutoRest: source === 'remote' });
const simulator = new ImuSimulator();
const left = new ImuScene(element('leftViewport'));
const right = new SimulatorView(element('rightViewport'), simulator);
const devices = new Map(); let currentRoom = params.get('room')?.trim().toUpperCase() || DEFAULT_ROOM;
let lastPaint = 0, previousFrame = performance.now(), accumulator = 0, nextInterval = 0.01;
let stream = true, disposed = false, autoFaces = null, latestSample = null, truthOrigin = new Vector3();
let activeFrames = 0, sourceStart = null, animation = null;
let remoteDeviceId = null, remoteLastReceive = 0;
const pendingEstimatedTrail = []; const pendingReferenceTrail = [];
const format = values => values.map(value => (Math.abs(value) < 0.00005 ? 0 : value).toFixed(3)).join(' / ');
const setStatus = message => { element('phoneStatus').textContent = message; };
const receive = sample => {
    const revision = engine.deadzoneRevision;
    if (engine.push(sample)) { latestSample = sample; activeFrames += 1; sourceStart ??= sample.time; }
    if (engine.deadzoneRevision !== revision) syncDeadzoneInputs();
};
const phone = new PhoneInput(receive, message => {
    setStatus(message);
    if (!phone.running && source === 'phone') engine.pause();
});
const room = new RoomClient(incoming => {
    for (const device of incoming) {
        devices.set(device.id, device);
        if (device.id !== room.device?.id && device.frame) left.update(device.id, device.frame, device.color, device.online);
    }
}, (message, joined) => {
    element('roomStatus').textContent = message;
    if (joined) {
        currentRoom = joined.room; element('roomCode').value = currentRoom;
        const url = new URL(location.href); url.searchParams.set('room', currentRoom); history.replaceState(null, '', url);
        if (source !== 'remote') {
            const link = new URL(location.href); link.searchParams.delete('source'); link.searchParams.set('role', 'phone'); element('phoneLink').value = link.href;
        }
        syncVisibleTrailSnapshot();
    }
}, payload => {
    if (source !== 'remote') return;
    if (payload.device.id !== remoteDeviceId) {
        remoteDeviceId = payload.device.id; remoteLastReceive = 0;
        engine = new ImuEngine(engine.profile); latestSample = null; sourceStart = null; activeFrames = 0;
        autoFaces = null; clearDisplayedTrails();
    }
    for (const sample of payload.samples) receive(sample);
    remoteLastReceive = performance.now();
});

/** 服务端重启或重新连接后，用页面内存中的两条可见轨迹恢复诊断缓存。 */
function syncVisibleTrailSnapshot(clearHistory = false) {
    const referenceTrail = source === 'simulator' ? left.getTrailSnapshot('truth') : [];
    const sent = room.publishTrajectorySnapshot(left.getTrailSnapshot('local'), referenceTrail, clearHistory);
    if (sent) { pendingEstimatedTrail.length = 0; pendingReferenceTrail.length = 0; }
    return sent;
}
function clearDisplayedTrails() {
    left.clearTrails(); pendingEstimatedTrail.length = 0; pendingReferenceTrail.length = 0;
    syncVisibleTrailSnapshot(true);
}
function queueTrailPoint(queue, point) {
    if (!point) return;
    queue.push(point);
    if (queue.length > 600) queue.shift();
}

function applySource() {
    document.body.classList.toggle('phone', source !== 'simulator');
    document.body.classList.toggle('remote', source === 'remote'); element('source').value = source;
    element('phoneStart').disabled = source !== 'phone'; element('phoneStop').disabled = source !== 'phone';
    engine.profile.simulatorAutoRest = source === 'simulator';
    engine.profile.remoteAutoRest = source === 'remote';
    element('roomCode').disabled = false;
    if (source === 'remote') {
        element('phoneStatus').textContent = `接收房间 ${currentRoom} 的Android原生六轴数据`;
    }
    else if (source === 'phone') element('phoneStatus').textContent = '手机通过浏览器运动接口接入';
    else element('phoneStatus').textContent = '电脑模拟六轴输入';
    right.resize(); left.resize();
}
function connect() {
    const role = 'source';
    const code = element('roomCode').value.trim().toUpperCase() || currentRoom || DEFAULT_ROOM;
    room.connect(code, source === 'phone' ? '手机浏览器六轴' : source === 'remote' ? '电脑观察端' : '电脑模拟器', role);
}
element('roomCode').value = currentRoom; applySource(); connect(); left.followId = 'local';
element('reconnect').addEventListener('click', connect);
element('copyLink').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(element('phoneLink').value); element('roomStatus').textContent = '手机链接已复制'; }
    catch { element('phoneLink').select(); element('roomStatus').textContent = '请复制已选中的链接'; }
});
element('source').addEventListener('change', event => {
    phone.stop(); source = event.target.value; engine = new ImuEngine(engine.profile); sourceStart = null;
    activeFrames = 0; latestSample = null; autoFaces = null; remoteDeviceId = null;
    const url = new URL(location.href);
    if (source === 'remote') { url.searchParams.delete('role'); url.searchParams.set('source', 'remote'); }
    else {
        url.searchParams.delete('source');
        if (source === 'phone') url.searchParams.set('role', 'phone'); else url.searchParams.delete('role');
    }
    const selectedRoom = element('roomCode').value.trim().toUpperCase() || currentRoom || DEFAULT_ROOM;
    currentRoom = selectedRoom; element('roomCode').value = selectedRoom; url.searchParams.set('room', selectedRoom);
    history.replaceState(null, '', url); applySource(); connect();
});
element('phoneStart').addEventListener('click', async () => {
    try { await phone.start(); } catch (error) { setStatus(error.message); }
});
element('phoneStop').addEventListener('click', () => phone.stop());
element('calibrate').addEventListener('click', () => { autoFaces = null; engine.beginCalibration(); });
element('calibrateDeadzone').addEventListener('click', () => { autoFaces = null; engine.beginDeadzoneCalibration(); });
element('cancelDeadzone').addEventListener('click', () => engine.cancelDeadzoneCalibration());
element('stopVelocity').addEventListener('click', () => engine.stopVelocity());
element('resetOrigin').addEventListener('click', () => { engine.resetOrigin(); truthOrigin.copy(simulator.p); clearDisplayedTrails(); });
element('resetHeading').addEventListener('click', () => engine.resetHeading());
element('clearTrails').addEventListener('click', clearDisplayedTrails);
element('assumedRest').addEventListener('change', event => { engine.profile.assumedRest = event.target.checked; });
element('followLeft').addEventListener('change', event => left.follow(event.target.checked ? element('deviceSelect').value : null));
element('deviceSelect').addEventListener('change', event => { if (element('followLeft').checked) left.follow(event.target.value); });
element('stream').addEventListener('change', event => { stream = event.target.checked;
    if (!stream) { engine.pause(); engine.message = '模拟数据流暂停；右侧可继续运动，左侧保持最后位姿'; } });
for (const mode of ['translate', 'rotate']) element(mode).addEventListener('click', () => {
    right.setMode(mode); element('translate').classList.toggle('active', mode === 'translate'); element('rotate').classList.toggle('active', mode === 'rotate');
});
element('resetExperiment').addEventListener('click', () => {
    simulator.reset(); truthOrigin.set(0, 0, 0); engine.resetOrigin(); engine.q.copy(REST_ORIENTATION);
    engine.lastTime = null; engine.filteredAcceleration = null; engine.filteredGyro = null; clearDisplayedTrails(); autoFaces = null;
    right.syncTarget();
});
element('holdTarget').addEventListener('click', () => { simulator.trajectory = null; simulator.setTarget(simulator.p, simulator.q); });
for (const button of document.querySelectorAll('[data-trajectory]')) button.addEventListener('click', () => {
    autoFaces = null; simulator.startTrajectory(button.dataset.trajectory);
});

function faceTarget(face) {
    const axis = new Vector3(); axis.setComponent('xyz'.indexOf(face[0]), face[1] === '+' ? 1 : -1);
    simulator.trajectory = null; simulator.targetQuaternion.setFromUnitVectors(axis, new Vector3(0, 1, 0));
    right.syncTarget();
}
for (const button of document.querySelectorAll('[data-face]')) button.addEventListener('click', () => {
    autoFaces = null; const face = button.dataset.face;
    if (source === 'simulator') { faceTarget(face); autoFaces = { queue: [face], readyAt: simulator.time + 3, capturing: false }; }
    else engine.beginCalibration(face);
});
element('autoFaces').addEventListener('click', () => {
    if (source !== 'simulator') { setStatus('手机请按各面的提示实际调整设备'); return; }
    autoFaces = { queue: ['x+', 'x-', 'y+', 'y-', 'z+', 'z-'], readyAt: simulator.time + 3, capturing: false };
    faceTarget(autoFaces.queue[0]);
});
function advanceFaces() {
    if (!autoFaces) return;
    if (!autoFaces.capturing && simulator.time >= autoFaces.readyAt) {
        engine.beginCalibration(autoFaces.queue[0]); autoFaces.capturing = true;
    } else if (autoFaces.capturing && !engine.calibration) {
        autoFaces.queue.shift();
        if (!autoFaces.queue.length) { autoFaces = null; simulator.targetQuaternion.copy(REST_ORIENTATION); return; }
        autoFaces.capturing = false; autoFaces.readyAt = simulator.time + 3; faceTarget(autoFaces.queue[0]);
    }
}
const profileInputs = { gyroZone: value => { engine.profile.gyroDeadZone = value * Math.PI / 180; },
    accelZone: value => { engine.profile.accelDeadZone = value; }, filterHz: value => { engine.profile.filterHz = value; },
    tiltGain: value => { engine.profile.tiltGain = value; } };
/** 校准成功后同步显示值，不触发手动输入事件导致取消或重复设置。 */
function syncDeadzoneInputs() {
    const values = { gyroZone: engine.profile.gyroDeadZone * 180 / Math.PI, accelZone: engine.profile.accelDeadZone };
    for (const [id, value] of Object.entries(values)) {
        const input = element(id); input.value = value.toFixed(2); input.nextElementSibling.value = input.value;
    }
}
const noiseInputs = { gyroNoise: ['gyro', Math.PI / 180], gyroBias: ['gyroBias', Math.PI / 180],
    accelNoise: ['accel', 1], accelBias: ['accelBias', 1], walk: ['walk', 1], drop: ['drop', 1], jitter: ['jitter', 1] };
for (const id of [...Object.keys(profileInputs), ...Object.keys(noiseInputs)]) {
    const input = element(id);
    const change = () => {
        const value = Number(input.value);
        if (input.value === '' || !Number.isFinite(value) || value < 0) {
            input.nextElementSibling.value = '请输入非负有限值'; return;
        }
        engine.cancelDeadzoneCalibration(); input.nextElementSibling.value = input.value;
        if (profileInputs[id]) profileInputs[id](value);
        else { const [key, scale] = noiseInputs[id]; simulator.noise[key] = value * scale; }
    };
    input.addEventListener('input', change); change();
}
function cleanExperiment(clearProcessing) {
    const inputs = clearProcessing ? [...Object.keys(noiseInputs), ...Object.keys(profileInputs)] : Object.keys(noiseInputs);
    for (const id of inputs) {
        element(id).value = '0'; element(id).dispatchEvent(new Event('input'));
    }
    engine.gyroBias = [0, 0, 0]; engine.accelBias = [0, 0, 0]; engine.accelScale = [1, 1, 1];
    engine.gyroCalibrated = false; engine.accelCalibrated = false; engine.faces = {}; engine.calibration = null;
    engine.gyroNoise = [0, 0, 0]; simulator.gyroWalk.fill(0); simulator.accelWalk.fill(0);
    element('resetExperiment').click();
}
element('cleanInput').addEventListener('click', () => cleanExperiment(false));
element('ideal').addEventListener('click', () => cleanExperiment(true));

function diagnostics(now) {
    element('cancelDeadzone').hidden = !engine.deadzoneCalibration;
    element('calibrateDeadzone').disabled = Boolean(engine.deadzoneCalibration);
    element('deadzoneStatus').textContent = engine.deadzoneMessage || '保持一个朝向静置，自动设置两个死区并对齐重力方向；不修改零偏。高死区可能忽略真实慢动作。';
    const own = engine.snapshot(); const selectedId = element('deviceSelect').value;
    const selected = selectedId === 'local' ? own : devices.get(selectedId)?.frame || own;
    element('position').value = format(selected.position); element('velocity').value = format(selected.velocity);
    element('rawRate').value = format(selected.rawGyro.map(value => value * 180 / Math.PI));
    element('cleanRate').value = format(selected.gyro.map(value => value * 180 / Math.PI));
    element('rawForce').value = format(selected.rawAccel);
    element('cleanForce').value = format(selected.linear);
    element('calibratedBias').value = format(selected.gyroBias.map(value => value * 180 / Math.PI));
    element('accelKind').textContent = `${selected.kind === 'gravity' ? '原始含重力' : '原始平台线性'}加速度 / m/s²`;
    element('gyro').value = format((latestSample?.gyro || [0, 0, 0]).map(value => value * 180 / Math.PI));
    element('acceleration').value = format(latestSample?.accel || [0, 0, 0]);
    const age = sourceStart === null ? 0 : Math.max(0, (latestSample?.time || 0) - sourceStart);
    element('sampleStatus').textContent = `${age > 0 ? (activeFrames / age).toFixed(1) : '—'} Hz · 缺口 ${own.gaps} · 拒绝 ${own.rejected} · 零速修正 ${own.zeroCorrections}`;
    element('engineStatus').textContent = `${selected.message} · 陀螺仪${selected.gyroCalibrated ? '已校准' : '使用死区，未校准'} · 加速度${selected.accelCalibrated ? '六面已校准' : '使用死区，六面校准可选'}`;
    element('faceCount').textContent = `${own.faces}/6`;
    if (source === 'simulator' && selectedId === 'local') {
        const referencePosition = simulator.p.clone().sub(truthOrigin);
        const rawError = engine.p.clone().sub(referencePosition).toArray();
        const error = rawError
            .map(value => Math.abs(value) < 0.00005 ? 0 : value);
        element('positionErrorX').value = error[0].toFixed(4);
        element('positionErrorY').value = error[1].toFixed(4);
        element('positionErrorZ').value = error[2].toFixed(4);
        element('positionErrorTotal').value = Math.hypot(...rawError).toFixed(4);
        element('rotationError').value = (engine.q.angleTo(simulator.q) * 180 / Math.PI).toFixed(3);
    } else {
        for (const id of ['positionErrorX', 'positionErrorY', 'positionErrorZ', 'positionErrorTotal']) {
            element(id).value = '无外部真值';
        }
        element('rotationError').value = '无外部真值';
    }
    const known = new Set([...element('deviceSelect').options].map(option => option.value));
    const badges = [];
    for (const device of devices.values()) {
        if (device.id === room.device?.id) continue;
        if (!known.has(device.id)) { const option = document.createElement('option'); option.value = device.id;
            option.textContent = device.label; element('deviceSelect').append(option); }
        const badge = document.createElement('span'); badge.style.color = device.color;
        badge.textContent = `${device.label} · ${device.online ? '在线' : '已断线'}`; badges.push(badge);
    }
    element('devices').replaceChildren(...badges);
    if ((source === 'phone' && phone.running && now - phone.lastReceive > 700
        || source === 'remote' && remoteLastReceive > 0 && now - remoteLastReceive > 700)
        && engine.status !== 'paused') engine.pause();
}
function tick(now) {
    if (disposed) return;
    const elapsed = Math.min(0.08, (now - previousFrame) / 1000); previousFrame = now;
    if (source === 'simulator' && !document.hidden) {
        accumulator += elapsed;
        while (accumulator >= nextInterval) {
            const interval = nextInterval; accumulator -= interval; const sample = simulator.step(interval);
            if (stream && sample) receive(sample);
            advanceFaces(); nextInterval = simulator.nextInterval();
        }
    }
    queueTrailPoint(pendingEstimatedTrail, left.update('local', engine.snapshot(), '#0f766e'));
    const truthEntry = left.devices.get('truth');
    if (source === 'simulator') {
        const truth = simulator.truth(); truth.position = simulator.p.clone().sub(truthOrigin).toArray();
        queueTrailPoint(pendingReferenceTrail, left.update('truth', truth, '#ea580c'));
        const showTruth = element('showTruth').checked;
        left.devices.get('truth').object.visible = showTruth;
        left.devices.get('truth').trail.visible = showTruth;
    } else if (truthEntry) { truthEntry.object.visible = false; truthEntry.trail.visible = false; }
    left.render(); if (source === 'simulator') right.render();
    if (now - lastPaint >= 150) { diagnostics(now); lastPaint = now; }
    animation = requestAnimationFrame(tick);
}
animation = requestAnimationFrame(tick);
/** 房间消息按20毫秒独立发送，避免60Hz屏幕刷新回调把实际发布频率压低。 */
const publishTimer = window.setInterval(() => {
    if (disposed || source === 'remote' && !latestSample) return;
    const referencePosition = source === 'simulator' ? simulator.p.clone().sub(truthOrigin).toArray() : null;
    const sent = room.publish(engine.snapshot(), referencePosition,
        { estimated: pendingEstimatedTrail, reference: pendingReferenceTrail });
    if (sent) { pendingEstimatedTrail.length = 0; pendingReferenceTrail.length = 0; }
}, 20);
document.addEventListener('visibilitychange', () => { if (document.hidden) {
    engine.pause();
    const referencePosition = source === 'simulator' ? simulator.p.clone().sub(truthOrigin).toArray() : null;
    room.publish(engine.snapshot(), referencePosition);
    syncVisibleTrailSnapshot();
}
    previousFrame = performance.now(); accumulator = 0; });
const dispose = () => { if (disposed) return; disposed = true; cancelAnimationFrame(animation); window.clearInterval(publishTimer);
    phone.stop(); room.close(); left.dispose(); right.dispose(); };
window.addEventListener('pagehide', dispose, { once: true });

// 诊断只读快照用于本测试页自测，不提供直接写左侧位姿的旁路。
window.imuLab = { snapshot: () => ({ source, engine: engine.snapshot(), truth: simulator.truth(), room: currentRoom,
    devices: [...devices.values()], rightCamera: right.camera.position.toArray(), rightTarget: right.controls.target.toArray(),
    rightDevice: right.device.position.toArray(), rightCameraOffset: right.camera.position.clone().sub(simulator.p).toArray(),
    transformMode: right.transform.mode, dragging: right.transform.dragging }),
    projectHandle: (axis, amount = 0.85) => {
        const position = right.target.position.clone(); position.setComponent('XYZ'.indexOf(axis), position.getComponent('XYZ'.indexOf(axis)) + amount);
        position.project(right.camera); const box = right.renderer.domElement.getBoundingClientRect();
        return { x: box.left + (position.x + 1) * box.width / 2, y: box.top + (1 - position.y) * box.height / 2 };
    } };
