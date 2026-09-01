import org.gradle.api.tasks.Exec

plugins {
    id("com.android.application")
}

val prepareBundledYoloModels = tasks.register<Exec>("prepareBundledYoloModels") {
    val inputDirectory = providers.environmentVariable("YOLO11_MODEL_DIR").orElse("/home/as").get()
    val outputDirectory = layout.buildDirectory.dir("generated/assets/yolo11").get().asFile
    commandLine(
        "python3",
        rootProject.file("../scripts/export-yolo11-onnx.py").absolutePath,
        "--input-dir",
        inputDirectory,
        "--output-dir",
        outputDirectory.absolutePath
    )
}

android {
    namespace = "com.aasc.yolo"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.aasc.yolo"
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
    dependsOn(prepareBundledYoloModels)
}

dependencies {
    implementation("androidx.core:core-ktx:1.12.0")
    implementation("androidx.appcompat:appcompat:1.6.1")
    implementation("com.microsoft.onnxruntime:onnxruntime-android:1.22.0")
    testImplementation("junit:junit:4.13.2")
}
