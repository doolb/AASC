/* 根据网页六轴数据计算短时运动：姿态积分后去除重力，不依赖线性加速度。 */
(function (root) {
    'use strict';
    const gravity = 9.80665;
    const multiply = (a, b) => [
        a[3]*b[0]+a[0]*b[3]+a[1]*b[2]-a[2]*b[1],
        a[3]*b[1]-a[0]*b[2]+a[1]*b[3]+a[2]*b[0],
        a[3]*b[2]+a[0]*b[1]-a[1]*b[0]+a[2]*b[3],
        a[3]*b[3]-a[0]*b[0]-a[1]*b[1]-a[2]*b[2]
    ];
    const normalize = q => { const n = Math.hypot(...q); return q.map(v => v / n); };
    const rotate = (q, v) => multiply(multiply(q, [...v, 0]), [-q[0], -q[1], -q[2], q[3]]).slice(0, 3);
    const step = (gyro, dt) => {
        const speed = Math.hypot(...gyro);
        if (speed < 0.0035) return [0, 0, 0, 1];
        const scale = Math.sin(speed * dt / 2) / speed;
        return [gyro[0]*scale, gyro[1]*scale, gyro[2]*scale, Math.cos(speed*dt/2)];
    };
    root.createWallpaperMotionEstimator = function () {
        let q = null, previous = null;
        function reset() { q = null; previous = null; }
        function sample(event, now) {
            const a = event.accelerationIncludingGravity, r = event.rotationRate;
            if (!a || !r || ![a.x,a.y,a.z,r.beta,r.gamma,r.alpha,now].every(Number.isFinite)) return null;
            const force = [a.x,a.y,a.z], magnitude = Math.hypot(...force);
            if (magnitude > 40 || magnitude < 1) return null;
            if (q && (now < previous || now - previous > 150)) reset();
            if (!q) {
                if (Math.abs(magnitude - gravity) > 1.5) return null;
                const [x,y,z] = force.map(value => value / magnitude);
                // 将静止时测得的重力方向旋转到世界上轴，反向时选取稳定的垂直轴。
                q = y < -0.999999 ? [1,0,0,0] : normalize([-z,0,x,1+y]);
                previous = now;
                return [0,0,0];
            }
            const dt = (now - previous) / 1000;
            previous = now;
            const gyro = [r.beta,r.gamma,r.alpha].map(value => value * Math.PI / 180);
            if (Math.hypot(...gyro) > 35) { reset(); return null; }
            const midpoint = normalize(multiply(q, step(gyro, dt / 2)));
            const world = rotate(midpoint, force);
            world[1] -= gravity;
            const linear = rotate([-midpoint[0],-midpoint[1],-midpoint[2],midpoint[3]], world);
            q = normalize(multiply(q, step(gyro, dt)));
            return linear;
        }
        return { sample, reset };
    };
})(typeof window !== 'undefined' ? window : globalThis);
