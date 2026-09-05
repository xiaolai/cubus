// The C ABI the Rust plugin (crates/cube-vision) links via swift-rs. Everything the plugin needs is
// here as `@_cdecl` free functions over one process-global model + camera — a Tauri plugin is a
// singleton and the CoreML compile/load is a one-time cost, so a global is the honest shape.
//
// The tensor never crosses as anything but raw Float32 the caller already sized: load() returns the
// element count so Rust allocates exactly once, and infer/next write into that buffer. No JSON for
// the hot path (the whole point is that only ~170 KB of tensor crosses the bridge, not the frame).
//
// ERRORS ARE CODES PLUS A MESSAGE THE CALLER FETCHES. This file used to write every failure to
// stderr and return -1; a Finder-launched app has no stderr, so the Rust side's "see stderr" pointed
// at nothing and a camera that refused to open was reported as a bare number. Each failing call now
// records ONE message under the state lock, and `cube_vision_last_error` hands it over (consumed on
// read) for the Rust side to log through the `log` facade and return to the webview. Nothing here
// writes to a file handle any more.
//
// Codes: 0 / positive = success (a count where one is meaningful); -1 = the operation threw (see
// the message); -2 = the caller's buffer is smaller than load() promised (a bug, not a condition);
// -3 = no model loaded; -4 = no camera open.

import CoreML
import Foundation

private final class State {
    var model: CubeModel?
    /// What `model` was built from. A repeat load for the same pair is answered from here without
    /// recompiling — the scan panel is re-mounted per screen and asks its parked detector to load
    /// every time, and `MLModel.compileModel` is seconds of work that must not be paid per mount.
    var loadedPath: String?
    var loadedUnits: Int32?
    var camera: Camera?
    var rows = 0
    var anchors = 0
    /// How many times a CoreML model has actually been compiled in this process. Exposed for the
    /// Rust test that proves the short-circuit above: a repeat load must not move it.
    var compileCount: Int32 = 0
    /// The explanation for the last failing call, until someone asks.
    var lastError: String?
}

private let state = State()
private let stateLock = NSLock()

/// Record why a call failed. Under the lock already held by every caller.
private func fail(_ what: String, _ error: Error) -> Int32 {
    state.lastError = "\(what): \(error)"
    return -1
}

private func units(_ raw: Int32) -> MLComputeUnits {
    switch raw {
    case 1: return .cpuOnly
    case 2: return .cpuAndGPU
    case 3: return .cpuAndNeuralEngine
    default: return .all
    }
}

/// Load (compile) the model. Returns the output element count (rows*anchors) so the caller sizes its
/// buffer once, or a negative error code. A repeat call with the same path and compute units is
/// answered from the loaded model without touching CoreML.
@_cdecl("cube_vision_load")
public func cube_vision_load(_ path: UnsafePointer<CChar>, _ computeUnits: Int32) -> Int32 {
    stateLock.lock(); defer { stateLock.unlock() }
    let pathString = String(cString: path)
    if state.model != nil, state.loadedPath == pathString, state.loadedUnits == computeUnits {
        return Int32(state.rows * state.anchors)
    }
    let url = URL(fileURLWithPath: pathString)
    do {
        let model = try CubeModel(mlpackageURL: url, computeUnits: units(computeUnits))
        state.compileCount += 1
        // One warm inference to learn the output shape and pay the first-run compile now, not on tick 1.
        let probe = try model.infer(chw: [Float](repeating: Letterbox.pad, count: 3 * Letterbox.imgSize * Letterbox.imgSize))
        state.model = model
        state.loadedPath = pathString
        state.loadedUnits = computeUnits
        state.rows = probe.rows
        state.anchors = probe.anchors
        return Int32(probe.rows * probe.anchors)
    } catch {
        // A failed load leaves no half-model behind that a later same-pair call could be answered from.
        state.model = nil
        state.loadedPath = nil
        state.loadedUnits = nil
        return fail("cube_vision_load", error)
    }
}

/// The number of CoreML compiles this process has performed. A test instrument — see `State`.
@_cdecl("cube_vision_compile_count")
public func cube_vision_compile_count() -> Int32 {
    stateLock.lock(); defer { stateLock.unlock() }
    return state.compileCount
}

/// The message recorded by the last failing call, consumed; null when none is recorded. Caller
/// frees with cube_vision_free_string.
@_cdecl("cube_vision_last_error")
public func cube_vision_last_error() -> UnsafeMutablePointer<CChar>? {
    stateLock.lock(); defer { stateLock.unlock() }
    guard let message = state.lastError else { return nil }
    state.lastError = nil
    return strdup(message)
}

private func writeInference(_ inf: Inference, _ out: UnsafeMutablePointer<Float>, _ cap: Int32,
                            _ outRows: UnsafeMutablePointer<Int32>, _ outAnchors: UnsafeMutablePointer<Int32>) -> Int32 {
    let count = inf.rows * inf.anchors
    if Int32(count) > cap {
        // The caller sized from load()'s return, so this is a bug on one side or the other — say which numbers.
        state.lastError = "the output tensor is \(count) elements but the caller's buffer holds \(cap)"
        return -2
    }
    inf.data.withUnsafeBufferPointer { out.update(from: $0.baseAddress!, count: count) }
    outRows.pointee = Int32(inf.rows)
    outAnchors.pointee = Int32(inf.anchors)
    return Int32(count)
}

/// Letterbox + infer a still RGBA frame (the inject-frame path the golden harness uses). Returns the
/// element count written, or a negative error. The Rust side has already proven `w`/`h` positive
/// and the buffer exactly `w*h*4`; `Letterbox.chw` preconditions the former again, loudly.
@_cdecl("cube_vision_infer_rgba")
public func cube_vision_infer_rgba(_ rgba: UnsafePointer<UInt8>, _ w: Int32, _ h: Int32,
                                   _ out: UnsafeMutablePointer<Float>, _ cap: Int32,
                                   _ outRows: UnsafeMutablePointer<Int32>, _ outAnchors: UnsafeMutablePointer<Int32>) -> Int32 {
    stateLock.lock(); defer { stateLock.unlock() }
    guard let model = state.model else {
        state.lastError = "no model loaded"
        return -3
    }
    do {
        let chw = Letterbox.chw(rgba: rgba, width: Int(w), height: Int(h))
        return writeInference(try model.infer(chw: chw), out, cap, outRows, outAnchors)
    } catch {
        return fail("cube_vision_infer_rgba", error)
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
        return fail("cube_vision_open_camera", error)
    }
}

@_cdecl("cube_vision_close_camera")
public func cube_vision_close_camera() {
    stateLock.lock(); defer { stateLock.unlock() }
    state.camera?.close()
}

/// Grab the latest camera frame, letterbox + infer it. Returns the element count, 0 when the camera
/// is open but no frame has arrived yet (the caller tries again next tick, and keeps a clock on how
/// long that goes on), or a negative error — -4 when no camera is open at all, which is a different
/// condition from "no frame yet" and used to be reported as the same zero.
@_cdecl("cube_vision_next_detection")
public func cube_vision_next_detection(_ out: UnsafeMutablePointer<Float>, _ cap: Int32,
                                       _ outRows: UnsafeMutablePointer<Int32>, _ outAnchors: UnsafeMutablePointer<Int32>) -> Int32 {
    stateLock.lock(); defer { stateLock.unlock() }
    guard let model = state.model else {
        state.lastError = "no model loaded"
        return -3
    }
    guard let cam = state.camera, cam.current != nil else {
        state.lastError = "no camera is open"
        return -4
    }
    guard let frame = cam.latestFrame() else { return 0 }
    do {
        let chw = frame.bytes.withUnsafeBufferPointer { Letterbox.chw(rgba: $0.baseAddress!, width: frame.width, height: frame.height) }
        return writeInference(try model.infer(chw: chw), out, cap, outRows, outAnchors)
    } catch {
        return fail("cube_vision_next_detection", error)
    }
}
