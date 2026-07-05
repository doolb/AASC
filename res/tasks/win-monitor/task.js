const os = require('os');
const { exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);

let timer = null;
let prevCpuStat = null;  // Linux /proc/stat 差值缓存
let lastCpus = null;     // Windows os.cpus() 差值缓存

async function run(context) {
    const { params, sendProgress } = context;
    const interval = (params && params.interval || 1) * 1000;
    const targetDisplay = params && params.targetDisplay;
    const isWin = os.platform() === 'win32';

    console.log('[监控] 已启动: ' + os.hostname() + ' (' + os.platform() + '), 间隔 ' + interval + 'ms');

    timer = setInterval(async () => {
        try {
            const stats = await collectStats(isWin);
            if (sendProgress) {
                sendProgress({
                    data: stats,
                    targetDisplay: targetDisplay
                });
            }
        } catch (err) {
            console.log('[监控] 采集失败: ' + err.message);
        }
    }, interval);

    return { stop: stop };
}

async function collectStats(isWin) {
    var gpu = {};
    try {
        var gpuRaw = await execAsync(
            'nvidia-smi --query-gpu=utilization.gpu,temperature.gpu,' +
            'memory.used,memory.total,clocks.current.graphics,' +
            'fan.speed,name --format=csv,noheader',
            { timeout: 3000 }
        );
        var cols = gpuRaw.stdout.trim().split(', ');
        if (cols.length >= 6) {
            gpu = {
                gpuName: cols[6],
                gpuPercent: cols[0] ? cols[0].replace('%', '') : 'N/A',
                gpuTemp: cols[1] || 'N/A',
                gpuMemUsed: cols[2] ? Math.round(parseInt(cols[2]) / 1024) : 0,
                gpuMemTotal: cols[3] ? Math.round(parseInt(cols[3]) / 1024) : 0,
                gpuClock: cols[4] || 'N/A',
                gpuFan: cols[5] || 'N/A'
            };
        }
    } catch (_) { /* no GPU */ }

    var cpuPercent = 'N/A';
    var cpuTemp = 'N/A';
    var mem = {};

    if (isWin) {
        // Windows：os.cpus() 差值法（同 SystemMonitor 一致）
        var cpus = os.cpus();
        if (lastCpus && lastCpus.length === cpus.length) {
            var totalIdle = 0, totalTick = 0;
            for (var i = 0; i < cpus.length; i++) {
                var cur = cpus[i].times;
                var last = lastCpus[i].times;
                totalIdle += cur.idle - last.idle;
                totalTick += (cur.user - last.user) + (cur.nice - last.nice)
                           + (cur.sys - last.sys) + (cur.idle - last.idle)
                           + (cur.irq - last.irq);
            }
            if (totalTick > 0) {
                cpuPercent = ((1 - totalIdle / totalTick) * 100).toFixed(1);
            }
        }
        lastCpus = cpus;
        if (cpuPercent === 'N/A') cpuPercent = 0;

        // Windows CPU 温度：尝试多种方式
        try {
            var tempRaw = await execAsync(
                'wmic /namespace:\\\\root\\wmi PATH MSAcpi_ThermalZoneTemperature get CurrentTemperature',
                { timeout: 2000 }
            );
            var tMatch = tempRaw.stdout.match(/(\d{4,})/);
            if (tMatch) cpuTemp = ((parseInt(tMatch[1]) / 10) - 273.15).toFixed(0);
        } catch (_) {
            try {
                var tempRaw = await execAsync(
                    'wmic path Win32_PerfFormattedData_Counters_ThermalZoneInformation get Temperature',
                    { timeout: 2000 }
                );
                var tMatch = tempRaw.stdout.match(/(\d{4,})/);
                if (tMatch) cpuTemp = ((parseInt(tMatch[1]) / 10) - 273.15).toFixed(0);
            } catch (_) {}
        }
    } else {
        // Linux：/proc/stat 差值法（含 iowait）
        try {
            var statRaw = await execAsync(
                "awk '/cpu /{for(i=2;i<=6;i++){printf \"%s \",$i;}}' /proc/stat",
                { timeout: 2000 }
            );
            var parts = statRaw.stdout.trim().split(/\s+/);
            if (parts.length >= 5) {
                var user = parseInt(parts[0]) || 0;
                var nice = parseInt(parts[1]) || 0;
                var sys = parseInt(parts[2]) || 0;
                var idle = parseInt(parts[3]) || 0;
                var iowait = parseInt(parts[4]) || 0;
                var busy = user + nice + sys;
                var total = busy + idle + iowait;

                if (prevCpuStat && total > prevCpuStat.total) {
                    var dBusy = busy - prevCpuStat.busy;
                    var dTotal = total - prevCpuStat.total;
                    cpuPercent = ((dBusy / dTotal) * 100).toFixed(1);
                }
                prevCpuStat = { busy: busy, total: total };
            }
        } catch (_) {}

        if (cpuPercent === 'N/A') {
            cpuPercent = (os.loadavg()[0] * 10).toFixed(1);
        }

        // Linux CPU 温度：sensors -j 解析封装温度
        try {
            var tempRaw = await execAsync('sensors -j', { timeout: 2000 });
            var sensorsData = JSON.parse(tempRaw.stdout);
            for (var key in sensorsData) {
                if (key.startsWith('coretemp')) {
                    var chip = sensorsData[key];
                    if (chip['Package id 0'] && chip['Package id 0'].temp1_input) {
                        cpuTemp = '' + Math.round(chip['Package id 0'].temp1_input);
                    } else if (chip['Core 0'] && chip['Core 0'].temp2_input) {
                        cpuTemp = '' + Math.round(chip['Core 0'].temp2_input);
                    }
                    break;
                }
            }
        } catch (_) {}
    }

    // 内存：os 模块（跨平台）
    var totalMem = os.totalmem();
    var freeMem = os.freemem();
    var usedMem = totalMem - freeMem;
    mem.memPercent = ((usedMem / totalMem) * 100).toFixed(1);
    mem.memTotal = (totalMem / 1024 / 1024 / 1024).toFixed(1);
    mem.memUsed = (usedMem / 1024 / 1024 / 1024).toFixed(1);

    return {
        cpuPercent: cpuPercent,
        cpuTemp: cpuTemp,
        memPercent: mem.memPercent || 'N/A',
        memTotal: mem.memTotal || 'N/A',
        memUsed: mem.memUsed || 'N/A',
        hostname: os.hostname(),
        timestamp: Date.now(),
        ...gpu
    };
}

function stop() {
    if (timer) {
        clearInterval(timer);
        timer = null;
        console.log('[监控] 已停止');
    }
    prevCpuStat = null;
    lastCpus = null;
}

module.exports = {
    run: run,
    stop: stop,
    params: [
        { name: 'interval', type: 'number', default: 1, min: 1, max: 30, label: '采集间隔(秒)' },
        { name: 'targetDisplay', type: 'string', default: '', label: '目标显示端ID(空=仅推送)' }
    ]
};
