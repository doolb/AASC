import java.util.Properties

// AGP 9.0+ 内置 Kotlin 支持，无需 org.jetbrains.kotlin.android 插件
plugins {
    id("com.android.application")
}

// Release 签名只允许读取本机忽略配置或环境变量，避免把私钥和密码提交到仓库。
val androidLocalProperties = Properties()
val androidLocalPropertiesFile = rootProject.file("local.properties")
if (androidLocalPropertiesFile.isFile) {
    androidLocalPropertiesFile.inputStream().use { androidLocalProperties.load(it) }
}

fun configuredSigningValue(propertyName: String, environmentName: String): String {
    val localValue = androidLocalProperties.getProperty(propertyName)?.trim()
    return localValue?.takeIf { it.isNotEmpty() }
        ?: System.getenv(environmentName)?.trim().orEmpty()
}

val releaseStoreFile = androidLocalProperties.getProperty("aasc.release.storeFile")
    ?.trim()
    ?.takeIf { it.isNotEmpty() }
    ?.let { rootProject.file(it) }
    ?: rootProject.file("${System.getProperty("user.home")}/.android/aasc-release.keystore")
val releaseStorePassword = configuredSigningValue(
    "aasc.release.storePassword",
    "AASC_RELEASE_STORE_PASSWORD"
)
val releaseKeyAlias = configuredSigningValue(
    "aasc.release.keyAlias",
    "AASC_RELEASE_KEY_ALIAS"
)
val releaseKeyPassword = configuredSigningValue(
    "aasc.release.keyPassword",
    "AASC_RELEASE_KEY_PASSWORD"
)

// 只在 Release 任务执行时校验，保证普通 debug 构建仍可使用默认 debug 签名。
val releaseTaskRequested = gradle.startParameter.taskNames.any {
    it.contains("release", ignoreCase = true)
}
if (releaseTaskRequested) {
    check(releaseStoreFile.isFile) {
        "固定 Release keystore 不存在: ${releaseStoreFile.absolutePath}"
    }
    check(releaseStorePassword.isNotBlank()) {
        "缺少 Release keystore 密码，请配置 aasc.release.storePassword 或 AASC_RELEASE_STORE_PASSWORD"
    }
    check(releaseKeyAlias.isNotBlank()) {
        "缺少 Release key alias，请配置 aasc.release.keyAlias 或 AASC_RELEASE_KEY_ALIAS"
    }
    check(releaseKeyPassword.isNotBlank()) {
        "缺少 Release key 密码，请配置 aasc.release.keyPassword 或 AASC_RELEASE_KEY_PASSWORD"
    }
}

android {
    namespace = "com.aasc.display"
    compileSdk = 34

   defaultConfig {
        applicationId = "com.aasc.display"
        // Microsoft Embedded Speech SDK -> azure-core 1.58.1 使用 MethodHandle，D8 要求 Android 8.0+
        minSdk = 26
        targetSdk = 34
        versionCode = 1
       versionName = "0.1.0"
        // Microsoft Embedded Speech SDK 仅提供 arm64-v8a 原生库
        ndk {
            abiFilters += "arm64-v8a"
        }
   }

   signingConfigs {
       // 独立 Release 身份与 debug 身份隔离；固定文件缺失时由上面的校验阻止构建。
       create("aascRelease") {
           storeFile = releaseStoreFile
           storePassword = releaseStorePassword
           keyAlias = releaseKeyAlias
           keyPassword = releaseKeyPassword
       }
   }

   buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("aascRelease")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    // AGP 9 内置 Kotlin：jvmTarget 跟随 compileOptions（默认对齐），无需额外配置
    externalNativeBuild {
        cmake {
            path = file("src/main/cpp/CMakeLists.txt")
        }
    }
    // Node Runtime 和 AASC 服务器运行包由 npm run prepare:android-node 生成，避免把
    // 体积较大的二进制和依赖直接放入 Git；没有生成 assets 时构建会明确失败。
    sourceSets {
        getByName("main") {
            assets.srcDir("$buildDir/generated/node-runtime/assets")
        }
    }
    packaging {
        jniLibs {
            // sherpa-onnx 1.12.35 与 ORT Java 都携带同名库；二者均基于 ORT 1.23.2，正式 APK 只保留一份。
            pickFirsts += "lib/arm64-v8a/libonnxruntime.so"
        }
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.12.0")
    implementation("androidx.appcompat:appcompat:1.6.1")
    // sherpa-onnx Android AAR：官方不上传 Maven Central，改用 GitHub release 产物 vendored 到 libs/
    // 来源: https://github.com/k2-fsa/sherpa-onnx/releases/download/v1.12.35/sherpa-onnx-1.12.35.aar
    // SHA-256: 43cfb818461da559016bd10647c95192f4683c02792b9d9116aba30e2324858e
   implementation(files("libs/sherpa-onnx-1.12.35.aar"))
    // Microsoft Cognitive Services Speech SDK（嵌入式离线 TTS）：vendored AAR
    // 来源：Microsoft Cognitive Services Speech Embedded SDK 1.51.2，AAR 已归档到 app/libs/
    implementation(files("libs/client-sdk-embedded-1.51.2.aar"))
    // SDK 依赖 azure-core（仅传输层，不传递其他 azure 依赖以减小体积）
    implementation("com.azure:azure-core:1.58.1")
    // RapidOCR/YOLO11n 通过同一 ORT Java API 执行；native 重复库由 APK 打包阶段验证。
    implementation("com.microsoft.onnxruntime:onnxruntime-android:1.23.2")
    implementation("org.opencv:opencv:4.9.0")
    implementation("androidx.exifinterface:exifinterface:1.3.7")
   testImplementation("junit:junit:4.13.2")
    // JVM 单元测试中 android.jar 的 org.json 是 stub（抛 "not mocked"），
    // 引入真实实现以覆盖 android.jar 的桩实现
    testImplementation("org.json:json:20240303")
}
