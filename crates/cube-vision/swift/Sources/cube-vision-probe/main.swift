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

// `--self-check`: prove the fp16 widening in CubeVision/Model.swift against Swift's own `Float16`,
// exhaustively, over all 65,536 half bit patterns.
//
// It exists because `Float16` is arm64-only on macOS: the widening had to be rewritten by hand so a
// universal binary could compile its x86_64 half, and a hand-written IEEE-754 conversion is exactly
// the kind of code that is subtly wrong in the corners nothing exercises — subnormals, NaN payloads,
// the exponent rebias. Exhaustive is cheap here: 65,536 cases is the WHOLE domain, so this is a
// proof rather than a sample.
//
// It runs only where `Float16` exists, which is the point: on arm64 there are two implementations
// to disagree, and that is where the check has content. On x86_64 there is nothing to compare
// against, so it reports that it could not run rather than passing.
if args.count > 1 && args[1] == "--self-check" {
    #if arch(arm64)
        var bad = 0
        for bits in 0...UInt16.max {
            let mine = float32(fromFloat16: bits)
            let theirs = Float(Float16(bitPattern: bits))
            // Compare BIT PATTERNS, not values: `==` is false for NaN and true across ±0, so it
            // would pass over both a flattened NaN payload and a lost sign of zero.
            if mine.bitPattern != theirs.bitPattern {
                if bad < 8 {
                    FileHandle.standardError.write(
                        "0x\(String(bits, radix: 16)): mine \(mine.bitPattern) vs Float16 \(theirs.bitPattern)\n"
                            .data(using: .utf8)!)
                }
                bad += 1
            }
        }
        if bad > 0 { die("FAIL: the fp16 widening disagrees with Float16 on \(bad) of 65536 patterns") }
        print("PASS: fp16 widening matches Float16 on all 65536 patterns, bit for bit")
        exit(0)
    #else
        die("CANNOT RUN: --self-check needs Float16, which macOS provides only on arm64")
    #endif
}

// `--leak-check <model.mlpackage> [calls]`: what one FFI inference leaves behind in resident memory
// when it is driven from a thread that has NO autorelease pool — which is what the desktop app's
// `next_detection` worker is: a Tauri `(async)` command runs on a tokio worker thread that lives
// for the whole process and never pops a pool. Objective-C objects autoreleased on such a thread
// are never released at all (the runtime installs a page with no boundary to pop), and CoreML
// autoreleases plenty per prediction. Measured on 2026-09-06 after a user's machine reported the
// app at 94 GB: see the number this prints against the same loop with a pool per call.
func residentMB() -> Double {
    var info = mach_task_basic_info()
    var count = mach_msg_type_number_t(MemoryLayout<mach_task_basic_info>.size / MemoryLayout<natural_t>.size)
    let kr = withUnsafeMutablePointer(to: &info) {
        $0.withMemoryRebound(to: integer_t.self, capacity: Int(count)) {
            task_info(mach_task_self_, task_flavor_t(MACH_TASK_BASIC_INFO), $0, &count)
        }
    }
    return kr == KERN_SUCCESS ? Double(info.resident_size) / 1_048_576 : -1
}

if args.count > 2 && args[1] == "--leak-check" {
    let calls = args.count > 3 ? (Int(args[3]) ?? 300) : 300
    let cap = args[2].withCString { cube_vision_load($0, 0) }
    guard cap > 0 else { die("cube_vision_load failed: \(cap)") }
    let w = 640, h = 480
    let rgba = [UInt8](repeating: 128, count: w * h * 4)
    var out = [Float](repeating: 0, count: Int(cap))

    // One pass without a pool, one with, each on a fresh thread so neither inherits the other's
    // page. The difference between the two growths is the per-call leak of the FFI path.
    func pass(pooled: Bool) -> (before: Double, after: Double) {
        var before = 0.0, after = 0.0
        let thread = Thread {
            var rows: Int32 = 0, anchors: Int32 = 0
            let one = {
                let r = rgba.withUnsafeBufferPointer { p in
                    out.withUnsafeMutableBufferPointer { o in
                        cube_vision_infer_rgba(p.baseAddress!, Int32(w), Int32(h), o.baseAddress!, cap, &rows, &anchors)
                    }
                }
                if r < 0 { die("cube_vision_infer_rgba failed: \(r)") }
            }
            // Warm up outside the measurement: the first call pays one-off allocations.
            for _ in 0..<5 { if pooled { autoreleasepool { one() } } else { one() } }
            before = residentMB()
            for _ in 0..<calls { if pooled { autoreleasepool { one() } } else { one() } }
            after = residentMB()
        }
        thread.start()
        while !thread.isFinished { Thread.sleep(forTimeInterval: 0.02) }
        return (before, after)
    }
    let bare = pass(pooled: false)
    let pooled = pass(pooled: true)
    let perCall = { (p: (before: Double, after: Double)) in (p.after - p.before) * 1024 / Double(calls) }
    print(String(format: "no pool:   %.1f MB -> %.1f MB over %d calls  (%.0f KB per call)", bare.before, bare.after, calls, perCall(bare)))
    print(String(format: "with pool: %.1f MB -> %.1f MB over %d calls  (%.0f KB per call)", pooled.before, pooled.after, calls, perCall(pooled)))
    // THE GATE. The FFI entries push their own pool (FFI.swift's `entry`), so a pool-less caller
    // must see the same flat line a pooled one does. 100 KB per call is the line: the leak this
    // caught was 3,609 KB per call, and resident memory wobbles by tens of KB per call from the
    // allocator alone, so the two are three orders apart and the threshold cannot mistake one for
    // the other.
    if perCall(bare) > 100 {
        die(String(format: "LEAK: %.0f KB per call from a thread with no autorelease pool — an FFI entry in FFI.swift is running outside `entry`/`pooled`", perCall(bare)))
    }
    print("ok: the FFI path leaves nothing behind on a pool-less thread")
    exit(0)
}

guard args.count >= 4 else { die("usage: cube-vision-probe <model.mlpackage> <frame.png> <out.bin> [units]\n       cube-vision-probe --self-check\n       cube-vision-probe --leak-check <model.mlpackage> [calls]") }
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
