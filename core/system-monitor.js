const os = require('os');

class SystemMonitor {
    constructor(options = {}) {
        this.intervalMs = options.intervalMs || 5000;
        this.timer = null;
        this.lastCpuInfo = null;
        this.listeners = new Set();
        this.currentStats = null;
    }

    start() {
        this.lastCpuInfo = os.cpus();
        this.lastCpuTime = process.hrtime();
        this.currentStats = this._collectStats();

        this.timer = setInterval(() => {
            this.currentStats = this._collectStats();
            this._notify(this.currentStats);
        }, this.intervalMs);
    }

    stop() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }

    getStats() {
        if (!this.currentStats) {
            this.currentStats = this._collectStats();
        }
        return this.currentStats;
    }

    _collectStats() {
        const memUsage = process.memoryUsage();
        const totalMem = os.totalmem();
        const freeMem = os.freemem();
        const usedMem = totalMem - freeMem;
        const cpus = os.cpus();
        const loadAvg = os.loadavg();

        const cpuUsage = this._calculateCpuUsage();

        return {
            timestamp: Date.now(),
            cpu: {
                usage: cpuUsage,
                count: cpus.length,
                model: cpus[0] ? cpus[0].model : 'unknown',
                loadAvg: {
                    '1m': loadAvg[0],
                    '5m': loadAvg[1],
                    '15m': loadAvg[2]
                }
            },
            memory: {
                total: totalMem,
                used: usedMem,
                free: freeMem,
                usagePercent: ((usedMem / totalMem) * 100).toFixed(1),
                process: {
                    rss: memUsage.rss,
                    heapTotal: memUsage.heapTotal,
                    heapUsed: memUsage.heapUsed,
                    external: memUsage.external,
                    arrayBuffers: memUsage.arrayBuffers || 0
                }
            },
            uptime: {
                system: os.uptime(),
                process: process.uptime()
            }
        };
    }

    _calculateCpuUsage() {
        const cpus = os.cpus();
        if (!this.lastCpuInfo || this.lastCpuInfo.length !== cpus.length) {
            this.lastCpuInfo = cpus;
            return 0;
        }

        let totalIdle = 0;
        let totalTick = 0;

        for (let i = 0; i < cpus.length; i++) {
            const current = cpus[i].times;
            const last = this.lastCpuInfo[i].times;

            const idleDiff = current.idle - last.idle;
            const totalDiff =
                (current.user - last.user) +
                (current.nice - last.nice) +
                (current.sys - last.sys) +
                (current.idle - last.idle) +
                (current.irq - last.irq);

            totalIdle += idleDiff;
            totalTick += totalDiff;
        }

        this.lastCpuInfo = cpus;

        if (totalTick === 0) return 0;
        return ((1 - totalIdle / totalTick) * 100).toFixed(1);
    }

    onStats(listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    _notify(stats) {
        this.listeners.forEach(listener => {
            try {
                listener(stats);
            } catch (e) {
                // 忽略监听器错误
            }
        });
    }
}

module.exports = SystemMonitor;
