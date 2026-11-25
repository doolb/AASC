// 3D 卡通浮动 UI：高饱和圆角描边卡片、3D 浮漂与视差、居中无限滑动关卡选择、精确包围盒拾取。
import * as THREE from '../vendor/three.module.min.js';
import { SEASONS, WEATHERS, SEASON_LABELS, WEATHER_LABELS } from './presets.mjs?v=20261125b';
import { TIME_SLOTS, TIME_LABELS } from './environment.mjs?v=20261125b';

// 时钟圆盘环形配置表：外圈 24h 时段（唯一三角指针指示，无遮字）、中环 120° 晴阴雨、内环 90° 四季
const DIAL_SIZE = 180;
const DIAL_RINGS = [
    {
        key: 'timeSlot',
        prefix: 'time',
        title: '时段',
        rIn: 58, rOut: 89, hitMid: 78,
        hasHand: true,
        fillActive: 'rgba(255, 224, 150, 0.42)', strokeActive: '#d97706',
        items: TIME_SLOTS,
        labels: TIME_LABELS
    },
    {
        key: 'weather',
        prefix: 'weather',
        title: '天气',
        rIn: 36, rOut: 58, hitMid: 47,
        hasHand: false,
        fillActive: '#9bd8ff', strokeActive: '#2563eb',
        items: WEATHERS,
        labels: WEATHER_LABELS
    },
    {
        key: 'season',
        prefix: 'season',
        title: '季节',
        rIn: 14, rOut: 36, hitMid: 25,
        hasHand: false,
        fillActive: '#a7ec8c', strokeActive: '#2e7d32',
        items: SEASONS,
        labels: SEASON_LABELS
    }
];

const DIAL_SECTOR_MAP = new Map();
DIAL_RINGS.forEach(ring => {
    ring.items.forEach((val, idx) => {
        DIAL_SECTOR_MAP.set(`${ring.prefix}-${val}`, { ring, val, idx });
    });
});

// UI 背景与按钮随天气（晴/阴/雨）、冬季及昼夜联动换肤配置表
const WEATHER_UI_THEMES = {
    sunny: {
        cardFill: '#fff6e0', cardMid: '#f9ebc8', cardShade: '#f0d7a9', cardCurl: '#c49d62', cardStroke: '#6b4125',
        btnFill: '#f2dab0', btnMid: '#dfbc85', btnShade: '#c49557', btnStroke: '#5d341a', btnFg: '#4a2b1a',
        dialBg: '#fffaf0', dialRingBg: '#fff6e4', dialAltBg: '#f7ead0'
    },
    cloudy: {
        cardFill: '#f2f6fb', cardMid: '#e3ebf4', cardShade: '#cfdbe8', cardCurl: '#9fb2c7', cardStroke: '#44576d',
        btnFill: '#e1ebf5', btnMid: '#c6d6e8', btnShade: '#9db4cc', btnStroke: '#3b4e63', btnFg: '#28384a',
        dialBg: '#f6f9fd', dialRingBg: '#eef4fa', dialAltBg: '#e2ebf5'
    },
    rain: {
        cardFill: '#e8f5fc', cardMid: '#d5eaf6', cardShade: '#b8d7eb', cardCurl: '#7fa8c4', cardStroke: '#2b516b',
        btnFill: '#cde8f6', btnMid: '#a5cfe8', btnShade: '#78accf', btnStroke: '#234a66', btnFg: '#1a384f',
        dialBg: '#f0f8fd', dialRingBg: '#e4f2fa', dialAltBg: '#d4e9f7'
    },
    winterRain: {
        cardFill: '#f2f8ff', cardMid: '#e2effc', cardShade: '#c7dff5', cardCurl: '#8eb1d1', cardStroke: '#355678',
        btnFill: '#dcecfc', btnMid: '#b8d5f0', btnShade: '#8eb6db', btnStroke: '#2d4e6e', btnFg: '#1f3954',
        dialBg: '#f6faff', dialRingBg: '#ebf4fe', dialAltBg: '#ddebfa'
    }
};

const SVG_UI_NAMES = ['panel-parchment', 'btn-close', 'dial-pointer', 'center-knob', 'btn-pill'];

const CARTOON_VERT = /* glsl */`
    uniform vec4 uSelfRect;
    varying vec2 vUv;
    varying vec2 vUiPos;
    void main() {
        vUv = uv;
        vUiPos = uSelfRect.xy + position.xy * uSelfRect.zw;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;

const CARTOON_FRAG = /* glsl */`
    uniform float uTime;
    uniform float uHover;
    uniform float uActive;
    uniform float uDisabled;
    uniform float uReveal;
    uniform vec4 uClipRect;
    uniform float uClipFeather;
    uniform sampler2D uTextMap;
    varying vec2 vUv;
    varying vec2 vUiPos;
    void main() {
        if (vUiPos.x < uClipRect.x || vUiPos.x > uClipRect.z || vUiPos.y < uClipRect.y || vUiPos.y > uClipRect.w) discard;
        float halfReveal = 0.5 * clamp(uReveal, 0.0, 1.0);
        if (abs(vUv.y - 0.5) > halfReveal) discard;
        vec4 tex = texture2D(uTextMap, vUv);
        if (tex.a < 0.02) discard;
        float clipAlpha = 1.0;
        if (uClipFeather > 0.01) {
            float fadeBot = smoothstep(uClipRect.y, uClipRect.y + uClipFeather, vUiPos.y);
            float fadeTop = smoothstep(uClipRect.w, uClipRect.w - uClipFeather, vUiPos.y);
            clipAlpha = min(fadeBot, fadeTop);
        }
        vec3 col = tex.rgb;
        col += vec3(0.08, 0.07, 0.04) * uHover;
        col += vec3(0.06, 0.08, 0.02) * uActive * (0.6 + 0.4 * sin(uTime * 5.0));
        float alpha = tex.a * (uDisabled > 0.5 ? 0.5 : 1.0) * clipAlpha;
        if (alpha < 0.01) discard;
        gl_FragColor = vec4(col, alpha);
    }
`;

const THEMES = {
    card: { fill: '#fff8ea', shade: '#f3e3c6', stroke: '#623a22', fg: '#4a2b1a', textStroke: '#fff8ea', glow: '#ffffff' },
    cream: { fill: '#fff3db', shade: '#edd5ad', stroke: '#6d4127', fg: '#4f2f1d', textStroke: '#fff8ea', glow: '#ffffff' },
    coral: { fill: '#ff8b5e', shade: '#e06338', stroke: '#5d2b18', fg: '#ffffff', textStroke: '#6b2a14', glow: '#ffc7ad' },
    green: { fill: '#79cf54', shade: '#56a834', stroke: '#2c591b', fg: '#ffffff', textStroke: '#285418', glow: '#c1f4a5' },
    sky: { fill: '#5eb9ff', shade: '#3693de', stroke: '#1f4d78', fg: '#ffffff', textStroke: '#1a456e', glow: '#bae2ff' },
    gold: { fill: '#ffd04d', shade: '#e5a422', stroke: '#6b440e', fg: '#4f2c08', textStroke: '#fff4c4', glow: '#fff0a8' },
    danger: { fill: '#ff6470', shade: '#d43c49', stroke: '#611921', fg: '#ffffff', textStroke: '#631820', glow: '#ffb8bf' }
};

export function createHoloUI({ levels, levelId, onAction, onEnvChange, onTimeSlot, onQualityChange, onAudioToggle, onTimeToggle, onCamReset }) {
    const uiScene = new THREE.Scene();
    const uiCam = new THREE.OrthographicCamera(0, 1, 1, 0, -1000, 1000);
    const root = new THREE.Group();
    uiScene.add(root);

    const widgets = [];
    const hitTargets = [];
    const disposables = [];
    let viewW = 1280, viewH = 720;
    let settingsOpen = false;
    let levelPickerOpen = false;
    let revealTime = 0;

    // 居中平滑滑动关卡选择状态（单位：行索引，不循环首尾，限制在列表范围内；渲染 5 行缓冲配合遮罩裁剪平滑进出）
    const PICK_COLS = 5;
    const PICK_ROWS_VISIBLE = 4;
    const PICK_ROWS_BUFFER = PICK_ROWS_VISIBLE + 1;
    const totalRows = Math.max(1, Math.ceil(levels.length / PICK_COLS));
    const maxScroll = Math.max(0, totalRows - PICK_ROWS_VISIBLE);
    const currentIdx = Math.max(0, levels.indexOf(String(levelId)));
    let pickerScroll = Math.min(maxScroll, Math.floor(currentIdx / PICK_COLS));
    let pickerVel = 0;
    let pickerDragging = false;
    let pickerDragMoved = false;
    let pickerLastY = 0;
    const pickerMaskBounds = { left: 0, right: 0, bottom: 0, top: 0 };

    let lastUi = {
        levelId: String(levelId), remaining: 0, ropeText: '', stepText: '准备开始', progressText: '0 / 0',
        statusText: '', statusKind: '', ruleText: '', hintChecked: true, hintDisabled: false,
        hasSteps: true, cursor: 0, totalSteps: 0, canPrev: false, canNext: true, canUndo: false,
        won: false, failed: false, freeMode: false, season: 'spring', weather: 'sunny',
        timeSlot: 'morning', dayPhase: 0.16,
        quality: 'auto', timeCycle: true, music: true, sfx: true, show2dControls: false,
        guideText: '', showGuideHand: false
    };
    let lastDialDrawKey = '';
    let lastSyncedSkinKey = '';
    const svgImgCache = new Map();
    const tintCanvas = document.createElement('canvas');
    const tintCtx = tintCanvas.getContext('2d');

    function getUiSkinKey() {
        const wKey = lastUi.season === 'winter' && lastUi.weather === 'rain' ? 'winterRain' : (WEATHER_UI_THEMES[lastUi.weather] ? lastUi.weather : 'sunny');
        return `${wKey}:${lastUi.timeSlot === 'night' ? 'night' : 'day'}`;
    }

    function getUiPalette() {
        const wKey = lastUi.season === 'winter' && lastUi.weather === 'rain' ? 'winterRain' : (WEATHER_UI_THEMES[lastUi.weather] ? lastUi.weather : 'sunny');
        const base = WEATHER_UI_THEMES[wKey];
        if (lastUi.timeSlot !== 'night') return base;
        return {
            ...base,
            cardStroke: '#304370',
            btnStroke: '#2b3e68',
            dialRingBg: wKey === 'sunny' ? '#f5efe6' : base.dialRingBg,
            dialAltBg: wKey === 'sunny' ? '#e6ded2' : base.dialAltBg
        };
    }

    function resolveTheme(themeKey) {
        const base = THEMES[themeKey] || THEMES.cream;
        const pal = getUiPalette();
        if (themeKey === 'card') {
            return { ...base, fill: pal.cardFill, shade: pal.cardShade, stroke: pal.cardStroke, fg: pal.btnFg, textStroke: pal.cardFill };
        }
        if (themeKey === 'cream') {
            return { ...base, fill: pal.btnFill, shade: pal.btnShade, stroke: pal.btnStroke, fg: pal.btnFg, textStroke: pal.cardFill };
        }
        return base;
    }

    function getSvgImage(name) {
        const img = svgImgCache.get(name);
        return img && img.complete && img.naturalWidth > 0 ? img : null;
    }

    function drawTintedSvg(ctx, img, w, h, tintColor, alpha = 0.45) {
        const wKey = lastUi.season === 'winter' && lastUi.weather === 'rain' ? 'winterRain' : lastUi.weather;
        if (wKey === 'sunny' && lastUi.timeSlot !== 'night') {
            ctx.drawImage(img, 0, 0, w, h);
            return;
        }
        const tw = Math.max(32, Math.round(w * 2));
        const th = Math.max(24, Math.round(h * 2));
        if (tintCanvas.width !== tw || tintCanvas.height !== th) {
            tintCanvas.width = tw; tintCanvas.height = th;
        }
        tintCtx.clearRect(0, 0, tw, th);
        tintCtx.globalCompositeOperation = 'source-over';
        tintCtx.drawImage(img, 0, 0, tw, th);
        tintCtx.globalCompositeOperation = 'multiply';
        tintCtx.fillStyle = tintColor;
        tintCtx.fillRect(0, 0, tw, th);
        tintCtx.globalCompositeOperation = 'destination-in';
        tintCtx.drawImage(img, 0, 0, tw, th);
        tintCtx.globalCompositeOperation = 'source-over';
        ctx.drawImage(img, 0, 0, w, h);
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.drawImage(tintCanvas, 0, 0, w, h);
        ctx.restore();
    }

    // 启动时仅一次性并行预加载 5 个静态 SVG 矢量皮肤（切换天气或首次打开弹窗时零异步重建）
    Promise.all(SVG_UI_NAMES.map(name => new Promise(resolve => {
        const img = new Image();
        img.onload = () => resolve(true);
        img.onerror = () => resolve(false);
        img.src = `./assets/ui/${name}.svg?v=20261125b`;
        svgImgCache.set(name, img);
    }))).then(results => {
        if (!results.some(Boolean)) return;
        lastDialDrawKey = '';
        for (const wg of allSettingsWidgets) wg.lastKey = '';
        if (settingsOpen) {
            lastSyncedSkinKey = '';
            layout();
            sync(lastUi);
        }
    });

    function makeTextCanvas(w, h) {
        const scale = Math.min(3, Math.max(2, Math.ceil(window.devicePixelRatio || 2)));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(32, Math.round(w * scale));
        canvas.height = Math.max(24, Math.round(h * scale));
        const ctx = canvas.getContext('2d');
        const tex = new THREE.CanvasTexture(canvas);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.minFilter = THREE.LinearFilter;
        tex.magFilter = THREE.LinearFilter;
        tex.generateMipmaps = false;
        disposables.push(tex);
        return { canvas, ctx, tex, scale };
    }

    function drawCartoonBox(ctx, w, h, themeKey, widgetName = '') {
        const t = resolveTheme(themeKey);
        if (widgetName === 'clock-dial' || widgetName === 'settings-title') return t;
        if (widgetName === 'settingsBg') {
            const svgCard = getSvgImage('panel-parchment');
            if (svgCard) {
                drawTintedSvg(ctx, svgCard, w, h, t.fill, lastUi.timeSlot === 'night' ? 0.55 : 0.45);
                return t;
            }
        }
        if (widgetName === 'settings-close') {
            const svgClose = getSvgImage('btn-close');
            if (svgClose) {
                ctx.drawImage(svgClose, 0, 0, w, h);
                return t;
            }
        }
        if (themeKey === 'cream' && (widgetName.startsWith('quality-') || ['music', 'sfx', 'time-cycle', 'cam-reset', 'toggle-2d-controls', 'view-2d'].includes(widgetName))) {
            const svgPill = getSvgImage('btn-pill');
            if (svgPill) {
                drawTintedSvg(ctx, svgPill, w, h, t.fill, lastUi.timeSlot === 'night' ? 0.62 : 0.52);
                return t;
            }
        }
        const pad = 2.5;
        const r = Math.min(18, Math.min(w, h) * 0.42);
        const bw = w - pad * 2, bh = h - pad * 2;
        ctx.fillStyle = t.stroke;
        ctx.beginPath();
        ctx.roundRect(pad, pad + 2, bw, bh, r);
        ctx.fill();
        const grad = ctx.createLinearGradient(0, pad, 0, pad + bh);
        grad.addColorStop(0, t.fill);
        grad.addColorStop(1, t.shade);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.roundRect(pad, pad, bw, bh - 2, r);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.42)';
        ctx.beginPath();
        ctx.roundRect(pad + 5, pad + 3, Math.max(8, bw - 10), Math.max(4, (bh - 6) * 0.3), Math.max(4, r - 4));
        ctx.fill();
        ctx.strokeStyle = t.stroke;
        ctx.lineWidth = 2.6;
        ctx.beginPath();
        ctx.roundRect(pad, pad, bw, bh - 2, r);
        ctx.stroke();
        return t;
    }

    function createPanel({ name, w = 120, h = 36, z = 0, theme = 'cream', action = null, payload = null, text = '', subtext = '', fontSize = 15, align = 'center' }) {
        const geo = new THREE.PlaneGeometry(1, 1);
        const textObj = makeTextCanvas(w, h);
        const uniforms = {
            uTime: { value: 0 },
            uHover: { value: 0 },
            uActive: { value: 0 },
            uDisabled: { value: 0 },
            uReveal: { value: 1 },
            uSelfRect: { value: new THREE.Vector4(0, 0, w, h) },
            uClipRect: { value: new THREE.Vector4(-32000, -32000, 32000, 32000) },
            uClipFeather: { value: 0 },
            uTextMap: { value: textObj.tex }
        };
        const mat = new THREE.ShaderMaterial({
            uniforms,
            transparent: true,
            depthTest: false,
            depthWrite: false,
            side: THREE.DoubleSide,
            vertexShader: CARTOON_VERT,
            fragmentShader: CARTOON_FRAG
        });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.frustumCulled = false;
        mesh.scale.set(w, h, 1);
        mesh.position.z = z;
        mesh.renderOrder = 100 + z;
        mesh.userData = { name, action, payload, w, h, z };
        root.add(mesh);
        if (action) hitTargets.push(mesh);
        disposables.push(geo, mat);

        const widget = {
            name, mesh, uniforms, textObj, w, h, baseW: w, baseH: h, theme,
            lastKey: '', text, subtext, fontSize, align, visible: true,
            setSize(nw, nh) {
                if (this.w === nw && this.h === nh) return;
                this.w = nw; this.h = nh;
                this.baseW = nw; this.baseH = nh;
                mesh.scale.set(nw, nh, 1);
                uniforms.uSelfRect.value.z = nw;
                uniforms.uSelfRect.value.w = nh;
                mesh.userData.w = nw; mesh.userData.h = nh;
                this.lastKey = '';
            },
            setPos(cx, cy, nz = mesh.userData.z) {
                mesh.position.set(cx, cy, nz);
                uniforms.uSelfRect.value.x = cx;
                uniforms.uSelfRect.value.y = cy;
                mesh.renderOrder = 100 + nz;
            },
            setVisible(v) {
                this.visible = v;
                mesh.visible = v;
            },
            drawText(nextText, nextSub = '', extraDraw = null, forceTheme = null) {
                const useTheme = forceTheme || this.theme;
                const isAct = uniforms.uActive.value > 0.5 ? 1 : 0;
                const skin = getUiSkinKey();
                const key = `${nextText}|${nextSub}|${this.w}x${this.h}|${useTheme}|${isAct}|${skin}`;
                if (key === this.lastKey && !extraDraw) return;
                this.lastKey = key;
                const { canvas, ctx, tex, scale } = this.textObj;
                const tw = Math.max(32, Math.round(this.w * scale));
                const th = Math.max(24, Math.round(this.h * scale));
                if (canvas.width !== tw || canvas.height !== th) {
                    canvas.width = tw; canvas.height = th;
                }
                ctx.clearRect(0, 0, tw, th);
                ctx.save();
                ctx.scale(scale, scale);
                const t = drawCartoonBox(ctx, this.w, this.h, useTheme, this.name);
                if (extraDraw) {
                    extraDraw(ctx, this.w, this.h, t);
                } else {
                    ctx.font = `800 ${this.fontSize}px system-ui, "Noto Sans SC", sans-serif`;
                    ctx.textBaseline = 'middle';
                    ctx.textAlign = this.align;
                    const tx = this.align === 'left' ? 14 : this.align === 'right' ? this.w - 14 : this.w / 2;
                    const maxW = this.w - 18;
                    if (nextSub) {
                        const isCompactBox = this.h <= 34;
                        const mainSize = isCompactBox ? Math.max(11, this.fontSize - 2) : this.fontSize;
                        const subSize = isCompactBox ? Math.max(9, this.fontSize - 5) : Math.max(11, this.fontSize - 3);
                        const mainY = isCompactBox ? this.h * 0.33 : this.h * 0.36;
                        const subY = isCompactBox ? this.h * 0.74 : this.h * 0.72;
                        ctx.font = `800 ${mainSize}px system-ui, "Noto Sans SC", sans-serif`;
                        ctx.lineWidth = 3.2; ctx.strokeStyle = t.textStroke;
                        ctx.strokeText(nextText, tx, mainY, maxW);
                        ctx.fillStyle = t.fg;
                        ctx.fillText(nextText, tx, mainY, maxW);
                        ctx.font = `700 ${subSize}px system-ui, "Noto Sans SC", sans-serif`;
                        ctx.fillStyle = useTheme === 'card' ? '#8c5634' : '#fff7e0';
                        ctx.fillText(nextSub, tx, subY, maxW);
                    } else {
                        if (t.fg === '#ffffff') {
                            ctx.lineWidth = 3.2; ctx.strokeStyle = t.textStroke;
                            ctx.strokeText(nextText, tx, this.h / 2 - 1, maxW);
                        }
                        ctx.fillStyle = t.fg;
                        ctx.fillText(nextText, tx, this.h / 2 - 1, maxW);
                    }
                }
                ctx.restore();
                tex.needsUpdate = true;
            }
        };
        if (text || theme === 'card') widget.drawText(text, subtext);
        widgets.push(widget);
        return widget;
    }

    const topBg = createPanel({ name: 'topBg', w: 360, h: 78, z: 0, theme: 'card' });
    const btnPrevLevel = createPanel({ name: 'level-prev', w: 54, h: 28, z: 1, theme: 'cream', action: 'prevLevel', text: '‹ 上关', fontSize: 13 });
    const btnLevelBadge = createPanel({ name: 'level-picker', w: 120, h: 30, z: 1, theme: 'gold', action: 'togglePicker', text: `第 ${levelId} 关 ▾`, fontSize: 14 });
    const btnNextLevel = createPanel({ name: 'level-next', w: 54, h: 28, z: 1, theme: 'cream', action: 'nextLevel', text: '下关 ›', fontSize: 13 });
    const btnSettings = createPanel({ name: 'settings-toggle', w: 66, h: 28, z: 1, theme: 'sky', action: 'toggleSettings', text: '⚙ 环境', fontSize: 13 });
    const pillRemain = createPanel({ name: 'remain', w: 86, h: 24, z: 1, theme: 'cream', text: '剩余 0 只', fontSize: 12 });
    const pillMech = createPanel({ name: 'mech', w: 120, h: 24, z: 1, theme: 'cream', text: '', fontSize: 12 });

    const bottomBg = createPanel({ name: 'bottomBg', w: 360, h: 104, z: 0, theme: 'card' });
    const lblStatus = createPanel({ name: 'status', w: 220, h: 24, z: 1, theme: 'cream', text: '', fontSize: 12, align: 'left' });
    const btnHint = createPanel({ name: 'hint', w: 70, h: 24, z: 1, theme: 'gold', action: 'hint', text: '💡 提示', fontSize: 12 });
    const btnPrevStep = createPanel({ name: 'previous', w: 36, h: 30, z: 1, theme: 'cream', action: 'previous', text: '‹', fontSize: 19 });
    const sliderBar = createPanel({ name: 'slider', w: 180, h: 28, z: 1, theme: 'cream', action: 'seekDrag', text: '' });
    const btnNextStep = createPanel({ name: 'next', w: 36, h: 30, z: 1, theme: 'coral', action: 'next', text: '›', fontSize: 19 });
    const btnUndo = createPanel({ name: 'undo', w: 74, h: 24, z: 1, theme: 'cream', action: 'undo', text: '↶ 撤回', fontSize: 12 });
    const lblProgress = createPanel({ name: 'progress', w: 96, h: 24, z: 1, theme: 'cream', text: '0 / 0', fontSize: 12 });
    const btnReset = createPanel({ name: 'reset', w: 74, h: 24, z: 1, theme: 'cream', action: 'reset', text: '↻ 重开', fontSize: 12 });

    // 居中弹出式环境与时间设置弹窗（放大表盘与按钮并带全屏遮罩）
    const settingsBg = createPanel({ name: 'settingsBg', w: 348, h: 454, z: 8, theme: 'card', action: 'settingsModal', text: '' });
    const settingsTitle = createPanel({ name: 'settings-title', w: 260, h: 30, z: 9, theme: 'gold', text: '⚙ 环境与时间设置', fontSize: 14 });
    const settingsClose = createPanel({ name: 'settings-close', w: 36, h: 30, z: 9, theme: 'danger', action: 'toggleSettings', text: '✕', fontSize: 15 });
    const clockDial = createPanel({ name: 'clock-dial', w: 232, h: 232, z: 9, theme: 'cream', action: 'clockDial', text: '' });
    const qualityBtns = [
        { q: 'auto', t: '自动' }, { q: 'high', t: '高' }, { q: 'medium', t: '中' }, { q: 'low', t: '低' }
    ].map(it => createPanel({ name: `quality-${it.q}`, w: 74, h: 32, z: 9, theme: 'cream', action: 'quality', payload: it.q, text: it.t, fontSize: 13 }));
    const btnMusic = createPanel({ name: 'music', w: 152, h: 32, z: 9, theme: 'green', action: 'music', text: '♪ 音乐:开', fontSize: 13 });
    const btnSfx = createPanel({ name: 'sfx', w: 152, h: 32, z: 9, theme: 'green', action: 'sfx', text: '🔊 音效:开', fontSize: 13 });
    const btnTime = createPanel({ name: 'time-cycle', w: 152, h: 32, z: 9, theme: 'sky', action: 'timeCycle', text: '☀ 天光:流', fontSize: 13 });
    const btnCamReset = createPanel({ name: 'cam-reset', w: 152, h: 32, z: 9, theme: 'cream', action: 'camReset', text: '⌖ 复位视角', fontSize: 13 });
    const btnToggle2d = createPanel({ name: 'toggle-2d-controls', w: 152, h: 32, z: 9, theme: 'cream', action: 'toggle2dControls', text: '☰ 2D控件', fontSize: 13 });
    const btnView2d = createPanel({ name: 'view-2d', w: 152, h: 32, z: 9, theme: 'cream', action: 'view2d', text: '回2D原版', fontSize: 13 });

    // 居中平滑滑动关卡选择器（有边界不循环）
    const pickerBg = createPanel({ name: 'pickerBg', w: 300, h: 256, z: 8, theme: 'card', action: 'pickerScroll', text: '' });
    const pickerTitle = createPanel({ name: 'picker-title', w: 180, h: 28, z: 9, theme: 'gold', text: '选择关卡（上下滑动）', fontSize: 13 });
    const pickerClose = createPanel({ name: 'picker-close', w: 36, h: 28, z: 9, theme: 'danger', action: 'togglePicker', text: '✕', fontSize: 14 });
    const pickerPrev = createPanel({ name: 'picker-prev', w: 96, h: 28, z: 9, theme: 'sky', action: 'pickerStep', payload: -2, text: '▲ 上滑', fontSize: 12 });
    const pickerNext = createPanel({ name: 'picker-next', w: 96, h: 28, z: 9, theme: 'sky', action: 'pickerStep', payload: 2, text: '▼ 下滑', fontSize: 12 });
    const pickerCells = Array.from({ length: PICK_COLS * PICK_ROWS_BUFFER }, (_, idx) =>
        createPanel({ name: `pick-${idx}`, w: 48, h: 34, z: 9, theme: 'cream', action: 'pickLevel', payload: '', text: '', fontSize: 13 })
    );

    // 胜利/失败结算全屏暗色遮罩，隔断底层棋盘与背景 HUD 误触并突出居中弹窗
    const modalBackdropGeo = new THREE.PlaneGeometry(1, 1);
    const modalBackdropMat = new THREE.MeshBasicMaterial({
        color: '#2b140c', transparent: true, opacity: 0.56,
        depthTest: false, depthWrite: false, side: THREE.DoubleSide
    });
    const modalBackdrop = new THREE.Mesh(modalBackdropGeo, modalBackdropMat);
    modalBackdrop.frustumCulled = false;
    modalBackdrop.position.set(0, 0, 11);
    modalBackdrop.renderOrder = 111;
    modalBackdrop.visible = false;
    root.add(modalBackdrop);
    disposables.push(modalBackdropGeo, modalBackdropMat);

    const modalBg = createPanel({ name: 'modalBg', w: 308, h: 188, z: 12, theme: 'card', text: '', fontSize: 20 });
    const modalBtn1 = createPanel({ name: 'modal-btn1', w: 112, h: 36, z: 13, theme: 'cream', action: 'reset', text: '再玩一次', fontSize: 14 });
    const modalBtn2 = createPanel({ name: 'modal-btn2', w: 112, h: 36, z: 13, theme: 'coral', action: 'nextLevel', text: '下一关 ›', fontSize: 14 });
    // 不响应点击的新手引导标语胶囊（棋盘下方提示“点击小猪向前移动”）
    const guideBanner = createPanel({ name: 'guide-banner', w: 252, h: 34, z: 6, theme: 'gold', action: null, text: '', fontSize: 13 });
    guideBanner.setVisible(false);

    const allSettingsWidgets = [settingsBg, settingsTitle, settingsClose, clockDial, ...qualityBtns, btnMusic, btnSfx, btnTime, btnCamReset, btnToggle2d, btnView2d];
    const allPickerWidgets = [pickerBg, pickerTitle, pickerClose, pickerPrev, pickerNext, ...pickerCells];
    const allModalWidgets = [modalBg, modalBtn1, modalBtn2];

    const byName = new Map(widgets.map(w => [w.name, w]));
    hitTargets.sort((a, b) => (b.userData.z || 0) - (a.userData.z || 0));

    function drawClockDial(livePhase = null) {
        const phase = Number.isFinite(livePhase) ? livePhase : (Number.isFinite(lastUi.dayPhase) ? lastUi.dayPhase : 0.16);
        const phaseStep = Math.round(((phase % 1 + 1) % 1) * 180);
        const skin = getUiSkinKey();
        const key = `${clockDial.w}|${skin}|${lastUi.season}|${lastUi.weather}|${lastUi.timeSlot}|${phaseStep}|${lastUi.timeCycle}`;
        if (key === lastDialDrawKey) return;
        lastDialDrawKey = key;

        const pal = getUiPalette();
        const svgPtr = getSvgImage('dial-pointer');
        const svgKnob = getSvgImage('center-knob');

        clockDial.drawText('', '', (ctx, cw, ch) => {
            ctx.save();
            ctx.scale(cw / DIAL_SIZE, ch / DIAL_SIZE);
            const cx = DIAL_SIZE / 2, cy = DIAL_SIZE / 2;

            // 内/中两环底圆与细密外圈刻度盘框（参考 env_modal_one_hand_dial_concept）
            ctx.beginPath();
            ctx.arc(cx, cy, 67, 0, Math.PI * 2);
            ctx.fillStyle = pal.dialBg;
            ctx.fill();
            ctx.lineWidth = 2.4;
            ctx.strokeStyle = pal.cardStroke;
            ctx.stroke();

            // 先绘制内环（季节 90° 四等分）与中环（天气 120° 三等分），无指针遮挡
            for (const ring of DIAL_RINGS) {
                if (ring.key === 'timeSlot') continue;
                const n = ring.items.length;
                const step = (Math.PI * 2) / n;
                const curVal = lastUi[ring.key];
                ring.items.forEach((val, idx) => {
                    const cwA = idx * step;
                    const a0 = cwA - Math.PI * 0.5 - step * 0.5;
                    const a1 = cwA - Math.PI * 0.5 + step * 0.5;
                    const act = val === curVal;
                    ctx.beginPath();
                    ctx.arc(cx, cy, ring.rOut, a0, a1);
                    ctx.arc(cx, cy, ring.rIn, a1, a0, true);
                    ctx.closePath();
                    ctx.fillStyle = act ? ring.fillActive : (idx % 2 === 0 ? pal.dialRingBg : pal.dialAltBg);
                    ctx.fill();
                    ctx.lineWidth = act ? 1.8 : 1.1;
                    ctx.strokeStyle = act ? ring.strokeActive : pal.cardStroke;
                    ctx.stroke();

                    const lx = cx + Math.sin(cwA) * ring.hitMid;
                    const ly = cy - Math.cos(cwA) * ring.hitMid;
                    ctx.font = `800 ${ring.key === 'weather' ? 12.5 : 11.5}px system-ui, "Noto Sans SC", sans-serif`;
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillStyle = act ? '#1f140c' : pal.btnFg;
                    ctx.fillText(ring.labels[val] || val, lx, ly + 0.5);
                });
            }

            // 绘制细密表圈刻度线（r = 59..66.5）
            ctx.save();
            ctx.strokeStyle = pal.cardStroke;
            for (let tIdx = 0; tIdx < 48; tIdx++) {
                const a = (tIdx / 48) * Math.PI * 2;
                const major = tIdx % 12 === 0;
                const mid = tIdx % 4 === 0;
                const r0 = major ? 58.5 : mid ? 60.5 : 62;
                ctx.lineWidth = major ? 1.8 : 1;
                ctx.beginPath();
                ctx.moveTo(cx + Math.sin(a) * r0, cy - Math.cos(a) * r0);
                ctx.lineTo(cx + Math.sin(a) * 66.5, cy - Math.cos(a) * 66.5);
                ctx.stroke();
            }
            ctx.restore();

            // 外圈 24h 时段标签（早/中/晚/夜 位于刻度环外侧 r=78，完全不被指针与扇区边框压字）
            const timeRing = DIAL_RINGS[0];
            timeRing.items.forEach((val, idx) => {
                const cwA = idx * Math.PI * 0.5;
                const lx = cx + Math.sin(cwA) * timeRing.hitMid;
                const ly = cy - Math.cos(cwA) * timeRing.hitMid;
                const act = val === lastUi.timeSlot;
                ctx.font = `800 ${act ? 14 : 13}px system-ui, "Noto Sans SC", sans-serif`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                if (act) {
                    ctx.lineWidth = 3;
                    ctx.strokeStyle = pal.cardFill;
                    ctx.strokeText(timeRing.labels[val] || val, lx, ly + 0.5);
                }
                ctx.fillStyle = act ? '#d97706' : pal.btnFg;
                ctx.fillText(timeRing.labels[val] || val, lx, ly + 0.5);
            });

            // 外圈唯一 24h 金橙三角指针（沿刻度带 r=57..71 绕圆心旋转，指向当前时段，绝不遮挡任何汉字）
            const ptrAngle = phase * Math.PI * 2;
            ctx.save();
            ctx.translate(cx, cy);
            ctx.rotate(ptrAngle);
            if (svgPtr) {
                ctx.drawImage(svgPtr, -9, -71, 18, 17);
            } else {
                ctx.beginPath();
                ctx.moveTo(0, -70);
                ctx.lineTo(8, -56);
                ctx.lineTo(-8, -56);
                ctx.closePath();
                ctx.fillStyle = '#ff9d2e';
                ctx.fill();
                ctx.lineWidth = 1.8;
                ctx.strokeStyle = '#5d2b14';
                ctx.stroke();
            }
            ctx.restore();

            // 圆心金色纽扣底托（优先使用 center-knob.svg）+ 动态“流/定”字
            if (svgKnob) {
                ctx.drawImage(svgKnob, cx - 15, cy - 15, 30, 30);
            } else {
                ctx.beginPath();
                ctx.arc(cx, cy, 13.5, 0, Math.PI * 2);
                ctx.fillStyle = lastUi.timeCycle ? '#ffd04d' : '#d8ccb8';
                ctx.fill();
                ctx.lineWidth = 2;
                ctx.strokeStyle = pal.cardStroke;
                ctx.stroke();
            }
            ctx.font = '800 10.5px system-ui, "Noto Sans SC", sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = '#4a2b1a';
            ctx.fillText(lastUi.timeCycle ? '流' : '定', cx, cy + 0.5);
            ctx.restore();
        });
    }

    function resolveClockSector(clientX, clientY) {
        const s = clockDial.w / DIAL_SIZE;
        const ux = clientX;
        const uy = viewH - clientY;
        const dx = (ux - clockDial.mesh.position.x) / s;
        const dy = (uy - clockDial.mesh.position.y) / s;
        const dist = Math.hypot(dx, dy);
        if (dist <= 13.5) return { kind: 'center' };
        const ring = DIAL_RINGS.find(r => dist >= r.rIn && dist <= r.rOut + 4);
        if (!ring) return null;
        const cwAngle = (Math.atan2(dx, dy) + Math.PI * 2) % (Math.PI * 2);
        const step = (Math.PI * 2) / ring.items.length;
        const idx = Math.floor(((cwAngle + step * 0.5) % (Math.PI * 2)) / step) % ring.items.length;
        return { kind: 'sector', ring, val: ring.items[idx] };
    }

    function layout() {
        const w = viewW, h = viewH;
        uiCam.left = 0; uiCam.right = w;
        uiCam.top = h; uiCam.bottom = 0;
        uiCam.updateProjectionMatrix();

        const compact = w < 520 || h < 520;
        const landscape = w > h && w >= 560;
        const rightColW = landscape ? Math.min(370, Math.max(290, Math.round(w * 0.36))) : 0;

        const topW = landscape ? rightColW : Math.min(w - 20, 480);
        const topH = compact ? 70 : 78;
        const topY = h - 10 - topH / 2;
        const topCx = landscape ? w - rightColW / 2 - 12 : w / 2;

        topBg.setSize(topW, topH);
        topBg.setPos(topCx, topY);
        topBg.drawText('', '');
        const row1Y = topY + 15;
        const row2Y = topY - 18;
        const bw = compact || landscape ? 50 : 62;
        const setBtnW = compact || landscape ? 54 : 68;
        const lvBadgeW = Math.max(88, topW - 24 - bw * 2 - setBtnW - 18);
        btnPrevLevel.setSize(bw, 28); btnPrevLevel.setPos(topCx - topW / 2 + 10 + bw / 2, row1Y);
        btnLevelBadge.setSize(lvBadgeW, 30); btnLevelBadge.setPos(topCx - setBtnW / 2 - 2, row1Y);
        btnNextLevel.setSize(bw, 28); btnNextLevel.setPos(btnLevelBadge.mesh.position.x + lvBadgeW / 2 + 4 + bw / 2, row1Y);
        btnSettings.setSize(setBtnW, 28); btnSettings.setPos(topCx + topW / 2 - 10 - setBtnW / 2, row1Y);

        const remW = 86;
        pillRemain.setSize(remW, 24); pillRemain.setPos(topCx - topW / 2 + 10 + remW / 2, row2Y);
        pillMech.setSize(Math.max(100, topW - remW - 26), 24); pillMech.setPos(topCx + remW / 2 + 3, row2Y);

        const botW = landscape ? rightColW : Math.min(w - 20, 460);
        const botH = compact ? 94 : 104;
        const botCx = landscape ? topCx : w / 2;
        const botCy = landscape ? Math.max(12 + botH / 2, (topY - topH / 2 - 10) / 2) : 10 + botH / 2;
        bottomBg.setSize(botW, botH);
        bottomBg.setPos(botCx, botCy);
        bottomBg.drawText('', '');

        const bRow1 = botCy + botH / 2 - 19;
        const bRow2 = botCy + 2;
        const bRow3 = botCy - botH / 2 + 19;
        lblStatus.setSize(botW - 92, 24); lblStatus.setPos(botCx - 36, bRow1);
        btnHint.setSize(66, 24); btnHint.setPos(botCx + botW / 2 - 42, bRow1);

        btnPrevStep.setSize(34, 28); btnPrevStep.setPos(botCx - botW / 2 + 26, bRow2);
        sliderBar.setSize(botW - 98, 26); sliderBar.setPos(botCx, bRow2);
        btnNextStep.setSize(34, 28); btnNextStep.setPos(botCx + botW / 2 - 26, bRow2);

        const sideBtnW = compact || landscape ? 68 : 74;
        btnUndo.setSize(sideBtnW, 24); btnUndo.setPos(botCx - botW / 2 + 10 + sideBtnW / 2, bRow3);
        lblProgress.setSize(Math.max(80, botW - sideBtnW * 2 - 28), 24); lblProgress.setPos(botCx, bRow3);
        btnReset.setSize(sideBtnW, 24); btnReset.setPos(botCx + botW / 2 - 10 - sideBtnW / 2, bRow3);

        // 居中自适应环境弹窗：桌面端竖排使用 462×462 大号表盘，移动端与矮横屏等比缩放不溢出
        const shortWide = w >= 540 && h < 480;
        const setW = shortWide ? Math.min(760, w - 20) : Math.min(540, w - 16);
        const setH = shortWide ? Math.min(366, h - 16) : Math.min(696, h - 20);
        const setCx = w / 2, setCy = h / 2;
        settingsBg.setSize(setW, setH);
        settingsBg.setPos(setCx, setCy);
        settingsBg.drawText('', '');
        settingsTitle.setSize(setW - 120, 28);
        settingsTitle.setPos(setCx, setCy + setH / 2 - 24);
        settingsTitle.drawText('⚙ 环境与时间设置', '', (ctx, tw, th) => {
            if (!getSvgImage('panel-parchment')) drawCartoonBox(ctx, tw, th, 'gold');
            ctx.font = '800 14px system-ui, "Noto Sans SC", sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = '#4f2c08';
            ctx.fillText('⚙ 环境与时间设置', tw / 2, th / 2);
        });
        settingsClose.setSize(34, 34);
        settingsClose.setPos(setCx + setW / 2 - 24, setCy + setH / 2 - 24);
        settingsClose.drawText('✕', '');
        if (shortWide) {
            const dialSize = Math.min(462, setH - 54, Math.floor(setW * 0.45));
            const colX = setCx + setW * 0.24;
            const colW = setW * 0.44;
            const qW = Math.floor((colW - 12) / 4);
            const pairW = Math.floor((colW - 8) / 2);
            clockDial.setSize(dialSize, dialSize);
            clockDial.setPos(setCx - setW * 0.24, setCy - 18);
            qualityBtns.forEach((b, i) => {
                b.setSize(qW, 28);
                b.setPos(colX + (i - 1.5) * (qW + 4), setCy + 64);
            });
            [btnMusic, btnSfx, btnTime, btnCamReset, btnToggle2d, btnView2d].forEach(b => b.setSize(pairW, 28));
            const halfGap = (pairW + 8) / 2;
            btnMusic.setPos(colX - halfGap, setCy + 20);
            btnSfx.setPos(colX + halfGap, setCy + 20);
            btnTime.setPos(colX - halfGap, setCy - 24);
            btnCamReset.setPos(colX + halfGap, setCy - 24);
            btnToggle2d.setPos(colX - halfGap, setCy - 68);
            btnView2d.setPos(colX + halfGap, setCy - 68);
        } else {
            const dialSize = Math.min(462, setW - 24, setH - 216);
            const dialCy = setCy + setH / 2 - 46 - dialSize / 2;
            const dialBot = dialCy - dialSize / 2;
            const qW = Math.floor((setW - 44) / 4);
            const pairW = Math.floor((setW - 34) / 2);
            clockDial.setSize(dialSize, dialSize);
            clockDial.setPos(setCx, dialCy);
            qualityBtns.forEach((b, i) => {
                b.setSize(qW, 30);
                b.setPos(setCx + (i - 1.5) * (qW + 4), dialBot - 22);
            });
            [btnMusic, btnSfx, btnTime, btnCamReset, btnToggle2d, btnView2d].forEach(b => b.setSize(pairW, 30));
            const halfGap = (pairW + 10) / 2;
            btnMusic.setPos(setCx - halfGap, dialBot - 58);
            btnSfx.setPos(setCx + halfGap, dialBot - 58);
            btnTime.setPos(setCx - halfGap, dialBot - 94);
            btnCamReset.setPos(setCx + halfGap, dialBot - 94);
            btnToggle2d.setPos(setCx - halfGap, dialBot - 130);
            btnView2d.setPos(setCx + halfGap, dialBot - 130);
        }
        lastDialDrawKey = '';
        drawClockDial();
        allSettingsWidgets.forEach(wg => wg.setVisible(settingsOpen));

        // 居中滑动关卡选择器 + 带像素裁剪遮罩的内凹列表视口
        const pW = Math.min(316, w - 24);
        const pH = Math.min(266, h - 40);
        const pCx = w / 2, pCy = h / 2;
        pickerBg.setSize(pW, pH);
        pickerBg.setPos(pCx, pCy);
        pickerMaskBounds.left = pCx - pW / 2 + 10;
        pickerMaskBounds.right = pCx + pW / 2 - 10;
        pickerMaskBounds.top = pCy + pH / 2 - 42;
        pickerMaskBounds.bottom = pCy - pH / 2 + 40;
        drawPickerCard(pW, pH);
        pickerTitle.setSize(pW - 76, 28);
        pickerTitle.setPos(pCx - 20, pCy + pH / 2 - 22);
        pickerClose.setPos(pCx + pW / 2 - 28, pCy + pH / 2 - 22);
        pickerPrev.setPos(pCx - 56, pCy - pH / 2 + 21);
        pickerNext.setPos(pCx + 56, pCy - pH / 2 + 21);
        allPickerWidgets.forEach(wg => wg.setVisible(levelPickerOpen));
        layoutPickerCells();

        // 结算弹窗自适应布局：上半区专放主副标题，下半区放双按钮，留足安全间距避免重叠
        const mW = Math.min(316, w - 28);
        const mH = Math.min(188, h - 24);
        const mBtnW = Math.min(116, Math.floor((mW - 36) / 2));
        const mBtnH = 36;
        const mBtnGap = 12;
        const mBtnY = h / 2 - Math.round(mH * 0.25);
        const modalOpen = Boolean(lastUi.won || lastUi.failed);
        modalBackdrop.scale.set(w, h, 1);
        modalBackdrop.position.set(w / 2, h / 2, modalOpen ? 11 : 7);
        modalBackdrop.renderOrder = modalOpen ? 111 : 107;
        modalBackdrop.visible = modalOpen || settingsOpen;
        modalBg.setSize(mW, mH);
        modalBg.setPos(w / 2, h / 2);
        modalBtn1.setSize(mBtnW, mBtnH);
        modalBtn2.setSize(mBtnW, mBtnH);
        modalBtn1.setPos(w / 2 - (mBtnW + mBtnGap) / 2, mBtnY);
        modalBtn2.setPos(w / 2 + (mBtnW + mBtnGap) / 2, mBtnY);
        lastModalKey = '';
        if (lastUi.failed || lastUi.won) drawModalCard();

        const gW = Math.min(268, landscape ? Math.max(196, w - rightColW - 44) : w - 28);
        const gCx = landscape ? Math.max(gW / 2 + 12, (w - rightColW - 12) / 2) : w / 2;
        const gCy = landscape ? Math.max(30, Math.round(h * 0.12)) : Math.min(topY - topH / 2 - 26, botCy + botH / 2 + 24);
        guideBanner.setSize(gW, 34);
        guideBanner.setPos(gCx, gCy);
        guideBanner.setVisible(Boolean(lastUi.guideText) && !levelPickerOpen && !settingsOpen && !lastUi.won && !lastUi.failed);
    }

    let lastPickerBgKey = '';
    function drawPickerCard(pW, pH) {
        const key = `${pW}x${pH}`;
        if (key === lastPickerBgKey) return;
        lastPickerBgKey = key;
        pickerBg.drawText('', '', (ctx, cw, ch) => {
            // 在列表可滚动可视区间绘制浅暖色内凹圆角底槽，配合 uClipRect 遮罩边界对齐
            ctx.fillStyle = 'rgba(138, 92, 54, 0.11)';
            ctx.strokeStyle = 'rgba(138, 92, 54, 0.25)';
            ctx.lineWidth = 1.6;
            ctx.beginPath();
            ctx.roundRect(10, 42, cw - 20, ch - 82, 12);
            ctx.fill();
            ctx.stroke();
        });
    }

    function layoutPickerCells() {
        pickerScroll = THREE.MathUtils.clamp(pickerScroll, 0, maxScroll);
        const pW = pickerBg.w, pCx = pickerBg.mesh.position.x;
        const { left: clipL, right: clipR, top: clipTop, bottom: clipBottom } = pickerMaskBounds;
        const cellW = (pW - 28) / PICK_COLS;
        const cellH = Math.max(24, (clipTop - clipBottom) / PICK_ROWS_VISIBLE);
        const baseRow = Math.floor(pickerScroll);
        const frac = pickerScroll - baseRow;

        pickerCells.forEach((cell, i) => {
            const col = i % PICK_COLS;
            const visRow = Math.floor(i / PICK_COLS);
            const row = baseRow + visRow;
            const lvIdx = row * PICK_COLS + col;
            const lv = levels[lvIdx];
            const y = clipTop - (visRow + 0.5 - frac) * cellH;
            const cellHVisual = Math.max(24, cellH - 6);
            const overlapsMask = (y + cellHVisual * 0.5) > clipBottom && (y - cellHVisual * 0.5) < clipTop;
            cell.setVisible(levelPickerOpen && Boolean(lv) && overlapsMask);
            if (!lv) return;
            cell.setSize(cellW - 6, cellHVisual);
            cell.setPos(pCx - pW / 2 + 14 + (col + 0.5) * cellW, y);
            cell.uniforms.uClipRect.value.set(clipL, clipBottom, clipR, clipTop);
            cell.uniforms.uClipFeather.value = 6.0;
            cell.mesh.userData.payload = lv;
            const isCur = lv === String(lastUi.levelId);
            cell.uniforms.uActive.value = isCur ? 1 : 0;
            cell.drawText(lv, '', null, isCur ? 'coral' : 'cream');
        });
        if (pickerScroll <= 0.001 && pickerVel < 0) pickerVel = 0;
        if (pickerScroll >= maxScroll - 0.001 && pickerVel > 0) pickerVel = 0;
        pickerPrev.uniforms.uDisabled.value = pickerScroll <= 0.01 ? 1 : 0;
        pickerNext.uniforms.uDisabled.value = pickerScroll >= maxScroll - 0.01 ? 1 : 0;
    }

    let lastModalKey = '';
    function drawModalCard() {
        const isFail = Boolean(lastUi.failed);
        const title = isFail ? '💥 炸弹爆炸了' : '✦ 挑战成功！';
        const sub = isFail ? '撤回一步或重新开始' : '所有小猪都安全离开了';
        const themeKey = isFail ? 'danger' : 'card';
        const key = `${title}|${sub}|${modalBg.w}x${modalBg.h}|${themeKey}`;
        if (key === lastModalKey) return;
        lastModalKey = key;
        modalBg.drawText('', '', (ctx, mw, mh, t) => {
            const titleSize = mw < 290 ? 18 : 20;
            const subSize = mw < 290 ? 12 : 13;
            const maxW = mw - 28;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.font = `800 ${titleSize}px system-ui, "Noto Sans SC", sans-serif`;
            if (t.fg === '#ffffff') {
                ctx.lineWidth = 3.2; ctx.strokeStyle = t.textStroke;
                ctx.strokeText(title, mw / 2, mh * 0.24, maxW);
            }
            ctx.fillStyle = t.fg;
            ctx.fillText(title, mw / 2, mh * 0.24, maxW);

            ctx.font = `700 ${subSize}px system-ui, "Noto Sans SC", sans-serif`;
            ctx.fillStyle = isFail ? '#fff3f3' : '#8c5634';
            ctx.fillText(sub, mw / 2, mh * 0.44, maxW);

            ctx.strokeStyle = isFail ? 'rgba(255,255,255,0.28)' : 'rgba(138, 92, 54, 0.22)';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(18, mh * 0.57);
            ctx.lineTo(mw - 18, mh * 0.57);
            ctx.stroke();
        }, themeKey);
    }

    let lastSliderKey = '';
    function drawSlider() {
        const key = `${lastUi.cursor}|${lastUi.totalSteps}|${sliderBar.w}x${sliderBar.h}`;
        if (key === lastSliderKey) return;
        lastSliderKey = key;
        sliderBar.drawText('', '', (ctx, w, h) => {
            const pad = 12;
            const barW = w - pad * 2;
            const cy = h / 2 - 1;
            ctx.fillStyle = '#d9bc94';
            ctx.beginPath();
            ctx.roundRect(pad, cy - 5, barW, 10, 5);
            ctx.fill();
            const ratio = lastUi.totalSteps > 0 && lastUi.cursor !== null ? lastUi.cursor / lastUi.totalSteps : 0;
            ctx.fillStyle = '#ff8b5e';
            ctx.beginPath();
            ctx.roundRect(pad, cy - 5, Math.max(8, barW * ratio), 10, 5);
            ctx.fill();
            const knobX = pad + barW * ratio;
            ctx.fillStyle = '#ffd04d';
            ctx.strokeStyle = '#623a22';
            ctx.lineWidth = 2.5;
            ctx.beginPath();
            ctx.arc(knobX, cy, 8.5, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
        });
    }

    function sync(uiData) {
        Object.assign(lastUi, uiData);
        const skinNow = getUiSkinKey();
        if (skinNow !== lastSyncedSkinKey) {
            lastSyncedSkinKey = skinNow;
            for (const wg of [topBg, bottomBg, btnPrevLevel, btnNextLevel, btnSettings, btnPrevStep, btnNextStep, btnUndo, btnReset, settingsBg, settingsTitle, settingsClose, btnCamReset, btnView2d, pickerBg]) {
                if (wg === settingsTitle) {
                    wg.drawText('⚙ 环境与时间设置', '', (ctx, tw, th) => {
                        if (!getSvgImage('panel-parchment')) drawCartoonBox(ctx, tw, th, 'gold');
                        ctx.font = '800 14px system-ui, "Noto Sans SC", sans-serif';
                        ctx.textAlign = 'center';
                        ctx.textBaseline = 'middle';
                        ctx.fillStyle = '#4f2c08';
                        ctx.fillText('⚙ 环境与时间设置', tw / 2, th / 2);
                    });
                } else if (wg === pickerBg) {
                    lastPickerBgKey = '';
                    drawPickerCard(pickerBg.w, pickerBg.h);
                } else {
                    wg.drawText(wg.text, wg.subtext);
                }
            }
            if (levelPickerOpen) layoutPickerCells();
        }
        const pos = levels.indexOf(String(lastUi.levelId));
        btnPrevLevel.uniforms.uDisabled.value = pos <= 0 ? 1 : 0;
        btnNextLevel.uniforms.uDisabled.value = pos >= levels.length - 1 ? 1 : 0;
        btnLevelBadge.drawText(`第 ${lastUi.levelId} 关 ▾`, lastUi.freeMode ? '自由试玩' : '');
        pillRemain.drawText(`剩余 ${lastUi.remaining} 只`);
        pillMech.drawText(lastUi.ropeText || '点击小猪滑出棋盘');
        lblStatus.drawText(lastUi.statusText || lastUi.stepText, '', null, lastUi.statusKind === 'warn' ? 'danger' : 'cream');
        btnHint.uniforms.uActive.value = lastUi.hintChecked ? 1 : 0;
        btnHint.uniforms.uDisabled.value = lastUi.hintDisabled ? 1 : 0;
        btnHint.drawText('💡 提示', '', null, lastUi.hintChecked ? 'gold' : 'cream');
        btnPrevStep.uniforms.uDisabled.value = lastUi.canPrev ? 0 : 1;
        btnNextStep.uniforms.uDisabled.value = lastUi.canNext ? 0 : 1;
        btnUndo.uniforms.uDisabled.value = lastUi.canUndo ? 0 : 1;
        sliderBar.uniforms.uDisabled.value = lastUi.hasSteps ? 0 : 1;
        lblProgress.drawText(lastUi.progressText);
        drawSlider();
        drawClockDial();
        qualityBtns.forEach(b => {
            const act = b.mesh.userData.payload === lastUi.quality;
            b.uniforms.uActive.value = act ? 1 : 0;
            b.drawText(b.text, '', null, act ? 'gold' : 'cream');
        });
        btnMusic.drawText(`♪ 音乐:${lastUi.music ? '开' : '关'}`, '', null, lastUi.music ? 'green' : 'cream');
        btnSfx.drawText(`🔊 音效:${lastUi.sfx ? '开' : '关'}`, '', null, lastUi.sfx ? 'green' : 'cream');
        btnTime.drawText(`☀ 天光:${lastUi.timeCycle ? '流' : '定'}`, '', null, lastUi.timeCycle ? 'sky' : 'cream');
        btnToggle2d.drawText('☰ 2D控件', '', null, lastUi.show2dControls ? 'coral' : 'cream');

        const showModal = Boolean(lastUi.won || lastUi.failed);
        modalBackdrop.position.z = showModal ? 11 : 7;
        modalBackdrop.renderOrder = showModal ? 111 : 107;
        modalBackdrop.visible = showModal || settingsOpen;
        allModalWidgets.forEach(wg => wg.setVisible(showModal));
        if (lastUi.failed) {
            drawModalCard();
            modalBtn1.mesh.userData.action = 'undo';
            modalBtn1.drawText('撤回一步', '', null, 'cream');
            modalBtn2.mesh.userData.action = 'reset';
            modalBtn2.drawText('重新开始', '', null, 'coral');
        } else if (lastUi.won) {
            drawModalCard();
            modalBtn1.mesh.userData.action = 'reset';
            modalBtn1.drawText('再玩一次', '', null, 'cream');
            modalBtn2.mesh.userData.action = 'nextLevel';
            modalBtn2.drawText('下一关 ›', '', null, 'coral');
        }
        if (levelPickerOpen) layoutPickerCells();
        const showGuide = Boolean(lastUi.guideText) && !levelPickerOpen && !settingsOpen && !lastUi.won && !lastUi.failed;
        guideBanner.setVisible(showGuide);
        if (showGuide) guideBanner.drawText(lastUi.guideText, '', null, 'gold');
    }

    let draggingSlider = false;
    const isModalOpen = () => Boolean(lastUi.won || lastUi.failed);

    function hitWidget(clientX, clientY) {
        const ux = clientX;
        const uy = viewH - clientY;
        const modalOnly = isModalOpen();
        for (const m of hitTargets) {
            if (!m.visible) continue;
            if (modalOnly && m !== modalBtn1.mesh && m !== modalBtn2.mesh) continue;
            if (!modalOnly && settingsOpen && m.userData.z < 8) continue;
            if (m.userData.action === 'pickLevel') {
                if (ux < pickerMaskBounds.left || ux > pickerMaskBounds.right || uy < pickerMaskBounds.bottom || uy > pickerMaskBounds.top) {
                    continue;
                }
            }
            if (Math.abs(ux - m.position.x) <= m.userData.w * 0.5 && Math.abs(uy - m.position.y) <= m.userData.h * 0.5) {
                return m;
            }
        }
        return null;
    }

    function seekFromPointer(clientX) {
        if (!lastUi.hasSteps || lastUi.totalSteps <= 0) return;
        const m = sliderBar.mesh;
        const left = m.position.x - m.userData.w / 2 + 12;
        const span = Math.max(1, m.userData.w - 24);
        const ratio = THREE.MathUtils.clamp((clientX - left) / span, 0, 1);
        onAction('seek', Math.round(ratio * lastUi.totalSteps));
    }

    function handlePointerDown(clientX, clientY) {
        const hit = hitWidget(clientX, clientY);
        if (!hit) {
            if (isModalOpen()) return true;
            if (levelPickerOpen || settingsOpen) {
                levelPickerOpen = false;
                settingsOpen = false;
                layout();
                return true;
            }
            return false;
        }
        const { action } = hit.userData;
        if (action === 'seekDrag') {
            if (!lastUi.hasSteps) return true;
            draggingSlider = true;
            seekFromPointer(clientX);
            return true;
        }
        if (levelPickerOpen && (action === 'pickerScroll' || action === 'pickLevel')) {
            pickerDragging = true;
            pickerDragMoved = false;
            pickerLastY = clientY;
            pickerVel = 0;
            return true;
        }
        return true;
    }

    function handlePointerMove(clientX, clientY) {
        if (draggingSlider) {
            seekFromPointer(clientX);
            return true;
        }
        if (pickerDragging) {
            const dy = clientY - pickerLastY;
            pickerLastY = clientY;
            if (Math.abs(dy) > 2) pickerDragMoved = true;
            const cellH = Math.max(24, (pickerBg.h - 86) / PICK_ROWS_VISIBLE);
            pickerScroll -= dy / cellH;
            if (dy !== 0) {
                const instVel = (-dy / cellH) * 52;
                pickerVel = THREE.MathUtils.clamp(pickerVel * 0.35 + instVel * 0.65, -96, 96);
            }
            layoutPickerCells();
            return true;
        }
        const hit = hitWidget(clientX, clientY);
        for (const w of widgets) {
            const allowHover = w.name !== 'pickerBg' && w.theme !== 'card';
            w.uniforms.uHover.value = allowHover && hit && hit === w.mesh ? 1 : 0;
        }
        return isModalOpen() || Boolean(hit);
    }

    function handlePointerUp(clientX, clientY) {
        if (draggingSlider) {
            draggingSlider = false;
            return true;
        }
        if (pickerDragging) {
            pickerDragging = false;
            if (pickerDragMoved) return true;
        }
        const hit = hitWidget(clientX, clientY);
        if (!hit) return isModalOpen();
        const wg = byName.get(hit.userData.name);
        if (wg && wg.uniforms.uDisabled.value > 0.5) return true;
        const { action, payload } = hit.userData;
        const actionMap = {
            toggleSettings() { settingsOpen = !settingsOpen; levelPickerOpen = false; layout(); },
            togglePicker() { levelPickerOpen = !levelPickerOpen; settingsOpen = false; layout(); },
            pickerStep() { pickerScroll += payload; pickerVel = 0; layoutPickerCells(); },
            pickLevel() { levelPickerOpen = false; onAction('level', payload); },
            clockDial() {
                const pick = resolveClockSector(clientX, clientY);
                if (!pick) return;
                if (pick.kind === 'center') {
                    onTimeToggle();
                    return;
                }
                if (pick.ring.key === 'timeSlot') {
                    onTimeSlot?.(pick.val);
                } else {
                    onEnvChange(pick.ring.key, pick.val);
                }
            },
            quality() { onQualityChange(payload); },
            music() { onAudioToggle('music'); },
            sfx() { onAudioToggle('sfx'); },
            timeCycle() { onTimeToggle(); },
            camReset() { onCamReset(); }
        };
        if (actionMap[action]) actionMap[action]();
        else if (action && action !== 'pickerScroll' && action !== 'settingsModal') onAction(action, payload);
        return true;
    }

    function handleWheel(deltaY, clientX, clientY) {
        if (isModalOpen() || settingsOpen) return true;
        if (!levelPickerOpen) return false;
        const ux = clientX, uy = viewH - clientY;
        const m = pickerBg.mesh;
        if (Math.abs(ux - m.position.x) <= pickerBg.w / 2 && Math.abs(uy - m.position.y) <= pickerBg.h / 2) {
            pickerScroll += deltaY * 0.008;
            pickerVel = THREE.MathUtils.clamp(pickerVel + deltaY * 0.065, -96, 96);
            layoutPickerCells();
            return true;
        }
        return false;
    }

    function resize(w, h) {
        viewW = Math.max(1, Number.isFinite(w) ? w : (window.innerWidth || 1280));
        viewH = Math.max(1, Number.isFinite(h) ? h : (window.innerHeight || 720));
        layout();
        sync(lastUi);
    }

    function update(dt, time, _yawOffset = 0, liveDayPhase = null) {
        const safeDt = Number.isFinite(dt) && dt > 0 ? Math.min(0.25, dt) : 0;
        const safeTime = Number.isFinite(time) ? time : 0;
        revealTime = Math.min(1, revealTime + safeDt * 3.5);
        if (settingsOpen && Number.isFinite(liveDayPhase)) {
            lastUi.dayPhase = liveDayPhase;
            drawClockDial(liveDayPhase);
        }
        if (levelPickerOpen && !pickerDragging && Math.abs(pickerVel) > 0.01) {
            pickerScroll += pickerVel * safeDt;
            pickerVel *= Math.pow(0.24, safeDt);
            layoutPickerCells();
        }
        const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        root.position.y = reduce ? 0 : Math.sin(safeTime * 1.8) * 1.6;
        // 保持正交 HUD 与屏幕平行，避免移动端旋转视角产生 root.rotation.y 导致的裁剪/精度消失问题
        root.rotation.y = 0;
        for (const w of widgets) {
            w.uniforms.uTime.value = safeTime;
            w.uniforms.uReveal.value = revealTime;
            if (!reduce && w.name === 'guide-banner' && w.visible) {
                const gs = 1 + Math.sin(safeTime * 4.2) * 0.035;
                const sw = w.baseW * gs, sh = w.baseH * gs;
                w.mesh.scale.set(sw, sh, 1);
                w.uniforms.uSelfRect.value.z = sw;
                w.uniforms.uSelfRect.value.w = sh;
            } else if (!reduce && w.mesh.userData.action && w.name !== 'pickerBg' && w.name !== 'settingsBg' && w.name !== 'clock-dial' && w.theme !== 'card') {
                const s = 1 + w.uniforms.uHover.value * 0.055;
                const sw = w.baseW * s, sh = w.baseH * s;
                w.mesh.scale.set(sw, sh, 1);
                w.uniforms.uSelfRect.value.z = sw;
                w.uniforms.uSelfRect.value.w = sh;
            }
        }
    }

    function render(renderer) {
        renderer.clearDepth();
        renderer.render(uiScene, uiCam);
    }

    function getButtonScreen(name) {
        const dialSector = DIAL_SECTOR_MAP.get(name);
        if (dialSector) {
            if (!clockDial.mesh.visible) return null;
            const s = clockDial.w / DIAL_SIZE;
            const step = (Math.PI * 2) / dialSector.ring.items.length;
            const cwA = dialSector.idx * step;
            const ux = clockDial.mesh.position.x + Math.sin(cwA) * dialSector.ring.hitMid * s;
            const uy = clockDial.mesh.position.y + Math.cos(cwA) * dialSector.ring.hitMid * s;
            return { x: ux, y: viewH - uy };
        }
        const wg = byName.get(name);
        if (!wg || !wg.mesh.visible) return null;
        return { x: wg.mesh.position.x, y: viewH - wg.mesh.position.y };
    }

    function getSafeMargins() {
        const compact = viewW < 520 || viewH < 520;
        const landscape = viewW > viewH && viewW >= 560;
        const rightColW = landscape ? Math.min(370, Math.max(290, Math.round(viewW * 0.36))) + 24 : 16;
        return {
            top: landscape ? 16 : (compact ? 86 : 96),
            bottom: landscape ? 16 : (compact ? 112 : 122),
            right: rightColW,
            left: 16
        };
    }

    resize(window.innerWidth || 1280, window.innerHeight || 720);

    return {
        sync,
        resize,
        update,
        render,
        handlePointerDown,
        handlePointerMove,
        handlePointerUp,
        handleWheel,
        getButtonScreen,
        getSafeMargins,
        getUiSkinKey,
        getClockDialSize: () => ({ w: clockDial.w, h: clockDial.h }),
        hasModalBackdrop: () => modalBackdrop.visible,
        setVisible(v) { root.visible = Boolean(v); },
        dispose() {
            svgImgCache.clear();
            for (const d of disposables) d?.dispose?.();
        }
    };
}
