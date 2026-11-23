// 主控 3D 视图：渲染调度、轨道与右键/双指平移、手绘场景、草地交互、丰富角色动画、卡通全息 UI 与音效。
import * as THREE from '../vendor/three.module.min.js';
import { SEASONS, WEATHERS, seasonForLevel, randomWeather } from './presets.mjs?v=20261122o';
import { createTextureLibrary } from './textures.mjs?v=20261122o';
import { createModelFactory, entityCells, gridToWorldCenter, DIR_VECTORS } from './models.mjs?v=20261122o';
import { createScenery } from './scenery.mjs?v=20261122o';
import { createGrass } from './grass.mjs?v=20261122o';
import { createParticles } from './particles.mjs?v=20261122o';
import { createEnvironment } from './environment.mjs?v=20261122o';
import { createHoloUI } from './holo-ui.mjs?v=20261122o';
import { createAudioSystem } from './audio.mjs?v=20261122o';
import { createPostPipeline, detectInitialTier, isSoftwareWebGL } from './post.mjs?v=20261122o';

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
    scene.add(markers.ring, markers.arrowGroup, markers.crossGroup);

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
    let yaw = 0, targetYaw = 0;
    let pitch = 0.91, targetPitch = 0.91;
    let zoom = 1.0, targetZoom = 1.0;
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
    function fitCamera() {
        viewW = Math.max(1, container.clientWidth || window.innerWidth);
        viewH = Math.max(1, container.clientHeight || window.innerHeight);
        camera.aspect = viewW / viewH;
        camera.updateProjectionMatrix();
        holoUI.resize(viewW, viewH);
        post.resize(viewW, viewH);

        const margins = holoUI.getSafeMargins();
        const minNdcX = (margins.left / viewW) * 2 - 1;
        const maxNdcX = ((viewW - margins.right) / viewW) * 2 - 1;
        const minNdcY = (margins.bottom / viewH) * 2 - 1;
        const maxNdcY = ((viewH - margins.top) / viewH) * 2 - 1;

        const hw = level.columns / 2 + 0.55;
        const hh = level.rows / 2 + 0.55;
        const pts = [
            [-hw, 0, -hh], [hw, 0, -hh], [-hw, 0, hh], [hw, 0, hh],
            [-hw, 1.2, -hh], [hw, 1.2, -hh], [-hw, 1.2, hh], [hw, 1.2, hh]
        ];

        const centerNdcX = (minNdcX + maxNdcX) / 2;
        const centerNdcY = (minNdcY + maxNdcY) / 2;
        baseLookTarget.set(0, 0, 0);
        panOffset.set(0, 0);

        let lo = 10, hi = 64;
        for (let iter = 0; iter < 18; iter++) {
            const mid = (lo + hi) / 2;
            updateCameraImmediate(mid, 0, 0.91);
            let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
            for (let i = 0; i < 8; i++) {
                tmpCorners[i].set(pts[i][0], pts[i][1], pts[i][2]).project(camera);
                minX = Math.min(minX, tmpCorners[i].x);
                maxX = Math.max(maxX, tmpCorners[i].x);
                minY = Math.min(minY, tmpCorners[i].y);
                maxY = Math.max(maxY, tmpCorners[i].y);
            }
            const safeW = Math.max(0.25, maxNdcX - minNdcX);
            const safeH = Math.max(0.25, maxNdcY - minNdcY);
            if ((maxX - minX) <= safeW * 0.94 && (maxY - minY) <= safeH * 0.94) hi = mid;
            else lo = mid;
        }
        baseDist = hi;
        const approxWorldW = 2 * baseDist * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect;
        const approxWorldH = 2 * baseDist * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / Math.sin(0.91);
        baseLookTarget.set(-centerNdcX * approxWorldW * 0.42, 0, centerNdcY * approxWorldH * 0.42);
        updateCameraImmediate(baseDist * zoom, yaw, pitch);
    }

    function resetCamera() {
        targetYaw = 0;
        targetPitch = 0.91;
        targetZoom = 1.0;
        targetPan.set(0, 0);
    }

    function applyPan(dx, dy) {
        const panScale = (baseDist * zoom) / Math.max(300, viewH) * 1.15;
        const rightX = Math.cos(yaw), rightZ = -Math.sin(yaw);
        const fwdX = -Math.sin(yaw), fwdZ = -Math.cos(yaw);
        targetPan.x = THREE.MathUtils.clamp(targetPan.x - (rightX * dx - fwdX * dy) * panScale, -16, 16);
        targetPan.y = THREE.MathUtils.clamp(targetPan.y - (rightZ * dx - fwdZ * dy) * panScale, -18, 18);
    }

    function applySeasonWeather(nextSeason, nextWeather, persist = true) {
        season = nextSeason;
        weather = nextWeather;
        environment.setPreset(season, weather, { cage: isCageLevel }, false);
        audio.setEnvironment(season, weather);
        if (persist) {
            try { localStorage.setItem(SEASON_STORE_KEY, JSON.stringify({ levelId: String(level.id), season, weather })); } catch (_) {}
        }
        if (latestUi) holoUI.sync({ ...latestUi, season, weather });
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
            if (latestUi) holoUI.sync({ ...latestUi, timeCycle: environment.isTimeCycleEnabled() });
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

    const activePointers = new Map();
    let pointerConsumedByUi = false;
    let rightPanning = false;
    let downX = 0, downY = 0, lastX = 0, lastY = 0, dragged = false;
    let prevPinch = null;

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

    function pinchInfo() {
        const pts = [...activePointers.values()];
        const a = pts[0], b = pts[1];
        return {
            midX: (a.x + b.x) / 2,
            midY: (a.y + b.y) / 2,
            dist: Math.max(10, Math.hypot(a.x - b.x, a.y - b.y))
        };
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
        const rect = domEl.getBoundingClientRect();
        const x = e.clientX - rect.left, y = e.clientY - rect.top;
        activePointers.set(e.pointerId, { x, y });

        if (activePointers.size === 2) {
            prevPinch = pinchInfo();
            dragged = true;
            pointerConsumedByUi = false;
            return;
        }
        downX = lastX = x;
        downY = lastY = y;
        dragged = false;
        rightPanning = e.button === 2 || (e.buttons & 2) === 2;
        if (!rightPanning && holoUI.handlePointerDown(x, y)) {
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
            applyPan(cur.midX - prevPinch.midX, cur.midY - prevPinch.midY);
            const ratio = prevPinch.dist / cur.dist;
            targetZoom = THREE.MathUtils.clamp(targetZoom * ratio, 0.65, 1.45);
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
            if (Math.hypot(x - downX, y - downY) > 8) dragged = true;
            if (dragged) {
                if (rightPanning || (e.buttons & 2) === 2) {
                    applyPan(dx, dy);
                } else {
                    targetYaw = THREE.MathUtils.clamp(targetYaw - dx * 0.0055, -0.62, 0.62);
                    targetPitch = THREE.MathUtils.clamp(targetPitch + dy * 0.0055, 0.61, 1.36);
                }
                return;
            }
        }
        const pt = pickGround(e.clientX, e.clientY);
        if (pt) grass.stamp(pt.x, pt.z, 0.85, 0.65);
    };

    const onPointerUp = e => {
        const rect = domEl.getBoundingClientRect();
        const x = e.clientX - rect.left, y = e.clientY - rect.top;
        activePointers.delete(e.pointerId);
        if (activePointers.size < 2) prevPinch = null;

        if (pointerConsumedByUi) {
            holoUI.handlePointerUp(x, y);
            pointerConsumedByUi = false;
            return;
        }
        if (!dragged && !rightPanning) {
            if (holoUI.handlePointerUp(x, y)) return;
            const pigId = pickActor(e.clientX, e.clientY);
            if (pigId !== null) {
                audio.playSfx('oink');
                onPick?.(pigId);
                return;
            }
            const pt = pickGround(e.clientX, e.clientY);
            if (pt) {
                grass.stamp(pt.x, pt.z, 1.1, 1.0);
                particles.burstGrass(pt.x, pt.z, season);
                audio.playSfx('rustle');
            }
        }
        rightPanning = false;
    };

    const onWheel = e => {
        e.preventDefault();
        const rect = domEl.getBoundingClientRect();
        if (holoUI.handleWheel(e.deltaY, e.clientX - rect.left, e.clientY - rect.top)) return;
        targetZoom = THREE.MathUtils.clamp(targetZoom + e.deltaY * 0.0008, 0.65, 1.45);
    };

    const onDblClick = () => resetCamera();
    const onResize = () => fitCamera();
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
    domEl.addEventListener('dblclick', onDblClick);
    window.addEventListener('resize', onResize);
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

        const damp = Math.min(1, dt * 10);
        yaw = THREE.MathUtils.lerp(yaw, targetYaw, damp);
        pitch = THREE.MathUtils.lerp(pitch, targetPitch, damp);
        zoom = THREE.MathUtils.lerp(zoom, targetZoom, damp);
        panOffset.lerp(targetPan, damp);
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
        scenery.applyPreset(curPreset, Math.min(1, dt * 4), horizonColor);
        scenery.update(dt, elapsedTotal, curPreset.wind);
        grass.update(dt, elapsedTotal, latestState, actorPositions, curPreset, environment.getShadowData(), horizonColor);
        particles.update(dt, elapsedTotal, curPreset, viewH);
        holoUI.update(dt, elapsedTotal, yaw);

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
        getActorCount: () => actorMap.size,
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
        setSeasonWeather(s, w) {
            if (SEASONS.includes(s) && WEATHERS.includes(w)) applySeasonWeather(s, w, false);
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
            domEl.removeEventListener('dblclick', onDblClick);
            window.removeEventListener('resize', onResize);
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
