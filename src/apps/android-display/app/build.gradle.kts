// AGP 9.0+ 内置 Kotlin 支持，无需 org.jetbrains.kotlin.android 插件
plugins {
    id("com.android.application")
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
    // AGP 9 内置 Kotlin：jvmTarget 跟随 compileOptions（默认对齐），无需额外配置
}

dependencies {
    implementation("androidx.core:core-ktx:1.12.0")
    implementation("androidx.appcompat:appcompat:1.6.1")
    // sherpa-onnx Android AAR：官方不上传 Maven Central，改用 GitHub release 产物 vendored 到 libs/
    implementation(files("libs/sherpa-onnx-1.12.35.aar"))
    testImplementation("junit:junit:4.13.2")
    // JVM 单元测试中 android.jar 的 org.json 是 stub（抛 "not mocked"），
    // 引入真实实现以覆盖 android.jar 的桩实现
    testImplementation("org.json:json:20240303")
}
