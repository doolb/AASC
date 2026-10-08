/** 浏览器返回平台处理后的数据；null不能伪装成静止样本。坐标独立于屏幕方向。 */
export function motionSample(event, time) {
    const gyro = event.rotationRate;
    const valid = value => value && [value.x, value.y, value.z].every(Number.isFinite);
    if (!gyro || ![gyro.beta, gyro.gamma, gyro.alpha].every(Number.isFinite)) return null;
    const gravity = valid(event.accelerationIncludingGravity);
    const acceleration = gravity ? event.accelerationIncludingGravity : event.acceleration;
    if (!valid(acceleration)) return null;
    return { time, gyro: [gyro.beta, gyro.gamma, gyro.alpha].map(value => value * Math.PI / 180),
        accel: [acceleration.x, acceleration.y, acceleration.z], kind: gravity ? 'gravity' : 'linear' };
}

export class PhoneInput {
    constructor(onSample, onStatus, target = window) {
        this.target = target; this.onSample = onSample; this.onStatus = onStatus; this.running = false;
        this.generation = 0; this.lastReceive = 0;
        this.onMotion = event => {
            this.lastReceive = performance.now();
            const sample = motionSample(event, this.lastReceive / 1000);
            if (sample) this.onSample(sample); else this.onStatus('浏览器未提供完整角速度/加速度');
        };
        this.onHidden = () => { if (document.hidden) this.stop('页面进入后台，采集已停止'); };
    }
    async start() {
        const generation = ++this.generation;
        if (!this.target.isSecureContext) throw new Error('手机采集需要可信HTTPS，或ADB转发的localhost');
        const Motion = this.target.DeviceMotionEvent;
        if (!Motion) throw new Error('当前浏览器没有DeviceMotion接口');
        // 需在点击手势内调用，不能先等待网络握手再请求权限。
        if (typeof Motion.requestPermission === 'function' && await Motion.requestPermission() !== 'granted') throw new Error('运动传感器权限未允许');
        if (generation !== this.generation || this.running) return;
        this.running = true; this.lastReceive = performance.now();
        this.target.addEventListener('devicemotion', this.onMotion);
        document.addEventListener('visibilitychange', this.onHidden);
        this.timer = this.target.setInterval(() => {
            if (performance.now() - this.lastReceive > 700) this.onStatus('传感器断流或浏览器未提供数据');
        }, 500);
        this.onStatus('正在采集手机六轴数据');
    }
    stop(message = '手机采集已停止') {
        this.generation += 1; this.running = false;
        this.target.removeEventListener('devicemotion', this.onMotion);
        document.removeEventListener('visibilitychange', this.onHidden);
        this.target.clearInterval(this.timer); this.onStatus(message);
    }
}
