// APK 显示端启动到指定屏幕：adb am start --display <id>
// 用法：npm run start:apk:display -- 5        （启动到 HDMI 屏）
//       npm run start:apk:display -- 0        （内置屏）
// 不带参数默认 5（HDMI 屏）
const { execSync } = require('child_process');

let displayId = process.argv[2] || '5';
// npm 传参会有 `--` 前缀剥掉，取最后一个数字参数
const numeric = process.argv.slice(2).map(Number).filter(n => Number.isInteger(n));
if (numeric.length) displayId = String(numeric[numeric.length - 1]);

// 取第一个已连接的真机（跳过 emulator）
let device = null;
try {
    const out = execSync('adb devices').toString();
    device = out.split('\n').slice(1)
        .map(l => l.trim().split('\t')[0])
        .find(id => id && !id.includes('emulator'));
} catch (e) { console.error('adb 不可用:', e.message); process.exit(1); }

if (!device) {
    console.error('无已连接设备');
    process.exit(1);
}

console.log(`启动 ${device} 到 display ${displayId}`);
execSync(`adb -s ${device} shell am start --display ${displayId} -n com.aasc.display/.MainActivity`, { stdio: 'inherit' });
console.log('已启动（若屏幕仍黑，检查该 display 是否 ON）');
