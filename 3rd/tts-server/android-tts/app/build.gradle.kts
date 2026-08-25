import org.gradle.api.tasks.Copy

plugins {
    id("com.android.application")
}

val bundledTtsModelFiles = listOf(
    "2052.INI",
    "MSTTSLocEnUS.dat",
    "MSTTSLocZhCN.dat",
    "MSTTSLocZhCN.ini",
    "Tokens.xml",
    "ZhCN.address.dat",
    "ZhCN.message.dat",
    "ZhCN.mixlingual.dat",
    "ZhCN.name.dat",
    "am_v5_decoder.bin",
    "am_v5_encoder.bin",
    "device_vocoder_v6_streaming.bin",
    "phones.txt",
    "punc.txt"
)

val prepareBundledTtsModel = tasks.register<Copy>("prepareBundledTtsModel") {
    from(rootProject.file("../models/extracted")) {
        include(bundledTtsModelFiles)
    }
    into(layout.buildDirectory.dir("generated/assets/tts"))
}

android {
    namespace = "com.aasc.tts"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.aasc.tts"
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
    dependsOn(prepareBundledTtsModel)
}

dependencies {
    implementation("androidx.core:core-ktx:1.12.0")
    implementation("androidx.appcompat:appcompat:1.6.1")
    implementation(files("../../../../src/apps/android-display/app/libs/client-sdk-embedded-1.51.2.aar"))
    implementation("com.azure:azure-core:1.58.1")
    testImplementation("junit:junit:4.13.2")
}
