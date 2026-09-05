import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("rust")
}

val tauriProperties = Properties().apply {
    val propFile = file("tauri.properties")
    if (propFile.exists()) {
        propFile.inputStream().use { load(it) }
    }
}

// Release signing, read from a file that is NEVER committed (gen/android/.gitignore already
// lists keystore.properties, and the repo root ignores the key material itself).
//
// Absent on purpose in a normal checkout: `tauri android build` is also the mobile compile gate
// (dev-docs/mobile-shell-plan.md M0), and a missing keystore must not stop someone proving the
// thing compiles. So the config is wired only when the file is there, and its ABSENCE is
// announced rather than silently producing an unsigned artifact that looks like a release. The
// release workflow does not trust this warning — it asserts the artifact is signed before it
// uploads anything, because a warning in a 20-minute log is a warning nobody reads.
val keystorePropertiesFile = rootProject.file("keystore.properties")
val keystoreProperties = Properties().apply {
    if (keystorePropertiesFile.exists()) {
        keystorePropertiesFile.inputStream().use { load(it) }
    }
}
val hasReleaseKeystore = keystoreProperties.getProperty("storeFile") != null

android {
    compileSdk = 36
    namespace = "im.cubus.app"
    defaultConfig {
        manifestPlaceholders["usesCleartextTraffic"] = "false"
        applicationId = "im.cubus.app"
        minSdk = 24
        targetSdk = 36
        versionCode = tauriProperties.getProperty("tauri.android.versionCode", "1").toInt()
        versionName = tauriProperties.getProperty("tauri.android.versionName", "1.0")
    }
    signingConfigs {
        if (hasReleaseKeystore) {
            create("release") {
                // Relative to gen/android — where keystore.properties itself lives and where the
                // release workflow writes `storeFile=upload.jks` beside it. `file()` here resolves
                // against THIS module's directory (gen/android/app), so that path could never
                // resolve and every "signed" release build would have failed at the signing step
                // — or, worse, been configured against a file that did not exist (audit
                // 2026-09-04, mobile A2). An absolute path in the properties file still works.
                storeFile = rootProject.file(keystoreProperties.getProperty("storeFile"))
                storePassword = keystoreProperties.getProperty("storePassword")
                keyAlias = keystoreProperties.getProperty("keyAlias")
                keyPassword = keystoreProperties.getProperty("keyPassword")
            }
        }
    }
    buildTypes {
        getByName("debug") {
            applicationIdSuffix = ".debug"
            manifestPlaceholders["usesCleartextTraffic"] = "true"
            isDebuggable = true
            isJniDebuggable = true
            isMinifyEnabled = false
            packaging {                jniLibs.keepDebugSymbols.add("*/arm64-v8a/*.so")
                jniLibs.keepDebugSymbols.add("*/armeabi-v7a/*.so")
                jniLibs.keepDebugSymbols.add("*/x86/*.so")
                jniLibs.keepDebugSymbols.add("*/x86_64/*.so")
            }
        }
        getByName("release") {
            if (hasReleaseKeystore) {
                signingConfig = signingConfigs.getByName("release")
            } else {
                logger.warn(
                    "cubus: no gen/android/keystore.properties, so this release build will be " +
                    "UNSIGNED and cannot be installed or uploaded. See dev-docs/release-runbook.md."
                )
            }
            isMinifyEnabled = true
            proguardFiles(
                *fileTree(".") { include("**/*.pro") }
                    .plus(getDefaultProguardFile("proguard-android-optimize.txt"))
                    .toList().toTypedArray()
            )
        }
    }
    kotlinOptions {
        jvmTarget = "1.8"
    }
    buildFeatures {
        buildConfig = true
    }
}

rust {
    rootDirRel = "../../../"
}

/**
 * Put the detector's model in the APK, copied from ml/models rather than committed here as well.
 *
 * One source of truth: ml/export.py writes all three artifacts (.onnx, .mlpackage, .tflite) from
 * the one checkpoint, and ml/golden_frames.py cross-checks them. A second copy checked in under
 * gen/android would be a file nothing regenerates and nothing compares — exactly the drift the
 * vendored-bundle gate exists to catch on the web side.
 */
val cubusModelFile = rootProject.file("../../../../../ml/models/cube-yolo.tflite")
val cubusModel = tasks.register<Copy>("copyCubeModel") {
    // FAIL, do not skip. A `from()` pointing at a missing file makes the task NO-SOURCE and the
    // build stays green while shipping an APK with no model in it — the plugin's `probe` then
    // answers false forever and the app falls back to WebDetector with nothing anywhere saying
    // why. The first version of this line had the wrong number of `..` and did exactly that.
    doFirst {
        if (!cubusModelFile.isFile) {
            throw GradleException(
                "cubus: ${'$'}{cubusModelFile.absolutePath} is missing — run ml/export.py. " +
                    "Without it the Android build produces an app whose native scanner silently " +
                    "never starts.",
            )
        }
    }
    from(cubusModelFile)
    into(layout.projectDirectory.dir("src/main/assets"))
}
tasks.named("preBuild") { dependsOn(cubusModel) }

dependencies {
    // Native capture and inference for Android (VisionPlugin.kt). CameraX for frames, TFLite for
    // the model — the `.tflite` is exported from the same checkpoint as the .onnx and .mlpackage
    // by ml/export.py and cross-checked against them by ml/golden_frames.py, so the artifact is
    // already gated even though this consumer of it is not yet proven on a device.
    implementation("androidx.camera:camera-core:1.4.1")
    implementation("androidx.camera:camera-camera2:1.4.1")
    implementation("androidx.camera:camera-lifecycle:1.4.1")
    implementation("org.tensorflow:tensorflow-lite:2.17.0")
    implementation("androidx.webkit:webkit:1.14.0")
    implementation("androidx.appcompat:appcompat:1.7.1")
    implementation("androidx.activity:activity-ktx:1.10.1")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.lifecycle:lifecycle-process:2.10.0")
    testImplementation("junit:junit:4.13.2")
}

apply(from = "tauri.build.gradle.kts")