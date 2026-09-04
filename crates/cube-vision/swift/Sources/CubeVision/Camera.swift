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

    /// How long `open` waits for the permission prompt to be answered. A person reading the sheet
    /// takes seconds; a prompt nobody answers (a test runner, a locked screen) must not hold the
    /// command forever, so the wait is bounded and the timeout is named in the error.
    private static let permissionWait: TimeInterval = 60

    // Types the webview cannot enumerate are exactly why this exists — list them explicitly.
    //
    // Two DIFFERENT gates, and conflating them broke the iOS build (2026-08-30). `#available` is a
    // RUNTIME check: it asks whether the OS running this binary is new enough, and it cannot make a
    // symbol that does not exist on a platform compile for it. External and Continuity Camera are
    // real on both platforms (macOS 14 / iOS 17), so availability is the whole story for them.
    // Desk View is `API_UNAVAILABLE(ios)` — a Mac-only device type — so it needs `#if os(macOS)`,
    // a COMPILE-time gate, or the first iOS build fails at this line. It did: swift-rs compiled the
    // package against the iPhoneOS SDK and stopped here.
    //
    // Nothing iOS-specific is added in its place. A phone's ultra-wide/macro lens is the obvious
    // candidate and is deliberately absent until it is measured against the sharpness floor on a
    // real device (dev-docs/mobile-shell-plan.md, M3) — an unverifiable native guess is worth less
    // than the default video device, which on iOS is already the rear wide camera.
    private static let deviceTypes: [AVCaptureDevice.DeviceType] = {
        var t: [AVCaptureDevice.DeviceType] = [.builtInWideAngleCamera]
        if #available(macOS 14.0, iOS 17.0, *) {
            t.append(.external)
            t.append(.continuityCamera)
            #if os(macOS)
            t.append(.deskViewCamera)
            #endif
        }
        return t
    }()

    public static func list() -> [CameraInfo] {
        AVCaptureDevice.DiscoverySession(deviceTypes: deviceTypes, mediaType: .video, position: .unspecified)
            .devices.map { CameraInfo(deviceId: $0.uniqueID, label: $0.localizedName) }
    }

    /// Ask for the camera, and say WHICH answer stood in the way when one did.
    ///
    /// This class never asked. `AVCaptureDeviceInput(device:)` fails for an unauthorised app and
    /// the failure was caught by `try?`, so a denial surfaced as "cannot open X — in use, or
    /// asleep?", which sends a person to check a cable when the fix is a switch in System
    /// Settings. The three refusals are named apart because their remedies differ: `.denied` is
    /// the user's own earlier answer, `.restricted` is a device policy nobody at the keyboard can
    /// change, and `.notDetermined` is the prompt that has not been shown yet — which this shows,
    /// and waits for, off the main thread (every caller is an async Tauri command).
    private static func ensureAuthorized() throws {
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized:
            return
        case .denied:
            throw CubeVisionError.capture(
                "camera access was denied for this app — allow it under Privacy & Security › Camera and try again")
        case .restricted:
            throw CubeVisionError.capture(
                "camera access is restricted on this device by a policy (parental controls or a device profile)")
        case .notDetermined:
            let answered = DispatchSemaphore(value: 0)
            var granted = false
            AVCaptureDevice.requestAccess(for: .video) { ok in
                granted = ok
                answered.signal()
            }
            if answered.wait(timeout: .now() + permissionWait) == .timedOut {
                throw CubeVisionError.capture(
                    "the camera permission prompt was not answered within \(Int(permissionWait))s")
            }
            if !granted {
                throw CubeVisionError.capture(
                    "camera access was declined — allow it under Privacy & Security › Camera and try again")
            }
        @unknown default:
            throw CubeVisionError.capture("camera authorization is in a state this build does not know")
        }
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
        // Authorization BEFORE the input: a refused app fails here with the reason, not below
        // with AVFoundation's opaque code wearing a hardware problem's face.
        try Camera.ensureAuthorized()
        let input: AVCaptureDeviceInput
        do {
            input = try AVCaptureDeviceInput(device: device)
        } catch {
            // The real AVFoundation error, kept. `try?` used to flatten every cause into one guess.
            throw CubeVisionError.capture("cannot open \(device.localizedName): \(error.localizedDescription)")
        }
        // Inputs are removed INSIDE the configuration, before `canAddInput` is asked. It used to be
        // asked first, with the previous input still attached: macOS tolerates that, iOS refuses a
        // second video input outright, so the second scan on an iPhone failed until a restart.
        session.beginConfiguration()
        session.inputs.forEach(session.removeInput)
        session.outputs.forEach(session.removeOutput)
        guard session.canAddInput(input) else {
            session.commitConfiguration()
            throw CubeVisionError.capture("the capture session refuses \(device.localizedName) as an input")
        }
        session.addInput(input)
        let output = AVCaptureVideoDataOutput()
        // BGRA is what AVFoundation delivers cheapest; the delegate swaps to RGBA to match the
        // browser's frames (and Letterbox.chw's channel order) before storing.
        output.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA]
        output.alwaysDiscardsLateVideoFrames = true
        output.setSampleBufferDelegate(self, queue: queue)
        guard session.canAddOutput(output) else {
            session.commitConfiguration()
            throw CubeVisionError.capture("the capture session refuses a video data output")
        }
        session.addOutput(output)
        try Camera.orientConnection(output)
        session.commitConfiguration()
        session.startRunning()
        current = CameraInfo(deviceId: device.uniqueID, label: device.localizedName)
    }

    /// Make the frames upright and unmirrored, where the platform would hand them over otherwise.
    ///
    /// A phone's sensor is landscape; held in portrait it delivers every frame rotated a quarter
    /// turn, and the letterbox is byte-exact against an UPRIGHT frame — the model reads a cube
    /// face whose stickers are in the wrong places. `fitFace` may or may not survive that
    /// (dev-docs/mobile-shell-plan.md §7 has carried the question since the shells landed); the
    /// capture connection is where it is answered, in the OS's own rotation path, before a byte is
    /// copied. iOS 17 replaced the orientation enum with an angle; both spellings are here because
    /// the deployment target is 16. macOS is untouched: a Mac's camera is upright already, and the
    /// rotation APIs are not available to it.
    ///
    /// Mirroring is asserted off rather than set off. A data output's connection is not mirrored
    /// unless something asked, and if a future front-camera path did ask, a mirrored frame reads
    /// the cube backwards — that is worth a hard stop, not a silent flip.
    ///
    /// UNVERIFIED ON A DEVICE (2026-09-05): this is the documented API for the documented problem,
    /// and no iPhone has yet delivered a frame through it. The plan's §7 records the check owed.
    private static func orientConnection(_ output: AVCaptureVideoDataOutput) throws {
        guard let connection = output.connection(with: .video) else { return }
        #if os(iOS)
        if #available(iOS 17.0, *) {
            if connection.isVideoRotationAngleSupported(90) {
                connection.videoRotationAngle = 90
            }
        } else {
            if connection.isVideoOrientationSupported {
                connection.videoOrientation = .portrait
            }
        }
        #endif
        if connection.isVideoMirrored {
            throw CubeVisionError.capture("the capture connection is mirrored; the scanner needs unmirrored frames")
        }
    }

    public func close() {
        if session.isRunning { session.stopRunning() }
        // Released, not merely stopped: an input left attached is what made the next `open` on iOS
        // fail its `canAddInput`, and a stopped session still holds the device it was given.
        session.beginConfiguration()
        session.inputs.forEach(session.removeInput)
        session.outputs.forEach(session.removeOutput)
        session.commitConfiguration()
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
