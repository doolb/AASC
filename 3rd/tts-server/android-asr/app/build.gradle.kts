import org.gradle.api.tasks.Copy

plugins {
    id("com.android.application")
}

val bundledAsrModelFiles = listOf("model.int8.onnx", "tokens.txt")

val prepareBundledAsrModel = tasks.register<Copy>("prepareBundledAsrModel") {
    from(rootProject.file("../../../res/models/sensevoice")) {
        include(bundledAsrModelFiles)
    }
    into(layout.buildDirectory.dir("generated/assets/asr"))
}

android {
    namespace = "com.aasc.asr"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.aasc.asr"
        minSdk = 26
        targetSdk = 34
        versionCode = 1
        versionName = "0.1.0"
        ndk {
            abiFilters += "arm64-v8a"
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }

    sourceSets {
        getByName("main") {
            assets.srcDir(layout.buildDirectory.dir("generated/assets").get().asFile)
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    externalNativeBuild {
        cmake {
            path = file("src/main/cpp/CMakeLists.txt")
        }
    }
}

tasks.named("preBuild") {
    dependsOn(prepareBundledAsrModel)
}

dependencies {
    implementation("androidx.core:core-ktx:1.12.0")
    implementation("androidx.appcompat:appcompat:1.6.1")
    implementation(files("../../../../src/apps/android-display/app/libs/sherpa-onnx-1.12.35.aar"))
    testImplementation("junit:junit:4.13.2")
}
