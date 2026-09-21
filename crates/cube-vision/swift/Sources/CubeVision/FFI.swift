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
// records ONE message, and `cube_vision_last_error` hands it over (consumed on read) for the Rust
// side to log through the `log` facade and return to the webview. The message is kept PER THREAD
// (`LastError`, 2026-09-21): the Rust side fetches it on the thread that made the failing call,
// right after it, and a process-wide slot let another command's failure on another Tauri worker
// overwrite or consume it in between (audit finding 105). Nothing here writes to a file handle.
//
// Codes: 0 / positive = success (a count where one is meaningful); -1 = the operation threw (see
// the message); -2 = the caller's buffer is smaller than load() promised (a bug, not a condition);
// -3 = no model loaded; -4 = no camera open; -5 = a still's byte count is not its dimensions' RGBA size;
// -6 = the open camera stopped — the OS reported its device disconnected or its session failed, and
// the message says which (2026-09-20). Distinct from -4: a camera WAS opened, and it went away.

import CoreML
import Foundation

/// The process's one model and one camera. Internal, not private, so `swift test` reaches it through
/// `@testable import`; nothing outside the module sees it.
final class State {
    var model: (any FrameInferring)?
    /// What `model` was built from. A repeat load for the same pair is answered from here without
    /// recompiling — the scan panel is re-mounted per screen and asks its parked detector to load
    /// every time, and `MLModel.compileModel` is seconds of work that must not be paid per mount.
    var loadedPath: String?
    var loadedUnits: Int32?
    var camera: Camera?
    var rows = 0
    var anchors = 0
    /// How many times a `CubeModel` has been BUILT in this process. Exposed for the Rust test that
    /// proves the short-circuit above: a repeat load must not move it, a load with other compute
    /// units must. Since 2026-09-20 a build compiles only when the compiled-model cache has no
    /// entry for the source (Model.swift), so this counts builds — each a CoreML load, and each
    /// the cost the short-circuit spares — under the name it had when every build was a compile.
    var compileCount: Int32 = 0
    /// How a model is built from a path: `CubeModel` in the app; a test's stand-in through
    /// `useModelBuilderForTests`, for the paths the committed model cannot be made to take — a
    /// build that fails after a model is loaded, a probe that answers a shape nothing can hold.
    var buildModel: (URL, MLComputeUnits) throws -> any FrameInferring = State.defaultBuilder

    static let defaultBuilder: (URL, MLComputeUnits) throws -> any FrameInferring = {
        try CubeModel(mlpackageURL: $0, computeUnits: $1)
    }
}

let state = State()
private let stateLock = NSLock()

/// The message of the last failing call ON THE CALLING THREAD, until that thread asks for it. See
/// the file comment: the Rust side asks on the thread that failed, immediately, so a slot per
/// thread makes the message travel with the call, whatever other threads do meanwhile.
enum LastError {
    private static let key = "im.cubus.cube-vision.last-error"

    static func record(_ message: String) {
        Thread.current.threadDictionary[key] = message
    }

    /// The calling thread's message, consumed.
    static func take() -> String? {
        let slot = Thread.current.threadDictionary
        defer { slot.removeObject(forKey: key) }
        return slot[key] as? String
    }
}

/// Every entry below runs inside this: the state lock, and an autorelease pool.
///
/// THE POOL IS NOT OPTIONAL, and it is here rather than in each caller because the callers are
/// Rust threads. A Tauri `(async)` command runs on a tokio worker that lives for the whole process
/// and never pops an autorelease pool, and CoreML and AVFoundation autorelease objects on every
/// call. With no pool in place the Objective-C runtime installs a page that nothing ever pops, so
/// every object autoreleased on that thread lives until the process exits. Measured 2026-09-06
/// with `cube-vision-probe --leak-check`: 3.6 MB per inference from a pool-less thread, flat with a
/// pool. At the scan panel's 16 ticks a second that is 58 MB/s, which is how a user's Mac came to
/// report the app at 94 GB and out of memory. One pool per call, so nothing outlives the call.
private func entry<T>(_ body: () -> T) -> T {
    autoreleasepool {
        stateLock.lock(); defer { stateLock.unlock() }
        return body()
    }
}

/// The same pool for an entry that reads no state and so takes no lock.
private func pooled<T>(_ body: () -> T) -> T {
    autoreleasepool(invoking: body)
}

/// Tests only (`@testable import`; internal, so no C symbol): put the process's state back to nothing
/// loaded and nothing open — under the lock every entry takes — so each test starts from, and leaves,
/// the same state rather than whatever the test before it left (round-3 audit).
func resetStateForTests() {
    entry {
        state.model = nil
        state.loadedPath = nil
        state.loadedUnits = nil
        state.camera = nil
        state.rows = 0
        state.anchors = 0
        state.compileCount = 0
        state.buildModel = State.defaultBuilder
        _ = LastError.take()
    }
}

/// Tests only: `model` as the loaded model, claiming the shape `rows`×`anchors`, under the entries'
/// lock — a stand-in that fails, for the path the committed model cannot be made to take.
func useModelForTests(_ model: (any FrameInferring)?, rows: Int, anchors: Int) {
    entry {
        state.model = model
        state.loadedPath = nil
        state.loadedUnits = nil
        state.rows = rows
        state.anchors = anchors
    }
}

/// Tests only: how `cube_vision_load` builds a model, under the entries' lock — see `State.buildModel`.
func useModelBuilderForTests(_ build: @escaping (URL, MLComputeUnits) throws -> any FrameInferring) {
    entry { state.buildModel = build }
}

/// Tests only: `camera` as the process's open camera, under the entries' lock.
func useCameraForTests(_ camera: Camera?) {
    entry { state.camera = camera }
}

/// Record why a call failed, for the calling thread.
private func fail(_ what: String, _ error: Error) -> Int32 {
    LastError.record("\(what): \(error)")
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

/// The element count a probe's output promises the caller, or the reason it promises nothing: the
/// shape must be positive both ways, its product must fit the `Int32` the ABI returns — and the
/// buffer the Rust side sizes from it — and the data must actually be that many elements, or the
/// first tick's `update(from:count:)` reads past the array (audit finding 103). A zero here used to
/// be returned as a success of 0 elements, which the Rust side reads as "no model loaded".
func outputCount(of probe: Inference) throws -> Int32 {
    guard probe.rows > 0, probe.anchors > 0 else {
        throw CubeVisionError.badModel("the output tensor is \(probe.rows)×\(probe.anchors); both must be positive")
    }
    let (count, overflow) = probe.rows.multipliedReportingOverflow(by: probe.anchors)
    guard !overflow, count <= Int(Int32.max) else {
        throw CubeVisionError.badModel("the output tensor \(probe.rows)×\(probe.anchors) has more elements than the ABI's Int32 can count")
    }
    guard probe.data.count == count else {
        throw CubeVisionError.badModel("the output tensor claims \(probe.rows)×\(probe.anchors) = \(count) elements and holds \(probe.data.count)")
    }
    return Int32(count)
}

/// Load (compile) the model. Returns the output element count (rows*anchors) so the caller sizes its
/// buffer once, or a negative error code. A repeat call with the same path and compute units is
/// answered from the loaded model without touching CoreML.
///
/// A load is a transaction: the replacement is built, warmed and its shape checked, and only then
/// does it become the loaded model. A load that fails leaves the previous model exactly as it was,
/// because the Rust side keeps the element count of its last SUCCESSFUL load and sizes every
/// buffer from it — clearing the model here while that count stood made the two sides disagree
/// about whether a model existed (audit finding 104, 2026-09-21).
@_cdecl("cube_vision_load")
public func cube_vision_load(_ path: UnsafePointer<CChar>, _ computeUnits: Int32) -> Int32 {
    return entry { () -> Int32 in
        let pathString = String(cString: path)
        if state.model != nil, state.loadedPath == pathString, state.loadedUnits == computeUnits {
            return Int32(state.rows * state.anchors)
        }
        let url = URL(fileURLWithPath: pathString)
        do {
            let model = try state.buildModel(url, units(computeUnits))
            state.compileCount += 1
            // One warm inference to learn the output shape and pay the first-run compile now, not on tick 1.
            let probe = try model.infer(chw: [Float](repeating: Letterbox.pad, count: 3 * Letterbox.imgSize * Letterbox.imgSize), imgsz: Letterbox.imgSize)
            let count = try outputCount(of: probe)
            state.model = model
            state.loadedPath = pathString
            state.loadedUnits = computeUnits
            state.rows = probe.rows
            state.anchors = probe.anchors
            return count
        } catch {
            return fail("cube_vision_load", error)
        }
    }
}

/// The number of model builds this process has performed. A test instrument — see `State`.
@_cdecl("cube_vision_compile_count")
public func cube_vision_compile_count() -> Int32 {
    return entry { () -> Int32 in
        return state.compileCount
    }
}

/// The message recorded by the last failing call on the calling thread, consumed; null when none
/// is recorded. Caller frees with cube_vision_free_string. No state lock: the slot is the thread's.
@_cdecl("cube_vision_last_error")
public func cube_vision_last_error() -> UnsafeMutablePointer<CChar>? {
    return pooled { () -> UnsafeMutablePointer<CChar>? in
        guard let message = LastError.take() else { return nil }
        return strdup(message)
    }
}

/// The loaded model, or the -3 the entries answer when there is none, its message recorded.
private func loadedModel() -> (any FrameInferring)? {
    guard let model = state.model else {
        LastError.record("no model loaded")
        return nil
    }
    return model
}

/// The one inference pipeline both entries run — the still's and the camera's — so the two cannot
/// drift in what they validate or how they fail (audit finding 46): one run of `model` on a prepared
/// CHW tensor, the tensor written into the caller's buffer, and every failure as the code and the
/// message the file comment promises, `what` naming the entry.
private func infer(_ model: any FrameInferring, chw: [Float], into out: UnsafeMutablePointer<Float>, cap: Int32,
                   outRows: UnsafeMutablePointer<Int32>, outAnchors: UnsafeMutablePointer<Int32>, what: String) -> Int32 {
    do {
        return writeInference(try model.infer(chw: chw, imgsz: Letterbox.imgSize), out, cap, outRows, outAnchors)
    } catch {
        return fail(what, error)
    }
}

private func writeInference(_ inf: Inference, _ out: UnsafeMutablePointer<Float>, _ cap: Int32,
                            _ outRows: UnsafeMutablePointer<Int32>, _ outAnchors: UnsafeMutablePointer<Int32>) -> Int32 {
    let count = inf.rows * inf.anchors
    if Int32(count) > cap {
        // The caller sized from load()'s return, so this is a bug on one side or the other — say which numbers.
        LastError.record("the output tensor is \(count) elements but the caller's buffer holds \(cap)")
        return -2
    }
    inf.data.withUnsafeBufferPointer { out.update(from: $0.baseAddress!, count: count) }
    outRows.pointee = Int32(inf.rows)
    outAnchors.pointee = Int32(inf.anchors)
    return Int32(count)
}

/// Letterbox + infer a still RGBA frame (the inject-frame path the golden harness uses). Returns the
/// element count written, or a negative error. The Rust side has already proven `w`/`h` positive and
/// the buffer exactly `w*h*4`; the byte count that crosses with the pointer is checked against them
/// here too (-5), and `Letterbox.chw` preconditions positive dimensions again, loudly.
@_cdecl("cube_vision_infer_rgba")
public func cube_vision_infer_rgba(_ rgba: UnsafePointer<UInt8>, _ byteCount: Int, _ w: Int32, _ h: Int32,
                                   _ out: UnsafeMutablePointer<Float>, _ cap: Int32,
                                   _ outRows: UnsafeMutablePointer<Int32>, _ outAnchors: UnsafeMutablePointer<Int32>) -> Int32 {
    return entry { () -> Int32 in
        // The buffer's LENGTH crosses with it and is checked here, at the boundary, not only by the
        // one caller that happens to validate first: a pointer and two dimensions alone cannot stop a
        // read past the end, and `w * h * 4` can overflow into a trap (audit, 2026-09-19).
        let (px, pxOverflow) = Int(w).multipliedReportingOverflow(by: Int(h))
        let (bytes, bytesOverflow) = px.multipliedReportingOverflow(by: 4)
        guard w > 0, h > 0, !pxOverflow, !bytesOverflow, bytes == byteCount else {
            LastError.record("cube_vision_infer_rgba: \(w)x\(h) RGBA is not \(byteCount) bytes")
            return -5
        }
        guard let model = loadedModel() else { return -3 }
        let chw = Letterbox.chw(rgba: rgba, width: Int(w), height: Int(h))
        return infer(model, chw: chw, into: out, cap: cap, outRows: outRows, outAnchors: outAnchors, what: "cube_vision_infer_rgba")
    }
}

/// Cameras as a JSON array string; caller frees with cube_vision_free_string.
@_cdecl("cube_vision_list_cameras")
public func cube_vision_list_cameras() -> UnsafeMutablePointer<CChar>? {
    return pooled { () -> UnsafeMutablePointer<CChar>? in
        let infos = Camera.list()
        guard let data = try? JSONEncoder().encode(infos), let json = String(data: data, encoding: .utf8) else {
            return strdup("[]")
        }
        return strdup(json)
    }
}

@_cdecl("cube_vision_free_string")
public func cube_vision_free_string(_ ptr: UnsafeMutablePointer<CChar>?) {
    free(ptr)
}

@_cdecl("cube_vision_current_camera")
public func cube_vision_current_camera() -> UnsafeMutablePointer<CChar>? {
    return entry { () -> UnsafeMutablePointer<CChar>? in
        guard let info = state.camera?.current,
            let data = try? JSONEncoder().encode(info),
            let json = String(data: data, encoding: .utf8)
        else { return nil }
        return strdup(json)
    }
}

@_cdecl("cube_vision_open_camera")
public func cube_vision_open_camera(_ deviceId: UnsafePointer<CChar>?) -> Int32 {
    return entry { () -> Int32 in
        let cam = state.camera ?? Camera()
        state.camera = cam
        do {
            try cam.open(deviceId: deviceId.map { String(cString: $0) })
            return 0
        } catch {
            return fail("cube_vision_open_camera", error)
        }
    }
}

@_cdecl("cube_vision_close_camera")
public func cube_vision_close_camera() {
    return entry { () -> Void in
        state.camera?.close()
    }
}

/// What the open camera has for this tick, as the per-tick entry answers it: the frame, or the
/// code — -4 when no camera is open, -6 when the one that was open stopped (its reason recorded),
/// 0 when it has nothing fresh.
private enum CameraTick {
    case answer(Int32)
    case frame(bytes: [UInt8], width: Int, height: Int)
}

private func cameraTick() -> CameraTick {
    guard let cam = state.camera, cam.current != nil else {
        LastError.record("no camera is open")
        return .answer(-4)
    }
    switch cam.latestFrame() {
    case .stopped(let reason):
        LastError.record("cube_vision_next_detection: \(reason)")
        return .answer(-6)
    case .none:
        return .answer(0)
    case .frame(let bytes, let width, let height):
        return .frame(bytes: bytes, width: width, height: height)
    }
}

/// Grab the latest camera frame, letterbox + infer it. Returns the element count, 0 when the camera
/// is open but has no fresh frame — none has arrived yet, or the last one is older than
/// `Camera.frameStaleAfter` (the caller tries again next tick, and keeps a clock on how long that
/// goes on), or a negative error — -4 when no camera is open at all, which is a different condition
/// from "no frame yet" and used to be reported as the same zero, and -6 when the camera that was
/// open stopped, with the OS's reason as the message (2026-09-20): the fact the 5 s clock could only
/// guess at, reported the tick after the OS said it.
/// Also writes the size of the camera picture the tensor was letterboxed from into `outPicture`, TWO
/// Int32s — `[width, height]` — zero when there is no frame; the page places each sticker in the
/// picture with it (dev-docs/scan-guidance-plan.md 5). One value rather than two out-parameters, so the
/// Rust side hands it on whole and cannot pass the pair in the wrong order (audit, 2026-09-19).
@_cdecl("cube_vision_next_detection")
public func cube_vision_next_detection(_ out: UnsafeMutablePointer<Float>, _ cap: Int32,
                                       _ outRows: UnsafeMutablePointer<Int32>, _ outAnchors: UnsafeMutablePointer<Int32>,
                                       _ outPicture: UnsafeMutablePointer<Int32>) -> Int32 {
    return entry { () -> Int32 in
        // Zero before anything can return, so EVERY path that is not a frame — no model, no camera,
        // no frame yet, a failed inference — leaves the size saying so (audit, 2026-09-19).
        outPicture[0] = 0
        outPicture[1] = 0
        guard let model = loadedModel() else { return -3 }
        let bytes: [UInt8], width: Int, height: Int
        switch cameraTick() {
        case .answer(let code):
            return code
        case .frame(let b, let w, let h):
            (bytes, width, height) = (b, w, h)
        }
        let chw = bytes.withUnsafeBufferPointer { Letterbox.chw(rgba: $0.baseAddress!, width: width, height: height) }
        let n = infer(model, chw: chw, into: out, cap: cap, outRows: outRows, outAnchors: outAnchors, what: "cube_vision_next_detection")
        if n > 0 {
            outPicture[0] = Int32(width)
            outPicture[1] = Int32(height)
        }
        return n
    }
}
