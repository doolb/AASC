import { Quaternion, Vector3 } from 'three';
import { MagneticAssist } from './imu-magnetic.mjs';
import { FixedLagDenoiser } from './imu-denoiser.mjs';

export const GRAVITY = 9.80665;
export const REST_ORIENTATION = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2);
const UP = new Vector3(0, 1, 0);
const finite3 = value => Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);
const vector = value => new Vector3().fromArray(value);
const average = values => values.reduce((sum, value) => sum + value, 0) / values.length;
const confidencePart = (value, good, bad) => Math.max(0, Math.min(1, (bad - value) / (bad - good)));

/** 指数映射保留大角度组合旋转；不是将三个欧拉角直接相加。 */
export function rotationStep(rate, dt) {
    const speed = rate.length();
    return speed < 1e-12 ? new Quaternion() : new Quaternion().setFromAxisAngle(rate.clone().divideScalar(speed), speed * dt);
}

function statistics(samples, key) {
    const mean = [0, 1, 2].map(axis => average(samples.map(sample => sample[key][axis])));
    const deviation = [0, 1, 2].map(axis => Math.sqrt(average(samples.map(sample => (sample[key][axis] - mean[axis]) ** 2))));
    return { mean, deviation };
}

export const DEFAULT_PROFILE = Object.freeze({ gyroDeadZone: 0.0035, accelDeadZone: 0.08,
    filterHz: 12, tiltGain: 0.25, assumedRest: false, simulatorAutoRest: false, remoteAutoRest: false,
    magneticAssist: true, denoiseEnabled: false, denoiseLagMs: 300, stopRecoveryEnabled: true, maxGap: 0.15 });

/** 不读取模拟真值的六轴估计器；所有输入端共用，观察端不重复积分。 */
export class ImuEngine {
    constructor(profile = {}) {
        this.profile = { ...DEFAULT_PROFILE, ...profile };
        this.magnetic = new MagneticAssist();
        this.denoiser = new FixedLagDenoiser(); this.denoiseKey = null;
        this.inputWorldAcceleration = [0, 0, 0]; this.denoiseRate = [0, 0, 0]; this.outputHold = false;
        this.q = REST_ORIENTATION.clone();
        this.p = new Vector3(); this.v = new Vector3();
        this.gyroBias = [0, 0, 0]; this.accelBias = [0, 0, 0]; this.accelScale = [1, 1, 1];
        this.gyroNoise = [0, 0, 0]; this.faces = {};
        this.gyroCalibrated = false; this.accelCalibrated = false;
        this.lastTime = null; this.initialized = false;
        this.filteredGyro = null; this.filteredAcceleration = null;
        this.calibration = null; this.samples = 0; this.gaps = 0; this.rejected = 0; this.zeroCorrections = 0;
        this.deadzoneCalibration = null; this.deadzoneMessage = ''; this.deadzoneRevision = 0;
        this.quietSince = null; this.simulatorRestActive = false; this.simulatorBraking = false;
        this.restWindow = []; this.restConfidence = 0; this.zuptSince = null; this.zuptReason = null;
        this.rotationOnlySince = null;
        this.remoteRestWindow = []; this.remoteRestSince = null; this.remoteRestActive = false;
        this.gravityMagnitude = GRAVITY;
        this.gravityDirectionErrorDegrees = null; this.attitudeGyro = [0, 0, 0];
        this.restNoise = null; this.resetRemoteRest();
        this.message = '等待六轴数据'; this.status = 'waiting'; this.lastSample = null;
    }

    beginCalibration(face = null) {
        this.magnetic.reset();
        this.cancelDeadzoneCalibration();
        if (face !== null && !/^[xyz][+-]$/.test(face)) throw new Error('校准面无效');
        this.quietSince = null; this.resetSimulatorRest(); this.resetRemoteRest();
        this.calibration = { face, samples: [], since: null };
        this.message = face ? `六面校准 ${face}：该轴正/负方向朝上，保持静止 2 秒` : '请保持设备静止 2 秒';
        this.resetDenoise('原始样本校准中', { state: 'calibration' });
    }

    beginDeadzoneCalibration() {
        this.magnetic.reset();
        this.calibration = null;
        this.zeroCorrections += 1;
        this.v.set(0, 0, 0); this.filteredAcceleration = null; this.quietSince = null;
        this.resetSimulatorRest(); this.resetRemoteRest();
        this.deadzoneCalibration = { samples: [], since: null, kind: null };
        this.deadzoneMessage = '请保持设备静止 3 秒，正在采集死区前数据';
        this.resetDenoise('原始样本校准中', { stop: true, state: 'calibration' });
    }

    cancelDeadzoneCalibration() {
        const active = Boolean(this.deadzoneCalibration);
        if (active) this.deadzoneMessage = '死区校准已取消，保留原阈值';
        this.deadzoneCalibration = null;
        if (active) this.resetDenoise('校准结束，重新预热');
    }

    resetSimulatorRest() {
        this.restWindow.length = 0; this.restConfidence = 0; this.zuptSince = null; this.zuptReason = null;
        this.simulatorRestActive = false; this.simulatorBraking = false; this.rotationOnlySince = null;
    }

    resetRemoteRest() {
        this.remoteRestWindow.length = 0; this.remoteRestSince = null; this.remoteRestActive = false;
        this.remoteRestDiagnostics = { state: 'window', windowSeconds: 0, gyroRms: null, forceVariation: null,
            gyroLimit: 0.015, variationLimit: 0.08, noiseLearned: Boolean(this.restNoise),
            gyroMeanError: null, gyroVariation: null, gyroVariationLimit: null };
    }

    /** APK观察端用原始六轴识别静稳，学习本机有效重力模长；不依赖平台线性加速度。 */
    updateRemoteRest(time, gyro, force) {
        const last = this.remoteRestWindow.at(-1);
        const noise = this.restNoise, gyroNoise = noise ? Math.hypot(...noise.gyroDeviation) : 0;
        const centered = noise ? gyro.clone().sub(vector(noise.gyroMean)).length() : gyro.length();
        // 快速运动使旧静稳窗口立即失效，避免复用上一段静置样本清掉新的移动速度。
        // 有静置学习依据时按实测噪声包络撤销，避免正常手持波动逐点清空窗口。
        if (last && (centered > Math.max(0.1, gyroNoise * 6)
            || force.distanceTo(last.force) > Math.max(0.35, (noise?.forceVariation || 0) * 6))) this.resetRemoteRest();
        this.remoteRestWindow.push({ time, gyro: gyro.clone(), gyroSq: gyro.lengthSq(), force: force.clone(), forceSq: force.lengthSq() });
        while (this.remoteRestWindow.length > 80 || time - this.remoteRestWindow[0].time > 0.8) {
            this.remoteRestWindow.shift();
        }
        const span = time - this.remoteRestWindow[0].time;
        if (this.remoteRestWindow.length < 12 || span < 0.5) {
            this.remoteRestDiagnostics.windowSeconds = span;
            this.remoteRestSince = null; this.remoteRestActive = false; return false;
        }
        const totals = this.remoteRestWindow.reduce((sum, item) => {
            sum.gyroSq += item.gyroSq; sum.gyro.add(item.gyro);
            sum.forceSq += item.forceSq; sum.force.add(item.force); return sum;
        }, { gyroSq: 0, forceSq: 0, force: new Vector3(), gyro: new Vector3() });
        const count = this.remoteRestWindow.length;
        const meanForce = totals.force.divideScalar(count);
        const meanMagnitude = meanForce.length();
        const gyroRms = Math.sqrt(totals.gyroSq / count);
        const forceVariation = Math.sqrt(Math.max(0, totals.forceSq / count - meanMagnitude * meanMagnitude));
        const baseGyroLimit = this.remoteRestActive ? 0.025 : 0.015;
        const gyroLimit = Math.max(baseGyroLimit, noise ? 3 * gyroNoise / Math.sqrt(count) : 0);
        const variationLimit = Math.max(this.remoteRestActive ? 0.12 : 0.08, (noise?.forceVariation || 0) * 1.5);
        const gyroMean = totals.gyro.divideScalar(count);
        const gyroVariation = Math.sqrt(Math.max(0, totals.gyroSq / count - gyroMean.lengthSq()));
        const gyroMeanError = noise ? gyroMean.clone().sub(vector(noise.gyroMean)).length() : null;
        const gyroVariationLimit = noise ? Math.max(baseGyroLimit, gyroNoise * 1.5) : null;
        // 均值和波动分别检查：大噪声不直接冒充持续旋转，持续旋转也不能因均方根门槛放大而被清零。
        const gyroStable = noise ? gyroMeanError < gyroLimit && gyroVariation < gyroVariationLimit : gyroRms < gyroLimit;
        const stable = gyroStable && forceVariation < variationLimit
            && meanMagnitude > 9 && meanMagnitude < 10.4;
        this.remoteRestSince = stable ? this.remoteRestSince ?? time : null;
        const stopped = this.remoteRestSince !== null && time - this.remoteRestSince >= 0.7;
        this.remoteRestDiagnostics = { state: stopped ? 'rest' : stable ? 'settling' : 'moving',
            windowSeconds: span, gyroRms, forceVariation, gyroLimit, variationLimit,
            noiseLearned: Boolean(noise), gyroMeanError, gyroVariation, gyroVariationLimit };
        if (!stopped) { this.remoteRestActive = false; return false; }
        if (!this.remoteRestActive) this.zeroCorrections += 1;
        // 单朝向不能求完整三轴零偏，但可由静稳力模长去除本机垂直残差，并用方向校正倾斜。
        this.gravityMagnitude = meanMagnitude;
        const measuredUp = meanForce.applyQuaternion(this.q).normalize();
        this.q.premultiply(new Quaternion().setFromUnitVectors(measuredUp, UP)).normalize();
        this.v.set(0, 0, 0); this.filteredAcceleration = null; this.remoteRestActive = true;
        return true;
    }

    /** 六轴滑动窗口只给出测量一致性评分；匀速与静止在惯性数据上仍可能相同。 */
    updateSimulatorRest(time, gyro, acceleration, forceNorm) {
        const last = this.restWindow.at(-1);
        // 突然运动立即撤销旧静稳计时，避免半秒窗口在启动初期继续把速度清零。
        if (last && (acceleration.distanceTo(last.accel) > 0.35 || gyro.length() > 0.04)) {
            this.restWindow.length = 0; this.zuptSince = null;
        }
        this.restWindow.push({ time, gyroSq: gyro.lengthSq(), accel: acceleration.clone(),
            accelSq: acceleration.lengthSq(), gravityError: Math.abs(forceNorm - GRAVITY) });
        while (this.restWindow.length > 80 || time - this.restWindow[0].time > 0.5) this.restWindow.shift();
        const span = time - this.restWindow[0].time;
        if (this.restWindow.length < 20 || span < 0.4) {
            this.restConfidence = 0; this.zuptSince = null; return;
        }
        const totals = this.restWindow.reduce((sum, item) => {
            sum.gyroSq += item.gyroSq; sum.accelSq += item.accelSq;
            sum.gravityError += item.gravityError; sum.accel.add(item.accel); return sum;
        }, { gyroSq: 0, accelSq: 0, gravityError: 0, accel: new Vector3() });
        const count = this.restWindow.length;
        const accelMean = totals.accel.divideScalar(count);
        const gyroRms = Math.sqrt(totals.gyroSq / count);
        const accelRms = Math.sqrt(totals.accelSq / count);
        const accelVariation = Math.sqrt(Math.max(0, totals.accelSq / count - accelMean.lengthSq()));
        const gyroScore = confidencePart(gyroRms, 0.008, 0.03);
        const accelScore = confidencePart(accelRms, 0.08, 0.45);
        const gravityScore = confidencePart(totals.gravityError / count, 0.04, 0.25);
        const variationScore = confidencePart(accelVariation, 0.05, 0.15);
        this.restConfidence = Math.min(gyroScore, variationScore, Math.max(accelScore, 0.9 * gravityScore));
        this.zuptSince = this.restConfidence >= 0.8 ? this.zuptSince ?? time : null;
    }

    /** 用户确认静置后冻结姿态；保留机体系测量，以便完成时先对齐重力再统计死区。 */
    captureDeadzone(sample, force, dt) {
        const capture = this.deadzoneCalibration;
        const gyro = sample.gyro.map((value, axis) => value - this.gyroBias[axis]);
        const reset = message => {
            capture.samples = []; capture.since = null;
            this.deadzoneMessage = message;
        };
        if (capture.kind !== sample.kind) reset('输入类型变化，重新静置采样');
        capture.kind = sample.kind;
        // 手持设备的瞬时抖动可能远高于固定经验阈值；采集窗口只由时间、类型和断流控制，
        // 让用户看到完整的统计死区，避免在计算前悄悄丢掉高噪声样本。
        capture.since ??= sample.time;
        capture.samples.push({ gyro, force: force.toArray(), dt });
        if (capture.samples.length > 1200) capture.samples.shift();
        const elapsed = sample.time - capture.since;
        this.deadzoneMessage = `静置采样 ${Math.min(3, elapsed).toFixed(1)} / 3 秒（${capture.samples.length} 点）`;
        if (elapsed < 3 || capture.samples.length < 60) return;
        const threshold = (values, margin, step) => {
            const mean = average(values);
            const deviation = Math.sqrt(average(values.map(value => (value - mean) ** 2)));
            const sorted = [...values].sort((a, b) => a - b);
            return Math.ceil((Math.max(sorted[Math.ceil(sorted.length * 0.99) - 1], mean + 3 * deviation) + margin) / step) * step;
        };
        const candidate = this.q.clone();
        if (sample.kind === 'gravity') {
            // 单朝向无法分离三轴加速度零偏，但静置重力方向足以校正倾斜；零偏和比例保持原值。
            const meanForce = vector(statistics(capture.samples, 'force').mean).applyQuaternion(candidate).normalize();
            candidate.premultiply(new Quaternion().setFromUnitVectors(meanForce, UP)).normalize();
        }
        let filtered = null;
        const accelNorms = capture.samples.map(item => {
            const corrected = vector(item.force).applyQuaternion(candidate);
            if (sample.kind === 'gravity') corrected.y -= this.gravityMagnitude;
            const blend = this.profile.filterHz <= 0 ? 1 : 1 - Math.exp(-2 * Math.PI * this.profile.filterHz * item.dt);
            filtered ??= corrected.clone();
            filtered.lerp(corrected, blend);
            return filtered.length();
        });
        const gyroDegrees = threshold(capture.samples.map(item => Math.hypot(...item.gyro) * 180 / Math.PI), 0.02, 0.01);
        const accelZone = threshold(accelNorms, 0.01, 0.01);
        this.deadzoneCalibration = null;
        if (![gyroDegrees, accelZone].every(value => Number.isFinite(value) && value >= 0)) {
            this.deadzoneMessage = '采样结果无效，未修改死区'; return;
        }
        this.profile.gyroDeadZone = gyroDegrees * Math.PI / 180; this.profile.accelDeadZone = accelZone;
        // 用户明确点击静置校准后才学习；任意手调死区都不能作为设备静止的证明。
        const gyroStats = statistics(capture.samples, 'gyro'), forceStats = statistics(capture.samples, 'force');
        const forceVariation = Math.hypot(...forceStats.deviation);
        const reliable = sample.kind === 'gravity' && Math.hypot(...forceStats.mean) > 9 && Math.hypot(...forceStats.mean) < 10.4
            && Math.hypot(...gyroStats.mean) < 0.05 && Math.hypot(...gyroStats.deviation) < 0.3 && forceVariation < 0.8;
        this.restNoise = reliable ? { gyroMean: gyroStats.mean, gyroDeviation: gyroStats.deviation,
            forceVariation, sampleCount: capture.samples.length, sampleRateHz: (capture.samples.length - 1) / elapsed } : null;
        this.q.copy(candidate); this.filteredAcceleration = null; this.quietSince = null; this.resetSimulatorRest();
        this.resetRemoteRest();
        this.deadzoneRevision += 1;
        const caution = gyroDegrees > 1 || accelZone > 0.5 ? '；高死区可能忽略真实慢动作' : '';
        this.deadzoneMessage = `死区已校准：${gyroDegrees.toFixed(2)} °/s，${accelZone.toFixed(2)} m/s²；含重力输入已对齐倾斜${caution}；${reliable ? '已学习静稳噪声' : '未启用静稳噪声学习，请确认窗口静置且波动可靠'}`;
    }

    calibrate(sample) {
        const capture = this.calibration;
        if (!capture) return;
        if (sample.kind !== 'gravity') { this.message = '六轴静置校准需要含重力加速度'; return; }
        const angular = vector(sample.gyro).length(), norm = vector(sample.accel).length();
        if (angular > 0.2 || Math.abs(norm - GRAVITY) > 1.5) {
            capture.samples = []; capture.since = null; this.message = '检测到运动，请重新保持静止'; return;
        }
        capture.since ??= sample.time;
        capture.samples.push(sample);
        if (capture.samples.length > 1200) capture.samples.shift();
        if (sample.time - capture.since < 2 || capture.samples.length < 20) return;
        const gyro = statistics(capture.samples, 'gyro'), accel = statistics(capture.samples, 'accel');
        if (Math.max(...gyro.deviation) > 0.03 || Math.max(...accel.deviation) > 0.18) {
            capture.samples = []; capture.since = null; this.message = '窗口噪声/运动过大，请保持静止重试'; return;
        }
        if (capture.face) {
            const axis = 'xyz'.indexOf(capture.face[0]), sign = capture.face[1] === '+' ? 1 : -1;
            if (sign * accel.mean[axis] < GRAVITY * 0.88) {
                this.message = `${capture.face} 方向未朝上，请调整设备`; capture.samples = []; capture.since = null; return;
            }
            this.faces[capture.face] = accel.mean;
            this.message = `已采集 ${Object.keys(this.faces).length}/6 面`;
            if (Object.keys(this.faces).length === 6) {
                const bias = [0, 1, 2].map(axis => (this.faces['xyz'[axis] + '+'][axis] + this.faces['xyz'[axis] + '-'][axis]) / 2);
                const scale = [0, 1, 2].map(axis => 2 * GRAVITY / (this.faces['xyz'[axis] + '+'][axis] - this.faces['xyz'[axis] + '-'][axis]));
                if (scale.every(value => value > 0.8 && value < 1.2) && bias.every(value => Math.abs(value) < 1.5)) {
                    this.accelBias = bias; this.accelScale = scale; this.accelCalibrated = true;
                    this.message = '加速度六面校准完成';
                } else this.message = '六面结果不一致，请重新采集';
            }
        } else {
            this.gyroBias = gyro.mean; this.gyroNoise = gyro.deviation; this.gyroCalibrated = true;
            const measured = vector(accel.mean.map((value, axis) => (value - this.accelBias[axis]) * this.accelScale[axis]))
                .applyQuaternion(this.q).normalize();
            this.q.premultiply(new Quaternion().setFromUnitVectors(measured, UP)).normalize();
            this.message = '陀螺仪零偏校准完成；加速度六面校准独立进行';
        }
        this.v.set(0, 0, 0); this.filteredGyro = null; this.filteredAcceleration = null;
        this.calibration = null; this.restNoise = null; this.resetSimulatorRest(); this.resetRemoteRest();
    }

    // 实验重置保留处理参数及已学标定；手机姿态必须由下一条实际重力重新对齐。
    // 只清原点的操作仍保留当前姿态，避免把两个按钮的语义混在一起。
    resetExperiment() {
        this.magnetic.reset();
        this.resetOrigin(); this.calibration = null; this.deadzoneMessage = '';
        this.q.copy(REST_ORIENTATION); this.initialized = false; this.lastTime = null;
        this.filteredAcceleration = null; this.filteredGyro = null; this.quietSince = null;
        this.clearProcessed(); this.status = 'waiting';
        this.message = '实验已重置，等待下一条六轴重新对齐重力';
        this.resetDenoise('实验重置，重新预热', { origin: true, stop: true });
    }
    // 断流或重置帧没有新的有效区间，不能沿用上一帧的处理输出和方向诊断。
    clearProcessed() {
        this.correctedGyro = [0, 0, 0]; this.attitudeGyro = [0, 0, 0]; this.linearAcceleration = [0, 0, 0];
        this.gravityDirectionErrorDegrees = null;
        this.inputWorldAcceleration = [0, 0, 0]; this.denoiseRate = [0, 0, 0]; this.outputHold = false;
    }
    resetOrigin() { this.cancelDeadzoneCalibration(); this.p.set(0, 0, 0); this.stopVelocity();
        this.resetDenoise('原点重置，重新预热', { origin: true, stop: true }); }
    stopVelocity() { this.v.set(0, 0, 0); this.resetSimulatorRest(); this.resetRemoteRest();
        this.zeroCorrections += 1; this.message = '已按用户确认停稳清零速度';
        this.resetDenoise('已确认停稳，重新预热', { stop: true }); }
    resetHeading() {
        this.magnetic.reset();
        const forward = new Vector3(0, 1, 0).applyQuaternion(this.q);
        const yaw = Math.atan2(-forward.x, -forward.z);
        // 绕世界竖直轴抵消当前航向，保留已有倾斜；同向叠加会把航向误差翻倍。
        this.q.premultiply(new Quaternion().setFromAxisAngle(UP, -yaw)).normalize();
        this.resetSimulatorRest(); this.resetRemoteRest();
        this.message = '已重置相对航向，保持倾斜';
        this.resetDenoise('航向重置，重新预热');
    }
    pause() { this.cancelDeadzoneCalibration(); this.lastTime = null; this.v.set(0, 0, 0); this.filteredGyro = null;
        this.magnetic.suspend();
        this.filteredAcceleration = null; this.quietSince = null; this.resetSimulatorRest(); this.resetRemoteRest();
        this.clearProcessed();
        this.status = 'paused'; this.message = '数据中断，冻结位置；恢复时速度从零开始';
        this.resetDenoise('数据暂停，等待恢复', { stop: true, state: 'paused' }); }

    /** 控制动作清理未来窗口，冻结已经显示的位置；不跨预热空白区补积分。 */
    resetDenoise(reason, { origin = false, stop = false, state = 'warming' } = {}) {
        const raw = this.rawSnapshot();
        let seed = raw;
        if (this.profile.denoiseEnabled && this.denoiser.frame && ['paused', 'gap'].includes(state)) {
            seed = { ...structuredClone(this.denoiser.frame), profile: raw.profile, status: raw.status,
                message: raw.message, gaps: raw.gaps, linear: [0, 0, 0], gyro: [0, 0, 0], attitudeGyro: [0, 0, 0] };
        }
        if (this.profile.denoiseEnabled && this.denoiser.frame) {
            seed.position = [...this.denoiser.frame.position]; seed.velocity = [...this.denoiser.frame.velocity];
        }
        if (origin) seed.position = [0, 0, 0];
        if (stop) seed.velocity = [0, 0, 0];
        this.denoiser.reset(seed, reason); this.denoiser.state = state;
        this.denoiser.latestInputTime = raw.time;
    }

    configureDenoise() {
        this.profile.denoiseLagMs = Number.isFinite(this.profile.denoiseLagMs)
            ? Math.min(1000, Math.max(50, this.profile.denoiseLagMs)) : 300;
        const key = JSON.stringify(this.profile);
        if (key === this.denoiseKey) return;
        // 显式改变模式/参数时以当前可见位置建立新时间基准，避免切换回原链路出现位置跳变。
        if (this.denoiseKey !== null && this.denoiser.frame && this.denoiseWasEnabled) {
            this.p.fromArray(this.denoiser.frame.position); this.v.fromArray(this.denoiser.frame.velocity);
        }
        this.denoiseKey = key; this.denoiseWasEnabled = this.profile.denoiseEnabled;
        this.denoiser.reset(this.rawSnapshot(), '参数变化，重新预热');
    }

    push(sample) {
        this.configureDenoise();
        const calibrating = Boolean(this.calibration || this.deadzoneCalibration);
        if (!this.pushRaw(sample)) return false;
        if (!this.profile.denoiseEnabled) return true;
        const raw = this.rawSnapshot();
        if (calibrating || raw.calibrationActive) {
            this.denoiser.reset(raw, raw.calibrationActive ? '使用原始样本校准' : '校准完成，重新预热');
            this.denoiser.state = raw.calibrationActive ? 'calibration' : 'warming';
            return true;
        }
        if (raw.status === 'gap') {
            this.resetDenoise('断流，重新预热', { stop: true, state: 'gap' }); return true;
        }
        this.denoiser.push(raw, this.inputWorldAcceleration, this.denoiseRate, this.outputHold);
        return true;
    }

    pushRaw(sample) {
        if (!sample || !Number.isFinite(sample.time) || !finite3(sample.gyro) || !finite3(sample.accel)
            || !['gravity', 'linear'].includes(sample.kind)) { this.rejected += 1; return false; }
        if (this.lastTime !== null && sample.time <= this.lastTime) { this.rejected += 1; return false; }
        // 原生传输队列丢弃旧样本时显式标记缺口；即使时间差尚未达到普通断流门限，也不能跨缺样积分。
        if (sample.gap === true && this.lastTime !== null) { this.gaps += 1; this.pause(); }
        this.calibrate(sample);
        this.lastSample = sample; this.samples += 1;
        const interrupted = this.status === 'paused' || this.status === 'gap';
        const dt = this.lastTime === null ? 0 : sample.time - this.lastTime;
        this.lastTime = sample.time;
        const force = vector(sample.accel.map((value, axis) => (value - this.accelBias[axis]) * this.accelScale[axis]));
        // 保留机体系力的模长；后续旋转、去重力会修改世界系向量，不能再拿它计算重力模长评分。
        const forceNorm = force.length();
        if (!this.initialized) {
            if (sample.kind === 'gravity' && force.length() > 1) this.q.setFromUnitVectors(force.clone().normalize(), UP);
            this.initialized = true;
        }
        if (dt > this.profile.maxGap) {
            this.magnetic.suspend('断流，等待稳定观测恢复');
            if (this.deadzoneCalibration) this.beginDeadzoneCalibration();
            this.gaps += 1; this.v.set(0, 0, 0); this.filteredGyro = null; this.filteredAcceleration = null;
            this.quietSince = null; this.resetSimulatorRest(); this.resetRemoteRest();
            this.clearProcessed();
            this.status = 'gap'; this.message = '断流：未跨空白区积分，速度重新初始化'; return true;
        }
        this.status = 'tracking';
        if (this.deadzoneCalibration) {
            this.captureDeadzone(sample, force, dt);
            this.correctedGyro = [0, 0, 0]; this.attitudeGyro = [0, 0, 0]; this.linearAcceleration = [0, 0, 0];
            this.gravityDirectionErrorDegrees = null;
            this.message = this.deadzoneMessage;
            return true;
        }
        if (interrupted) this.message = '数据已恢复，速度从零重新估计';
        if (!this.calibration && !this.gyroCalibrated && !interrupted) this.message = '死区处理中；零偏校准可选';
        const gyro = vector(sample.gyro.map((value, axis) => value - this.gyroBias[axis]));
        // 延迟支路已确认静稳后，当前原始观测的新运动须先撤销旧静稳窗口，避免旧hold吞掉重启动作。
        // 此处只撤销原链路的窗口；快停本身仍在对应的延迟源中心到来时才退出。
        if (this.profile.denoiseEnabled && this.profile.stopRecoveryEnabled && this.denoiser.stopRecovery.active) {
            const predicted = this.q.clone().multiply(rotationStep(gyro, dt));
            const worldLinear = force.clone().applyQuaternion(predicted).sub(new Vector3(0, this.gravityMagnitude, 0));
            if (this.denoiser.stopRecovery.isMoving(worldLinear.toArray(), gyro.toArray())) this.resetRemoteRest();
        }
        const remoteStopped = this.profile.remoteAutoRest && !this.calibration && sample.kind === 'gravity'
            ? this.updateRemoteRest(sample.time, gyro, force) : false;
        const blend = this.profile.filterHz <= 0 ? 1 : 1 - Math.exp(-2 * Math.PI * this.profile.filterHz * dt);
        // 姿态必须与当前加速度属于同一采样区间；单独低通角速度会把重力投影成虚假平移。
        // 降噪在扣除重力后的世界线性加速度上进行，避免混用不同延迟的六轴数据。
        const rate = gyro.clone();
        if (rate.length() < this.profile.gyroDeadZone) rate.set(0, 0, 0);
        // 大显示死区不能吞掉缓慢旋转，否则重力会被投影为水平加速度。
        // 真实输入姿态通道只保留原默认的小噪声门槛；用户关闭死区时两通道都关闭门槛。
        // 模拟器保留其可控噪声实验的原门槛，避免改变已有静稳/真值对照基线。
        const attitudeRate = gyro.clone();
        const attitudeDeadZone = this.profile.simulatorAutoRest ? this.profile.gyroDeadZone
            : Math.min(this.profile.gyroDeadZone, DEFAULT_PROFILE.gyroDeadZone);
        if (attitudeRate.length() < attitudeDeadZone) attitudeRate.set(0, 0, 0);
        if (remoteStopped) { rate.set(0, 0, 0); attitudeRate.set(0, 0, 0); }
        // 用户确认静置后采集零偏时，不把尚未扣除的零偏积成不可观测航向误差。
        if (this.calibration && this.calibration.face === null) { rate.set(0, 0, 0); attitudeRate.set(0, 0, 0); }
        const midpoint = this.q.clone().multiply(rotationStep(attitudeRate, dt / 2));
        this.q.multiply(rotationStep(attitudeRate, dt)).normalize();
        if (!this.calibration) {
            const correction = this.magnetic.update(sample, force, this.q, dt, this.profile.magneticAssist);
            this.q.premultiply(correction).normalize(); midpoint.premultiply(correction).normalize();
        }
        const acceleration = force.clone().applyQuaternion(midpoint);
        if (this.profile.simulatorAutoRest && sample.kind === 'gravity' && dt > 0) {
            const gravityError = Math.abs(forceNorm - GRAVITY);
            const apparentLinear = acceleration.clone().addScaledVector(UP, -GRAVITY).length();
            const recovery = this.simulatorRestActive && attitudeRate.length() < 0.02;
            if (gravityError < 0.12 && (attitudeRate.length() > 0.03 && apparentLinear < 0.25 || recovery)) {
                // 六轴只能约束俯仰/横滚；重力方向的最小旋转不会凭空提供航向信息。
                // 位移加速度可能暂时伪装成倾斜，故仅在接近重力且线性残差很小时快速纠倾。
                const correction = new Quaternion().setFromUnitVectors(acceleration.clone().normalize(), UP);
                const partial = new Quaternion().slerp(correction, 1 - Math.exp(-10 * dt));
                midpoint.premultiply(partial); this.q.premultiply(partial).normalize();
                acceleration.applyQuaternion(partial);
            }
        }
        // 此读数是测得的力方向与估计竖直方向的夹角，运动加速度也会影响它，不是真值姿态误差。
        this.gravityDirectionErrorDegrees = sample.kind === 'gravity' && forceNorm > 1
            ? Math.acos(Math.max(-1, Math.min(1, acceleration.y / forceNorm))) * 180 / Math.PI : null;
        if (sample.kind === 'gravity') acceleration.y -= this.gravityMagnitude;
        this.inputWorldAcceleration = acceleration.toArray(); this.denoiseRate = gyro.toArray();
        this.filteredAcceleration ??= acceleration.clone(); this.filteredAcceleration.lerp(acceleration, blend);
        const linear = this.filteredAcceleration.clone();
        if (linear.length() < this.profile.accelDeadZone) linear.set(0, 0, 0);
        // 限速后的匀速段也可能几乎无加速度。只有最近显著减速过，模拟器才把后续静稳视为停下。
        if (this.profile.simulatorAutoRest && acceleration.length() > 0.4) {
            const work = acceleration.dot(this.v);
            if (work < -0.2) this.simulatorBraking = true;
            if (work > 0.2 || (this.v.length() < 0.1 && acceleration.length() > 1)) this.simulatorBraking = false;
        }
        const quiet = attitudeRate.length() < 0.02 && acceleration.length() < 0.12;
        this.quietSince = quiet ? this.quietSince ?? sample.time : null;
        const assumedStopped = this.profile.assumedRest && this.quietSince !== null && sample.time - this.quietSince > 0.7;
        if (this.profile.simulatorAutoRest && sample.kind === 'gravity') {
            this.updateSimulatorRest(sample.time, gyro, acceleration, forceNorm);
        }
        // 已进入仅旋转零速时略放宽退出门限，避免单帧加速度噪声反复增加修正计数。
        const continuingRotation = this.simulatorRestActive && this.zuptReason === 'rotation';
        const rotationOnly = this.profile.simulatorAutoRest && sample.kind === 'gravity'
            && attitudeRate.length() > 0.08 && acceleration.length() < (continuingRotation ? 0.25 : 0.18)
            && Math.abs(forceNorm - GRAVITY) < (continuingRotation ? 0.12 : 0.08);
        this.rotationOnlySince = rotationOnly ? this.rotationOnlySince ?? sample.time : null;
        const rotationStopped = this.rotationOnlySince !== null && sample.time - this.rotationOnlySince >= 0.7;
        const stationaryTime = this.zuptSince === null ? 0 : sample.time - this.zuptSince;
        const simulatorStopped = this.profile.simulatorAutoRest && sample.kind === 'gravity'
            && (rotationStopped || this.restConfidence >= 0.8 && stationaryTime >= (this.simulatorBraking ? 0.7 : 1.5));
        const wasSimulatorRest = this.simulatorRestActive;
        if (dt > 0 && !simulatorStopped && !remoteStopped) {
            this.p.addScaledVector(this.v, dt).addScaledVector(linear, 0.5 * dt * dt);
            this.v.addScaledVector(linear, dt);
        }
        // 低加速度本身不能证明静止：手机需用户启用假设，模拟器按来源单独启用；一般运动不持续纠倾。
        if (assumedStopped && sample.kind === 'gravity' && this.profile.tiltGain > 0 && dt > 0) {
            const direction = vector(sample.accel.map((value, axis) => (value - this.accelBias[axis]) * this.accelScale[axis]))
                .applyQuaternion(midpoint).normalize();
            const correction = new Quaternion().setFromUnitVectors(direction, UP);
            this.q.premultiply(new Quaternion().slerp(correction, 1 - Math.exp(-this.profile.tiltGain * dt))).normalize();
        }
        if (assumedStopped) {
            this.v.set(0, 0, 0); this.zeroCorrections += 1;
            this.message = '手持停稳假设已清零速度；匀速运动也可能被误判';
        }
        if (simulatorStopped) {
            if (!wasSimulatorRest) this.zeroCorrections += 1;
            this.v.set(0, 0, 0); this.filteredAcceleration?.set(0, 0, 0); linear.set(0, 0, 0);
            this.zuptReason = rotationStopped ? 'rotation' : this.simulatorBraking ? 'braking' : 'window';
            const reasonText = { rotation: '仅旋转', braking: '减速后', window: '静稳兜底' }[this.zuptReason];
            this.simulatorRestActive = true; this.message = `模拟器窗口ZUPT已清零速度（${reasonText}）`;
        } else {
            this.simulatorRestActive = false; this.zuptReason = null;
            if (wasSimulatorRest && !quiet) this.message = '模拟器继续运动，恢复积分';
        }
        if (remoteStopped) {
            this.filteredAcceleration?.set(0, 0, 0); linear.set(0, 0, 0);
            this.message = `APK六轴静稳：速度已清零，本机重力模长 ${this.gravityMagnitude.toFixed(3)} m/s²`;
        }
        this.outputHold = Boolean(assumedStopped || simulatorStopped || remoteStopped);
        this.correctedGyro = rate.toArray(); this.attitudeGyro = attitudeRate.toArray(); this.linearAcceleration = linear.toArray();
        return true;
    }

    snapshot() {
        return this.denoiser.snapshot(this.rawSnapshot(), this.profile.denoiseEnabled);
    }

    rawSnapshot() {
        return { position: this.p.toArray(), velocity: this.v.toArray(), quaternion: this.q.toArray(),
            gyro: this.correctedGyro || [0, 0, 0], linear: this.linearAcceleration || [0, 0, 0],
            attitudeGyro: [...this.attitudeGyro], profile: { ...this.profile },
            magnetic: this.magnetic.snapshot(),
            rawGyro: this.lastSample?.gyro || [0, 0, 0], rawAccel: this.lastSample?.accel || [0, 0, 0],
            time: this.lastSample?.time ?? 0, samples: this.samples, gaps: this.gaps, rejected: this.rejected,
            zeroCorrections: this.zeroCorrections, restConfidence: this.restConfidence, restReason: this.zuptReason,
            gravityMagnitude: this.gravityMagnitude, remoteRestActive: this.remoteRestActive,
            gravityDirectionErrorDegrees: this.gravityDirectionErrorDegrees, remoteRest: { ...this.remoteRestDiagnostics },
            restNoise: this.restNoise ? { ...this.restNoise, gyroMean: [...this.restNoise.gyroMean], gyroDeviation: [...this.restNoise.gyroDeviation] } : null,
            status: this.status, message: this.message,
            gyroCalibrated: this.gyroCalibrated, accelCalibrated: this.accelCalibrated,
            calibrationActive: Boolean(this.calibration || this.deadzoneCalibration), faces: Object.keys(this.faces).length,
            gyroBias: [...this.gyroBias], gyroNoise: [...this.gyroNoise], kind: this.lastSample?.kind || 'gravity' };
    }
}
