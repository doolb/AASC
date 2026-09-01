import org.gradle.api.tasks.Copy

plugins {
    id("com.android.application")
}

val bundledRapidOcrModelFiles = listOf(
    "PP-OCRv6_det_small.onnx",
    "ch_ppocr_mobile_v2.0_cls_mobile.onnx",
    "PP-OCRv6_rec_small.onnx",
    "ppocrv6_dict.txt"
)

val prepareBundledRapidOcrModels = tasks.register<Copy>("prepareBundledRapidOcrModels") {
    from(rootProject.file("../../../res/models/rapidocr")) {
        include(bundledRapidOcrModelFiles)
    }
    into(layout.buildDirectory.dir("generated/assets/rapidocr"))
}

android {
    namespace = "com.aasc.rapidocr"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.aasc.rapidocr"
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
    dependsOn(prepareBundledRapidOcrModels)
}

dependencies {
    implementation("androidx.core:core-ktx:1.12.0")
    implementation("androidx.appcompat:appcompat:1.6.1")
    implementation("com.microsoft.onnxruntime:onnxruntime-android:1.22.0")
    implementation("org.opencv:opencv:4.9.0")
    implementation("androidx.exifinterface:exifinterface:1.3.7")
    testImplementation("junit:junit:4.13.2")
}
