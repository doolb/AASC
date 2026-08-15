# 2026-08-15 Android APK 显示端（跨域控制增强）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增 Android APK 显示端：WebView 加载现有 display.html + 原生桥（真实像素截图 + 跨域输入注入），实现跨域页面全场景执行（点击/滚轮/键盘/中文文本）；现有浏览器显示端保留，通过能力声明标识无跨域控制能力。

**Architecture:** APK（Kotlin/Gradle）内 WebView 原样运行服务器 /display 页；JavascriptInterface 注入 `window.NativeDisplay` 桥。display.html 探测到桥后：截图走 `NativeDisplay.takeScreenshot()`（WebView 位图，真实像素，无 CORS/授权限制），输入走 `NativeDisplay.injectTouch/injectWheel/injectKey/injectText`（无障碍真实触摸 + WebView 真实按键，绕过 DOM 跨域限制）。无桥时行为与现在完全一致。

**Tech Stack:** Kotlin 1.9.22, AGP 8.2.2, compileSdk 34, minSdk 24 (Android 7.0+), Gradle 8.5, JDK 17；WebView（系统 WebView，引擎层薄封装便于未来切 GeckoView）。

## 全局约束

- minSdk = 24（无障碍 dispatchGesture 需 API 24+）
- 权限仅 `INTERNET` + 无障碍服务（`BIND_ACCESSIBILITY_SERVICE`）；**不用 MediaProjection**
- 桥接口 JS 契约（`window.NativeDisplay`）以本计划 Task 3 表格为准，display.html 与 APK 两侧严格一致
- 截图统一 720p（长边 ≤ 1280，等比缩放）、JPEG q0.7，与 `ControlModeUtils.fitSizeTo720p` 一致
- 服务器端零改动（capabilities 已透传）
- 浏览器显示端（无桥）行为不得改变
- 项目规则：注释用中文；spec 文档与代码同步；AASC 规则（避免大段 if-else 链，用映射表）

---

### Task 1: 构建环境（JDK 17 + Android SDK + Gradle 8.5）

**Files:**
- 系统环境（/opt/android-sdk、/opt/gradle），无仓库文件

**Interfaces:**
- Produces: `java`(17)、`sdkmanager`、`adb`、`gradle` 命令可用，ANDROID_HOME 已设置

- [ ] **Step 1: 安装 JDK 17 与 Android SDK 基础包**

```bash
sudo pacman -S jdk17-openjdk
# 下载 Android 命令行工具（官方地址）
cd /tmp && curl -O https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip
sudo mkdir -p /opt/android-sdk/cmdline-tools
sudo unzip -q commandlinetools-linux-11076708_latest.zip -d /tmp/cmdtools
sudo mv /tmp/cmdtools/cmdline-tools /opt/android-sdk/cmdline-tools/latest
```

- [ ] **Step 2: 安装 SDK 组件（platform-tools / android-34 / build-tools）**

```bash
export ANDROID_HOME=/opt/android-sdk
yes | /opt/android-sdk/cmdline-tools/latest/bin/sdkmanager --licenses
/opt/android-sdk/cmdline-tools/latest/bin/sdkmanager "platform-tools" "platforms;android-34" "build-tools;34.0.0"
```

- [ ] **Step 3: 安装 Gradle 8.5**

```bash
cd /tmp && curl -O https://services.gradle.org/distributions/gradle-8.5-bin.zip
sudo mkdir -p /opt/gradle && sudo unzip -q gradle-8.5-bin.zip -d /opt/gradle
```

- [ ] **Step 4: 写入环境变量（追加到 ~/.zshrc）并验证**

```bash
echo 'export ANDROID_HOME=/opt/android-sdk' >> ~/.zshrc
echo 'export PATH=$PATH:/opt/android-sdk/cmdline-tools/latest/bin:/opt/android-sdk/platform-tools:/opt/gradle/gradle-8.5/bin' >> ~/.zshrc
source ~/.zshrc
java -version        # 期望 openjdk 17.x
gradle --version     # 期望 Gradle 8.5
adb version          # 期望 Android Debug Bridge 1.0.x
```

- [ ] **Step 5: 验证 SDK**

Run: `sdkmanager --list_installed | grep -E "platforms;android-34|build-tools;34"`
Expected: 两条记录均出现（platforms;android-34 与 build-tools;34.0.0）

---

### Task 2: APK 工程骨架 + MainActivity + 配置页 + WebView 容器

**Files:**
- Create: `src/apps/android-display/settings.gradle.kts`
- Create: `src/apps/android-display/build.gradle.kts`
- Create: `src/apps/android-display/gradle.properties`
- Create: `src/apps/android-display/app/build.gradle.kts`
- Create: `src/apps/android-display/app/src/main/AndroidManifest.xml`
- Create: `src/apps/android-display/app/src/main/res/values/strings.xml`
- Create: `src/apps/android-display/app/src/main/res/layout/activity_main.xml`
- Create: `src/apps/android-display/app/src/main/res/xml/accessibility_service_config.xml`
- Create: `src/apps/android-display/app/src/main/java/com/aasc/display/MainActivity.kt`
- Create: `src/apps/android-display/app/src/main/java/com/aasc/display/DisplayWebView.kt`

**Interfaces:**
- Produces: `DisplayWebView(context)` — 已启用 JS/DOM 存储/混合内容的 WebView 子类
- Produces: `MainActivity` — 全屏 + 服务器地址配置（SharedPreferences `"aasc_display"` key `"server_url"`）+ 加载 `https://<host>/display`
- Produces: 无障碍服务声明（Task 5 的 `DisplayAccessibilityService` 类已在此注册，类体 Task 5 实现）

- [ ] **Step 1: 创建 Gradle 工程文件**

`src/apps/android-display/settings.gradle.kts`:
```kotlin
pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}
rootProject.name = "aasc-display"
include(":app")
```

`src/apps/android-display/build.gradle.kts`:
```kotlin
plugins {
    id("com.android.application") version "8.2.2" apply false
    id("org.jetbrains.kotlin.android") version "1.9.22" apply false
}
```

`src/apps/android-display/gradle.properties`:
```properties
org.gradle.jvmargs=-Xmx2048m -Dfile.encoding=UTF-8
android.useAndroidX=true
android.nonTransitiveRClass=true
kotlin.code.style=official
```

`src/apps/android-display/app/build.gradle.kts`:
```kotlin
plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.aasc.display"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.aasc.display"
        minSdk = 24
        targetSdk = 34
        versionCode = 1
        versionName = "0.1.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.12.0")
    implementation("androidx.appcompat:appcompat:1.6.1")
}
```

- [ ] **Step 2: 创建 Manifest 与资源**

`src/apps/android-display/app/src/main/AndroidManifest.xml`:
```xml
<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <uses-permission android:name="android.permission.INTERNET" />

    <application
        android:label="@string/app_name"
        android:usesCleartextTraffic="true"
        android:hardwareAccelerated="true"
        android:theme="@style/Theme.AppCompat.NoActionBar">

        <activity
            android:name=".MainActivity"
            android:exported="true"
            android:configChanges="orientation|screenSize|keyboardHidden|density"
            android:launchMode="singleTask">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>

        <service
            android:name=".DisplayAccessibilityService"
            android:exported="false"
            android:permission="android.permission.BIND_ACCESSIBILITY_SERVICE">
            <intent-filter>
                <action android:name="android.accessibilityservice.AccessibilityService" />
            </intent-filter>
            <meta-data
                android:name="android.accessibilityservice"
                android:resource="@xml/accessibility_service_config" />
        </service>
    </application>
</manifest>
```

`src/apps/android-display/app/src/main/res/values/strings.xml`:
```xml
<resources>
    <string name="app_name">AASC 显示端</string>
    <string name="accessibility_desc">AASC 显示端跨域控制：将控制端的触摸/滚轮注入到网页内容</string>
    <string name="server_hint">服务器地址，如 192.168.1.39:8081</string>
    <string name="connect">连接</string>
    <string name="ssl_warn">已信任自签名证书（本设备专属）</string>
</resources>
```

`src/apps/android-display/app/src/main/res/layout/activity_main.xml`:
```xml
<?xml version="1.0" encoding="utf-8"?>
<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:orientation="vertical">

    <LinearLayout
        android:id="@+id/configBar"
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:orientation="horizontal"
        android:padding="12dp"
        android:background="#222222">

        <EditText
            android:id="@+id/serverInput"
            android:layout_width="0dp"
            android:layout_height="wrap_content"
            android:layout_weight="1"
            android:hint="@string/server_hint"
            android:inputType="textUri"
            android:imeOptions="actionGo" />

        <Button
            android:id="@+id/connectBtn"
            android:layout_width="wrap_content"
            android:layout_height="wrap_content"
            android:text="@string/connect" />
    </LinearLayout>

    <FrameLayout
        android:id="@+id/webContainer"
        android:layout_width="match_parent"
        android:layout_height="0dp"
        android:layout_weight="1" />
</LinearLayout>
```

`src/apps/android-display/app/src/main/res/xml/accessibility_service_config.xml`:
```xml
<?xml version="1.0" encoding="utf-8"?>
<accessibility-service xmlns:android="http://schemas.android.com/apk/res/android"
    android:accessibilityEventTypes="typeWindowStateChanged"
    android:accessibilityFeedbackType="feedbackGeneric"
    android:notificationTimeout="100"
    android:canPerformGestures="true"
    android:description="@string/accessibility_desc" />
```

- [ ] **Step 3: 创建 DisplayWebView.kt**

`src/apps/android-display/app/src/main/java/com/aasc/display/DisplayWebView.kt`:
```kotlin
package com.aasc.display

import android.annotation.SuppressLint
import android.content.Context
import android.webkit.WebSettings
import android.webkit.WebView

// 显示端 WebView：启用 JS/DOM 存储/混合内容，保证 display.html 与跨域 iframe 内容可渲染
@SuppressLint("SetJavaScriptEnabled")
class DisplayWebView(context: Context) : WebView(context) {

    init {
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.mediaPlaybackRequiresUserGesture = false
        settings.mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
        isFocusable = true
        isFocusableInTouchMode = true
        requestFocus()
    }
}
```

- [ ] **Step 4: 创建 MainActivity.kt**

`src/apps/android-display/app/src/main/java/com/aasc/display/MainActivity.kt`:
```kotlin
package com.aasc.display

import android.annotation.SuppressLint
import android.os.Build
import android.os.Bundle
import android.view.View
import android.view.WindowInsets
import android.view.WindowManager
import android.webkit.SslErrorHandler
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity

class MainActivity : AppCompatActivity() {

    private lateinit var configBar: View
    private lateinit var serverInput: EditText
    private lateinit var webContainer: FrameLayout
    private var webView: DisplayWebView? = null
    private var trustedSsl = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        configBar = findViewById(R.id.configBar)
        serverInput = findViewById(R.id.serverInput)
        webContainer = findViewById(R.id.webContainer)
        val connectBtn = findViewById<Button>(R.id.connectBtn)

        val saved = getSharedPreferences("aasc_display", MODE_PRIVATE).getString("server_url", "")
        serverInput.setText(saved)
        connectBtn.setOnClickListener { connect() }
        serverInput.setOnEditorActionListener { _, _, _, _ -> connect(); true }

        if (!saved.isNullOrEmpty()) {
            connect()
        }
    }

    private fun connect() {
        val input = serverInput.text.toString().trim()
        if (input.isEmpty()) {
            Toast.makeText(this, "请输入服务器地址", Toast.LENGTH_SHORT).show()
            return
        }
        val base = if (input.startsWith("http://") || input.startsWith("https://")) input else "https://$input"
        val url = if (base.endsWith("/display")) base else "$base/display"
        getSharedPreferences("aasc_display", MODE_PRIVATE).edit().putString("server_url", input).apply()

        hideSystemUi()
        configBar.visibility = View.GONE
        if (webView == null) {
            setupWebView(url)
        } else {
            webView?.loadUrl(url)
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupWebView(url: String) {
        val wv = DisplayWebView(this)
        wv.addJavascriptInterface(NativeBridge(wv), "NativeDisplay")
        wv.webViewClient = object : WebViewClient() {
            // 自签名证书：本设备专属信任（首次提示，不持久化）
            override fun onReceivedSslError(view: WebView, handler: SslErrorHandler, error: android.net.http.SslError) {
                if (!trustedSsl) {
                    trustedSsl = true
                    Toast.makeText(this@MainActivity, getString(R.string.ssl_warn), Toast.LENGTH_LONG).show()
                }
                handler.proceed()
            }
        }
        webContainer.addView(wv)
        webView = wv
        wv.loadUrl(url)
    }

    private fun hideSystemUi() {
        if (Build.VERSION.SDK_INT >= 30) {
            window.insetsController?.hide(WindowInsets.Type.systemBars())
        } else {
            @Suppress("DEPRECATION")
            window.decorView.systemUiVisibility = (View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                    or View.SYSTEM_UI_FLAG_FULLSCREEN
                    or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                    or View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                    or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                    or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION)
        }
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        // 后退键回配置页（重新输入服务器地址）
        webView?.visibility = View.GONE
        configBar.visibility = View.VISIBLE
    }
}
```

- [ ] **Step 5: 骨架编译验证**

Run: `cd /mnt/AASC/src/apps/android-display && gradle :app:assembleDebug`
Expected: BUILD SUCCESSFUL，产物 `app/build/outputs/apk/debug/app-debug.apk`（此步报错 `DisplayAccessibilityService`/`NativeBridge` 未定义属预期——类在 Task 3/5 补齐后再次构建）

- [ ] **Step 6: Commit**

```bash
git add src/apps/android-display/
git commit -m "feat: android-display 工程骨架（WebView 容器 + 服务器配置页）"
```

---

### Task 3: NativeBridge（JavascriptInterface）+ ScreenshotEngine

**Files:**
- Create: `src/apps/android-display/app/src/main/java/com/aasc/display/NativeBridge.kt`
- Create: `src/apps/android-display/app/src/main/java/com/aasc/display/ScreenshotEngine.kt`
- Modify: `src/apps/android-display/app/src/main/java/com/aasc/display/MainActivity.kt`（Step 4 已调用 NativeBridge，无需再改）

**Interfaces:**

桥 JS 契约（display.html 侧 Task 7/8 使用，必须逐字段一致）：

| JS 方法 | 参数 | 返回 | 说明 |
|---------|------|------|------|
| `NativeDisplay.isAvailable()` | - | boolean | 桥存在即 true |
| `NativeDisplay.takeScreenshot(cb)` | `cb(dataUrl, width, height)` JS 函数 | void | dataUrl 为 JPEG base64 data URI；失败传 `(null, 0, 0)` |
| `NativeDisplay.injectTouch(x, y, action)` | 屏幕像素 int；action ∈ `down`/`up`/`click`/`contextmenu` | boolean | 无障碍服务未开启返回 false |
| `NativeDisplay.injectWheel(x, y, deltaY)` | 屏幕像素 int + 滚轮 delta | boolean | deltaY>0 向下滚动 |
| `NativeDisplay.injectKey(keyCode, meta)` | Android keyCode + metaState 位掩码 | boolean | 真实按键 |
| `NativeDisplay.injectText(text)` | 字符串 | boolean | ASCII 按键 / 中文剪贴板粘贴 |

- Produces: `ScreenshotEngine.capture(webView, callback)` — 必须主线程调用；长边 ≤1280 等比缩放、JPEG q0.7
- Produces: `NativeBridge(webView)` — @JavascriptInterface 全部方法

- [ ] **Step 1: 创建 ScreenshotEngine.kt**

`src/apps/android-display/app/src/main/java/com/aasc/display/ScreenshotEngine.kt`:
```kotlin
package com.aasc.display

import android.graphics.Bitmap
import android.graphics.Canvas
import android.util.Base64
import android.webkit.WebView
import java.io.ByteArrayOutputStream

object ScreenshotEngine {

    // 与显示端 ControlModeUtils.fitSizeTo720p 一致：长边 ≤ 1280 等比缩放
    fun fitSize(w: Int, h: Int, maxLongEdge: Int = 1280): Pair<Int, Int> {
        val scale = minOf(1.0, maxLongEdge.toDouble() / maxOf(w, h))
        return Pair(Math.round(w * scale), Math.round(h * scale))
    }

    // 必须在主线程调用（WebView.draw 线程约束）；WebView 渲染位图 = 真实像素，跨域内容同样可读
    fun capture(webView: WebView, callback: (String?, Int, Int) -> Unit) {
        try {
            val w = webView.width
            val h = webView.height
            if (w <= 0 || h <= 0) {
                callback(null, 0, 0)
                return
            }
            val bitmap = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
            webView.draw(Canvas(bitmap))
            val fit = fitSize(w, h)
            val scaled = if (fit.first == w && fit.second == h) bitmap
                else Bitmap.createScaledBitmap(bitmap, fit.first, fit.second, true)
            val out = ByteArrayOutputStream()
            scaled.compress(Bitmap.CompressFormat.JPEG, 70, out)
            val dataUrl = "data:image/jpeg;base64," + Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
            callback(dataUrl, fit.first, fit.second)
        } catch (e: Exception) {
            callback(null, 0, 0)
        }
    }
}
```

- [ ] **Step 2: 创建 NativeBridge.kt**

`src/apps/android-display/app/src/main/java/com/aasc/display/NativeBridge.kt`:
```kotlin
package com.aasc.display

import android.os.Handler
import android.os.Looper
import android.webkit.JavascriptInterface
import android.webkit.WebView
import org.json.JSONObject

// display.html 的原生桥：截图（真实像素）+ 输入注入（真实触摸/按键，跨域内容可用）
class NativeBridge(
    private val webView: WebView,
    private val mainHandler: Handler = Handler(Looper.getMainLooper())
) {

    @JavascriptInterface
    fun isAvailable(): Boolean = true

    @JavascriptInterface
    fun getScreenSize(): String {
        val metrics = webView.resources.displayMetrics
        return JSONObject()
            .put("width", metrics.widthPixels)
            .put("height", metrics.heightPixels)
            .toString()
    }

    // 异步截图：JS 传函数源码字符串，完成后回调 (<callback>)("dataUrl", w, h)
    @JavascriptInterface
    fun takeScreenshot(callback: String) {
        mainHandler.post {
            ScreenshotEngine.capture(webView) { dataUrl, w, h ->
                runJs("($callback)(${quote(dataUrl)}, $w, $h)")
            }
        }
    }

    @JavascriptInterface
    fun injectTouch(x: Int, y: Int, action: String): Boolean =
        TouchInjector.injectTouch(x, y, action)

    @JavascriptInterface
    fun injectWheel(x: Int, y: Int, deltaY: Int): Boolean =
        TouchInjector.injectWheel(x, y, deltaY)

    @JavascriptInterface
    fun injectKey(keyCode: Int, meta: Int): Boolean =
        KeyInjector.injectKey(webView, keyCode, meta)

    @JavascriptInterface
    fun injectText(text: String): Boolean =
        KeyInjector.injectText(webView, text)

    private fun runJs(js: String) {
        webView.post { webView.evaluateJavascript(js, null) }
    }

    private fun quote(s: String?): String {
        if (s == null) return "null"
        return "'" + s.replace("\\", "\\\\").replace("'", "\\'") + "'"
    }
}
```

（`TouchInjector`/`KeyInjector` 类在 Task 4/5 创建；此步编译会报未定义——Task 5 全部补齐后统一构建。）

- [ ] **Step 3: Commit**

```bash
git add src/apps/android-display/
git commit -m "feat: android-display 原生桥 NativeBridge + WebView 位图截图引擎"
```

---

### Task 4: KeyInjector（真实按键 + 中文剪贴板粘贴）

**Files:**
- Create: `src/apps/android-display/app/src/main/java/com/aasc/display/KeyInjector.kt`

**Interfaces:**
- Consumes: `NativeBridge.injectKey(keyCode: Int, meta: Int)`（Android keyCode + metaState）
- Produces: `KeyInjector.injectKey(webView, keyCode, meta): Boolean` — 同步返回，内部主线程派发 down/up
- Produces: `KeyInjector.injectText(webView, text): Boolean` — ASCII 逐字符按键；非 ASCII 走剪贴板 + Ctrl+V

- [ ] **Step 1: 创建 KeyInjector.kt**

`src/apps/android-display/app/src/main/java/com/aasc/display/KeyInjector.kt`:
```kotlin
package com.aasc.display

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.view.KeyEvent
import android.webkit.WebView
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

object KeyInjector {

    // 真实按键：WebView.dispatchKeyEvent → Chromium 按键路由到 iframe 内聚焦元素（跨域同样生效）
    // 必须在主线程派发；CountDownLatch 等待结果返回给 JS 桥线程
    fun injectKey(webView: WebView, keyCode: Int, meta: Int): Boolean {
        val latch = CountDownLatch(1)
        var ok = false
        webView.post {
            webView.requestFocus()
            val down = KeyEvent(0, 0, KeyEvent.ACTION_DOWN, keyCode, 0, meta)
            val up = KeyEvent(0, 0, KeyEvent.ACTION_UP, keyCode, 0, meta)
            ok = webView.dispatchKeyEvent(down) && webView.dispatchKeyEvent(up)
            latch.countDown()
        }
        return try {
            latch.await(1, TimeUnit.SECONDS)
            ok
        } catch (e: InterruptedException) {
            false
        }
    }

    // ASCII 逐字符按键；中文/其他走系统剪贴板 + Ctrl+V（聚焦输入框自动粘贴）
    fun injectText(webView: WebView, text: String): Boolean {
        if (text.all { it.code in 32..126 }) {
            text.forEach { c ->
                val entry = asciiKey(c) ?: return false
                val meta = if (entry.second) KeyEvent.META_SHIFT_ON else 0
                if (!injectKey(webView, entry.first, meta)) return false
            }
            return true
        }
        val latch = CountDownLatch(1)
        var ok = false
        webView.post {
            try {
                val cm = webView.context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                cm.setPrimaryClip(ClipData.newPlainText("aasc", text))
                webView.requestFocus()
                ok = injectKey(webView, KeyEvent.KEYCODE_V, KeyEvent.META_CTRL_ON)
            } catch (e: Exception) {
                ok = false
            }
            latch.countDown()
        }
        return try {
            latch.await(1, TimeUnit.SECONDS)
            ok
        } catch (e: InterruptedException) {
            false
        }
    }

    // 字符 → (Android keyCode, 是否需 Shift)
    private fun asciiKey(c: Char): Pair<Int, Boolean>? = when {
        c in 'a'..'z' -> KeyEvent.KEYCODE_A + (c - 'a') to false
        c in 'A'..'Z' -> KeyEvent.KEYCODE_A + (c - 'A') to true
        c in '0'..'9' -> KeyEvent.KEYCODE_0 + (c - '0') to false
        c == ' ' -> KeyEvent.KEYCODE_SPACE to false
        c == '\n' -> KeyEvent.KEYCODE_ENTER to false
        c == '\t' -> KeyEvent.KEYCODE_TAB to false
        c == '.' -> KeyEvent.KEYCODE_PERIOD to false
        c == ',' -> KeyEvent.KEYCODE_COMMA to false
        c == '-' -> KeyEvent.KEYCODE_MINUS to false
        c == '=' -> KeyEvent.KEYCODE_EQUALS to false
        c == '/' -> KeyEvent.KEYCODE_SLASH to false
        c == '\\' -> KeyEvent.KEYCODE_BACKSLASH to false
        c == ';' -> KeyEvent.KEYCODE_SEMICOLON to false
        c == '\'' -> KeyEvent.KEYCODE_APOSTROPHE to false
        c == '[' -> KeyEvent.KEYCODE_LEFT_BRACKET to false
        c == ']' -> KeyEvent.KEYCODE_RIGHT_BRACKET to false
        c == '`' -> KeyEvent.KEYCODE_GRAVE to false
        else -> null
    }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/apps/android-display/
git commit -m "feat: android-display 真实按键注入（键盘 + ASCII/中文文本）"
```

---

### Task 5: 无障碍服务（真实触摸 + 滚轮滑动）

**Files:**
- Create: `src/apps/android-display/app/src/main/java/com/aasc/display/DisplayAccessibilityService.kt`
- Create: `src/apps/android-display/app/src/main/java/com/aasc/display/TouchInjector.kt`

**Interfaces:**
- Consumes: `NativeBridge.injectTouch(x, y, action)` / `injectWheel(x, y, deltaY)`
- Produces: `TouchInjector.service: DisplayAccessibilityService?` — 静态引用（onServiceConnected 赋值）
- Produces: `TouchInjector.injectTouch(x, y, action): Boolean` / `injectWheel(x, y, deltaY): Boolean`
- 服务已在 Task 2 Manifest 注册（`DisplayAccessibilityService` + `res/xml/accessibility_service_config.xml`）

- [ ] **Step 1: 创建 DisplayAccessibilityService.kt**

`src/apps/android-display/app/src/main/java/com/aasc/display/DisplayAccessibilityService.kt`:
```kotlin
package com.aasc.display

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.graphics.Path
import android.view.accessibility.AccessibilityEvent

// 无障碍服务：真实触摸注入（系统输入管道 → 跨域 iframe 内容同样接收事件）
class DisplayAccessibilityService : AccessibilityService() {

    override fun onServiceConnected() {
        super.onServiceConnected()
        TouchInjector.service = this
    }

    override fun onDestroy() {
        if (TouchInjector.service === this) TouchInjector.service = null
        super.onDestroy()
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {}

    override fun onInterrupt() {}

    // action: click=点按 / down=按住 / up=轻点抬起 / contextmenu=长按
    fun performTouch(x: Int, y: Int, action: String): Boolean {
        val path = Path().apply { moveTo(x.toFloat(), y.toFloat()) }
        val stroke = when (action) {
            "click" -> GestureDescription.StrokeDescription(path, 0, 120)
            "down" -> GestureDescription.StrokeDescription(path, 0, 2000)
            "up" -> GestureDescription.StrokeDescription(path, 0, 80)
            "contextmenu" -> GestureDescription.StrokeDescription(path, 0, 600)
            else -> return false
        }
        val gesture = GestureDescription.Builder().addStroke(stroke).build()
        return dispatchGesture(gesture, null, null)
    }

    // 滚轮 → 垂直滑动：deltaY>0 向下滚 → 手指上滑
    fun performWheel(x: Int, y: Int, deltaY: Int): Boolean {
        if (deltaY == 0) return false
        val dist = deltaY.coerceIn(-2000, 2000)
        val offset = 300f
        val startY = y + offset
        val path = Path().apply {
            moveTo(x.toFloat(), startY)
            lineTo(x.toFloat(), startY - dist)
        }
        val gesture = GestureDescription.Builder()
            .addStroke(GestureDescription.StrokeDescription(path, 0, 250))
            .build()
        return dispatchGesture(gesture, null, null)
    }
}
```

- [ ] **Step 2: 创建 TouchInjector.kt**

`src/apps/android-display/app/src/main/java/com/aasc/display/TouchInjector.kt`:
```kotlin
package com.aasc.display

// 触摸注入入口：服务未开启时返回 false，display.html 回退 JS 合成（同源仍可用）
object TouchInjector {

    var service: DisplayAccessibilityService? = null

    fun injectTouch(x: Int, y: Int, action: String): Boolean {
        val svc = service ?: return false
        return svc.performTouch(x, y, action)
    }

    fun injectWheel(x: Int, y: Int, deltaY: Int): Boolean {
        val svc = service ?: return false
        return svc.performWheel(x, y, deltaY)
    }
}
```

- [ ] **Step 3: 全量编译验证（补齐 Task 3/4/5 所有类）**

Run: `cd /mnt/AASC/src/apps/android-display && gradle :app:assembleDebug`
Expected: BUILD SUCCESSFUL，产物 `app/build/outputs/apk/debug/app-debug.apk`

- [ ] **Step 4: Commit**

```bash
git add src/apps/android-display/
git commit -m "feat: android-display 无障碍真实触摸注入（点击/按住/滚轮滑动）"
```

---

### Task 6: 构建产物安装到电视盒子（adb）

**Files:**
- 无仓库文件（adb 安装验证）

**Interfaces:**
- Consumes: `app/build/outputs/apk/debug/app-debug.apk`

- [ ] **Step 1: 确认盒子 adb 连接**

Run: `adb devices`
Expected: 出现 `192.168.1.6:5555  device`（如未连接：`adb connect 192.168.1.6:5555`；盒子需已开启 adb 网络调试）

- [ ] **Step 2: 安装 APK**

Run: `adb -s 192.168.1.6:5555 install -r /mnt/AASC/src/apps/android-display/app/build/outputs/apk/debug/app-debug.apk`
Expected: `Success`

- [ ] **Step 3: 启动并验证显示端连接**

Run: `adb -s 192.168.1.6:5555 shell am start -n com.aasc.display/.MainActivity`
Expected: 盒子出现配置页；输入服务器地址后控制端显示端列表出现新显示端，能力标识含"跨域控制"

- [ ] **Step 4: 记录验证结果到本计划（测试记录节）**

---

### Task 7: display.html 桥探测 + 截图链改造（native 优先）+ puppeteer 测试

**Files:**
- Modify: `src/apps/web-mediacenter/ui/public/display.html`（captureHtmlShot 区域，当前 1554-1595 行附近）
- Test: `tests/display-native-bridge.test.js`（新增，node + puppeteer 单测脚本）

**Interfaces:**
- Consumes: `window.NativeDisplay`（Task 3 契约）：`takeScreenshot(cb)` / `isAvailable()`
- Produces: `shotWithNativeBridge()` — 桥截图成功上报 `mode: 'native'`，失败返回 null
- Produces: 桥探测常量 `nativeBridge`（`window.NativeDisplay || null`，Task 8 复用）

- [ ] **Step 1: 编写失败测试（puppeteer mock 桥）**

`tests/display-native-bridge.test.js`:
```js
// display.html 原生桥测试：mock window.NativeDisplay，验证 native 优先 + 输入走桥
// 运行：node tests/display-native-bridge.test.js        （桥场景）
//       NO_BRIDGE=1 node tests/display-native-bridge.test.js  （无桥回归）
const puppeteer = require('/mnt/AASC/node_modules/puppeteer');
const assert = require('assert');

const NO_BRIDGE = !!process.env.NO_BRIDGE;
const FAKE_JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: '/usr/bin/chromium',
    args: ['--ignore-certificate-errors', '--no-sandbox']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });

  await page.evaluateOnNewDocument((noBridge) => {
    const OrigWS = window.WebSocket;
    window.__wsSends = [];
    window.__wsInstance = null;
    window.WebSocket = function(...args) {
      const ws = new OrigWS(...args);
      window.__wsInstance = ws;
      const origSend = ws.send.bind(ws);
      ws.send = function(data) {
        window.__wsSends.push(data);
        return origSend(data);
      };
      return ws;
    };
    window.WebSocket.prototype = OrigWS.prototype;
    Object.getOwnPropertyNames(OrigWS).forEach(k => {
      try { if (!(k in window.WebSocket)) window.WebSocket[k] = OrigWS[k]; } catch (e) {}
    });
    // mock 原生桥（NO_BRIDGE=1 时不注入，回归浏览器显示端行为）
    if (!noBridge) {
      window.__bridgeCalls = [];
      window.NativeDisplay = {
        isAvailable: () => true,
        takeScreenshot: (cb) => {
          window.__bridgeCalls.push(['takeScreenshot']);
          setTimeout(() => cb(FAKE_JPEG, 1280, 720), 50);
        },
        injectTouch: (x, y, a) => { window.__bridgeCalls.push(['injectTouch', x, y, a]); return true; },
        injectWheel: (x, y, d) => { window.__bridgeCalls.push(['injectWheel', x, y, d]); return true; },
        injectKey: (k, m) => { window.__bridgeCalls.push(['injectKey', k, m]); return true; },
        injectText: (t) => { window.__bridgeCalls.push(['injectText', t]); return true; },
        getScreenSize: () => ({ width: 1280, height: 800 })
      };
    }
  });

  }, NO_BRIDGE);

  await page.goto('https://127.0.0.1:8081/display', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.__wsInstance && window.__wsInstance.readyState === 1, { timeout: 15000 });
  await new Promise(r => setTimeout(r, 500));

  // 发送跨域 URL 媒体（桥场景下应走 native 截图，不依赖 iframe 可读性）
  await page.evaluate(() => {
    const ws = window.__wsInstance;
    ws.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({
      type: 'url', url: 'https://example.com/page', fileName: 'x.html', mediaType: 'html', temp: true
    }) }));
  });
  await new Promise(r => setTimeout(r, 1500));

  // 开启控制模式
  await page.evaluate(() => {
    const ws = window.__wsInstance;
    ws.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ type: 'control', action: 'controlMode', value: true }) }));
  });
  await new Promise(r => setTimeout(r, 2500));

  // 断言：桥场景回传 mode='native'；无桥场景（跨域内容）不得出现 native
  const result = await page.evaluate(() => {
    const shots = window.__wsSends
      .filter(s => s.includes('controlScreenshot'))
      .slice(-3)
      .map(s => JSON.parse(s));
    return { shots, bridgeCalls: window.__bridgeCalls || [] };
  });
  const modes = result.shots.map(s => s.mode);
  if (NO_BRIDGE) {
    assert(!modes.includes('native'), '无桥场景不应出现 native 截图，实际: ' + JSON.stringify(modes));
    console.log('PASS: 无桥回归（跨域内容回退现有链，无 native 截图）');
  } else {
    assert(result.bridgeCalls.some(c => c[0] === 'takeScreenshot'), '桥 takeScreenshot 应被调用');
    const nativeShot = result.shots.find(s => s.mode === 'native');
    assert(nativeShot, '应存在 mode=native 的截图消息，实际: ' + JSON.stringify(modes));
    assert(nativeShot.dataUrl === FAKE_JPEG, 'dataUrl 应为桥回调值');
    console.log('PASS: 桥截图链（native 优先, mode=native, dataUrl 透传）');
  }

  await browser.close();
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node tests/display-native-bridge.test.js`
Expected: FAIL——`应存在 mode=native 的截图消息`（当前代码无桥逻辑，跨域内容走 gdm 链被禁用后为 none/无消息）

- [ ] **Step 3: 实现桥探测 + 截图链**

`display.html` 中 `captureHtmlShot`（当前约 1554 行）上方新增桥探测常量：

```js
        // APK 原生桥探测（Android APK 显示端注入：真实像素截图 + 跨域输入注入）
        const nativeBridge = window.NativeDisplay || null;
```

`captureHtmlShot` 函数开头（`mediaHtml.style.display === 'none'` 检查之后）插入：

```js
            // APK 原生截图优先：真实像素，跨域 iframe / 外站图片均可截
            if (nativeBridge && nativeBridge.takeScreenshot) {
                const shot = await shotWithNativeBridge();
                if (shot) return;
                // 原生失败（如视频位图空白）回退现有降级链
            }
```

函数末尾（`shotWithHtmlToImage` 定义前）新增：

```js
        // NativeDisplay.takeScreenshot：WebView 位图真实像素，回调式
        function shotWithNativeBridge() {
            return new Promise((resolve) => {
                try {
                    nativeBridge.takeScreenshot(function(dataUrl, width, height) {
                        if (dataUrl) {
                            sendControlScreenshot('native', dataUrl, width || 0, height || 0);
                            resolve(dataUrl);
                        } else {
                            resolve(null);
                        }
                    });
                } catch (e) {
                    resolve(null);
                }
            });
        }
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node tests/display-native-bridge.test.js`
Expected: PASS：桥截图链（native 优先, mode=native, dataUrl 透传）

- [ ] **Step 5: 回归验证（无桥时浏览器行为不变）**

```bash
NO_BRIDGE=1 node tests/display-native-bridge.test.js
```

Expected: PASS：无桥回归（跨域内容回退现有链，无 native 截图）——确认浏览器显示端行为未被破坏

- [ ] **Step 6: Commit**

```bash
git add src/apps/web-mediacenter/ui/public/display.html tests/display-native-bridge.test.js
git commit -m "feat: 显示端原生桥截图链（native 优先，跨域/外站图片可截）"
```

---

### Task 8: display.html 输入派发走桥 + puppeteer 测试

**Files:**
- Modify: `src/apps/web-mediacenter/ui/public/display.html`（`dispatchControlInput`，当前约 1744 行）
- Test: `tests/display-native-bridge.test.js`（追加输入断言）

**Interfaces:**
- Consumes: `nativeBridge`（Task 7 常量）；`window.NativeDisplay.injectTouch/injectWheel/injectKey/injectText`
- Produces: `dispatchControlInputNative(data): boolean` — 桥处理成功返回 true；未映射键/失败返回 false
- Produces: `DOM_KEY_TO_ANDROID` 映射表 + `domKeyToAndroidKeyCode(domKeyCode)` + `domMetaToAndroidMeta(data)`

- [ ] **Step 1: 追加失败测试（输入断言）**

在 `tests/display-native-bridge.test.js` 末尾（`await browser.close()` 前）追加：

```js
  // ===== 输入注入断言 =====
  await page.evaluate(() => {
    window.__bridgeCalls.length = 0;
    const ws = window.__wsInstance;
    // 鼠标点击（50%,50%）→ 屏幕坐标 = rect 偏移 + 容器一半
    ws.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({
      type: 'control', action: 'controlInput', event: 'mousedown', x: 50, y: 50, button: 0
    }) }));
    // 滚轮
    ws.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({
      type: 'control', action: 'controlInput', event: 'wheel', x: 50, y: 50, deltaX: 0, deltaY: 120
    }) }));
    // 键盘 Enter（DOM keyCode 13 → Android 66）
    ws.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({
      type: 'control', action: 'controlInput', event: 'keydown', key: 'Enter', code: 'Enter', keyCode: 13, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false
    }) }));
    // 中文文本
    ws.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({
      type: 'control', action: 'controlInput', event: 'text', text: '中文测试'
    }) }));
  });
  await new Promise(r => setTimeout(r, 500));

  const inputCalls = await page.evaluate(() => window.__bridgeCalls || []);
  if (NO_BRIDGE) {
    assert(inputCalls.length === 0, '无桥场景不应调用桥，实际: ' + JSON.stringify(inputCalls));
    console.log('PASS: 无桥输入回归（走 JS 合成，不调桥）');
  } else {
    assert(inputCalls.some(c => c[0] === 'injectTouch' && c[1] > 0 && c[2] > 0 && c[3] === 'down'), 'injectTouch(down) 应被调用并带屏幕坐标: ' + JSON.stringify(inputCalls));
    assert(inputCalls.some(c => c[0] === 'injectWheel'), 'injectWheel 应被调用');
    assert(inputCalls.some(c => c[0] === 'injectKey' && c[1] === 66), 'Enter 应映射 Android keyCode 66: ' + JSON.stringify(inputCalls));
    assert(inputCalls.some(c => c[0] === 'injectText' && c[1] === '中文测试'), 'injectText 应透传中文');
    console.log('PASS: 桥输入注入（touch/wheel/key/text）');
  }
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node tests/display-native-bridge.test.js`
Expected: FAIL——`injectTouch(down) 应被调用`（当前代码走 JS 合成，不调桥）

- [ ] **Step 3: 实现输入派发走桥**

`display.html` 的 `dispatchControlInput` 函数开头（`mediaHtml.style.display === 'none'` 检查之后）插入：

```js
        // APK 原生注入优先：真实触摸/按键，跨域 iframe 内容同样生效
        if (nativeBridge && nativeBridge.injectTouch && dispatchControlInputNative(data)) {
            return;
        }
```

`dispatchControlInput` 函数定义后（`injectText` 定义前）新增：

```js
        // 原生输入注入：iframe 可见区域 → 屏幕像素
        function dispatchControlInputNative(data) {
            const evt = data.event;
            if (evt === 'text') {
                nativeBridge.injectText(data.text || '');
                return true;
            }
            const rect = mediaHtml.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) return false;
            const sx = Math.round(rect.left + rect.width * (data.x || 0) / 100);
            const sy = Math.round(rect.top + rect.height * (data.y || 0) / 100);
            if (evt === 'mousedown' || evt === 'mouseup' || evt === 'click' || evt === 'contextmenu') {
                const action = evt === 'mouseup' ? 'up'
                    : evt === 'click' ? 'click'
                    : evt === 'contextmenu' ? 'contextmenu'
                    : 'down';
                return nativeBridge.injectTouch(sx, sy, action) !== false;
            }
            if (evt === 'wheel') {
                return nativeBridge.injectWheel(sx, sy, data.deltaY || 0) !== false;
            }
            if (evt === 'keydown' || evt === 'keyup') {
                const keyCode = domKeyToAndroidKeyCode(data.keyCode);
                if (keyCode === 0) return false;   // 未映射键回退 JS 合成
                const meta = domMetaToAndroidMeta(data);
                return nativeBridge.injectKey(keyCode, meta) !== false;
            }
            return false;
        }

        // DOM keyCode → Android keyCode 映射（与 APK KeyInjector 约定一致）
        const DOM_KEY_TO_ANDROID = {
            13: 66, 9: 61, 8: 67, 46: 112, 27: 111, 32: 62,
            37: 21, 38: 19, 39: 22, 40: 20, 33: 92, 34: 93, 35: 123, 36: 122, 45: 124,
            112: 131, 113: 132, 114: 133, 115: 134, 116: 135, 117: 136, 118: 137,
            119: 138, 120: 139, 121: 140, 122: 141, 123: 142,
            48: 7, 49: 8, 50: 9, 51: 10, 52: 11, 53: 12, 54: 13, 55: 14, 56: 15, 57: 16,
            65: 29, 66: 30, 67: 31, 68: 32, 69: 33, 70: 34, 71: 35, 72: 36, 73: 37, 74: 38,
            75: 39, 76: 40, 77: 41, 78: 42, 79: 43, 80: 44, 81: 45, 82: 46, 83: 47, 84: 48,
            85: 49, 86: 50, 87: 51, 88: 52, 89: 53, 90: 54
        };
        function domKeyToAndroidKeyCode(domKeyCode) {
            return DOM_KEY_TO_ANDROID[domKeyCode] || 0;
        }
        function domMetaToAndroidMeta(data) {
            let m = 0;
            if (data.ctrlKey) m |= 4096;   // KeyEvent.META_CTRL_ON
            if (data.altKey) m |= 2;       // KeyEvent.META_ALT_ON
            if (data.shiftKey) m |= 1;     // KeyEvent.META_SHIFT_ON
            if (data.metaKey) m |= 65536;  // KeyEvent.META_META_ON
            return m;
        }
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node tests/display-native-bridge.test.js && NO_BRIDGE=1 node tests/display-native-bridge.test.js`
Expected: 桥场景 PASS 两条（桥截图链 + 桥输入注入）；无桥场景 PASS 两条（回退现有链）

- [ ] **Step 5: Commit**

```bash
git add src/apps/web-mediacenter/ui/public/display.html tests/display-native-bridge.test.js
git commit -m "feat: 显示端原生桥输入注入（触摸/滚轮/键盘/文本，跨域可用）"
```

---

### Task 9: 能力声明（display.html）+ 控制端提示（crop.js / upload.html）

**Files:**
- Modify: `src/apps/web-mediacenter/ui/public/display.html`（declareCapabilities capabilities 对象，当前约 2451 行）
- Modify: `src/apps/web-mediacenter/ui/public/js/crop.js`（showControlScreenshot 提示文本）
- Modify: `src/apps/web-mediacenter/ui/public/upload.html`（控制模式开关旁能力标识）

**Interfaces:**
- Consumes: `nativeBridge`（Task 7）；`window.DeviceList.getDisplays()`（控制端显示列表）
- Produces: 能力 `capabilities.crossOriginControl: true|false`；`capabilities.crossOriginControlDegraded: true`（桥存在但触摸不可用）

- [ ] **Step 1: display.html 能力声明**

`declareCapabilities` 的 `capabilities` 对象（约 2451 行）末尾 `webgpu` 项之后追加：

```js
                crossOriginControl: !!(nativeBridge && nativeBridge.injectTouch),
                crossOriginControlDegraded: !!(nativeBridge && !nativeBridge.injectTouch),
```

- [ ] **Step 2: 控制端提示（crop.js showControlScreenshot none 分支）**

`src/apps/web-mediacenter/ui/public/js/crop.js` 的 `showControlScreenshot` 中 `mode === 'none'` 分支，将占位文本替换为按能力区分的提示：

```js
            if (this.placeholder) {
                this.placeholder.style.display = 'block';
                const t = this.placeholder.querySelector('.crop-preview-placeholder-text');
                if (t) {
                    const caps = this._currentDisplayCapabilities();
                    if (caps.crossOriginControl) {
                        t.textContent = '原生截图失败，无画面（操作仍生效）';
                    } else if (caps.crossOriginControlDegraded) {
                        t.textContent = '跨域控制降级：仅同源页面可操作';
                    } else {
                        t.textContent = '此显示端不支持跨域控制，无画面（操作仍生效）';
                    }
                }
            }
```

`crop.js` 对象内新增辅助方法：

```js
    // 当前选中显示端能力（displayList → capabilities）
    _currentDisplayCapabilities() {
        try {
            const list = window.DeviceList && window.DeviceList.getDisplays
                ? window.DeviceList.getDisplays() : [];
            const item = list.find(d => d.id === window.currentDisplayId) || {};
            return item.capabilities || {};
        } catch (e) {
            return {};
        }
    },
```

- [ ] **Step 3: 控制模式开关旁能力标识（upload.html）**

`upload.html` 控制模式 label（约 228 行）内、`<input id="controlModeToggle">` 前插入：

```html
                    <span id="controlCapabilityHint" style="font-size:11px;color:rgba(255,255,255,0.4);margin-right:6px;"></span>
```

`crop.js` 的 `setControlMode(on)` 开启分支（`_applyControlModeContainer()` 调用处）追加能力标识刷新：

```js
            this._updateControlCapabilityHint();
```

`crop.js` 对象内新增：

```js
    // 控制开关旁的能力标识："跨域控制"可用 / 不可用 / 降级
    _updateControlCapabilityHint() {
        const hint = document.getElementById('controlCapabilityHint');
        if (!hint) return;
        const caps = this._currentDisplayCapabilities();
        if (caps.crossOriginControl) {
            hint.textContent = '跨域控制';
            hint.style.color = '#4caf50';
        } else if (caps.crossOriginControlDegraded) {
            hint.textContent = '跨域控制降级';
            hint.style.color = '#ff9800';
        } else {
            hint.textContent = '不支持跨域控制';
            hint.style.color = 'rgba(255,255,255,0.4)';
        }
    },
```

（`setControlMode(false)` 时同样调用以刷新；显示端切换时在 crop.js 现有 selectDisplay 相关回调中调用一次。）

- [ ] **Step 4: 验证**

Run: `node -e "require('/mnt/AASC/src/apps/web-mediacenter/ui/public/js/control-mode-utils.js')"`（语法检查依赖 OK）
Expected: 无异常；浏览器控制台无 JS 报错（手动验证：控制端开控制模式，无桥显示端提示"此显示端不支持跨域控制"）

- [ ] **Step 5: Commit**

```bash
git add src/apps/web-mediacenter/ui/public/display.html src/apps/web-mediacenter/ui/public/js/crop.js src/apps/web-mediacenter/ui/public/upload.html
git commit -m "feat: 跨域控制能力声明 + 控制端能力标识与准确提示"
```

---

### Task 10: 文档更新（spec / changelog / todo）

**Files:**
- Create: `docs/spec/android-display.md`
- Modify: `docs/design/android-display.md`（若实现与设计有出入，同步修正）
- Modify: `changelog.md`
- Modify: `docs/todo.md`

- [ ] **Step 1: 编写 spec 伪代码文档**

`docs/spec/android-display.md`（伪代码，与实现同步）：
```markdown
# Android APK 显示端（跨域控制增强）实现文档

## 桥接口（window.NativeDisplay）
伪代码：
    isAvailable() -> boolean
    takeScreenshot(cb(dataUrl, w, h))    # 主线程 WebView.draw → 720p JPEG q0.7
    injectTouch(x, y, action) -> boolean # 无障碍 dispatchGesture；down/up/click/contextmenu
    injectWheel(x, y, deltaY) -> boolean # 垂直滑动，deltaY>0 手指上滑
    injectKey(keyCode, meta) -> boolean  # WebView.dispatchKeyEvent
    injectText(text) -> boolean          # ASCII 按键；中文剪贴板 + Ctrl+V

## display.html 集成
伪代码：
    启动: nativeBridge = window.NativeDisplay || null
    截图链(captureHtmlShot):
        if nativeBridge 可用:
            shot = await shotWithNativeBridge()   # mode='native'
            if shot: return
        否则走现有 html-to-image → gdm → 兜底
    输入链(dispatchControlInput):
        if nativeBridge 可用 and dispatchControlInputNative(data) 成功: return
        否则走现有 JS 合成
    dispatchControlInputNative:
        text -> injectText
        鼠标 -> rect 偏移 + % → 屏幕像素 -> injectTouch(down/up/click/contextmenu)
        wheel -> injectWheel
        keydown/up -> DOM_KEY_TO_ANDROID[keyCode] -> injectKey(keyCode, meta)
        未映射键 -> false（回退 JS 合成）
    能力声明:
        crossOriginControl = nativeBridge 存在且 injectTouch 可用
        crossOriginControlDegraded = 桥存在但触摸不可用

## 控制端提示（crop.js）
伪代码:
    mode='none' 占位文本按能力区分:
        crossOriginControl    -> "原生截图失败，无画面（操作仍生效）"
        crossOriginControlDegraded -> "跨域控制降级：仅同源页面可操作"
        其他                    -> "此显示端不支持跨域控制，无画面（操作仍生效）"
    开关旁能力标识: 跨域控制(绿) / 跨域控制降级(橙) / 不支持跨域控制(灰)
```

- [ ] **Step 2: 更新 changelog.md**

`changelog.md` [Unreleased] 新增：
```markdown
### 新增

- ✅ [2026-08-15] Android APK 显示端（跨域控制增强）
  - APK（Kotlin/Gradle, src/apps/android-display/）：WebView 加载服务器 /display 页 + JavascriptInterface 原生桥
  - 原生桥（window.NativeDisplay）：WebView 位图截图（真实像素，跨域/外站图片可截，无授权弹窗）+ 无障碍真实触摸注入 + WebView 真实按键（跨域 iframe 同样生效）+ 中文剪贴板粘贴
  - display.html：桥探测后截图链 native 优先（mode='native'）、输入派发走桥（未映射键回退 JS 合成）
  - 能力声明：crossOriginControl / crossOriginControlDegraded；控制端开关旁能力标识 + 按能力区分的降级提示
  - 浏览器显示端无桥行为不变
  - 改动文件：
    - src/apps/android-display/（新增，APK 工程）
    - src/apps/web-mediacenter/ui/public/display.html
    - src/apps/web-mediacenter/ui/public/js/crop.js
    - src/apps/web-mediacenter/ui/public/upload.html
    - tests/display-native-bridge.test.js（新增）
    - docs/design/android-display.md（新增）
    - docs/spec/android-display.md（新增）
```

- [ ] **Step 3: 更新 todo.md**

将 APK 任务从「功能完善」标记为已完成（保留完成日期），或按实际进度保留 🚧 状态并注明剩余项。

- [ ] **Step 4: Commit**

```bash
git add docs/spec/android-display.md changelog.md docs/todo.md
git commit -m "docs: APK 显示端实现文档 + changelog + todo"
```

---

### Task 11: 真机自测清单（Android 盒子）

**Files:**
- 无仓库文件（人工自测记录）

**自测用例：**

| # | 用例 | 步骤 | 期望 |
|---|------|------|------|
| 1 | APK 启动连接 | 盒子打开 APK → 输入服务器地址 → 连接 | 显示端列表出现新显示端，能力标识"跨域控制"（绿） |
| 2 | 同源 html 控制模式回归 | 控制端发本地 html → 开控制模式 | 截图 mode=native、点击/滚轮/键盘/中文文本全部生效 |
| 3 | 跨域 html 控制（核心） | 发公网网页 URL → 开控制模式 | 截图正常回传（真实像素），点击/滚轮/键盘/文本注入生效 |
| 4 | 外站图片页面（mhtml 场景） | 发送 mhtml 文件 → 开控制模式 | 截图正常（原生位图无 CORS 问题） |
| 5 | 无障碍服务关闭 | 系统设置关闭 AASC 无障碍 → 控制模式 | 同源仍可控；跨域提示"跨域控制降级" |
| 6 | 浏览器显示端回归 | 浏览器打开 /display → 控制模式 | 行为与之前一致，能力标识"不支持跨域控制" |
| 7 | 旋转场景 | 旋转 90° 后控制模式 | 截图方向正确，点击坐标与画面一致 |
| 8 | 断线重连 | 关盒子网络再恢复 | 显示端自动重连（display.html 现有逻辑），桥继续可用 |

**性能测试：** 复杂页面（11.7MB mhtml）控制模式 1 帧/秒无卡顿；截图链路 CPU 占用 < 30%（盒子硬件）；JPEG 帧 ≤ 150KB 局域网传输无积压。

**兼容性测试：** Android 7 / 8 / 10 / 11 盒子各一台（如可用）；WebView 版本差异不影响桥（桥是纯原生层）。

**风险评估：**
| 风险 | 等级 | 缓解 |
|------|------|------|
| 部分 WebView 对 draw() 位图输出 WebGL/视频层空白 | 中 | 截图失败自动回退 html-to-image 链；后续可加 MediaProjection 兜底 |
| 无障碍手势与页面 JS 监听器语义差异（无 mousemove，长按≈contextmenu） | 低 | 协议无 move；contextmenu 用长按近似 |
| 盒子 WebView 版本过旧导致网页渲染差异 | 中 | 引擎层薄封装，可切 GeckoView |
| 无障碍服务被系统回收 | 低 | onDestroy 置空引用，display.html 回退 JS 合成 |

**预计工时：** 环境搭建 1h + APK 实现 6h + display.html 集成 2h + 控制端提示 1h + 真机自测 2h ≈ 12h

**测试记录：**（真机自测完成后填写）
- [ ] 用例 1-8 结果
- [ ] 性能数据
- [ ] 发现的问题与修复
