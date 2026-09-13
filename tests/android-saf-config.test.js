const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const read = filePath => fs.readFileSync(filePath, 'utf8');

test('APK Node 启动环境注入回环 SAF 网关配置', () => {
  const service = read('src/apps/android-display/app/src/main/java/com/aasc/display/NodeServerService.kt');
  const server = read('src/apps/server/boot/server-app.js');

  assert.match(service, /AASC_ANDROID_SAF_URL/);
  assert.match(service, /AASC_ANDROID_SAF_TOKEN/);
  assert.match(service, /SafMediaServer\(this\)/);
  assert.match(server, /process\.env\.AASC_ANDROID_SAF_URL/);
  assert.match(server, /androidSafConfig:/);
});

test('SAF 运行时配置不使用 ~/ 别名或整盘权限', () => {
  const service = read('src/apps/android-display/app/src/main/java/com/aasc/display/NodeServerService.kt');
  const manifest = read('src/apps/android-display/app/src/main/AndroidManifest.xml');
  const provider = read('src/apps/web-mediacenter/modules/media/media-library-app-service.js');

  assert.doesNotMatch(service, /AASC_ANDROID_SAF_HOME/);
  assert.doesNotMatch(manifest, /MANAGE_EXTERNAL_STORAGE/);
  assert.match(provider, /虚拟 `\/` 路径/);
});
