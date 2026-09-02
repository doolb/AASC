// APK 部署：上传到服务器 res/uploads + adb 安装到所有已连接设备
// 用法：npm run upload:apk（先 build:apk）
const { execFileSync, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { buildStartArgs, resolveServerUrl } = require('./apk-deploy-config');

const ROOT = path.resolve(__dirname, '../..');
const APK = path.join(ROOT, 'src/apps/android-display/app/build/outputs/apk/debug/app-debug.apk');
const UPLOAD_DIR = path.join(ROOT, 'res', 'uploads');
const UPLOAD_NAME = 'aasc-display.apk';
const SERVER_URL = resolveServerUrl();

if (!fs.existsSync(APK)) {
    console.error('未找到 APK，请先运行 npm run build:apk');
    process.exit(1);
}

// 1) 上传到服务器 res/uploads（经 https://<host>/uploads/aasc-display.apk 下载）
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const dest = path.join(UPLOAD_DIR, UPLOAD_NAME);
fs.copyFileSync(APK, dest);
console.log('已上传到服务器:', dest);

// 2) adb 安装到所有已连接设备（跳过 emulator）
let devices = [];
try {
    const out = execSync('adb devices').toString();
    devices = out.split('\n').slice(1)
        .map(l => l.trim().split('\t')[0])
        .filter(id => id && !id.startsWith('*') && !id.includes('emulator'));
} catch (e) {
    console.error('adb 不可用:', e.message);
}

if (devices.length === 0) {
    console.log('无已连接设备，跳过 adb 安装');
} else {
    for (const dev of devices) {
        try {
            execSync(`adb -s ${dev} install -r "${APK}"`, { stdio: 'inherit' });
            console.log('已安装到:', dev);
            execFileSync('adb', buildStartArgs(dev, SERVER_URL), { stdio: 'inherit' });
            console.log('已向设备注入服务器地址并启动:', SERVER_URL);
        } catch (e) {
            console.error('安装到', dev, '失败:', e.message);
        }
    }
}
