// AGP 9.0+ 内置 Kotlin 支持，无需 org.jetbrains.kotlin.android 插件
plugins {
    id("com.android.application")
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

   buildTypes {
        release {
            isMinifyEnabled = false
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    // AGP 9 内置 Kotlin：jvmTarget 跟随 compileOptions（默认对齐），无需额外配置
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
   testImplementation("junit:junit:4.13.2")
    // JVM 单元测试中 android.jar 的 org.json 是 stub（抛 "not mocked"），
    // 引入真实实现以覆盖 android.jar 的桩实现
    testImplementation("org.json:json:20240303")
}
