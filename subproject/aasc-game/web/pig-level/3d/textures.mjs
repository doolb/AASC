// 程序纹理：全部由 Canvas 与种子化噪声生成，不加载任何外部图片。
import * as THREE from '../vendor/three.module.min.js';
import { seededRandom } from './presets.mjs?v=20261123c';

// 二维 value noise（带平滑插值），用于 fbm 与色斑。
export function createNoise2D(seed = 1) {
    const rand = seededRandom(seed);
    const size = 256;
    const table = new Float32Array(size * size);
    for (let i = 0; i < table.length; i++) table[i] = rand();
    const smooth = t => t * t * (3 - 2 * t);
    return (x, y) => {
        const xi = Math.floor(x), yi = Math.floor(y);
        const xf = smooth(x - xi), yf = smooth(y - yi);
        const at = (ix, iy) => table[((iy & 255) * size) + (ix & 255)];
        const a = at(xi, yi), b = at(xi + 1, yi), c = at(xi, yi + 1), d = at(xi + 1, yi + 1);
        return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
    };
}

// 分形噪声：多倍频叠加，返回 0～1。
export function fbm(noise, x, y, octaves = 4) {
    let sum = 0, amp = 0.5, freq = 1, norm = 0;
    for (let i = 0; i < octaves; i++) {
        sum += noise(x * freq, y * freq) * amp;
        norm += amp;
        amp *= 0.5;
        freq *= 2.03;
    }
    return sum / norm;
}

function makeCanvas(w, h) {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    return [canvas, canvas.getContext('2d')];
}

function toTexture(canvas, { repeat = false, srgb = true, nearest = false } = {}) {
    const texture = new THREE.CanvasTexture(canvas);
    if (srgb) texture.colorSpace = THREE.SRGBColorSpace;
    if (repeat) texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    if (nearest) {
        texture.magFilter = THREE.NearestFilter;
        texture.minFilter = THREE.NearestFilter;
        texture.generateMipmaps = false;
    } else {
        texture.anisotropy = 4;
    }
    texture.needsUpdate = true;
    return texture;
}

// 用像素回调填充 ImageData，回调返回 [r,g,b,a]（0～255）。
function paintPixels(ctx, w, h, fn) {
    const image = ctx.createImageData(w, h);
    const data = image.data;
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const c = fn(x, y);
            const i = (y * w + x) * 4;
            data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2]; data[i + 3] = c[3] ?? 255;
        }
    }
    ctx.putImageData(image, 0, 0);
}

// 可平铺噪声：在环面上采样以保证四边连续。
function tileable(noise, x, y, size, scale, octaves) {
    const u = x / size, v = y / size;
    const a = fbm(noise, u * scale, v * scale, octaves);
    const b = fbm(noise, (u - 1) * scale, v * scale, octaves);
    const c = fbm(noise, u * scale, (v - 1) * scale, octaves);
    const d = fbm(noise, (u - 1) * scale, (v - 1) * scale, octaves);
    return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

// 画笔短笔触，模仿水粉刷痕。
function brushStrokes(ctx, size, count, rand, palette, alpha, minLen, maxLen, width) {
    ctx.lineCap = 'round';
    for (let i = 0; i < count; i++) {
        const x = rand() * size, y = rand() * size;
        const len = minLen + rand() * (maxLen - minLen);
        const ang = -0.6 + rand() * 1.2 + (rand() < 0.5 ? 0 : Math.PI);
        ctx.strokeStyle = palette[Math.floor(rand() * palette.length)];
        ctx.globalAlpha = alpha * (0.5 + rand() * 0.5);
        ctx.lineWidth = width * (0.6 + rand() * 0.8);
        const dx = Math.cos(ang) * len, dy = Math.sin(ang) * len;
        const cx = Math.cos(ang) * len * 0.5 + (rand() - 0.5) * 3, cy = Math.sin(ang) * len * 0.5;
        const oxList = x < maxLen ? [0, size] : x > size - maxLen ? [0, -size] : [0];
        const oyList = y < maxLen ? [0, size] : y > size - maxLen ? [0, -size] : [0];
        for (const ox of oxList) {
            for (const oy of oyList) {
                ctx.beginPath();
                ctx.moveTo(x + ox, y + oy);
                ctx.quadraticCurveTo(x + ox + cx, y + oy + cy, x + ox + dx, y + oy + dy);
                ctx.stroke();
            }
        }
    }
    ctx.globalAlpha = 1;
}

export function createTextureLibrary(tier = 'high') {
    const scale = tier === 'low' ? 0.5 : 1;
    const cache = new Map();
    const noise = createNoise2D(7);
    const noise2 = createNoise2D(31);
    const once = (key, factory) => {
        if (!cache.has(key)) cache.set(key, factory());
        return cache.get(key);
    };

    const lib = {
        noise,
        // 共享噪声贴图：RGBA 四个通道分别是不同频率的可平铺噪声，供着色器风场、云影、色斑使用。
        noiseMap: () => once('noiseMap', () => {
            const size = 128;
            const data = new Uint8Array(size * size * 4);
            for (let y = 0; y < size; y++) {
                for (let x = 0; x < size; x++) {
                    const i = (y * size + x) * 4;
                    data[i] = tileable(noise, x, y, size, 4, 3) * 255;
                    data[i + 1] = tileable(noise2, x, y, size, 8, 3) * 255;
                    data[i + 2] = tileable(noise, x + 37, y + 91, size, 2, 4) * 255;
                    data[i + 3] = tileable(noise2, x + 11, y + 53, size, 16, 2) * 255;
                }
            }
            const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
            texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
            texture.magFilter = THREE.LinearFilter;
            texture.minFilter = THREE.LinearMipmapLinearFilter;
            texture.generateMipmaps = true;
            texture.needsUpdate = true;
            return texture;
        }),
        // 地面：高亮度水粉刷痕图（基础亮度 236，完整保留季节草坪高饱和色调）。
        ground: () => once('ground', () => {
            const size = Math.round(512 * scale);
            const [canvas, ctx] = makeCanvas(size, size);
            paintPixels(ctx, size, size, (x, y) => {
                const n = tileable(noise, x, y, size, 6, 4);
                const m = tileable(noise2, x, y, size, 18, 2);
                const v = Math.min(255, 234 + (n - 0.5) * 44 + (m - 0.5) * 18);
                return [v, v, v * 0.98, 255];
            });
            const rand = seededRandom(99);
            brushStrokes(ctx, size, Math.round(4800 * scale), rand, ['#ffffff', '#f5f8ee', '#d8e3ce', '#e7eedd'], 0.28, 5 * scale, 16 * scale, 2.6 * scale);
            return toTexture(canvas, { repeat: true });
        }),
        // 棋盘草坪：高亮度修剪条纹 + 柔和水粉刷痕。
        lawn: () => once('lawn', () => {
            const size = Math.round(512 * scale);
            const [canvas, ctx] = makeCanvas(size, size);
            paintPixels(ctx, size, size, (x, y) => {
                const stripe = Math.floor(y / (size / 8)) % 2 ? 1 : 0;
                const n = tileable(noise2, x, y, size, 10, 3);
                const v = Math.min(255, 232 + stripe * 16 + (n - 0.5) * 26);
                return [v, v, v * 0.98, 255];
            });
            const rand = seededRandom(5);
            brushStrokes(ctx, size, Math.round(2800 * scale), rand, ['#ffffff', '#eef4e6', '#d8e2cc'], 0.2, 3 * scale, 8 * scale, 1.8 * scale);
            return toTexture(canvas, { repeat: true });
        }),
        // 石板：fbm + 裂纹 + 苔藓斑（彩色）。
        stone: () => once('stone', () => {
            const size = Math.round(256 * scale);
            const [canvas, ctx] = makeCanvas(size, size);
            paintPixels(ctx, size, size, (x, y) => {
                const n = tileable(noise, x * 1.3, y * 1.3, size, 5, 4);
                const crack = Math.abs(tileable(noise2, x, y, size, 6, 2) - 0.5) < 0.012 ? -40 : 0;
                const moss = Math.max(0, tileable(noise2, x + 50, y, size, 3, 3) - 0.6) * 3;
                const v = 175 + (n - 0.5) * 90 + crack;
                return [v * (1 - moss * 0.4), v * (1 - moss * 0.1), v * (0.95 - moss * 0.45), 255];
            });
            return toTexture(canvas, { repeat: true });
        }),
        // 木纹：拉伸噪声年轮 + 板缝（灰度偏暖）。
        wood: () => once('wood', () => {
            const size = Math.round(256 * scale);
            const [canvas, ctx] = makeCanvas(size, size);
            paintPixels(ctx, size, size, (x, y) => {
                const n = tileable(noise, x * 0.3, y * 4, size, 3, 3);
                const ring = Math.sin((x / size) * 60 + n * 14) * 0.5 + 0.5;
                const seam = (y % Math.round(size / 4)) < 2 ? -60 : 0;
                const v = 175 + ring * 45 + (n - 0.5) * 30 + seam;
                return [v, v * 0.92, v * 0.82, 255];
            });
            return toTexture(canvas, { repeat: true });
        }),
        // 远山剪影：三层，透明背景，山脊顶部带笔触高光，底部渐隐。
        mountain: layer => once(`mountain${layer}`, () => {
            const w = Math.round(1024 * scale), h = Math.round(256 * scale);
            const [canvas, ctx] = makeCanvas(w, h);
            const rand = seededRandom(200 + layer);
            const base = [0.5, 0.42, 0.34][layer];
            const amp = [0.36, 0.3, 0.24][layer];
            const ridge = new Float32Array(w);
            for (let x = 0; x < w; x++) {
                const u = x / w;
                let v = base + amp * (fbm(noise, u * (5 + layer * 3) + layer * 10, layer * 3.3, 5) - 0.5) * 2;
                v += Math.sin(u * Math.PI * 2 * (2 + layer)) * 0.05;
                // 首尾平滑过渡，避免圆柱接缝。
                const edge = Math.min(u, 1 - u);
                if (edge < 0.04) v = v * (edge / 0.04) + (base * 0.6) * (1 - edge / 0.04);
                ridge[x] = h * (1 - v);
            }
            const grad = ctx.createLinearGradient(0, 0, 0, h);
            grad.addColorStop(0, 'rgba(255,255,255,1)');
            grad.addColorStop(0.75, 'rgba(225,230,240,1)');
            grad.addColorStop(1, 'rgba(210,218,232,0)');
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.moveTo(0, h);
            for (let x = 0; x < w; x++) ctx.lineTo(x, ridge[x]);
            ctx.lineTo(w, h);
            ctx.closePath();
            ctx.fill();
            // 山体笔触明暗。
            ctx.save();
            ctx.globalCompositeOperation = 'source-atop';
            for (let i = 0; i < 900 * scale; i++) {
                const x = rand() * w;
                const y = ridge[Math.floor(x)] + rand() * (h - ridge[Math.floor(x)]) * 0.7;
                ctx.strokeStyle = rand() < 0.5 ? 'rgba(160,170,195,0.18)' : 'rgba(255,255,255,0.25)';
                ctx.lineWidth = 2 + rand() * 4;
                ctx.beginPath();
                ctx.moveTo(x, y);
                ctx.lineTo(x + (rand() - 0.5) * 30, y + 6 + rand() * 14);
                ctx.stroke();
            }
            // 山顶雪线（冬季通过颜色增强）。
            ctx.fillStyle = 'rgba(255,255,255,0.5)';
            for (let x = 0; x < w; x += 2) {
                if (ridge[x] < h * (0.55 - layer * 0.08)) ctx.fillRect(x, ridge[x], 2, 6 + rand() * 8);
            }
            ctx.restore();
            return toTexture(canvas);
        }),
        // 粒子贴图图集：2×2（圆点、花瓣、叶片、雪花）。
        particleAtlas: () => once('particleAtlas', () => {
            const size = 128, half = 64;
            const [canvas, ctx] = makeCanvas(size, size);
            // 0：柔和圆点
            const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 30);
            g.addColorStop(0, 'rgba(255,255,255,1)');
            g.addColorStop(0.5, 'rgba(255,255,255,0.8)');
            g.addColorStop(1, 'rgba(255,255,255,0)');
            ctx.fillStyle = g;
            ctx.fillRect(0, 0, half, half);
            // 1：花瓣
            ctx.fillStyle = '#fff';
            ctx.beginPath();
            ctx.ellipse(96, 32, 12, 24, 0.3, 0, Math.PI * 2);
            ctx.fill();
            // 2：叶片（带叶脉）
            ctx.beginPath();
            ctx.moveTo(32, 70);
            ctx.quadraticCurveTo(56, 96, 32, 124);
            ctx.quadraticCurveTo(8, 96, 32, 70);
            ctx.fill();
            ctx.strokeStyle = 'rgba(0,0,0,0.25)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(32, 72);
            ctx.lineTo(32, 122);
            ctx.stroke();
            // 3：雪花（六角）
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 3;
            ctx.lineCap = 'round';
            for (let k = 0; k < 6; k++) {
                const a = k * Math.PI / 3;
                ctx.beginPath();
                ctx.moveTo(96, 96);
                ctx.lineTo(96 + Math.cos(a) * 24, 96 + Math.sin(a) * 24);
                ctx.stroke();
            }
            const g2 = ctx.createRadialGradient(96, 96, 0, 96, 96, 10);
            g2.addColorStop(0, 'rgba(255,255,255,1)');
            g2.addColorStop(1, 'rgba(255,255,255,0)');
            ctx.fillStyle = g2;
            ctx.fillRect(80, 80, 32, 32);
            return toTexture(canvas, { srgb: true });
        }),
        // 卡通明暗 4 阶暖色渐变图：压深暗部并提亮受光面，显著拉大树木/木屋/配件明暗反差。
        gradient3: () => once('gradient3', () => {
            const data = new Uint8Array([
                46, 34, 38, 255,
                104, 82, 82, 255,
                222, 208, 192, 255,
                255, 253, 240, 255
            ]);
            const texture = new THREE.DataTexture(data, 4, 1, THREE.RGBAFormat);
            texture.magFilter = THREE.NearestFilter;
            texture.minFilter = THREE.NearestFilter;
            texture.generateMipmaps = false;
            texture.needsUpdate = true;
            return texture;
        }),
        // 数字/文字标签牌，按文本与样式缓存（LRU 64）。
        label: (text, style = 'gold') => {
            const key = `label:${style}:${text}`;
            if (cache.has(key)) {
                const hit = cache.get(key);
                cache.delete(key);
                cache.set(key, hit);
                return hit;
            }
            const styles = {
                gold: { bg: '#f2b836', edge: '#8a5a12', fg: '#ffffff', stroke: '#7a4a10' },
                red: { bg: '#c9412f', edge: '#5e1d14', fg: '#ffffff', stroke: '#5e1d14' },
                timer: { bg: '#231f22', edge: '#c83728', fg: '#ff5b45', stroke: '#2a0b08' },
                steel: { bg: 'rgba(40,52,72,0.82)', edge: '#cfe0f2', fg: '#ffffff', stroke: '#1b2433' }
            };
            const s = styles[style] || styles.gold;
            const [canvas, ctx] = makeCanvas(160, 96);
            const r = 26;
            ctx.fillStyle = s.bg;
            ctx.strokeStyle = s.edge;
            ctx.lineWidth = 7;
            ctx.beginPath();
            ctx.roundRect(8, 8, 144, 80, r);
            ctx.fill();
            ctx.stroke();
            ctx.font = '900 58px system-ui, "Noto Sans SC", sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.lineWidth = 8;
            ctx.strokeStyle = s.stroke;
            ctx.strokeText(text, 80, 51);
            ctx.fillStyle = s.fg;
            ctx.fillText(text, 80, 51);
            const texture = toTexture(canvas);
            cache.set(key, texture);
            // 超过上限时淘汰最早使用的标签。
            const labels = [...cache.keys()].filter(k => k.startsWith('label:'));
            if (labels.length > 64) {
                const old = cache.get(labels[0]);
                old.dispose();
                cache.delete(labels[0]);
            }
            return texture;
        },
        // 手绘 5 瓣星形小花精灵图（白色细描边花瓣 + 金黄花蕊，供 instanceColor 染色）。
        flowerSprite: () => once('flowerSprite', () => {
            const size = 128, c = size / 2;
            const [canvas, ctx] = makeCanvas(size, size);
            ctx.save();
            ctx.translate(c, c);
            ctx.lineJoin = 'round';
            for (let i = 0; i < 5; i++) {
                ctx.save();
                ctx.rotate((i * Math.PI * 2) / 5);
                ctx.beginPath();
                ctx.moveTo(0, -10);
                ctx.quadraticCurveTo(17, -26, 0, -54);
                ctx.quadraticCurveTo(-17, -26, 0, -10);
                ctx.closePath();
                const grad = ctx.createLinearGradient(0, -10, 0, -54);
                grad.addColorStop(0, '#f3f3ee');
                grad.addColorStop(1, '#ffffff');
                ctx.fillStyle = grad;
                ctx.fill();
                ctx.strokeStyle = 'rgba(38, 42, 34, 0.85)';
                ctx.lineWidth = 2.4;
                ctx.stroke();
                ctx.restore();
            }
            // 金黄花蕊与高光点
            ctx.beginPath();
            ctx.arc(0, 0, 12, 0, Math.PI * 2);
            ctx.fillStyle = '#ffd046';
            ctx.fill();
            ctx.strokeStyle = 'rgba(130, 82, 18, 0.85)';
            ctx.lineWidth = 2.2;
            ctx.stroke();
            ctx.beginPath();
            ctx.arc(-3.5, -3.5, 3.2, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(255, 252, 232, 0.9)';
            ctx.fill();
            ctx.restore();
            const tex = toTexture(canvas);
            tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
            return tex;
        }),
        // 地面贴花式提示环纹理：鲜艳红色光晕 + 虚线目标圈 + 朝向角标（用于表面贴花）。
        hintDecal: () => once('hintDecal', () => {
            const size = 256, c = size / 2;
            const [canvas, ctx] = makeCanvas(size, size);
            const g = ctx.createRadialGradient(c, c, 24, c, c, 120);
            g.addColorStop(0, 'rgba(255, 42, 58, 0.34)');
            g.addColorStop(0.55, 'rgba(255, 32, 48, 0.56)');
            g.addColorStop(0.84, 'rgba(235, 18, 36, 0.32)');
            g.addColorStop(1, 'rgba(235, 18, 36, 0)');
            ctx.fillStyle = g;
            ctx.fillRect(0, 0, size, size);
            // 外圈鲜红高亮虚线环
            ctx.save();
            ctx.translate(c, c);
            ctx.strokeStyle = 'rgba(255, 58, 72, 0.98)';
            ctx.lineWidth = 10;
            ctx.setLineDash([22, 14]);
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.arc(0, 0, 96, 0, Math.PI * 2);
            ctx.stroke();
            // 内圈鲜艳纯红实线
            ctx.setLineDash([]);
            ctx.strokeStyle = 'rgba(255, 20, 38, 0.98)';
            ctx.lineWidth = 7;
            ctx.beginPath();
            ctx.arc(0, 0, 74, 0, Math.PI * 2);
            ctx.stroke();
            // 四枚鲜红泛白高光指向角标
            ctx.fillStyle = '#ff283c';
            ctx.strokeStyle = '#fff5f5';
            ctx.lineWidth = 2.2;
            for (let k = 0; k < 4; k++) {
                ctx.save();
                ctx.rotate((k * Math.PI) / 2);
                ctx.beginPath();
                ctx.moveTo(0, -116);
                ctx.lineTo(-11, -101);
                ctx.lineTo(11, -101);
                ctx.closePath();
                ctx.fill();
                ctx.stroke();
                ctx.restore();
            }
            ctx.restore();
            return toTexture(canvas);
        }),
        dispose() {
            for (const value of cache.values()) value?.dispose?.();
            cache.clear();
        }
    };
    return lib;
}
