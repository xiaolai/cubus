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
