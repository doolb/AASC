// WebGL命令不能强制取消：限制在途批次，栅栏轮询不阻塞主线程。
export const GPU_CLOTH_BUDGET_MS = 500;
export class ClothGpuBudget {
    constructor(owner) { this.owner = owner; this.gl = owner.renderer.getContext(); this.job = null; }
    start(iterator, complete = () => {}, started = performance.now()) {
        this.cancel();
        this.job = { iterator, complete, started, fence: null, timer: null, done: false };
        this.schedule();
    }
    schedule() {
        const job = this.job;
        if (job) job.timer = setTimeout(() => this.poll(job), 0);
    }
    check(job) {
        if (performance.now() - job.started > GPU_CLOTH_BUDGET_MS) throw new Error('顶点GPU单次计算超过500ms');
        if (this.gl.isContextLost()) throw new Error('顶点GPU上下文丢失');
    }
    poll(job) {
        if (this.job !== job) return;
        try {
            this.check(job);
            if (job.fence) {
                const status = this.gl.clientWaitSync(job.fence, 0, 0);
                if (status === this.gl.WAIT_FAILED) throw new Error('顶点GPU完成状态读取失败');
                if (status === this.gl.TIMEOUT_EXPIRED) { this.schedule(); return; }
                this.gl.deleteSync(job.fence); job.fence = null;
            }
            if (job.done) {
                this.job = null; this.owner.lastComputeMs = performance.now() - job.started;
                job.complete(); return;
            }
            this.owner.run(() => {
                // 每批至多4个pass；提交本身过慢时也立即停止追加命令。
                for (let count = 0; count < 4; count++) {
                    this.check(job);
                    const result = job.iterator.next();
                    this.check(job);
                    if (result.done) { job.done = true; break; }
                }
            });
            job.fence = this.gl.fenceSync(this.gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
            if (!job.fence) throw new Error('顶点GPU栅栏创建失败');
            this.gl.flush(); this.schedule();
        } catch (error) {
            this.cancel(); this.owner.bridge.fallbackGpu(error);
        }
    }
    cancel() {
        const job = this.job; this.job = null;
        if (!job) return;
        clearTimeout(job.timer);
        if (job.fence) this.gl.deleteSync(job.fence);
        // 不调用generator.return：不得在销毁时执行尚未完成的GPU命令。
    }
}
