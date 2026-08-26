// AVFoundation capture for the native scanner. The webview never shows the camera picture (a
// recorded design decision), so this is a frame SOURCE, not a preview layer: it keeps only the most
// recent frame as RGBA bytes, and the plugin pulls one per tick, letterboxes it and runs the model.
// No compositing under the webview, no native preview — the same contract camera.ts has in the
// browser, on the other side of the seam.
//
// It reaches cameras getUserMedia cannot (Continuity, Desk View), which is one of the two reasons
// the native path exists at all (see dev-docs/native-capture-and-inference.md).

import AVFoundation
import Foundation

public struct CameraInfo: Codable {
    public let deviceId: String
    public let label: String
}

public final class Camera: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate {
    private let session = AVCaptureSession()
    private let queue = DispatchQueue(label: "im.cubus.cube-vision.frames")
    private let lock = NSLock()
    private var latest: (bytes: [UInt8], width: Int, height: Int)?
    /// The device actually opened — the honest answer to "which camera am I looking through?", which
    /// a host that shows no preview has no other way to learn (a Continuity Camera or a virtual one
    /// looks identical to the built-in from the outside).
    public private(set) var current: CameraInfo?

    // Types the webview cannot enumerate are exactly why this exists — list them explicitly. Both
    // are gated: Continuity Camera as a discoverable type is macOS 14+, Desk View macOS 13+, and on
    // an older system they simply are not offered rather than failing to build.
    private static let deviceTypes: [AVCaptureDevice.DeviceType] = {
        var t: [AVCaptureDevice.DeviceType] = [.builtInWideAngleCamera]
        if #available(macOS 14.0, iOS 17.0, *) {
            t.append(.external)
            t.append(.continuityCamera)
            t.append(.deskViewCamera)
        }
        return t
    }()

    public static func list() -> [CameraInfo] {
        AVCaptureDevice.DiscoverySession(deviceTypes: deviceTypes, mediaType: .video, position: .unspecified)
            .devices.map { CameraInfo(deviceId: $0.uniqueID, label: $0.localizedName) }
    }

    /// Open a camera by uniqueID, or the default video device when `deviceId` is nil/empty.
    public func open(deviceId: String?) throws {
        close()
        let device: AVCaptureDevice
        if let id = deviceId, !id.isEmpty {
            guard let d = AVCaptureDevice(uniqueID: id) else {
                throw CubeVisionError.capture("no camera with id \(id)")
            }
            device = d
        } else if let d = AVCaptureDevice.default(for: .video) {
            device = d
        } else {
            throw CubeVisionError.capture("no default video device")
        }
        guard let input = try? AVCaptureDeviceInput(device: device), session.canAddInput(input) else {
            throw CubeVisionError.capture("cannot open \(device.localizedName) — in use, or asleep?")
        }
        session.beginConfiguration()
        session.inputs.forEach(session.removeInput)
        session.addInput(input)
        let output = AVCaptureVideoDataOutput()
        // BGRA is what AVFoundation delivers cheapest; the delegate swaps to RGBA to match the
        // browser's frames (and Letterbox.chw's channel order) before storing.
        output.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA]
        output.alwaysDiscardsLateVideoFrames = true
        output.setSampleBufferDelegate(self, queue: queue)
        session.outputs.forEach(session.removeOutput)
        if session.canAddOutput(output) { session.addOutput(output) }
        session.commitConfiguration()
        session.startRunning()
        current = CameraInfo(deviceId: device.uniqueID, label: device.localizedName)
    }

    public func close() {
        if session.isRunning { session.stopRunning() }
        lock.lock(); latest = nil; lock.unlock()
        current = nil
    }

    /// The most recent frame as straight RGBA8, or nil if none has arrived yet.
    public func latestFrame() -> (bytes: [UInt8], width: Int, height: Int)? {
        lock.lock(); defer { lock.unlock() }
        return latest
    }

    public func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
        guard let buf = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        CVPixelBufferLockBaseAddress(buf, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(buf, .readOnly) }
        let w = CVPixelBufferGetWidth(buf)
        let h = CVPixelBufferGetHeight(buf)
        guard let base = CVPixelBufferGetBaseAddress(buf) else { return }
        let stride = CVPixelBufferGetBytesPerRow(buf)
        let src = base.assumingMemoryBound(to: UInt8.self)
        var rgba = [UInt8](repeating: 255, count: w * h * 4)
        rgba.withUnsafeMutableBufferPointer { dst in
            for y in 0..<h {
                let row = y * stride
                let out = y * w * 4
                for x in 0..<w {
                    let s = row + x * 4     // BGRA
                    let d = out + x * 4     // RGBA
                    dst[d] = src[s + 2]     // R ← BGRA.R
                    dst[d + 1] = src[s + 1] // G
                    dst[d + 2] = src[s]     // B ← BGRA.B
                    dst[d + 3] = 255
                }
            }
        }
        lock.lock(); latest = (rgba, w, h); lock.unlock()
    }
}
