// swift-tools-version:5.9
// The native capture-and-inference core, as a Swift package. One static-library target so the whole
// archive (letterbox + CoreML runner + AVFoundation capture + the @_cdecl FFI) links as one
// libCubeVision.a — which is what swift-rs links into the Tauri plugin (crates/cube-vision). The
// probe executable drives the SAME code from a CLI so the golden-frame harness can prove parity with
// no Tauri and no camera.
import PackageDescription

let package = Package(
    name: "CubeVision",
    platforms: [.macOS(.v13), .iOS(.v16)],
    products: [
        .library(name: "CubeVision", type: .static, targets: ["CubeVision"]),
        .executable(name: "cube-vision-probe", targets: ["cube-vision-probe"]),
    ],
    targets: [
        .target(name: "CubeVision"),
        .executableTarget(name: "cube-vision-probe", dependencies: ["CubeVision"]),
    ]
)
