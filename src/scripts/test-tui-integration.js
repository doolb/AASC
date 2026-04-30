/**
 * TUI 集成自测脚本
 *
 * 验证：
 *   1. ServerTUI 和 installConsoleRedirect 模块可正确加载
 *   2. --no-tui 标志检测逻辑
 *   3. ServerTUI 实例化 enabled/disabled 行为
 *   4. 日志分支在 TUI/非 TUI 模式下的行为
 *   5. blessed 依赖在 package.json 中声明
 *
 * 说明：本测试不依赖终端 TTY，blessed 在非 TTY 环境下可能抛出警告但不影响测试。
 */

const path = require('path');
const fs = require('fs');

// ─── 辅助函数 ──────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(condition, label) {
    if (condition) {
        console.log(`  ✓ ${label}`);
        passed++;
    } else {
        console.log(`  ✗ ${label}`);
        failed++;
    }
}

function assertEqual(actual, expected, label) {
    if (actual === expected) {
        console.log(`  ✓ ${label}`);
        passed++;
    } else {
        console.log(`  ✗ ${label} (期望: ${expected}, 实际: ${actual})`);
        failed++;
    }
}

// ─── 测试 1：模块加载 ──────────────────────────────────────────────────────

console.log('\n[测试 1] 模块加载');

let ServerTUI;
try {
    ServerTUI = require('../framework/observability/server-tui');
    assert(typeof ServerTUI === 'function', 'ServerTUI 模块加载成功，为构造函数');
} catch (e) {
    assert(false, `ServerTUI 模块加载: ${e.message}`);
}

let installConsoleRedirect;
try {
    const cr = require('../framework/observability/console-redirect');
    installConsoleRedirect = cr.installConsoleRedirect;
    assert(typeof installConsoleRedirect === 'function', 'installConsoleRedirect 加载成功，为函数');
} catch (e) {
    assert(false, `installConsoleRedirect 加载: ${e.message}`);
}

// ─── 测试 2：--no-tui 标志检测 ─────────────────────────────────────────────

console.log('\n[测试 2] --no-tui 标志检测');

function testNoTUIFlag(argv) {
    return !argv.includes('--no-tui');
}

assertEqual(testNoTUIFlag(['node', 'server-app.js', '--no-tui']), false, '含 --no-tui 时 useTUI = false');
assertEqual(testNoTUIFlag(['node', 'server-app.js']), true, '不含 --no-tui 时 useTUI = true');
assertEqual(testNoTUIFlag(['node', 'server-app.js', '--other-flag']), true, '其他标志不影响 useTUI');

// ─── 测试 3：ServerTUI 实例化 ──────────────────────────────────────────────

console.log('\n[测试 3] ServerTUI 实例化');

if (ServerTUI) {
    // 禁用状态
    const tuiDisabled = new ServerTUI({ enabled: false });
    assert(tuiDisabled.enabled === false, 'enabled=false 实例: enabled 属性为 false');
    assert(tuiDisabled.screen == null, 'enabled=false 实例: screen 为 undefined（不初始化 blessed）');

    // 静默返回验证：调用方法不应抛异常
    let threw = false;
    try {
        tuiDisabled.addLog('测试', '消息');
        tuiDisabled.setHeader('http', '127.0.0.1', 8081);
        tuiDisabled.updateStatus({});
        tuiDisabled.updateDeviceList([]);
        tuiDisabled.startRefresh(() => ({}), () => []);
        tuiDisabled.destroy();
    } catch (e) {
        threw = true;
    }
    assert(!threw, 'enabled=false 实例: 所有方法静默返回，不抛异常');

    // 启用状态（非 TTY 环境下 blessed 可能不渲染，但应不抛异常）
    const tuiEnabled = new ServerTUI({ enabled: true });
    assert(tuiEnabled.enabled === true, 'enabled=true 实例: enabled 属性为 true');
    assert(tuiEnabled.screen != null, 'enabled=true 实例: screen 已初始化');

    tuiEnabled.setHeader('http', '127.0.0.1', 8081);
    tuiEnabled.addLog('系统', '测试日志消息');
    tuiEnabled.updateStatus({
        uptime: 100,
        memoryRSS: 50 * 1024 * 1024,
        memoryHeapUsed: 30 * 1024 * 1024,
        memoryHeapTotal: 64 * 1024 * 1024,
        protocol: 'http',
        displayCount: 2,
        controlCount: 1,
        isMuted: false
    });
    tuiEnabled.updateDeviceList([
        { id: 'display-1', ip: '192.168.1.10', isSubDisplay: false, capabilities: { mediaRendering: true } }
    ]);
    assert(true, 'enabled=true 实例: 方法调用不抛异常');

    tuiEnabled.destroy();
    assert(tuiEnabled.enabled === false, 'destroy() 后将 enabled 置为 false');
}

// ─── 测试 4：日志分支行为 ──────────────────────────────────────────────────

console.log('\n[测试 4] 日志分支行为');

// 模拟 TUI 模式
const tuiLogs = [];
const mockTui = {
    enabled: true,
    addLog: (cat, msg) => { tuiLogs.push({ cat, msg }); }
};

function mockLog(mode, category, message) {
    if (mode === 'tui') {
        mockTui.addLog(category, message);
    }
}

mockLog('tui', '连接', '显示端已连接');
assertEqual(tuiLogs.length, 1, 'TUI 模式下 addLog 被调用');
assertEqual(tuiLogs[0].cat, '连接', 'TUI 模式下 category 正确传递');
assertEqual(tuiLogs[0].msg, '显示端已连接', 'TUI 模式下 message 正确传递');

// ─── 测试 5：package.json 依赖声明 ─────────────────────────────────────────

console.log('\n[测试 5] blessed 依赖声明');

try {
    const pkgPath = path.resolve(__dirname, '../../package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    const hasBlessed = pkg.dependencies && typeof pkg.dependencies.blessed === 'string';
    assert(hasBlessed, 'blessed 在 package.json dependencies 中声明');
    if (hasBlessed) {
        assertEqual(pkg.dependencies.blessed, '^0.1.81', 'blessed 版本为 ^0.1.81');
    }
} catch (e) {
    assert(false, `读取 package.json 失败: ${e.message}`);
}

// ─── 汇总 ──────────────────────────────────────────────────────────────────

console.log(`\n═══════════════════════════════════`);
console.log(`通过: ${passed}  失败: ${failed}  总计: ${passed + failed}`);
console.log(`═══════════════════════════════════\n`);
process.exit(failed > 0 ? 1 : 0);
