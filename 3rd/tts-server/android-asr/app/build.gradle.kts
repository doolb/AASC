import org.gradle.api.tasks.Copy

plugins {
    id("com.android.application")
}

val bundledAsrModelFiles = listOf("model.int8.onnx", "tokens.txt")
val bundledVoiceprintModelFiles = listOf(
    "3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx",
    "pyannote_segmentation_3_0_int8.onnx"
)
val bundledStreamingAsrModelFiles = listOf("encoder.int8.onnx", "decoder.int8.onnx", "joiner.int8.onnx", "tokens.txt")
val bundledDenoiseModelFiles = listOf("gtcrn_simple.onnx")
val bundledTlsFiles = listOf("android-asr-cert.pem", "android-asr-key.pem")

val prepareBundledAsrModel = tasks.register<Copy>("prepareBundledAsrModel") {
    from(rootProject.file("../../../res/models/sensevoice")) {
        include(bundledAsrModelFiles)
    }
    into(layout.buildDirectory.dir("generated/assets/asr"))
}

val prepareBundledVoiceprintModels = tasks.register<Copy>("prepareBundledVoiceprintModels") {
    from(rootProject.file("../../../res/models/voiceprint")) {
        include(bundledVoiceprintModelFiles)
    }
    into(layout.buildDirectory.dir("generated/assets/voiceprint"))
}

val prepareBundledStreamingAsrModel = tasks.register<Copy>("prepareBundledStreamingAsrModel") {
    from(rootProject.file("../../../res/models/streaming-zipformer")) {
        include(bundledStreamingAsrModelFiles)
    }
    into(layout.buildDirectory.dir("generated/assets/streaming"))
}

val prepareBundledDenoiseModel = tasks.register<Copy>("prepareBundledDenoiseModel") {
    from(rootProject.file("../../../res/models/speech-enhancement")) {
        include(bundledDenoiseModelFiles)
    }
    into(layout.buildDirectory.dir("generated/assets/speech-enhancement"))
}

val prepareBundledTls = tasks.register<Copy>("prepareBundledTls") {
    from(rootProject.file("../../../res/certs")) {
        include(bundledTlsFiles)
    }
    into(layout.buildDirectory.dir("generated/assets/tls"))
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
    dependsOn(prepareBundledVoiceprintModels)
    dependsOn(prepareBundledStreamingAsrModel)
    dependsOn(prepareBundledDenoiseModel)
    dependsOn(prepareBundledTls)
}

dependencies {
    implementation("androidx.core:core-ktx:1.12.0")
    implementation("androidx.appcompat:appcompat:1.6.1")
    implementation(files("../../../../src/apps/android-display/app/libs/sherpa-onnx-1.12.35.aar"))
    testImplementation("junit:junit:4.13.2")
}
