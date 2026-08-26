// cube-vision-probe: the headless proof that the NATIVE inference path reads a frame the same way
// the browser does. It is the plugin's real letterbox + CoreML runner behind a CLI, so the
// golden-frame harness can drive it with no Tauri, no camera and no cube.
//
//   cube-vision-probe <model.mlpackage> <frame.png> <out.bin> [all|cpu_and_ne|cpu_and_gpu|cpu_only]
//
// It prints, on stdout, the SHA-256 of the letterboxed CHW Float32 tensor — the same fingerprint
// ml/cube_infer.py and onnx-detect.ts's preprocess produce, so a drift in the SWIFT letterbox fails
// the gate. It writes the raw detect output to <out.bin> as: int32 rows, int32 anchors (little-
// endian), then rows*anchors Float32 — which golden_frames.py reads and runs through the ONE Python
// post-processing (decode → NMS → fitFace), exactly as it does for every other runtime.

import CoreML
import CryptoKit
import CubeVision
import Foundation
import ImageIO
import UniformTypeIdentifiers

func die(_ msg: String) -> Never {
    FileHandle.standardError.write((msg + "\n").data(using: .utf8)!)
    exit(1)
}

// Decode a PNG to straight RGBA8, row-major, no premultiplication surprises (fixtures are opaque).
func loadRGBA(_ url: URL) -> (bytes: [UInt8], width: Int, height: Int) {
    guard let src = CGImageSourceCreateWithURL(url as CFURL, nil),
        let img = CGImageSourceCreateImageAtIndex(src, 0, nil)
    else { die("cannot decode \(url.path)") }
    let w = img.width, h = img.height
    var bytes = [UInt8](repeating: 0, count: w * h * 4)
    let cs = CGColorSpace(name: CGColorSpace.sRGB)!
    guard let ctx = CGContext(
        data: &bytes, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
        space: cs, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
    ) else { die("cannot make RGBA context") }
    ctx.draw(img, in: CGRect(x: 0, y: 0, width: w, height: h))
    return (bytes, w, h)
}

let args = CommandLine.arguments
guard args.count >= 4 else { die("usage: cube-vision-probe <model.mlpackage> <frame.png> <out.bin> [units]") }
let modelURL = URL(fileURLWithPath: args[1])
let pngURL = URL(fileURLWithPath: args[2])
let outURL = URL(fileURLWithPath: args[3])
let units: MLComputeUnits = {
    switch args.count > 4 ? args[4] : "all" {
    case "cpu_only": return .cpuOnly
    case "cpu_and_gpu": return .cpuAndGPU
    case "cpu_and_ne": return .cpuAndNeuralEngine
    default: return .all
    }
}()

do {
    let (rgba, w, h) = loadRGBA(pngURL)
    let chw = rgba.withUnsafeBufferPointer { Letterbox.chw(rgba: $0.baseAddress!, width: w, height: h) }

    // SHA-256 of the tensor's little-endian Float32 bytes — the cross-language fingerprint.
    let sha = chw.withUnsafeBytes { SHA256.hash(data: Data($0)) }
    print(sha.map { String(format: "%02x", $0) }.joined())

    let model = try CubeModel(mlpackageURL: modelURL, computeUnits: units)
    let inf = try model.infer(chw: chw)

    var blob = Data()
    var rows = Int32(inf.rows).littleEndian
    var anchors = Int32(inf.anchors).littleEndian
    withUnsafeBytes(of: &rows) { blob.append(contentsOf: $0) }
    withUnsafeBytes(of: &anchors) { blob.append(contentsOf: $0) }
    inf.data.withUnsafeBufferPointer { blob.append(contentsOf: UnsafeRawBufferPointer($0)) }
    try blob.write(to: outURL)
} catch {
    die("probe failed: \(error)")
}
