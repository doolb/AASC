// 主控 3D 视图：渲染调度、左键/单指平移、右键/双指旋转与捏合缩放、手绘场景、草地交互、丰富角色动画、卡通全息 UI 与音效。
import * as THREE from '../vendor/three.module.min.js';
import { SEASONS, WEATHERS, seasonForLevel, randomWeather } from './presets.mjs?v=20261125i';
import { createTextureLibrary } from './textures.mjs?v=20261125i';
import { createModelFactory, entityCells, gridToWorldCenter, DIR_VECTORS } from './models.mjs?v=20261125i';
import { createScenery } from './scenery.mjs?v=20261125i';
import { createGrass } from './grass.mjs?v=20261125i';
import { createParticles } from './particles.mjs?v=20261125i';
import { createEnvironment } from './environment.mjs?v=20261125i';
import { createHoloUI } from './holo-ui.mjs?v=20261125i';
import { createAudioSystem } from './audio.mjs?v=20261125i';
import { createPostPipeline, detectInitialTier, isSoftwareWebGL } from './post.mjs?v=20261125i';

const SEASON_STORE_KEY = 'pig3d.manualEnv';

function readStoredEnv(levelId) {
    try {
        const raw = localStorage.getItem(SEASON_STORE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (parsed.levelId === String(levelId) && SEASONS.includes(parsed.season) && WEATHERS.includes(parsed.weather)) {
            return parsed;
        }
    } catch (_) {}
    return null;
}

export async function createView3D({ container, level, levels, onPick, onAction }) {
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', alpha: false });
    if (!renderer.getContext()) throw new Error('WebGL 上下文不可用');

    renderer.autoClear = false;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.04;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const isSoftware = isSoftwareWebGL(renderer);
    const initialTier = detectInitialTier(renderer);
    renderer.shadowMap.enabled = initialTier !== 'low';
    container.replaceChildren(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, 1, 0.4, 240);

    const textures = createTextureLibrary(initialTier);
    const audio = createAudioSystem();
    const environment = createEnvironment(scene, textures, initialTier, () => audio.playSfx('thunder'));
    const scenery = createScenery(scene, textures, level, initialTier);
    const grass = createGrass(scene, textures, level, initialTier, isSoftware);
    scenery.setInteractTexture(grass.getInteractTexture());
    const models = createModelFactory(textures);
    const particles = createParticles(scene, textures, initialTier);

    const post = createPostPipeline(renderer, initialTier, nextTier => {
        environment.setShadowTier(nextTier);
        grass.setTierCount(nextTier);
    }, isSoftware);

    const params = new URLSearchParams(location.search);
    const defaultSeason = seasonForLevel(level.id);
    const stored = readStoredEnv(level.id);
    let season = SEASONS.includes(params.get('season')) ? params.get('season') : (stored?.season || defaultSeason);
    let weather = WEATHERS.includes(params.get('weather')) ? params.get('weather') : (stored?.weather || randomWeather(season, level.id));
    const isCageLevel = Boolean(level.cages?.length);

    environment.setPreset(season, weather, { cage: isCageLevel }, true);
    audio.setEnvironment(season, weather);

    const markers = models.createMarkers();
    scene.add(markers.ring, markers.arrowGroup, markers.crossGroup, markers.handSprite);

    const actorMap = new Map();
    const actorPositions = new Map();
    const duckMap = new Map();
    const duckExitTweens = [];
    const cageItems = [];
    const exitingIds = new Set();
    const slideTweens = new Map();
    const shakeTweens = new Map();
    const exitTweens = new Map();
    let suppressDuckExitAnim = true;

    let latestState = null;
    let latestHintId = null;
    let latestUi = null;
    let crossTimer = 0;
    let prevExitCount = 0;
    let prevScissors = level.pigs.filter(p => p.kind === 'scissors').length;
    let prevFailed = false;
    let prevWon = false;

    for (const cage of level.cages || []) {
        const cObj = models.createCage(cage);
        gridToWorldCenter(cage.cells, level.columns, level.rows, cObj.group.position);
        scene.add(cObj.group);
        cageItems.push({ def: cage, obj: cObj, unlocked: false });
    }

    let viewW = container.clientWidth || window.innerWidth || 1280;
    let viewH = container.clientHeight || window.innerHeight || 720;
    let baseDist = 24;
    let yaw = 0, targetYaw = 0, yawVel = 0, lastSpinAt = 0;
    let pitch = 0.91, targetPitch = 0.91;
    let zoom = 1.0, targetZoom = 1.0;

    // 随缩放高度自动计算俯仰角：默认 1.0 对应 0.91(约 52°)，拉近低空放平(约 33°)，拉远高空俯瞰(约 71°)
    function autoPitchForZoom(z) {
        return THREE.MathUtils.clamp(0.91 + (z - 1.0) * 0.72, 0.58, 1.24);
    }
    const baseLookTarget = new THREE.Vector3(0, 0, 0);
    const panOffset = new THREE.Vector2(0, 0);
    const targetPan = new THREE.Vector2(0, 0);
    const lookTarget = new THREE.Vector3(0, 0, 0);

    function updateCameraImmediate(d, yAng, pAng) {
        lookTarget.set(baseLookTarget.x + panOffset.x, 0, baseLookTarget.z + panOffset.y);
        const horiz = Math.cos(pAng) * d;
        camera.position.set(
            lookTarget.x + Math.sin(yAng) * horiz,
            lookTarget.y + Math.sin(pAng) * d,
            lookTarget.z + Math.cos(yAng) * horiz
        );
        camera.lookAt(lookTarget);
        camera.updateMatrixWorld();
    }

    const tmpCorners = Array.from({ length: 8 }, () => new THREE.Vector3());
    function innerBoardCorners() {
        const hw = level.columns / 2 + 0.15;
        const hh = level.rows / 2 + 0.15;
        return [
            [-hw, 0, -hh], [hw, 0, -hh], [-hw, 0, hh], [hw, 0, hh],
            [-hw, 0.92, -hh], [hw, 0.92, -hh], [-hw, 0.92, hh], [hw, 0.92, hh]
        ];
    }

    function projectBoardNdc(pts) {
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (let i = 0; i < 8; i++) {
            tmpCorners[i].set(pts[i][0], pts[i][1], pts[i][2]).project(camera);
            minX = Math.min(minX, tmpCorners[i].x);
            maxX = Math.max(maxX, tmpCorners[i].x);
            minY = Math.min(minY, tmpCorners[i].y);
            maxY = Math.max(maxY, tmpCorners[i].y);
        }
        return { minX, maxX, minY, maxY };
    }

    function fitCamera() {
        viewW = Math.max(1, container.clientWidth || window.innerWidth);
        viewH = Math.max(1, container.clientHeight || window.innerHeight);
        camera.aspect = viewW / viewH;
        camera.updateProjectionMatrix();
        holoUI.resize(viewW, viewH);
        post.resize(viewW, viewH);

        const landscape = viewW >= viewH;
        const margins = holoUI.getSafeMargins();
        const minNdcX = (margins.left / viewW) * 2 - 1;
        const maxNdcX = ((viewW - margins.right) / viewW) * 2 - 1;
        const minNdcY = (margins.bottom / viewH) * 2 - 1;
        const maxNdcY = ((viewH - margins.top) / viewH) * 2 - 1;
        const safeW = Math.max(0.25, maxNdcX - minNdcX);
        const safeH = Math.max(0.25, maxNdcY - minNdcY);
        const centerNdcX = (minNdcX + maxNdcX) / 2;
        const centerNdcY = (minNdcY + maxNdcY) / 2;
        const pts = innerBoardCorners();

        // 对给定距离反推精准居中的 lookTarget，按横屏填满高度 / 竖屏贴紧透视最长前边填满宽度判定是否超界
        const evalFit = dist => {
            let tx = 0, tz = 0;
            const worldPerNdcX = dist * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect;
            const worldPerNdcZ = dist * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / Math.sin(0.91);
            for (let pass = 0; pass < 3; pass++) {
                baseLookTarget.set(tx, 0, tz);
                panOffset.set(0, 0);
                updateCameraImmediate(dist, 0, 0.91);
                const ndcBox = projectBoardNdc(pts);
                if (pass < 2) {
                    tx -= (centerNdcX - (ndcBox.minX + ndcBox.maxX) / 2) * worldPerNdcX;
                    tz += (centerNdcY - (ndcBox.minY + ndcBox.maxY) / 2) * worldPerNdcZ;
                    continue;
                }
                const spanW = ndcBox.maxX - ndcBox.minX;
                const spanH = ndcBox.maxY - ndcBox.minY;
                const ok = landscape
                    ? (spanH <= safeH * 0.96 && spanW <= safeW * 0.96)
                    : (spanW <= safeW * 0.96 && spanH <= safeH * 0.96);
                return { tx, tz, ok };
            }
        };

        const prevPanX = panOffset.x, prevPanY = panOffset.y;
        let lo = 5, hi = 64, best = null;
        for (let iter = 0; iter < 20; iter++) {
            const mid = (lo + hi) / 2;
            const res = evalFit(mid);
            if (res.ok) {
                hi = mid;
                best = res;
            } else {
                lo = mid;
            }
        }
        best = best || evalFit(hi);
        baseDist = hi;
        baseLookTarget.set(best.tx, 0, best.tz);
        panOffset.set(prevPanX, prevPanY);
        updateCameraImmediate(baseDist * zoom, yaw, pitch);
    }

    function resetCamera() {
        const tau = Math.PI * 2;
        yaw = ((yaw % tau) + Math.PI * 3) % tau - Math.PI;
        targetYaw = 0;
        yawVel = 0;
        pivotMode = 'none';
        pinchTransition = false;
        targetZoom = 1.0;
        targetPitch = autoPitchForZoom(1.0);
        targetPan.set(0, 0);
    }

    function applyPan(dx, dy) {
        pivotMode = 'none';
        yawVel = 0;
        const panScale = (baseDist * zoom) / Math.max(300, viewH) * 1.15;
        const rightX = Math.cos(yaw), rightZ = -Math.sin(yaw);
        const fwdX = -Math.sin(yaw), fwdZ = -Math.cos(yaw);
        targetPan.x = THREE.MathUtils.clamp(targetPan.x - (rightX * dx - fwdX * dy) * panScale, -28, 28);
        targetPan.y = THREE.MathUtils.clamp(targetPan.y - (rightZ * dx - fwdZ * dy) * panScale, -28, 28);
    }

    function applySeasonWeather(nextSeason, nextWeather, persist = true) {
        season = nextSeason;
        weather = nextWeather;
        environment.setPreset(season, weather, { cage: isCageLevel }, false);
        audio.setEnvironment(season, weather);
        if (persist) {
            try { localStorage.setItem(SEASON_STORE_KEY, JSON.stringify({ levelId: String(level.id), season, weather })); } catch (_) {}
        }
        if (latestUi) holoUI.sync({ ...latestUi, season, weather, timeSlot: environment.getTimeSlot(), dayPhase: environment.getDayPhase() });
    }

    const holoUI = createHoloUI({
        levels,
        levelId: level.id,
        onAction: (name, payload) => {
            audio.playSfx('holo');
            onAction?.(name, payload);
        },
        onEnvChange: (kind, val) => {
            audio.playSfx('holo');
            applySeasonWeather(kind === 'season' ? val : season, kind === 'weather' ? val : weather);
        },
        onTimeSlot: slot => {
            audio.playSfx('holo');
            environment.setTimeSlot(slot);
            if (latestUi) {
                holoUI.sync({
                    ...latestUi,
                    season,
                    weather,
                    timeSlot: environment.getTimeSlot(),
                    dayPhase: environment.getDayPhase()
                });
            }
        },
        onQualityChange: mode => {
            audio.playSfx('holo');
            post.setQualityMode(mode);
            if (latestUi) holoUI.sync({ ...latestUi, quality: mode });
        },
        onAudioToggle: kind => {
            if (kind === 'music') audio.setMusicEnabled(!audio.isMusicEnabled());
            else audio.setSfxEnabled(!audio.isSfxEnabled());
            audio.playSfx('holo');
            if (latestUi) holoUI.sync({ ...latestUi, music: audio.isMusicEnabled(), sfx: audio.isSfxEnabled() });
        },
        onTimeToggle: () => {
            audio.playSfx('holo');
            environment.setTimeCycle(!environment.isTimeCycleEnabled());
            if (latestUi) holoUI.sync({
                ...latestUi,
                timeCycle: environment.isTimeCycleEnabled(),
                timeSlot: environment.getTimeSlot(),
                dayPhase: environment.getDayPhase()
            });
        },
        onCamReset: () => {
            audio.playSfx('holo');
            resetCamera();
        }
    });

    function resetVisualPose(actor) {
        actor.visual.position.set(0, 0, 0);
        actor.visual.rotation.set(0, 0, 0);
        actor.visual.scale.set(1, 1, 1);
    }

    function buildDuckEscapeWaypoints(startX, startY, lv, st) {
        const toWorld = (gx, gy) => new THREE.Vector3(gx - lv.columns / 2 + 0.5, 0, gy - lv.rows / 2 + 0.5);
        const blocked = new Set();
        for (const p of st.pigs) {
            if (p.gone) continue;
            for (const [cx, cy] of entityCells(p)) blocked.add(`${cx},${cy}`);
        }
        for (const cage of lv.cages || []) {
            if (st.exitCount < cage.unlockAfter) {
                for (const [cx, cy] of cage.cells) blocked.add(`${cx},${cy}`);
            }
        }
        const startKey = `${startX},${startY}`;
        const queue = [[startX, startY]];
        const parent = new Map([[startKey, null]]);
        let edgeCell = null;
        for (let qi = 0; qi < queue.length; qi++) {
            const [cx, cy] = queue[qi];
            if (cx === 0 || cy === 0 || cx === lv.columns - 1 || cy === lv.rows - 1) {
                edgeCell = [cx, cy];
                break;
            }
            for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
                const nx = cx + dx, ny = cy + dy;
                const nk = `${nx},${ny}`;
                if (nx < 0 || ny < 0 || nx >= lv.columns || ny >= lv.rows || blocked.has(nk) || parent.has(nk)) continue;
                parent.set(nk, [cx, cy]);
                queue.push([nx, ny]);
            }
        }
        const gridPath = [];
        if (edgeCell) {
            let cur = edgeCell;
            while (cur) {
                gridPath.push(cur);
                cur = parent.get(`${cur[0]},${cur[1]}`);
            }
            gridPath.reverse();
        } else {
            gridPath.push([startX, startY]);
        }
        const pts = gridPath.map(([gx, gy]) => toWorld(gx, gy));
        const [ex, ey] = gridPath[gridPath.length - 1];
        let outX = ex === 0 ? -1 : ex === lv.columns - 1 ? 1 : 0;
        let outZ = outX === 0 ? (ey === 0 ? -1 : 1) : 0;
        pts.push(toWorld(ex + outX * 4.5, ey + outZ * 4.5));
        return pts;
    }

    function sync({ level: lv, state, hintId, ui }) {
        latestState = state;
        latestHintId = hintId;
        latestUi = ui;
        const canAnimateDuckEscape = !suppressDuckExitAnim && state.exitCount > prevExitCount;
        suppressDuckExitAnim = false;

        if (state.exitCount > prevExitCount) {
            for (const pig of state.pigs) {
                if (!pig.gone && pig.kind === 'lock' && prevExitCount < pig.unlockAfter && state.exitCount >= pig.unlockAfter) {
                    const pos = actorPositions.get(pig.id);
                    if (pos) particles.burstSpark(pos.x, 1.0, pos.z, '#ffd95b', 28);
                    audio.playSfx('unlock');
                }
            }
        }
        if (state.remainingScissors < prevScissors) audio.playSfx('scissors');
        prevExitCount = state.exitCount;
        prevScissors = state.remainingScissors;

        if (state.failed && !prevFailed) {
            audio.playSfx('boom');
            const boomPig = state.pigs.find(p => !p.gone && ((p.kind === 'bomb' && p.bombCount === 0) || (p.kind === 'timer_bomb' && p.timerSeconds <= 0)));
            const boomPos = boomPig ? actorPositions.get(boomPig.id) : null;
            particles.burstExplosion(boomPos ? boomPos.x : 0, boomPos ? boomPos.z : 0);
        }
        prevFailed = state.failed;

        if (ui.won && !prevWon) {
            audio.playSfx('win');
            particles.burstFireworks();
        }
        prevWon = ui.won;

        const activeIds = new Set();
        for (const pig of state.pigs) {
            if (pig.gone && !exitingIds.has(pig.id)) continue;
            activeIds.add(pig.id);
            const targetPos = gridToWorldCenter(entityCells(pig), lv.columns, lv.rows);

            if (!actorMap.has(pig.id)) {
                const actor = models.createActor(pig);
                actor.root.position.copy(targetPos);
                actor.root.userData.pigId = pig.id;
                actor.root.userData.pig = pig;
                scene.add(actor.root);
                actorMap.set(pig.id, actor);
                actorPositions.set(pig.id, targetPos.clone());
            } else if (!exitingIds.has(pig.id)) {
                const actor = actorMap.get(pig.id);
                actor.root.userData.pig = pig;
                const cur = actorPositions.get(pig.id);
                if (cur.distanceToSquared(targetPos) > 0.002) {
                    const dist = cur.distanceTo(targetPos);
                    slideTweens.set(pig.id, {
                        from: cur.clone(),
                        to: targetPos.clone(),
                        dir: DIR_VECTORS[pig.direction] || [0, 1],
                        elapsed: 0,
                        dur: Math.min(0.48, Math.max(0.28, 0.2 + dist * 0.035)),
                        bumped: false
                    });
                    audio.playSfx('slide');
                    if (pig.kind === 'bomb') audio.playSfx('tick');
                }
            }
        }

        for (const [id, actor] of actorMap) {
            if (!activeIds.has(id)) {
                scene.remove(actor.root);
                actorMap.delete(id);
                actorPositions.delete(id);
                slideTweens.delete(id);
            }
        }

        const nextDuckKeys = new Set((state.ducks || []).map(([dx, dy]) => `${dx},${dy}`));
        for (const [key, duckMesh] of duckMap) {
            if (!nextDuckKeys.has(key)) {
                duckMap.delete(key);
                if (canAnimateDuckEscape) {
                    const [sx, sy] = key.split(',').map(Number);
                    const waypoints = buildDuckEscapeWaypoints(sx, sy, lv, state);
                    duckExitTweens.push({
                        mesh: duckMesh,
                        waypoints,
                        elapsed: 0,
                        dur: Math.min(0.95, Math.max(0.65, 0.45 + waypoints.length * 0.045)),
                        dustAcc: 0
                    });
                    audio.playSfx('exit');
                } else {
                    scene.remove(duckMesh);
                }
            }
        }
        (state.ducks || []).forEach(([dx, dy], idx) => {
            const key = `${dx},${dy}`;
            if (!duckMap.has(key)) {
                const d = models.createDuck();
                d.position.set(dx - lv.columns / 2 + 0.5, 0, dy - lv.rows / 2 + 0.5);
                d.rotation.y = Math.sin(idx * 1.7) * 0.4;
                scene.add(d);
                duckMap.set(key, d);
            }
        });

        for (const c of cageItems) {
            const left = Math.max(0, c.def.unlockAfter - state.exitCount);
            if (left <= 0 && !c.unlocked) {
                c.unlocked = true;
                c.liftTimer = 0.55;
                particles.burstSpark(c.obj.group.position.x, 1.0, c.obj.group.position.z, '#9fd8ff', 30);
                audio.playSfx('cage');
            }
            if (left > 0) {
                c.unlocked = false;
                c.obj.group.visible = true;
                c.obj.group.position.y = 0;
                c.obj.updateCount(left);
            }
        }

        holoUI.sync({
            ...ui,
            season,
            weather,
            timeSlot: environment.getTimeSlot(),
            dayPhase: environment.getDayPhase(),
            quality: post.getQualityMode(),
            timeCycle: environment.isTimeCycleEnabled(),
            music: audio.isMusicEnabled(),
            sfx: audio.isSfxEnabled()
        });
    }

    function animateExit(id) {
        const actor = actorMap.get(id);
        const pig = latestState?.pigs.find(p => p.id === id);
        if (!actor || !pig || exitingIds.has(id)) {
            return Promise.resolve();
        }
        exitingIds.add(id);
        slideTweens.delete(id);
        audio.playSfx('exit');

        const [vx, vz] = DIR_VECTORS[pig.direction] || [0, 1];
        const start = actor.root.position.clone();
        const dist = Math.max(level.columns, level.rows) * 0.55 + 4.8;
        const end = new THREE.Vector3(start.x + vx * dist, 0, start.z + vz * dist);
        const dur = Math.min(0.85, Math.max(0.55, dist * 0.048));

        return new Promise(resolve => {
            exitTweens.set(id, {
                actor, start, end, vx, vz,
                elapsed: 0,
                dur,
                dustAcc: 0,
                done: () => {
                    exitingIds.delete(id);
                    exitTweens.delete(id);
                    scene.remove(actor.root);
                    actorMap.delete(id);
                    actorPositions.delete(id);
                    resolve();
                }
            });
        });
    }

    function shake(id, message = '') {
        const actor = actorMap.get(id);
        const pig = latestState?.pigs.find(p => p.id === id);
        if (!actor) return;
        const hitObstacle = /阻挡|弹回/.test(message);
        const dir = DIR_VECTORS[pig?.direction] || [0, 1];
        shakeTweens.set(id, {
            actor,
            hitObstacle,
            dir,
            elapsed: 0,
            dur: hitObstacle ? 0.46 : 0.42,
            sparked: false
        });
        markers.crossGroup.position.set(actor.root.position.x, 1.38, actor.root.position.z);
        markers.crossGroup.visible = true;
        crossTimer = 0.65;
        audio.playSfx(pig?.kind === 'spring' ? 'spring' : 'blocked');
    }

    function cancelAnimations() {
        suppressDuckExitAnim = true;
        for (const [, tw] of exitTweens) tw.done();
        exitTweens.clear();
        exitingIds.clear();
        slideTweens.clear();
        shakeTweens.clear();
        while (duckExitTweens.length) scene.remove(duckExitTweens.pop().mesh);
        if (latestState) {
            for (const pig of latestState.pigs) {
                if (pig.gone) continue;
                const actor = actorMap.get(pig.id);
                if (!actor) continue;
                const pos = gridToWorldCenter(entityCells(pig), level.columns, level.rows);
                actor.root.position.copy(pos);
                resetVisualPose(actor);
                actorPositions.set(pig.id, pos);
            }
        }
    }

    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const hitPt = new THREE.Vector3();
    const probeCam = new THREE.PerspectiveCamera(40, 1, 0.4, 240);
    const pivotWorld = new THREE.Vector3();
    const tmpHitZero = new THREE.Vector3();
    let pivotMode = 'none'; // 'none' | 'spin' | 'wheel'
    let pivotNdcX = 0, pivotNdcY = 0;

    const activePointers = new Map();
    let pointerConsumedByUi = false;
    let rightRotating = false;
    let downX = 0, downY = 0, lastX = 0, lastY = 0, dragged = false;
    let prevPinch = null;
    let pinchTransition = false;

    function clientToNdc(clientX, clientY) {
        const rect = domEl.getBoundingClientRect();
        return {
            x: ((clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
            y: -((clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1
        };
    }

    function localToNdc(lx, ly) {
        return {
            x: (lx / Math.max(1, viewW)) * 2 - 1,
            y: -(ly / Math.max(1, viewH)) * 2 + 1
        };
    }

    // 用独立探测相机在指定姿态下求屏幕坐标与 y=0 地面平面交点，避免修改当前渲染相机
    function pickGroundAt(ndcX, ndcY, dist, yAng, pAng, tx, tz, outVec = hitPt) {
        probeCam.aspect = camera.aspect;
        probeCam.fov = camera.fov;
        probeCam.updateProjectionMatrix();
        const horiz = Math.cos(pAng) * dist;
        probeCam.position.set(tx + Math.sin(yAng) * horiz, Math.sin(pAng) * dist, tz + Math.cos(yAng) * horiz);
        probeCam.lookAt(tx, 0, tz);
        probeCam.updateMatrixWorld();
        ndc.set(ndcX, ndcY);
        raycaster.setFromCamera(ndc, probeCam);
        if (raycaster.ray.direction.y > -0.04) return null;
        if (!raycaster.ray.intersectPlane(groundPlane, outVec)) return null;
        const len = Math.hypot(outVec.x, outVec.z);
        if (len > 26) {
            const s = 26 / len;
            outVec.x *= s;
            outVec.z *= s;
        }
        return outVec;
    }

    function pickGroundTarget(ndcX, ndcY, outVec) {
        const hit = pickGroundAt(
            ndcX, ndcY, baseDist * targetZoom, targetYaw, targetPitch,
            baseLookTarget.x + targetPan.x, baseLookTarget.z + targetPan.y, outVec
        );
        if (hit) return hit;
        outVec.set(baseLookTarget.x + targetPan.x, 0, baseLookTarget.z + targetPan.y);
        return outVec;
    }

    // 解析反解 targetPan，使地面锚点 anchorWorld 在目标视角下精确保持在屏幕坐标 (ndcX, ndcY)
    function lockPivotToScreen(anchorWorld, ndcX, ndcY) {
        const hitZero = pickGroundAt(ndcX, ndcY, baseDist * targetZoom, targetYaw, targetPitch, 0, 0, tmpHitZero);
        if (!hitZero) return;
        targetPan.x = THREE.MathUtils.clamp((anchorWorld.x - hitZero.x) - baseLookTarget.x, -28, 28);
        targetPan.y = THREE.MathUtils.clamp((anchorWorld.z - hitZero.z) - baseLookTarget.z, -28, 28);
    }

    function pickGround(clientX, clientY) {
        const rect = renderer.domElement.getBoundingClientRect();
        ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
        raycaster.setFromCamera(ndc, camera);
        return raycaster.ray.intersectPlane(groundPlane, hitPt) ? hitPt : null;
    }

    function pickActor(clientX, clientY) {
        scene.updateMatrixWorld(true);
        const rect = renderer.domElement.getBoundingClientRect();
        ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
        raycaster.setFromCamera(ndc, camera);
        const meshes = [];
        const boxes = [];
        for (const [id, actor] of actorMap) {
            if (actor.root.visible && !exitingIds.has(id)) {
                meshes.push(actor.bodyMesh);
                boxes.push(actor.hitBox);
            }
        }
        // 优先对真实 3D 躯体网格做像素级射线拾取，避免前排包围盒角遮挡后排小猪。
        const bodyHits = raycaster.intersectObjects(meshes, false);
        if (bodyHits.length) return bodyHits[0].object.userData.pigId;
        const boxHits = raycaster.intersectObjects(boxes, false);
        return boxHits.length ? boxHits[0].object.userData.pigId : null;
    }

    function pickTree(clientX, clientY) {
        const ndc = clientToNdc(clientX, clientY);
        raycaster.setFromCamera(ndc, camera);
        return scenery.pickTree(raycaster);
    }

    function triggerTreeInteract(hitTree) {
        if (!hitTree) return false;
        scenery.shakeTree(hitTree.index);
        particles.burstTree(hitTree.x, hitTree.y, hitTree.z, season);
        grass.stamp(hitTree.x, hitTree.z, 1.35, 0.95);
        audio.playSfx('rustle');
        return true;
    }

    function pinchInfo() {
        const pts = [...activePointers.values()];
        const a = pts[0], b = pts[1];
        return {
            midX: (a.x + b.x) / 2,
            midY: (a.y + b.y) / 2,
            dist: Math.max(10, Math.hypot(a.x - b.x, a.y - b.y)),
            angle: Math.atan2(b.y - a.y, b.x - a.x)
        };
    }

    function applySpin(dYaw) {
        targetYaw += dYaw;
        const now = performance.now();
        const dtSpin = Math.max(0.012, (now - (lastSpinAt || now - 16)) / 1000);
        lastSpinAt = now;
        yawVel = THREE.MathUtils.clamp(yawVel * 0.55 + (dYaw / dtSpin) * 0.25, -2.6, 2.6);
    }

    const domEl = renderer.domElement;
    const onContextMenu = e => {
        e.preventDefault();
        e.stopPropagation();
        return false;
    };
    const onMouseDownBlock = e => {
        if (e.button === 2) e.preventDefault();
    };

    const onPointerDown = e => {
        audio.unlock();
        yawVel = 0;
        lastSpinAt = 0;
        pinchTransition = false;
        const rect = domEl.getBoundingClientRect();
        const x = e.clientX - rect.left, y = e.clientY - rect.top;
        activePointers.set(e.pointerId, { x, y });

        if (activePointers.size === 2) {
            prevPinch = pinchInfo();
            const ndcMid = localToNdc(prevPinch.midX, prevPinch.midY);
            pivotNdcX = ndcMid.x;
            pivotNdcY = ndcMid.y;
            pickGroundTarget(ndcMid.x, ndcMid.y, pivotWorld);
            pivotMode = 'spin';
            dragged = true;
            pointerConsumedByUi = false;
            return;
        }
        downX = lastX = x;
        downY = lastY = y;
        dragged = false;
        rightRotating = e.button === 2 || (e.buttons & 2) === 2;
        if (rightRotating) {
            const ndcPt = clientToNdc(e.clientX, e.clientY);
            pivotNdcX = ndcPt.x;
            pivotNdcY = ndcPt.y;
            pickGroundTarget(pivotNdcX, pivotNdcY, pivotWorld);
            pivotMode = 'spin';
        } else {
            pivotMode = 'none';
        }
        if (!rightRotating && holoUI.handlePointerDown(x, y)) {
            pointerConsumedByUi = true;
            return;
        }
        pointerConsumedByUi = false;
    };

    const onPointerMove = e => {
        const rect = domEl.getBoundingClientRect();
        const x = e.clientX - rect.left, y = e.clientY - rect.top;
        if (activePointers.has(e.pointerId)) activePointers.set(e.pointerId, { x, y });

        if (activePointers.size === 2 && prevPinch) {
            const cur = pinchInfo();
            const dx = cur.midX - prevPinch.midX;
            let dAngle = cur.angle - prevPinch.angle;
            if (dAngle > Math.PI) dAngle -= Math.PI * 2;
            else if (dAngle < -Math.PI) dAngle += Math.PI * 2;
            const ratio = prevPinch.dist / cur.dist;
            if (!Number.isFinite(dx) || !Number.isFinite(dAngle) || !Number.isFinite(ratio)) {
                prevPinch = cur;
                return;
            }
            const prevMidNdc = localToNdc(prevPinch.midX, prevPinch.midY);
            const curMidNdc = localToNdc(cur.midX, cur.midY);
            pickGroundTarget(prevMidNdc.x, prevMidNdc.y, pivotWorld);
            pivotMode = 'spin';
            pivotNdcX = curMidNdc.x;
            pivotNdcY = curMidNdc.y;

            // 双指只控制垂直轴（yaw）无极旋转与缩放高度，俯仰由缩放高度自动计算，围绕两指比例中心锚点锁定地面
            const parallelSpin = Math.abs(dAngle) < 0.012 ? -dx * 0.0085 : 0;
            applySpin(dAngle + parallelSpin);
            targetZoom = THREE.MathUtils.clamp(targetZoom * ratio, 0.65, 1.45);
            targetPitch = autoPitchForZoom(targetZoom);
            lockPivotToScreen(pivotWorld, pivotNdcX, pivotNdcY);
            prevPinch = cur;
            return;
        }

        if (pointerConsumedByUi) {
            holoUI.handlePointerMove(x, y);
            return;
        }
        if (activePointers.size === 0 && holoUI.handlePointerMove(x, y)) return;

        if (activePointers.size === 1) {
            const dx = x - lastX, dy = y - lastY;
            lastX = x; lastY = y;
            if (pinchTransition) {
                if (Math.hypot(x - downX, y - downY) <= 6) return;
                pinchTransition = false;
            }
            if (Math.hypot(x - downX, y - downY) > 8) dragged = true;
            if (dragged) {
                if (rightRotating || (e.buttons & 2) === 2) {
                    if (pivotMode !== 'spin') {
                        const ndcPt = clientToNdc(e.clientX, e.clientY);
                        pivotNdcX = ndcPt.x;
                        pivotNdcY = ndcPt.y;
                        pickGroundTarget(pivotNdcX, pivotNdcY, pivotWorld);
                        pivotMode = 'spin';
                    }
                    applySpin(-dx * 0.0075);
                    targetPitch = THREE.MathUtils.clamp(targetPitch + dy * 0.0055, 0.35, 1.38);
                    lockPivotToScreen(pivotWorld, pivotNdcX, pivotNdcY);
                } else {
                    applyPan(dx, dy);
                }
                return;
            }
        }
        const pt = pickGround(e.clientX, e.clientY);
        // 指针移动仅压出草叶与雪槽轨迹，雪花/草屑飞溅仅在点击地面时触发
        if (pt) grass.stamp(pt.x, pt.z, 0.85, 0.65);
    };

    const onPointerUp = e => {
        const rect = domEl.getBoundingClientRect();
        const x = e.clientX - rect.left, y = e.clientY - rect.top;
        activePointers.delete(e.pointerId);
        if (activePointers.size < 2) {
            prevPinch = null;
            if (performance.now() - lastSpinAt > 45) yawVel = 0;
        }
        // 双指依次抬起 1 指时同步剩余手指坐标，防止镜头瞬移和松手误触，并保留甩手惯性直到次指同步抬起或发生实质单指拖拽
        if (activePointers.size === 1) {
            const [rem] = activePointers.values();
            downX = lastX = rem.x;
            downY = lastY = rem.y;
            pinchTransition = true;
            dragged = true;
            return;
        }
        pinchTransition = false;

        if (pointerConsumedByUi) {
            holoUI.handlePointerUp(x, y);
            pointerConsumedByUi = false;
            return;
        }
        if (!dragged && !rightRotating) {
            if (holoUI.handlePointerUp(x, y)) return;
            const pigId = pickActor(e.clientX, e.clientY);
            if (pigId !== null) {
                audio.playSfx('oink');
                onPick?.(pigId);
                return;
            }
            const hitTree = pickTree(e.clientX, e.clientY);
            if (hitTree) {
                triggerTreeInteract(hitTree);
                return;
            }
            const pt = pickGround(e.clientX, e.clientY);
            if (pt) {
                grass.stamp(pt.x, pt.z, 1.1, 1.0);
                particles.burstGrass(pt.x, pt.z, season);
                audio.playSfx('rustle');
            }
        }
        rightRotating = false;
    };

    const onWheel = e => {
        e.preventDefault();
        const rect = domEl.getBoundingClientRect();
        if (holoUI.handleWheel(e.deltaY, e.clientX - rect.left, e.clientY - rect.top)) return;
        yawVel = 0;
        const ndcPt = clientToNdc(e.clientX, e.clientY);
        pivotNdcX = ndcPt.x;
        pivotNdcY = ndcPt.y;
        pickGroundTarget(pivotNdcX, pivotNdcY, pivotWorld);
        pivotMode = 'wheel';
        targetZoom = THREE.MathUtils.clamp(targetZoom + e.deltaY * 0.0008, 0.65, 1.45);
        targetPitch = autoPitchForZoom(targetZoom);
        lockPivotToScreen(pivotWorld, pivotNdcX, pivotNdcY);
    };

    const resizeTimers = [];
    const onResize = () => fitCamera();
    const onOrientationChange = () => {
        fitCamera();
        resizeTimers.push(setTimeout(fitCamera, 120), setTimeout(fitCamera, 320));
    };
    const onVisibility = () => {
        audio.setPaused(document.hidden);
        if (!document.hidden) {
            lastClock = performance.now();
            post.resetFpsMonitor();
        }
    };
    const onFocusResetFps = () => {
        lastClock = performance.now();
        post.resetFpsMonitor();
    };

    domEl.addEventListener('contextmenu', onContextMenu);
    window.addEventListener('contextmenu', onContextMenu, { capture: true });
    domEl.addEventListener('mousedown', onMouseDownBlock);
    domEl.addEventListener('auxclick', onMouseDownBlock);
    domEl.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    domEl.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onOrientationChange);
    window.visualViewport?.addEventListener('resize', onResize);
    window.addEventListener('focus', onFocusResetFps);
    window.addEventListener('blur', onFocusResetFps);
    document.addEventListener('visibilitychange', onVisibility);

    fitCamera();

    let rafId = 0;
    let disposed = false;
    let lastClock = performance.now();
    let elapsedTotal = 0;
    const tmpVec = new THREE.Vector3();

    function frame(now) {
        if (disposed) return;
        if (isSoftware) {
            setTimeout(() => { if (!disposed) rafId = requestAnimationFrame(frame); }, 32);
        } else {
            rafId = requestAnimationFrame(frame);
        }
        if (document.hidden) { lastClock = now; return; }
        const dt = Math.min(0.1, Math.max(0.001, (now - lastClock) / 1000));
        lastClock = now;
        elapsedTotal += dt;

        post.recordFrame(dt);

        if (activePointers.size === 0 && !rightRotating && Math.abs(yawVel) > 0.002) {
            targetYaw += yawVel * dt;
            yawVel *= Math.exp(-8.5 * dt);
            if (pivotMode === 'spin') lockPivotToScreen(pivotWorld, pivotNdcX, pivotNdcY);
        }

        const damp = Math.min(1, dt * 10);
        yaw = THREE.MathUtils.lerp(yaw, targetYaw, damp);
        pitch = THREE.MathUtils.lerp(pitch, targetPitch, damp);
        zoom = THREE.MathUtils.lerp(zoom, targetZoom, damp);
        if (pivotMode !== 'none') {
            // 按当前渲染姿态实时反解 panOffset，彻底消除旋转/缩放平滑过渡过程中的弦线漂移
            const hitRender = pickGroundAt(pivotNdcX, pivotNdcY, baseDist * zoom, yaw, pitch, 0, 0, tmpHitZero);
            if (hitRender) {
                panOffset.x = THREE.MathUtils.clamp((pivotWorld.x - hitRender.x) - baseLookTarget.x, -28, 28);
                panOffset.y = THREE.MathUtils.clamp((pivotWorld.z - hitRender.z) - baseLookTarget.z, -28, 28);
            } else {
                panOffset.lerp(targetPan, damp);
            }
        } else {
            panOffset.lerp(targetPan, damp);
        }
        updateCameraImmediate(baseDist * zoom, yaw, pitch);

        // 累计受限帧时间，确保即使首帧编译着色器或低帧率也不会跳过离场/滑行/摇摆动画
        const animDt = isSoftware ? Math.min(0.25, dt) : Math.min(0.05, dt);

        for (const [id, tw] of slideTweens) {
            tw.elapsed += animDt;
            const p = Math.min(1, tw.elapsed / tw.dur);
            const actor = actorMap.get(id);
            if (actor) {
                if (p < 0.72) {
                    const moveP = p / 0.72;
                    const ease = 1 - Math.pow(1 - moveP, 2.2);
                    actor.root.position.lerpVectors(tw.from, tw.to, ease);
                    actor.root.position.y = Math.abs(Math.sin(moveP * Math.PI * 3)) * 0.18;
                    actor.visual.rotation.x = 0.14;
                    actor.visual.rotation.z = Math.sin(moveP * Math.PI * 6) * 0.1;
                    actor.visual.scale.set(0.95, 1.02, 1.08);
                    grass.stamp(actor.root.position.x, actor.root.position.z, 0.72, 0.9);
                } else {
                    const bumpP = (p - 0.72) / 0.28;
                    actor.root.position.copy(tw.to);
                    actor.root.position.y = 0;
                    const lunge = Math.sin(bumpP * Math.PI) * 0.18;
                    actor.visual.position.set(0, 0, lunge);
                    const squash = Math.sin(bumpP * Math.PI);
                    actor.visual.scale.set(1 + squash * 0.2, 1 - squash * 0.12, 1 - squash * 0.22);
                    actor.visual.rotation.x = -squash * 0.15;
                    actor.visual.rotation.z = Math.sin(bumpP * Math.PI * 4) * 0.14 * (1 - bumpP);
                    if (!tw.bumped) {
                        tw.bumped = true;
                        particles.burstImpact(tw.to.x + tw.dir[0] * 0.55, 0.45, tw.to.z + tw.dir[1] * 0.55);
                        audio.playSfx('blocked');
                    }
                }
                actorPositions.set(id, actor.root.position.clone());
            }
            if (p >= 1) {
                if (actor) resetVisualPose(actor);
                slideTweens.delete(id);
            }
        }

        for (const [, tw] of exitTweens) {
            tw.elapsed += animDt;
            const p = Math.min(1, tw.elapsed / tw.dur);
            if (p < 0.14) {
                const c = p / 0.14;
                tw.actor.root.position.copy(tw.start);
                tw.actor.visual.scale.set(1 + c * 0.12, 1 - c * 0.18, 1 - c * 0.14);
                tw.actor.visual.rotation.x = -c * 0.16;
            } else {
                const dp = (p - 0.14) / 0.86;
                const dashEase = dp * dp * 0.35 + dp * 0.65;
                tw.actor.root.position.lerpVectors(tw.start, tw.end, dashEase);
                tw.actor.root.position.y = Math.abs(Math.sin(dp * Math.PI * 6)) * 0.28;
                tw.actor.visual.rotation.x = 0.22;
                tw.actor.visual.rotation.z = Math.sin(dp * Math.PI * 12) * 0.14;
                const fade = dp > 0.78 ? Math.max(0.05, 1 - (dp - 0.78) * 4.2) : 1;
                tw.actor.visual.scale.set(0.92 * fade, 1.04 * fade, 1.18 * fade);
                grass.stamp(tw.actor.root.position.x, tw.actor.root.position.z, 0.85, 1.0);
                tw.dustAcc += animDt;
                if (tw.dustAcc > 0.045) {
                    tw.dustAcc = 0;
                    particles.burstDash(tw.actor.root.position.x, tw.actor.root.position.z, tw.vx, tw.vz);
                }
            }
            if (p >= 1) tw.done();
        }

        for (const [id, tw] of shakeTweens) {
            tw.elapsed += animDt;
            const p = Math.min(1, tw.elapsed / tw.dur);
            const dampFade = 1 - p;
            if (tw.hitObstacle && p < 0.42) {
                const bp = p / 0.42;
                const bump = Math.sin(bp * Math.PI);
                tw.actor.visual.position.set(0, 0, bump * 0.22);
                tw.actor.visual.scale.set(1 + bump * 0.22, 1 - bump * 0.12, 1 - bump * 0.24);
                tw.actor.visual.rotation.x = -bump * 0.18;
                if (!tw.sparked && bp > 0.35) {
                    tw.sparked = true;
                    const pos = tw.actor.root.position;
                    particles.burstImpact(pos.x + tw.dir[0] * 0.55, 0.45, pos.z + tw.dir[1] * 0.55);
                }
            } else {
                tw.actor.visual.position.set(0, Math.abs(Math.sin(p * Math.PI * 4)) * 0.06 * dampFade, 0);
                tw.actor.visual.scale.set(1, 1, 1);
                tw.actor.visual.rotation.x = 0;
                tw.actor.visual.rotation.y = Math.sin(p * Math.PI * 7) * 0.26 * dampFade;
                tw.actor.visual.rotation.z = Math.sin(p * Math.PI * 7) * 0.2 * dampFade;
            }
            if (p >= 1) {
                resetVisualPose(tw.actor);
                shakeTweens.delete(id);
            }
        }

        if (latestState) {
            for (const pig of latestState.pigs) {
                if (pig.gone) continue;
                const actor = actorMap.get(pig.id);
                if (!actor) continue;
                if (!exitingIds.has(pig.id) && !slideTweens.has(pig.id) && !shakeTweens.has(pig.id)) {
                    const b = Math.sin(elapsedTotal * 2.6 + actor.phase);
                    actor.visual.scale.set(1 + b * 0.015, 1 - b * 0.024, 1 + b * 0.015);
                }
                if (actor.eyeMesh) {
                    actor.blinkTimer -= dt;
                    if (actor.blinkTimer <= 0) {
                        actor.eyeMesh.scale.y = 0.12;
                        if (actor.blinkTimer < -0.1) {
                            actor.eyeMesh.scale.y = 1;
                            actor.blinkTimer = 2.4 + Math.random() * 3.5;
                        }
                    }
                }
                models.updateActorAccessory(actor, pig, latestState, elapsedTotal);
            }
        }

        let duckIdx = 0;
        for (const d of duckMap.values()) {
            d.rotation.z = Math.sin(elapsedTotal * 3.2 + duckIdx) * 0.08;
            duckIdx += 1;
        }
        for (let i = duckExitTweens.length - 1; i >= 0; i--) {
            const tw = duckExitTweens[i];
            tw.elapsed += animDt;
            const p = Math.min(1, tw.elapsed / tw.dur);
            const segCount = Math.max(1, tw.waypoints.length - 1);
            const f = p * segCount;
            const seg = Math.min(segCount - 1, Math.floor(f));
            const t = f - seg;
            const a = tw.waypoints[seg];
            const b = tw.waypoints[seg + 1] || a;
            tw.mesh.position.lerpVectors(a, b, t);
            tw.mesh.position.y = Math.abs(Math.sin(p * Math.PI * 7)) * 0.24;
            const dx = b.x - a.x, dz = b.z - a.z;
            if (Math.hypot(dx, dz) > 0.01) tw.mesh.rotation.y = Math.atan2(dx, dz);
            tw.mesh.rotation.z = Math.sin(p * Math.PI * 10) * 0.14;
            const fade = p > 0.78 ? Math.max(0.05, 1 - (p - 0.78) * 4.2) : 1;
            tw.mesh.scale.setScalar(fade);
            grass.stamp(tw.mesh.position.x, tw.mesh.position.z, 0.65, 0.85);
            tw.dustAcc += animDt;
            if (tw.dustAcc > 0.055 && Math.hypot(dx, dz) > 0.01) {
                tw.dustAcc = 0;
                const inv = 1 / Math.hypot(dx, dz);
                particles.burstDash(tw.mesh.position.x, tw.mesh.position.z, dx * inv, dz * inv);
            }
            if (p >= 1) {
                scene.remove(tw.mesh);
                duckExitTweens.splice(i, 1);
            }
        }
        for (const c of cageItems) {
            if (c.unlocked && c.obj.group.visible) {
                c.liftTimer -= dt;
                c.obj.group.position.y += dt * 3.4;
                if (c.liftTimer <= 0) c.obj.group.visible = false;
            }
        }

        const hintActor = latestHintId ? actorMap.get(latestHintId) : null;
        const showHint = Boolean(hintActor && latestUi?.hintChecked && !latestState?.failed);
        markers.ring.visible = showHint;
        markers.arrowGroup.visible = showHint;
        markers.handSprite.visible = showHint && Boolean(latestUi?.showGuideHand);
        if (showHint) {
            const p = hintActor.root.position;
            const pig = hintActor.root.userData.pig;
            const spanX = pig && (pig.direction === 'east' || pig.direction === 'west') ? pig.length : (pig?.width || 1);
            const spanZ = pig && (pig.direction === 'east' || pig.direction === 'west') ? (pig?.width || 1) : (pig?.length || 2);
            const pulse = 1 + Math.sin(elapsedTotal * 5) * 0.07;
            markers.ring.position.set(p.x, 0.018, p.z);
            markers.ring.scale.set((0.82 + spanX * 0.35) * pulse, (0.82 + spanZ * 0.35) * pulse, 1);
            markers.ring.rotation.z = elapsedTotal * 0.65;
            markers.arrowGroup.position.set(p.x, 1.52 + Math.sin(elapsedTotal * 4.4) * 0.14, p.z);
            markers.arrowGroup.rotation.y = elapsedTotal * 1.8;
            if (markers.handSprite.visible) {
                // 食指指尖中心(center 0.35,0.84)直接落在目标猪背部中心上方，并按当前相机平面轻抬轻按，旋转任意角度均不偏移
                const tap = Math.pow(Math.abs(Math.sin(elapsedTotal * 3.8)), 2.2);
                const lift = (1 - tap) * 0.22;
                const rightX = Math.cos(yaw), rightZ = -Math.sin(yaw);
                markers.handSprite.position.set(p.x + rightX * lift * 0.35, 0.62 + lift, p.z + rightZ * lift * 0.35);
                const hs = 0.96 - tap * 0.1;
                markers.handSprite.scale.set(hs, hs, 1);
            }

            // 将表面贴花投影贴附到选中猪自身的 3D 躯体上
            if (markers.bodyDecal.parent !== hintActor.visual) {
                hintActor.visual.add(markers.bodyDecal);
            }
            if (markers.bodyDecal.geometry !== hintActor.bodyMesh.geometry) {
                markers.bodyDecal.geometry = hintActor.bodyMesh.geometry;
            }
            markers.bodyDecalUniforms.uTime.value = elapsedTotal;
            const localW = (pig?.width || 1) * 1.15;
            const localL = Math.max(1.3, (pig?.length || 2) * 0.95);
            markers.bodyDecalUniforms.uSize.value.set(localW, localL);
            markers.bodyDecal.visible = true;
        } else {
            markers.bodyDecal.visible = false;
            if (markers.bodyDecal.parent) markers.bodyDecal.parent.remove(markers.bodyDecal);
        }
        if (crossTimer > 0) {
            crossTimer -= dt;
            markers.crossGroup.lookAt(camera.position);
            if (crossTimer <= 0) markers.crossGroup.visible = false;
        }

        const curPreset = environment.update(dt, elapsedTotal);
        const horizonColor = environment.getHorizonColor();
        const lightState = environment.getLightState();
        scenery.applyPreset(curPreset, Math.min(1, dt * 4), horizonColor, lightState);
        scenery.update(dt, elapsedTotal, curPreset.wind);
        grass.update(dt, elapsedTotal, latestState, actorPositions, curPreset, environment.getShadowData(), horizonColor, lightState);
        models.setLightState(lightState);
        particles.update(dt, elapsedTotal, curPreset, viewH);
        holoUI.update(dt, elapsedTotal, yaw, environment.getDayPhase());

        post.renderScene(scene, camera);
        holoUI.render(renderer);
        window.__pig3d.ready = true;
    }

    rafId = requestAnimationFrame(frame);

    window.__pig3d = {
        ready: false,
        get tier() { return post.getTier(); },
        get fps() { return post.getFps(); },
        get preset() { return { season, weather, isCageLevel }; },
        get timeSlot() { return environment.getTimeSlot(); },
        get dayPhase() { return environment.getDayPhase(); },
        getSunPosition: () => environment.getSunPosition(),
        setTimeSlot: slot => {
            environment.setTimeSlot(slot);
            if (latestUi) holoUI.sync({ ...latestUi, season, weather, timeSlot: environment.getTimeSlot(), dayPhase: environment.getDayPhase() });
        },
        getActorCount: () => actorMap.size,
        getGuideText: () => latestUi?.guideText || '',
        hasGuideHand: () => markers.handSprite.visible,
        getUiSkinKey: () => holoUI.getUiSkinKey(),
        getClockDialSize: () => holoUI.getClockDialSize(),
        getGrassLightState: () => grass.getLightState(),
        getGroundPbrState: () => scenery.getGroundPbrState(),
        getSnowInteractSample: (wx = 0, wz = 0) => grass.getInteractSample(wx, wz),
        stampGround: (wx = 0, wz = 0, r = 0.9, s = 1.0) => grass.stamp(wx, wz, r, s),
        shakeTree: (index = 0) => triggerTreeInteract(scenery.shakeTree(index)),
        getTreeState: (index = 0) => scenery.getTreeState(index),
        getPigLightState: () => models.getLightState(),
        getGuideHandScreen() {
            if (!markers.handSprite.visible) return null;
            tmpVec.copy(markers.handSprite.position).project(camera);
            const rect = domEl.getBoundingClientRect();
            return {
                x: rect.left + (tmpVec.x * 0.5 + 0.5) * rect.width,
                y: rect.top + (-tmpVec.y * 0.5 + 0.5) * rect.height
            };
        },
        getDuckExitTweenCount: () => duckExitTweens.length,
        getEyeOffsetY: id => actorMap.get(Number(id))?.eyeMesh?.position?.y ?? null,
        getTimerSeconds: id => actorMap.get(Number(id))?.root?.userData?.pig?.timerSeconds ?? null,
        screenOf(id) {
            const actor = actorMap.get(Number(id));
            if (!actor) return null;
            tmpVec.copy(actor.root.position).setY(0.45).project(camera);
            const rect = domEl.getBoundingClientRect();
            return {
                x: rect.left + (tmpVec.x * 0.5 + 0.5) * rect.width,
                y: rect.top + (-tmpVec.y * 0.5 + 0.5) * rect.height
            };
        },
        holoButton(name) {
            const pos = holoUI.getButtonScreen(name);
            if (!pos) return null;
            const rect = domEl.getBoundingClientRect();
            return { x: rect.left + pos.x, y: rect.top + pos.y };
        },
        hasModalBackdrop: () => holoUI.hasModalBackdrop(),
        setSeasonWeather(s, w) {
            if (SEASONS.includes(s) && WEATHERS.includes(w)) applySeasonWeather(s, w, false);
        },
        getCameraState: () => ({ yaw: targetYaw, pitch: targetPitch, zoom: targetZoom, panX: targetPan.x, panZ: targetPan.y }),
        getGroundAtScreen(clientX, clientY) {
            const pt = pickGround(clientX, clientY);
            return pt ? { x: pt.x, z: pt.z } : null;
        },
        projectWorld(wx, wy, wz) {
            tmpVec.set(wx, wy, wz).project(camera);
            const rect = domEl.getBoundingClientRect();
            return {
                x: rect.left + (tmpVec.x * 0.5 + 0.5) * rect.width,
                y: rect.top + (-tmpVec.y * 0.5 + 0.5) * rect.height
            };
        },
        getGrassCount: () => grass.getCount(),
        getBoardScreenBounds() {
            const margins = holoUI.getSafeMargins();
            const safeW = Math.max(1, viewW - margins.left - margins.right);
            const safeH = Math.max(1, viewH - margins.top - margins.bottom);
            const ndcBox = projectBoardNdc(innerBoardCorners());
            const left = (ndcBox.minX * 0.5 + 0.5) * viewW;
            const right = (ndcBox.maxX * 0.5 + 0.5) * viewW;
            const top = (-ndcBox.maxY * 0.5 + 0.5) * viewH;
            const bottom = (-ndcBox.minY * 0.5 + 0.5) * viewH;
            return {
                left, right, top, bottom,
                widthRatio: (right - left) / safeW,
                heightRatio: (bottom - top) / safeH,
                margins
            };
        },
        resetCamera
    };

    return {
        sync,
        animateExit,
        shake,
        cancelAnimations,
        resetCamera,
        setHoloVisible: v => holoUI.setVisible(v),
        toggleMusic: () => {
            audio.setMusicEnabled(!audio.isMusicEnabled());
            if (latestUi) holoUI.sync({ ...latestUi, music: audio.isMusicEnabled(), sfx: audio.isSfxEnabled() });
        },
        getAudioState: () => ({ music: audio.isMusicEnabled(), sfx: audio.isSfxEnabled() }),
        dispose() {
            disposed = true;
            cancelAnimationFrame(rafId);
            domEl.removeEventListener('contextmenu', onContextMenu);
            window.removeEventListener('contextmenu', onContextMenu, { capture: true });
            domEl.removeEventListener('mousedown', onMouseDownBlock);
            domEl.removeEventListener('auxclick', onMouseDownBlock);
            domEl.removeEventListener('pointerdown', onPointerDown);
            window.removeEventListener('pointermove', onPointerMove);
            window.removeEventListener('pointerup', onPointerUp);
            window.removeEventListener('pointercancel', onPointerUp);
            domEl.removeEventListener('wheel', onWheel);
            while (resizeTimers.length) clearTimeout(resizeTimers.pop());
            window.removeEventListener('resize', onResize);
            window.removeEventListener('orientationchange', onOrientationChange);
            window.visualViewport?.removeEventListener('resize', onResize);
            window.removeEventListener('focus', onFocusResetFps);
            window.removeEventListener('blur', onFocusResetFps);
            document.removeEventListener('visibilitychange', onVisibility);
            holoUI.dispose();
            post.dispose();
            particles.dispose();
            grass.dispose();
            scenery.dispose();
            models.dispose();
            environment.dispose();
            textures.dispose();
            audio.dispose();
            renderer.dispose();
            if (window.__pig3d) delete window.__pig3d;
        }
    };
}
