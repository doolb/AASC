const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const manifestPath = 'src/apps/android-display/app/src/main/AndroidManifest.xml';
const activityPath = 'src/apps/android-display/app/src/main/java/com/aasc/display/MainActivity.kt';

const read = (filePath) => fs.readFileSync(filePath, 'utf8');

test('APK 共享存储权限仅声明到 Android 9/API 28', () => {
  const manifest = read(manifestPath);

  assert.match(
    manifest,
    /<uses-permission\s+android:name="android\.permission\.READ_EXTERNAL_STORAGE"\s+android:maxSdkVersion="28"\s*\/>/
  );
  assert.match(
    manifest,
    /<uses-permission\s+android:name="android\.permission\.WRITE_EXTERNAL_STORAGE"\s+android:maxSdkVersion="28"\s*\/>/
  );
  assert.doesNotMatch(manifest, /MANAGE_EXTERNAL_STORAGE/);
});

test('MainActivity 启动时申请共享存储权限并在回调后继续启动', () => {
  const activity = read(activityPath);

  assert.match(activity, /REQ_STORAGE_PERMISSION/);
  assert.match(activity, /SharedStorageAccess\.missingPermissions\(Build\.VERSION\.SDK_INT/);
  assert.match(activity, /requestPermissions\(missingPermissions, REQ_STORAGE_PERMISSION\)/);
  assert.match(activity, /continueStartup\(\)/);
});
