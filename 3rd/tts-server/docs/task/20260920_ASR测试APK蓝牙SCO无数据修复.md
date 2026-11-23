# ASR 测试 APK 蓝牙 SCO 无数据修复

## 任务描述

测试 APK 可以枚举 AIMIC-M4 的 Bluetooth SCO 输入，但录音没有数据，并在启动失败后自动回退到内置麦克风。需要修复 SCO 状态开关处理，保证 `AudioRecord` 创建前蓝牙 SCO 路由真正生效。

## design 需求

- 连接成功后设置 `AudioManager.isBluetoothScoOn=true`，并记录是否由测试 APK 修改。
- 保存录音前的 `AudioManager.mode` 和 SCO 开关状态，停止或失败时只恢复本次由控制器修改的状态。
- 接收 `CONNECTED`、`DISCONNECTED`、`ERROR` 状态；错误、超时和断开均不得继续创建蓝牙 `AudioRecord`。
- 保持 8 kHz SCO 采集、16 kHz 重采样和内置麦克风路径不变。

## spec 设计

- `BluetoothScoCapture` 增加 `previousScoOn`、`scoFlagChangedByController`。
- `BluetoothScoController` 在 SCO 连接后设置开关，在释放时恢复开关和模式。
- Node 契约测试校验 SCO 开关打开、恢复和错误状态处理。

## 受影响模块

- `3rd/tts-server/android-asr/app/src/main/java/com/aasc/asr/BluetoothScoController.kt`
- `tests/android-asr-apk.test.js`
- ASR 测试 APK design/spec/task/todo/changelog 文档

## 自测用例

1. 选择 Bluetooth SCO 后等待 CONNECTED，再创建 `AudioRecord`。
2. 录音停止后恢复录音前 SCO 开关和 AudioManager 模式。
3. 收到 ERROR、DISCONNECTED 或超时后显示失败并允许回退，不产生假成功录音。
4. 内置麦克风仍使用 16 kHz，蓝牙仍使用 8 kHz 后重采样到 16 kHz。

## 兼容性与风险

- 目标设备为 SM-N9500 / Android 9；部分系统可能在 `isBluetoothScoOn` setter 上抛出异常，需按失败处理并释放接收器。
- 如果其他应用占用 SCO，连接仍可能超时；页面保留明确错误和系统默认回退。

## 完成情况

- 已同步正式显示端的 SCO 开关状态管理，增加连接成功设置、错误状态处理和停止恢复逻辑。
- 待 Android JVM、Node 契约测试、APK 构建和真机蓝牙 PCM 峰值验证。
