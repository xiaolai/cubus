// The C ABI the Rust plugin (crates/cube-vision) links via swift-rs. Everything the plugin needs is
// here as `@_cdecl` free functions over one process-global model + camera — a Tauri plugin is a
// singleton and the CoreML compile/load is a one-time cost, so a global is the honest shape.
//
// The tensor never crosses as anything but raw Float32 the caller already sized: load() returns the
// element count so Rust allocates exactly once, and infer/next write into that buffer. No JSON for
// the hot path (the whole point is that only ~170 KB of tensor crosses the bridge, not the frame).

import CoreML
import Foundation

private final class State {
    var model: CubeModel?
    var camera: Camera?
    var rows = 0
    var anchors = 0
}

private let state = State()
private let stateLock = NSLock()

private func units(_ raw: Int32) -> MLComputeUnits {
    switch raw {
    case 1: return .cpuOnly
    case 2: return .cpuAndGPU
    case 3: return .cpuAndNeuralEngine
    default: return .all
    }
}

/// Load (compile) the model. Returns the output element count (rows*anchors) so the caller sizes its
/// buffer once, or a negative error code.
@_cdecl("cube_vision_load")
public func cube_vision_load(_ path: UnsafePointer<CChar>, _ computeUnits: Int32) -> Int32 {
    stateLock.lock(); defer { stateLock.unlock() }
    let url = URL(fileURLWithPath: String(cString: path))
    do {
        let model = try CubeModel(mlpackageURL: url, computeUnits: units(computeUnits))
        // One warm inference to learn the output shape and pay the first-run compile now, not on tick 1.
        let probe = try model.infer(chw: [Float](repeating: Letterbox.pad, count: 3 * Letterbox.imgSize * Letterbox.imgSize))
        state.model = model
        state.rows = probe.rows
        state.anchors = probe.anchors
        return Int32(probe.rows * probe.anchors)
    } catch {
        FileHandle.standardError.write("cube_vision_load: \(error)\n".data(using: .utf8)!)
        return -1
    }
}

private func writeInference(_ inf: Inference, _ out: UnsafeMutablePointer<Float>, _ cap: Int32,
                            _ outRows: UnsafeMutablePointer<Int32>, _ outAnchors: UnsafeMutablePointer<Int32>) -> Int32 {
    let count = inf.rows * inf.anchors
    if Int32(count) > cap { return -2 }   // caller undersized the buffer; it sized from load()'s return, so this is a bug
    inf.data.withUnsafeBufferPointer { out.update(from: $0.baseAddress!, count: count) }
    outRows.pointee = Int32(inf.rows)
    outAnchors.pointee = Int32(inf.anchors)
    return Int32(count)
}

/// Letterbox + infer a still RGBA frame (the inject-frame path the golden harness uses). Returns the
/// element count written, or a negative error.
@_cdecl("cube_vision_infer_rgba")
public func cube_vision_infer_rgba(_ rgba: UnsafePointer<UInt8>, _ w: Int32, _ h: Int32,
                                   _ out: UnsafeMutablePointer<Float>, _ cap: Int32,
                                   _ outRows: UnsafeMutablePointer<Int32>, _ outAnchors: UnsafeMutablePointer<Int32>) -> Int32 {
    stateLock.lock(); defer { stateLock.unlock() }
    guard let model = state.model else { return -3 }
    do {
        let chw = Letterbox.chw(rgba: rgba, width: Int(w), height: Int(h))
        return writeInference(try model.infer(chw: chw), out, cap, outRows, outAnchors)
    } catch {
        FileHandle.standardError.write("cube_vision_infer_rgba: \(error)\n".data(using: .utf8)!)
        return -1
    }
}

/// Cameras as a JSON array string; caller frees with cube_vision_free_string.
@_cdecl("cube_vision_list_cameras")
public func cube_vision_list_cameras() -> UnsafeMutablePointer<CChar>? {
    let infos = Camera.list()
    guard let data = try? JSONEncoder().encode(infos), let json = String(data: data, encoding: .utf8) else {
        return strdup("[]")
    }
    return strdup(json)
}

@_cdecl("cube_vision_free_string")
public func cube_vision_free_string(_ ptr: UnsafeMutablePointer<CChar>?) {
    free(ptr)
}

@_cdecl("cube_vision_current_camera")
public func cube_vision_current_camera() -> UnsafeMutablePointer<CChar>? {
    stateLock.lock(); defer { stateLock.unlock() }
    guard let info = state.camera?.current,
        let data = try? JSONEncoder().encode(info),
        let json = String(data: data, encoding: .utf8)
    else { return nil }
    return strdup(json)
}

@_cdecl("cube_vision_open_camera")
public func cube_vision_open_camera(_ deviceId: UnsafePointer<CChar>?) -> Int32 {
    stateLock.lock(); defer { stateLock.unlock() }
    let cam = state.camera ?? Camera()
    state.camera = cam
    do {
        try cam.open(deviceId: deviceId.map { String(cString: $0) })
        return 0
    } catch {
        FileHandle.standardError.write("cube_vision_open_camera: \(error)\n".data(using: .utf8)!)
        return -1
    }
}

@_cdecl("cube_vision_close_camera")
public func cube_vision_close_camera() {
    stateLock.lock(); defer { stateLock.unlock() }
    state.camera?.close()
}

/// Grab the latest camera frame, letterbox + infer it. Returns the element count, 0 when no frame has
/// arrived yet (the caller tries again next tick), or a negative error.
@_cdecl("cube_vision_next_detection")
public func cube_vision_next_detection(_ out: UnsafeMutablePointer<Float>, _ cap: Int32,
                                       _ outRows: UnsafeMutablePointer<Int32>, _ outAnchors: UnsafeMutablePointer<Int32>) -> Int32 {
    stateLock.lock(); defer { stateLock.unlock() }
    guard let model = state.model else { return -3 }
    guard let cam = state.camera, let frame = cam.latestFrame() else { return 0 }
    do {
        let chw = frame.bytes.withUnsafeBufferPointer { Letterbox.chw(rgba: $0.baseAddress!, width: frame.width, height: frame.height) }
        return writeInference(try model.infer(chw: chw), out, cap, outRows, outAnchors)
    } catch {
        FileHandle.standardError.write("cube_vision_next_detection: \(error)\n".data(using: .utf8)!)
        return -1
    }
}
