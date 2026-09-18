# Offline 分辨率与 DPI 缩放校正

## 任务描述

修正 Offline APK WebView 仅按像素长边计算初始比例造成的 Display 2 UI 偏大问题。以
`1280px@320dpi` 作为 100% 参照，同时使用所属显示屏的分辨率和 densityDpi 计算比例。

## design 需求

- Offline 显示页和控制页统一使用分辨率与 densityDpi 组合缩放。
- 公式为 `round((长边 / 1280) × (densityDpi / 320) × 100)`。
- 普通 APK 保持 100%；宽度、高度或 densityDpi 无效时回退 100%。
- 不修改系统 density、物理/逻辑分辨率、媒体尺寸、截图像素和输入坐标协议。

## spec 设计

```text
WebViewScalePolicy.initialScalePercent(offlineMode, widthPixels, heightPixels, densityDpi):
    如果 offlineMode == false 或任一输入无效：返回 100
    longEdgePixels = max(widthPixels, heightPixels)
    返回 max(1, round(longEdgePixels / 1280 * densityDpi / 320 * 100))

DisplayWebView.init:
    metrics = 当前 display Context.resources.displayMetrics
    scale = initialScalePercent(offlineMode, metrics.widthPixels, metrics.heightPixels, metrics.densityDpi)
    调用 setInitialScale(scale)
```

## 受影响的功能模块和代码

- `WebViewScalePolicy.kt`：增加 densityDpi 参数和 320 dpi 基准。
- `DisplayWebView.kt`：把所属显示屏 densityDpi 传给策略。
- `WebViewScalePolicyTest.kt`：覆盖 1280@320、Display 2 1920@160、手机 1480@280、无效 dpi 和普通 APK。
- `docs/design/android-display-offline-apk.md`、`docs/spec/android-display-offline-apk.md`、`docs/design/android-display.md`、`docs/spec/android-display.md`：同步设计和伪代码。
- `docs/design/android-offline-hot-update.md`、`docs/spec/android-offline-hot-update.md`、`docs/todo.md`、`changelog.md`：同步发布和验收记录。

## 自测用例

- `initialScalePercent(true, 1280, 720, 320)` 返回 100%。
- `initialScalePercent(true, 1920, 1080, 160)` 返回 75%。
- `initialScalePercent(true, 720, 1480, 280)` 返回 101%。
- `initialScalePercent(true, 1920, 1080, 320)` 返回 150%。
- 普通 APK、无效分辨率和无效 densityDpi 返回 100%。
- 构建 min APK，安装到 SM-N9500 Display 2，确认 Activity 使用 75% 策略并保持服务健康。

## 兼容性测试

- Android 9/API 28、arm64、Display 2 `Desktop` 虚拟屏（1920×1080、160 dpi）。
- 内置屏覆盖分辨率 720×1480、280 dpi。
- 普通 APK 保持 100% 策略；不改变既有显示页、控制页和 render-display 的共享 WebView 行为。

## 性能测试

- 比例只在 WebView 构造时计算一次，不增加布局循环、资源解包或服务请求。
- 计算使用 Long/Double，避免分辨率和 dpi 乘法溢出。

## 风险评估

- 不同 WebView 版本对 `setInitialScale` 和 viewport 的组合行为可能不同，需要通过 Android JVM 和真机服务启动检查确认。
- Display 2 报告 `touch NONE`，无法用 adb 定向验证点击和返回键；`screencap -d 2` 也可能无法取图。
- 若现场比例仍偏大，只调整基准或上限常量，不修改显示页业务布局。

## 预计工时

约 1 小时，包含 spec 更新、TDD 单测、min APK 构建、Display 2 安装和双站点发布。

## 执行状态

已完成实现、测试、构建、真机验证和正式发布。`WebViewScalePolicy` 使用
`round((长边 / 1280) × (densityDpi / 320) × 100)`，`DisplayWebView` 从所属 Display 的
`displayMetrics` 传入像素和 densityDpi。Android JVM 策略单测 4/4、Offline 静态回归 35/35
通过；min APK v8（versionCode `8`、versionName `0.2.6-offline-min`）大小 `89231402` bytes，
SHA-256 为 `470c19c57ca528d84e87729ece45b74d48a3e2acdfbf124a16751a04786b0d2c`，签名和 ZIP
完整性通过。

v8 已发布到 `http://192.168.1.39/mnt/aasc-offline/` 和
`http://120.79.245.103/mnt/aasc-offline/`；两站点 manifest 均引用 v8，APK HTTP 返回 200
且 Content-Length 正确，WAN 远端文件 hash 与本地一致。SM-N9500 Android 9/API 28 覆盖安装
成功，Activity 窗口确认在 `mDisplayId=2`，Display 2 为 1920×1080、app 区域 1920×1018、
160 dpi，固定 `offline-display` 的 `/api/status`、`/v1/models`（Qwen ready）和 `/display`
均正常，无 FATAL/ANR 日志。当前策略在该屏为 75%。

设备将 Display 2 标为 `touch NONE`，adb 输入无法定向到该屏，`screencap -d 2` 无法取得
Desktop 图像，因此点击和返回键未记为真实手工回归。
