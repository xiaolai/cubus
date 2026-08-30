// The plugin's build: generate the command-permission ACL (always), then link the Swift package on
// Apple targets. The permission generation must run on every host so the app can resolve
// `cube-vision:default` even on a Linux CI runner, where the commands themselves are never compiled.

const COMMANDS: &[&str] = &[
    "probe",
    "list_cameras",
    "current_camera",
    "load_model",
    "open_camera",
    "close_camera",
    "next_detection",
    "infer_frame",
];

#[cfg(target_os = "macos")]
fn link_swift() {
    let target_os = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    if target_os != "macos" && target_os != "ios" {
        return;
    }
    // SwiftPM compiles Package.swift ITSELF as a host macOS program (`arm64-apple-macosx…`), and it
    // honours SDKROOT from the environment when it does. Cargo run from inside an Xcode build phase
    // — which is exactly how `tauri ios build` invokes it — inherits SDKROOT pointing at the iPhoneOS
    // or iPhoneSimulator SDK, so the manifest is compiled for macOS against an iPhone SDK and dies
    // with "unable to load standard library for target 'arm64-apple-macosx14.0'". The panic surfaces
    // as `build_script_build::link_swift`, which names the wrong culprit: nothing is wrong with the
    // package, only with the SDK the manifest was read under.
    //
    // Removing it is safe in every case, not just the failing one: swift-rs always passes an
    // explicit `--sdk` (and `-Xswiftc -sdk`) for the real build, so SDKROOT is redundant here even
    // when it happens to be correct. Verified 2026-08-30 — with SDKROOT set to the simulator SDK
    // this build failed and now succeeds, and `tauri ios build` gets past cargo.
    //
    // Safety: build scripts are single-threaded at this point; nothing else can be reading the
    // environment concurrently.
    std::env::remove_var("SDKROOT");

    swift_rs::SwiftLinker::new("13.0")
        .with_ios("16.0")
        .with_package("CubeVision", concat!(env!("CARGO_MANIFEST_DIR"), "/swift"))
        .link();
    for framework in [
        "CoreML",
        "Vision",
        "AVFoundation",
        "CoreVideo",
        "CoreMedia",
        "CoreImage",
        "Foundation",
    ] {
        println!("cargo:rustc-link-lib=framework={framework}");
    }
    println!("cargo:rerun-if-changed=swift/Sources");
    println!("cargo:rerun-if-changed=swift/Package.swift");
}

#[cfg(not(target_os = "macos"))]
fn link_swift() {}

fn main() {
    tauri_plugin::Builder::new(COMMANDS).build();
    link_swift();
}
