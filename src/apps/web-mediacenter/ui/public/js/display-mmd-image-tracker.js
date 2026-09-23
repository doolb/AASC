/* 显示端离线自然图片跟踪：局部角点、亮度归一化描述子和 RANSAC 单应矩阵。 */
(function exposeImageTargetTracker(root) {
    'use strict';

    const MAX_WIDTH = 320;
    const MAX_FEATURES = 240;
    const SAMPLE_OFFSETS = [-4, -2, 0, 2, 4];
    const MIN_MATCHES = 10;

    function createFrame(source) {
        const width = Math.max(1, Math.round(source.width || source.videoWidth || 1));
        const height = Math.max(1, Math.round(source.height || source.videoHeight || 1));
        const scale = Math.min(1, MAX_WIDTH / width);
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(width * scale));
        canvas.height = Math.max(1, Math.round(height * scale));
        const context = canvas.getContext('2d', { willReadFrequently: true });
        context.drawImage(source, 0, 0, canvas.width, canvas.height);
        const rgba = context.getImageData(0, 0, canvas.width, canvas.height).data;
        const gray = new Float32Array(canvas.width * canvas.height);
        for (let index = 0; index < gray.length; index += 1) {
            const offset = index * 4;
            gray[index] = rgba[offset] * 0.299 + rgba[offset + 1] * 0.587 + rgba[offset + 2] * 0.114;
        }
        return { gray, width: canvas.width, height: canvas.height, originalWidth: width, originalHeight: height };
    }

    function insideQuad(x, y, quad) {
        let sign = 0;
        for (let index = 0; index < 4; index += 1) {
            const start = quad[index];
            const end = quad[(index + 1) % 4];
            const cross = (end.x - start.x) * (y - start.y) - (end.y - start.y) * (x - start.x);
            if (Math.abs(cross) < 0.001) continue;
            const nextSign = Math.sign(cross);
            if (sign && nextSign !== sign) return false;
            sign = nextSign;
        }
        return true;
    }

    function describe(frame, x, y) {
        // 固定取角点周围 5×5 个采样点，减去均值并按能量归一化。
        // 这样同一印刷图在较亮或较暗的摄像头画面中仍可比较局部结构。
        const samples = [];
        let total = 0;
        for (const dy of SAMPLE_OFFSETS) {
            for (const dx of SAMPLE_OFFSETS) {
                const value = frame.gray[(y + dy) * frame.width + x + dx];
                samples.push(value);
                total += value;
            }
        }
        const mean = total / samples.length;
        let energy = 0;
        for (let index = 0; index < samples.length; index += 1) {
            samples[index] -= mean;
            energy += samples[index] * samples[index];
        }
        if (energy < 900) return null;
        const inverse = 1 / Math.sqrt(energy);
        return samples.map((value) => value * inverse);
    }

    function extractFeatures(frame, region = null) {
        // 将画面分格后保留各格最强角点，再做空间去重；避免大段文字只占满
        // 一小片区域，导致估计出的透视矩阵缺乏跨区域约束。
        const { gray, width, height } = frame;
        const cells = new Map();
        for (let y = 7; y < height - 7; y += 3) {
            for (let x = 7; x < width - 7; x += 3) {
                if (region && !insideQuad(x, y, region)) continue;
                const offset = y * width + x;
                const gx = gray[offset + 1] - gray[offset - 1];
                const gy = gray[offset + width] - gray[offset - width];
                const diagonal = gray[offset + width + 1] + gray[offset - width - 1]
                    - gray[offset + width - 1] - gray[offset - width + 1];
                const score = Math.min(Math.abs(gx) + Math.abs(diagonal), Math.abs(gy) + Math.abs(diagonal));
                if (score < 25) continue;
                const cell = `${Math.floor(x / 24)}:${Math.floor(y / 24)}`;
                const list = cells.get(cell) || [];
                list.push({ x, y, score });
                list.sort((left, right) => right.score - left.score);
                if (list.length > 4) list.pop();
                cells.set(cell, list);
            }
        }
        const separated = [];
        for (const point of [...cells.values()].flat().sort((left, right) => right.score - left.score)) {
            if (separated.some((other) => Math.hypot(point.x - other.x, point.y - other.y) < 7)) continue;
            separated.push(point);
            if (separated.length >= MAX_FEATURES) break;
        }
        return separated
            .map((point) => ({ ...point, descriptor: describe(frame, point.x, point.y) }))
            .filter((point) => point.descriptor);
    }

    function descriptorDistance(left, right) {
        let dot = 0;
        for (let index = 0; index < left.length; index += 1) dot += left[index] * right[index];
        return 1 - dot;
    }

    function matchFeatures(reference, current) {
        const candidates = [];
        for (const source of reference) {
            let best = null;
            let bestDistance = Infinity;
            let secondDistance = Infinity;
            for (const destination of current) {
                const distance = descriptorDistance(source.descriptor, destination.descriptor);
                if (distance < bestDistance) {
                    secondDistance = bestDistance;
                    bestDistance = distance;
                    best = destination;
                } else if (distance < secondDistance) {
                    secondDistance = distance;
                }
            }
            if (best && bestDistance < 0.36 && bestDistance < secondDistance * 0.78) {
                candidates.push({ source, destination: best, distance: bestDistance });
            }
        }
        candidates.sort((left, right) => left.distance - right.distance);
        const used = new Set();
        return candidates.filter((match) => {
            if (used.has(match.destination)) return false;
            used.add(match.destination);
            return true;
        });
    }

    function solveLinear(matrix, values) {
        const size = values.length;
        const rows = matrix.map((row, index) => [...row, values[index]]);
        for (let column = 0; column < size; column += 1) {
            let pivot = column;
            for (let row = column + 1; row < size; row += 1) {
                if (Math.abs(rows[row][column]) > Math.abs(rows[pivot][column])) pivot = row;
            }
            if (Math.abs(rows[pivot][column]) < 1e-8) return null;
            [rows[column], rows[pivot]] = [rows[pivot], rows[column]];
            const divisor = rows[column][column];
            for (let index = column; index <= size; index += 1) rows[column][index] /= divisor;
            for (let row = 0; row < size; row += 1) {
                if (row === column) continue;
                const factor = rows[row][column];
                for (let index = column; index <= size; index += 1) {
                    rows[row][index] -= factor * rows[column][index];
                }
            }
        }
        return rows.map((row) => row[size]);
    }

    function fitHomography(matches) {
        const normal = Array.from({ length: 8 }, () => Array(8).fill(0));
        const values = Array(8).fill(0);
        for (const match of matches) {
            const { x, y } = match.source;
            const { x: u, y: v } = match.destination;
            const equations = [
                [[x, y, 1, 0, 0, 0, -u * x, -u * y], u],
                [[0, 0, 0, x, y, 1, -v * x, -v * y], v]
            ];
            for (const [row, answer] of equations) {
                for (let a = 0; a < 8; a += 1) {
                    values[a] += row[a] * answer;
                    for (let b = 0; b < 8; b += 1) normal[a][b] += row[a] * row[b];
                }
            }
        }
        const solved = solveLinear(normal, values);
        return solved ? [...solved, 1] : null;
    }

    function project(matrix, point) {
        const divisor = matrix[6] * point.x + matrix[7] * point.y + 1;
        if (Math.abs(divisor) < 1e-6) return null;
        return {
            x: (matrix[0] * point.x + matrix[1] * point.y + matrix[2]) / divisor,
            y: (matrix[3] * point.x + matrix[4] * point.y + matrix[5]) / divisor
        };
    }

    function estimateHomography(matches) {
        if (matches.length < MIN_MATCHES) return null;
        // 自然图会产生错误匹配；重复抽取四对点求透视变换，只统计重投影误差
        // 小于五像素的匹配。最终使用全部内点重新拟合矩阵。
        let best = [];
        const iterations = Math.min(120, matches.length * 8);
        for (let iteration = 0; iteration < iterations; iteration += 1) {
            const sample = [];
            while (sample.length < 4) {
                const candidate = matches[Math.floor(Math.random() * matches.length)];
                if (!sample.includes(candidate)) sample.push(candidate);
            }
            const matrix = fitHomography(sample);
            if (!matrix) continue;
            const inliers = matches.filter((match) => {
                const point = project(matrix, match.source);
                return point && Math.hypot(
                    point.x - match.destination.x,
                    point.y - match.destination.y
                ) < 5;
            });
            if (inliers.length > best.length) best = inliers;
        }
        if (best.length < MIN_MATCHES || best.length / matches.length < 0.35) return null;
        return { matrix: fitHomography(best), confidence: best.length / matches.length };
    }

    async function loadReference(blob) {
        if (typeof root.createImageBitmap === 'function') return root.createImageBitmap(blob);
        const url = URL.createObjectURL(blob);
        try {
            const image = new Image();
            image.src = url;
            await image.decode();
            return image;
        } finally {
            URL.revokeObjectURL(url);
        }
    }

    async function start(target) {
        if (!target?.referenceImageBlob || !Array.isArray(target.selectedQuad)) {
            throw new Error('定位图数据不完整');
        }
        const image = await loadReference(target.referenceImageBlob);
        const reference = createFrame(image);
        image.close?.();
        const quad = target.selectedQuad.map((point) => ({
            x: point.x * reference.width,
            y: point.y * reference.height
        }));
        const features = extractFeatures(reference, quad);
        if (features.length < MIN_MATCHES) throw new Error('定位区域纹理不足，请选择文字或细节丰富的图片');
        let active = true;
        return {
            async processFrame(video) {
                if (!active || !video.videoWidth || !video.videoHeight) return { visible: false };
                const frame = createFrame(video);
                const current = extractFeatures(frame);
                const matches = matchFeatures(features, current);
                const estimate = estimateHomography(matches);
                if (!estimate?.matrix) return { visible: false };
                const corners = quad.map((point) => project(estimate.matrix, point));
                if (corners.some((point) => !point || !Number.isFinite(point.x) || !Number.isFinite(point.y))) {
                    return { visible: false };
                }
                const area = Math.abs(corners.reduce((sum, point, index) => {
                    const next = corners[(index + 1) % 4];
                    return sum + point.x * next.y - next.x * point.y;
                }, 0)) / 2;
                if (area < 250 || area > frame.width * frame.height * 1.4) return { visible: false };
                const center = project(estimate.matrix, {
                    x: quad.reduce((sum, point) => sum + point.x, 0) / 4,
                    y: quad.reduce((sum, point) => sum + point.y, 0) / 4
                });
                if (!center || !Number.isFinite(center.x) || !Number.isFinite(center.y)) {
                    return { visible: false };
                }
                const sourceWidth = Math.hypot(quad[1].x - quad[0].x, quad[1].y - quad[0].y);
                const imageWidth = Math.hypot(corners[1].x - corners[0].x, corners[1].y - corners[0].y);
                return {
                    visible: true,
                    confidence: estimate.confidence,
                    pose: {
                        x: center.x / frame.width,
                        y: center.y / frame.height,
                        width: imageWidth / frame.width,
                        scale: Math.max(0.2, Math.min(3, imageWidth / sourceWidth)),
                        rotation: Math.atan2(corners[1].y - corners[0].y, corners[1].x - corners[0].x),
                        videoAspect: frame.width / frame.height
                    }
                };
            },
            async stop() { active = false; }
        };
    }

    function mapPoseToCover(pose, video, layer) {
        // 背景视频用 object-fit: cover，裁掉的边缘也必须从锚点坐标中扣除，
        // 否则宽高比不同的手机上角色脚底会偏离实际基准图位置。
        const width = Math.max(1, layer.clientWidth);
        const height = Math.max(1, layer.clientHeight);
        const videoWidth = Math.max(1, video.videoWidth);
        const videoHeight = Math.max(1, video.videoHeight);
        const coverScale = Math.max(width / videoWidth, height / videoHeight);
        const renderedWidth = videoWidth * coverScale;
        const renderedHeight = videoHeight * coverScale;
        return {
            ...pose,
            x: (pose.x * renderedWidth - (renderedWidth - width) / 2) / width,
            y: (pose.y * renderedHeight - (renderedHeight - height) / 2) / height
        };
    }

    root.DisplayMmdImageTargetTracker = Object.freeze({ mapPoseToCover, start });
}(window));
