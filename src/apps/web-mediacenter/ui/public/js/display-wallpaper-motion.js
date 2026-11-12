/* 从网页含重力加速度估计短时设备轴运动，不读取角速度或平台线性加速度。 */
(function (root) {
    'use strict';
    const gravity = 9.80665;
    const gravityTimeConstant = 0.8;
    root.createWallpaperMotionEstimator = function () {
        let baseline = null, previous = null;
        function reset() { baseline = null; previous = null; }
        function sample(event, now) {
            const a = event.accelerationIncludingGravity;
            if (!a || ![a.x, a.y, a.z, now].every(Number.isFinite)) return null;
            const force = [a.x, a.y, a.z], magnitude = Math.hypot(...force);
            if (magnitude > 40 || magnitude < 1) return null;
            if (baseline && (now < previous || now - previous > 150)) reset();
            if (!baseline) {
                // 启动或中断后用近似静止的样本建立重力基线，避免把瞬时大加速度当作重力。
                if (Math.abs(magnitude - gravity) > 1.5) return null;
                baseline = force.slice();
                previous = now;
                return [0, 0, 0];
            }
            const dt = (now - previous) / 1000;
            previous = now;
            const weight = 1 - Math.exp(-dt / gravityTimeConstant);
            return force.map((value, index) => {
                // 缓慢更新重力，保留短时变化；只靠加速度无法消除快速转动产生的瞬态。
                baseline[index] += (value - baseline[index]) * weight;
                return value - baseline[index];
            });
        }
        return { sample, reset };
    };
})(typeof window !== 'undefined' ? window : globalThis);
