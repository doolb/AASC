const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const read = (filePath) => fs.readFileSync(filePath, 'utf8');
const manifest = read('src/apps/android-display/app/src/main/AndroidManifest.xml');
const controller = read(
  'src/apps/android-display/app/src/main/java/com/aasc/display/BluetoothScoController.kt'
);
const bridge = read('src/apps/android-display/app/src/main/java/com/aasc/display/NativeBridge.kt');
const activity = read('src/apps/android-display/app/src/main/java/com/aasc/display/MainActivity.kt');
const display = read('src/apps/web-mediacenter/ui/public/display.html');

test('正式 APK 声明标准蓝牙 SCO 所需权限并申请 Android 12+ 连接权限', () => {
  assert.match(manifest, /android\.permission\.MODIFY_AUDIO_SETTINGS/);
  assert.match(manifest, /android\.permission\.BLUETOOTH/);
  assert.match(manifest, /android\.permission\.BLUETOOTH_ADMIN/);
  assert.match(manifest, /android\.permission\.BLUETOOTH_CONNECT/);
  assert.match(activity, /requestBluetoothConnectPermissionIfNeeded/);
  assert.match(activity, /REQ_BLUETOOTH_CONNECT_PERMISSION/);
});

test('正式 APK SCO 控制器只管理系统路由，不创建第二个 AudioRecord', () => {
  assert.match(controller, /TYPE_BLUETOOTH_SCO/);
  assert.match(controller, /startBluetoothSco\(\)/);
  assert.match(controller, /ACTION_SCO_AUDIO_STATE_UPDATED/);
  assert.match(controller, /SCO_CONNECT_TIMEOUT_SECONDS = 8L/);
  assert.match(controller, /audioManager\.mode = AudioManager\.MODE_IN_COMMUNICATION/);
  assert.doesNotMatch(controller, /\bAudioRecord\s*\(/);
  assert.match(bridge, /fun startBluetoothScoForVoice\(\): String/);
  assert.match(bridge, /fun stopBluetoothScoForVoice\(\)/);
  assert.match(bridge, /fun release\(\)/);
});

test('WebView 录音在 getUserMedia 前建立 SCO，并在统一释放函数中停止', () => {
  assert.match(display, /function ensureBluetoothScoForVoice\(\)/);
  assert.match(display, /function stopBluetoothScoForVoice\(\)/);
  assert.match(display, /回退系统默认麦克风/);
  assert.match(display, /function releaseVoiceRecordingResources\(\)[\s\S]*stopBluetoothScoForVoice\(\);/);

  const normalRecording = display.slice(
    display.indexOf('async function startVoiceRecording()'),
    display.indexOf('function startSilenceDetection()', display.indexOf('async function startVoiceRecording()'))
  );
  const temporaryRecording = display.slice(
    display.indexOf('async function startDisplayRecording(session)'),
    display.indexOf('async function handleDisplayRecordingRequest', display.indexOf('async function startDisplayRecording(session)'))
  );
  assert.ok(normalRecording.indexOf('ensureBluetoothScoForVoice();') < normalRecording.indexOf('navigator.mediaDevices.getUserMedia'));
  assert.ok(temporaryRecording.indexOf('ensureBluetoothScoForVoice();') < temporaryRecording.indexOf('navigator.mediaDevices.getUserMedia'));
});
