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
#if os(iOS)
import UIKit
#endif

public struct CameraInfo: Codable {
    public let deviceId: String
    public let label: String
    /// Which way the camera points, when AVFoundation knows: "user" (front) or "environment" (back).
    /// Nil for `unspecified` — a Mac's built-in and external cameras — and the page mirrors what it
    /// draws unless this says "environment" (dev-docs/scan-guidance-plan.md 5).
    public let facing: String?

    init(deviceId: String, label: String, facing: String?) {
        self.deviceId = deviceId
        self.label = label
        self.facing = facing
    }

    init(_ device: AVCaptureDevice) {
        self.init(deviceId: device.uniqueID, label: device.localizedName, facing: CameraInfo.facing(for: device.position))
    }

    /// AVFoundation's position as the page's facing — pure, so `swift test` holds every case
    /// (Tests/CubeVisionTests): a wrong answer here mirrors the scan's sticker view on a phone.
    static func facing(for position: AVCaptureDevice.Position) -> String? {
        switch position {
        case .front: return "user"
        case .back: return "environment"
        default: return nil
        }
    }
}

/// What the camera has for the tick that asks. One answer under one lock, so the order of
/// precedence — stopped, then fresh, then nothing — is decided here and nowhere else.
public enum LatestFrame {
    /// A frame younger than `Camera.frameStaleAfter`, as straight RGBA8.
    case frame(bytes: [UInt8], width: Int, height: Int)
    /// Nothing fresh: no frame has arrived, the last one is older than the window, or the session
    /// is interrupted. The per-tick entry answers 0 and the Rust side's no-frame clock runs.
    case none
    /// The OS said the camera stopped, and why — a device that was disconnected, a session that
    /// failed. Sticky until the next `open`; the per-tick entry answers -6 with the reason.
    case stopped(String)
}

/// Which way the INTERFACE is up. The frames' "up" is the interface's, never gravity's
/// (decided 2026-09-21, audit finding 44): the page draws its guide and places every sticker in
/// the interface's frame, the browser build's `getUserMedia` frames are in that frame too, and a
/// phone pointed down at a cube on a table has no horizon worth levelling to. Apple's rotation
/// coordinator answers a different question — its two angles are "horizon-level relative to
/// gravity" and "change dynamically as the device is physically rotated" (AVCaptureDevice.h) — so
/// it is not used for the data output.
enum InterfaceOrientation: Equatable {
    case portrait
    case portraitUpsideDown
    case landscapeLeft
    case landscapeRight

    /// The angle that turns a built-in camera's frames upright for this orientation, on a sensor
    /// mounted the classic way: Apple's own table for the enum it retired in iOS 17 (`portrait`
    /// is 90, `portraitUpsideDown` 270, `landscapeRight` 0 — the sensor's native orientation —
    /// and `landscapeLeft` 180). `Camera.captureAngle` adds the sensor's own offset on top.
    var captureAngle: CGFloat {
        switch self {
        case .portrait: return 90
        case .portraitUpsideDown: return 270
        case .landscapeLeft: return 180
        case .landscapeRight: return 0
        }
    }
}

/// Where the camera learns which way the interface is up: the host seam. iOS answers from UIKit
/// (`UIKitInterfaceOrientation`); a Mac has no source, because a Mac's camera is upright already;
/// a test hands in one it drives.
protocol InterfaceOrientationSource: AnyObject {
    /// The orientation now. Throws when the host cannot say — a failed `open`, never a guess.
    func current() throws -> InterfaceOrientation
    /// Every later change, for as long as the returned token is held.
    func observe(_ onChange: @escaping (InterfaceOrientation) -> Void) -> AnyObject
}

/// The two members of `AVCaptureConnection` a rotation needs, behind a protocol so a test can hand
/// in a connection that refuses an angle (Tests/CubeVisionTests/CameraTests.swift) — a real one
/// exists only with a device.
protocol RotatableConnection: AnyObject {
    func isVideoRotationAngleSupported(_ angle: CGFloat) -> Bool
    var videoRotationAngle: CGFloat { get set }
}

@available(macOS 14.0, iOS 17.0, *)
extension AVCaptureConnection: RotatableConnection {}

/// The undo list of one configuration transaction: each step that changed the session registers
/// how to take it back, and `Camera.configure` runs the list in reverse if a later step throws.
final class Rollback {
    private var undos: [() -> Void] = []

    /// Register how to undo the step that just succeeded.
    func onThrow(_ undo: @escaping () -> Void) {
        undos.append(undo)
    }

    fileprivate func run() {
        for undo in undos.reversed() { undo() }
        undos.removeAll()
    }
}

public final class Camera: NSObject {
    /// What the camera is doing, for the frames' sake. Every case but `closed` carries the
    /// GENERATION of the `open` it belongs to, so a notification or a queued sample callback from
    /// an earlier open cannot speak for a later one (audit findings 43 and 45, 2026-09-21).
    private enum Lifecycle: Equatable {
        case closed
        case running(Int)
        case interrupted(Int)
        case stopped(Int, String)

        var generation: Int? {
            switch self {
            case .closed: return nil
            case .running(let g), .interrupted(let g), .stopped(let g, _): return g
            }
        }
    }

    typealias Frame = (bytes: [UInt8], width: Int, height: Int, at: TimeInterval)

    private let session = AVCaptureSession()
    private let queue = DispatchQueue(label: "im.cubus.cube-vision.frames")
    private let lock = NSLock()
    /// The most recent frame and WHEN it arrived on the monotonic clock (`now()`). Under `lock`,
    /// as is everything below it down to `opened`: the sink writes it, the observers clear it,
    /// `latestFrame()` judges it.
    private var frame: Frame?
    private var lifecycle: Lifecycle = .closed
    /// Counts every `open`; the lifecycle's generation is the latest value.
    private var generations = 0
    /// The device the current open opened.
    private var opened: CameraInfo?
    private let orientationSource: InterfaceOrientationSource?
    /// The delegate of the current open's output — one per generation, see `FrameSink`.
    private var sink: FrameSink?
    /// The disconnect observer for the device `open` opened, replaced per open. The session's own
    /// observers are installed once, in `init`, because the session outlives every open.
    private var deviceObserver: NSObjectProtocol?
    private var sessionObservers: [NSObjectProtocol] = []
    /// The interface-orientation observation of the current open, dropped by `close()`.
    private var rotationObservation: AnyObject?

    /// The device actually opened — the honest answer to "which camera am I looking through?", which
    /// a host that shows no preview has no other way to learn (a Continuity Camera or a virtual one
    /// looks identical to the built-in from the outside).
    public var current: CameraInfo? {
        lock.lock()
        defer { lock.unlock() }
        return opened
    }

    /// How long `open` waits for the permission prompt to be answered. A person reading the sheet
    /// takes seconds; a prompt nobody answers (a test runner, a locked screen) must not hold the
    /// command forever, so the wait is bounded and the timeout is named in the error.
    private static let permissionWait: TimeInterval = 60

    /// How old a frame may be and still be served as the latest: one second.
    ///
    /// Until 2026-09-20 the last frame was kept until a new one replaced it or `close()` ran, so a
    /// camera that stopped delivering — a webcam unplugged, a Continuity Camera that walked away,
    /// an iPhone taking a call — was re-inferred every tick as a perfectly still cube, and the Rust
    /// side's 5 s no-frame clock, which only starts on a tick with NO frame, never started (audit
    /// 2026-09-20 §1.2). A frame has an age now, and past this window it is not served.
    ///
    /// One second, because a running camera delivers many frames a second — 30 in the formats
    /// AVFoundation picks by default, and no low-light throttle takes a webcam under a few — so a
    /// frame nothing has replaced in a whole second is not a late frame; it is a stopped camera.
    /// Thirty times the normal gap, so a dropped frame cannot trip it, and a fifth of the Rust
    /// clock's 5 s, so that clock still owns the wait: the stale frame merely stops being served,
    /// the tick answers "no frame", and the clock starts as it was designed to.
    public static let frameStaleAfter: TimeInterval = 1

    /// The clock frames are stamped with. `systemUptime` is monotonic — it cannot jump with a
    /// wall-clock change, which a frame's age must not depend on — and it does not run while the
    /// machine sleeps, so a frame from just before a sleep is judged by awake time only, and the
    /// camera has that second after waking to replace it.
    static func now() -> TimeInterval { ProcessInfo.processInfo.systemUptime }

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

    /// The platform's interface-orientation source: UIKit on iOS, none on a Mac.
    private static func platformOrientationSource() -> InterfaceOrientationSource? {
        #if os(iOS)
        return UIKitInterfaceOrientation()
        #else
        return nil
        #endif
    }

    public override convenience init() {
        self.init(orientationSource: Camera.platformOrientationSource())
    }

    /// `orientationSource` is the host seam (see `InterfaceOrientationSource`); the tests hand in
    /// one they drive.
    init(orientationSource: InterfaceOrientationSource?) {
        self.orientationSource = orientationSource
        super.init()
        // The session's own notifications, observed for the life of the camera object: a runtime
        // error is the session saying it stopped (2026-09-20, audit §1.2 — "no frame for 5 s" is the
        // vague version of a fact the OS just told us), an interruption is it saying it paused, and
        // the interruption's end is it saying it resumed. `queue: nil` runs each block on the
        // posting thread; all three take only `lock`, never the FFI's state lock, so nothing here
        // can wait on a tick.
        let center = NotificationCenter.default
        sessionObservers = [
            center.addObserver(forName: .AVCaptureSessionRuntimeError, object: session, queue: nil) { [weak self] note in
                let reason = (note.userInfo?[AVCaptureSessionErrorKey] as? NSError)?.localizedDescription ?? "no reason given"
                self?.stopped("the capture session failed: \(reason)", generation: nil)
            },
            center.addObserver(forName: .AVCaptureSessionWasInterrupted, object: session, queue: nil) { [weak self] _ in
                self?.interrupted()
            },
            center.addObserver(forName: .AVCaptureSessionInterruptionEnded, object: session, queue: nil) { [weak self] _ in
                self?.interruptionEnded()
            },
        ]
    }

    deinit {
        // A block observer outlives the object that registered it unless removed.
        sessionObservers.forEach(NotificationCenter.default.removeObserver)
        if let deviceObserver { NotificationCenter.default.removeObserver(deviceObserver) }
    }

    public static func list() -> [CameraInfo] {
        AVCaptureDevice.DiscoverySession(deviceTypes: deviceTypes, mediaType: .video, position: .unspecified)
            .devices.map { CameraInfo($0) }
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
    ///
    /// Four steps, each its own function: the device (`resolveDevice`), the pieces (`makeInput`,
    /// `makeOutput`), their installation in ONE transaction that takes itself back if any step
    /// refuses (`install`), and the lifecycle — the generation, the observers, the start
    /// (`activate`). `close()` first, and `close()` alone, tears the previous open down: the
    /// transaction only adds, so the removal that iOS needs before `canAddInput` is asked (it
    /// refuses a second video input outright; macOS tolerates one) has exactly one owner.
    public func open(deviceId: String?) throws {
        close()
        let device = try Camera.resolveDevice(deviceId)
        // Authorization BEFORE the input: a refused app fails here with the reason, not below
        // with AVFoundation's opaque code wearing a hardware problem's face.
        try Camera.ensureAuthorized()
        let input = try Camera.makeInput(device)
        // Read before anything is installed: a host that cannot say which way it is up fails the
        // open here, with nothing to take back.
        let orientation = try orientationSource?.current()
        let generation = nextGeneration()
        let sink = FrameSink(generation: generation, camera: self)
        let output = Camera.makeOutput(delegate: sink, on: queue)
        try Camera.install(input, output, into: session, label: device.localizedName) { connection in
            try Camera.orient(connection, of: device, to: orientation)
        }
        self.sink = sink
        activate(generation, CameraInfo(device), device: device, output: output)
    }

    private static func resolveDevice(_ deviceId: String?) throws -> AVCaptureDevice {
        if let id = deviceId, !id.isEmpty {
            guard let d = AVCaptureDevice(uniqueID: id) else {
                throw CubeVisionError.capture("no camera with id \(id)")
            }
            return d
        }
        guard let d = AVCaptureDevice.default(for: .video) else {
            throw CubeVisionError.capture("no default video device")
        }
        return d
    }

    private static func makeInput(_ device: AVCaptureDevice) throws -> AVCaptureDeviceInput {
        do {
            return try AVCaptureDeviceInput(device: device)
        } catch {
            // The real AVFoundation error, kept. `try?` used to flatten every cause into one guess.
            throw CubeVisionError.capture("cannot open \(device.localizedName): \(error.localizedDescription)")
        }
    }

    private static func makeOutput(delegate: FrameSink, on queue: DispatchQueue) -> AVCaptureVideoDataOutput {
        let output = AVCaptureVideoDataOutput()
        // BGRA is what AVFoundation delivers cheapest; the sink swaps to RGBA to match the
        // browser's frames (and Letterbox.chw's channel order) before storing.
        output.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA]
        output.alwaysDiscardsLateVideoFrames = true
        output.setSampleBufferDelegate(delegate, queue: queue)
        return output
    }

    /// The input, the output and the connection's orientation, installed in one transaction. A
    /// step that refuses takes back every step before it — the input removed, the output removed
    /// and its delegate cleared — so a failed `open` holds no camera (audit finding 42,
    /// 2026-09-21: it used to commit the input and report failure, and the device stayed taken).
    /// Static and internal so `swift test` can drive the output half against a real session
    /// (Tests/CubeVisionTests/CameraTests.swift); the input half needs a device.
    static func install(_ input: AVCaptureInput, _ output: AVCaptureVideoDataOutput, into session: AVCaptureSession,
                        label: String, orient: (AVCaptureConnection) throws -> Void) throws {
        try configure(session) { rollback in
            guard session.canAddInput(input) else {
                throw CubeVisionError.capture("the capture session refuses \(label) as an input")
            }
            session.addInput(input)
            rollback.onThrow { session.removeInput(input) }
            try installOutput(output, into: session, rollback)
            if let connection = output.connection(with: .video) {
                try orient(connection)
            }
        }
    }

    /// The output step of `install`, on its own so a test can run it and then throw.
    static func installOutput(_ output: AVCaptureVideoDataOutput, into session: AVCaptureSession, _ rollback: Rollback) throws {
        guard session.canAddOutput(output) else {
            throw CubeVisionError.capture("the capture session refuses a video data output")
        }
        session.addOutput(output)
        rollback.onThrow {
            session.removeOutput(output)
            output.setSampleBufferDelegate(nil, queue: nil)
        }
    }

    /// The lifecycle of a new open: the generation goes live, the disconnect observer is keyed to
    /// THIS device and THIS generation, the rotation follows the interface, and the session starts.
    /// The observer is installed before `startRunning()`, so a device that goes away while the
    /// session starts is still named — by the label captured here, never by a field another
    /// thread may be rewriting (audit finding 43).
    private func activate(_ generation: Int, _ info: CameraInfo, device: AVCaptureDevice, output: AVCaptureVideoDataOutput) {
        lock.lock()
        lifecycle = .running(generation)
        frame = nil
        opened = info
        lock.unlock()
        let label = info.label
        deviceObserver = NotificationCenter.default.addObserver(
            forName: .AVCaptureDeviceWasDisconnected, object: device, queue: nil
        ) { [weak self] _ in
            self?.deviceWasDisconnected(label: label, generation: generation)
        }
        if let orientationSource {
            followRotation(from: orientationSource, generation: generation) { [weak output] orientation in
                guard let connection = output?.connection(with: .video) else { return }
                try Camera.orient(connection, of: device, to: orientation)
            }
        }
        session.startRunning()
    }

    /// A generation number for an open that is about to happen. Its lifecycle is not live until
    /// `activate` — a frame published under it before then is dropped, as it should be.
    private func nextGeneration() -> Int {
        lock.lock()
        defer { lock.unlock() }
        generations += 1
        return generations
    }

    /// One configuration transaction — `beginConfiguration`, `steps`, `commitConfiguration` — with
    /// the commit guaranteed on EVERY way out, a throw included, and every step the throw
    /// interrupted taken back first (`Rollback`, in reverse).
    ///
    /// Until 2026-09-20 the commit was written by hand on each path, and the mirroring refusal in
    /// `orientConnection` had none: it threw between begin and commit, so every later `open` nested
    /// inside the transaction the first one had left open, and `startRunning()` ran on a
    /// configuration the session had never been handed (audit §2.9). `defer` makes the balance a
    /// property of this function rather than of every path through the caller. Static and internal
    /// so `swift test` can prove it with a step that throws (Tests/CubeVisionTests/CameraTests.swift)
    /// — a real output cannot be made to refuse in a test, so the seam is the transaction itself.
    static func configure(_ session: AVCaptureSession, _ steps: (Rollback) throws -> Void) rethrows {
        session.beginConfiguration()
        defer { session.commitConfiguration() }
        let rollback = Rollback()
        do {
            try steps(rollback)
        } catch {
            rollback.run()
            throw error
        }
    }

    /// Make the frames upright and unmirrored, where the platform would hand them over otherwise.
    ///
    /// A phone's sensor is landscape; held in portrait it delivers every frame rotated a quarter
    /// turn, and the letterbox is byte-exact against an UPRIGHT frame — the model reads a cube
    /// face whose stickers are in the wrong places. `fitFace` may or may not survive that
    /// (dev-docs/mobile-shell-plan.md §7 has carried the question since the shells landed); the
    /// capture connection is where it is answered, in the OS's own rotation path, before a byte is
    /// copied — and inside the configuration, before `startRunning()`, which is where AVFoundation
    /// says a data output's rotation belongs (AVCaptureSession.h: it "requires a lengthy
    /// configuration of the capture render pipeline"). The angle is the INTERFACE's
    /// (`InterfaceOrientation`), read from the host at `open` and followed afterwards
    /// (`followRotation`), so an iPad turned in the hand keeps its frames upright and a
    /// portrait-locked iPhone held sideways keeps them portrait, as the browser build's are. A
    /// refusal is a failed open here and a recorded fault later, never silence (audit finding 102).
    /// macOS is untouched: a Mac has no orientation source, and its camera is upright already.
    ///
    /// Mirroring is asserted off rather than set off. A data output's connection is not mirrored
    /// unless something asked, and if a future front-camera path did ask, a mirrored frame reads
    /// the cube backwards — that is worth a hard stop, not a silent flip.
    ///
    /// UNVERIFIED ON A DEVICE (2026-09-05, still on 2026-09-21): this is the documented API for the
    /// documented problem, and no iPhone or iPad has yet delivered a frame through it. The check
    /// owed: an iPad held landscape reads a face upright; a portrait-locked iPhone held sideways
    /// still reads it in portrait; a phone pointed straight down at a table reads it at all.
    private static func orient(_ connection: AVCaptureConnection, of device: AVCaptureDevice, to orientation: InterfaceOrientation?) throws {
        if connection.isVideoMirrored {
            throw CubeVisionError.capture("the capture connection is mirrored; the scanner needs unmirrored frames")
        }
        guard let orientation else { return }
        try rotate(connection, of: device, to: orientation)
    }

    #if os(iOS)
    /// The rotation for `orientation` on this connection. iOS 17 and later: an angle
    /// (`captureAngle`); iOS 16 has only the orientation enum, and keeps it.
    private static func rotate(_ connection: AVCaptureConnection, of device: AVCaptureDevice, to orientation: InterfaceOrientation) throws {
        if #available(iOS 17.0, *) {
            try rotate(connection, to: captureAngle(for: orientation, of: device, on: connection))
        } else {
            guard connection.isVideoOrientationSupported else {
                throw CubeVisionError.capture("the capture connection cannot be turned to \(orientation)")
            }
            connection.videoOrientation = orientation.videoOrientation
        }
    }

    /// The angle a device's frames turn by for an interface orientation, per Apple: on iOS 27 the
    /// OS answers it for the device (`videoRotationAngleRelativeToDeviceOrientation:`, "the static
    /// angle relative to the provided orientation regardless of how the device is physically
    /// oriented" — AVCaptureDevice.h), which is exactly the question. Before iOS 27 the table is
    /// `InterfaceOrientation.captureAngle` with two corrections the same headers name: an external
    /// camera turns by 0 for every orientation, because the OS does not know how it is mounted;
    /// and the connection's DEFAULT angle is the sensor's own offset — 0 on every device but the
    /// Spring-2024 iPads' front camera, whose default is 180 so that its video data comes out the
    /// way earlier devices' did (AVCaptureSession.h), which makes its portrait 90 + 180. Pure
    /// once the offset is read, so `swift test` holds the table (`captureAngle(_:sensorOffset:external:)`).
    /// The offset is read before this ever sets the angle, and remembered per open, because a
    /// second read would see what this set.
    @available(iOS 17.0, *)
    private static func captureAngle(for orientation: InterfaceOrientation, of device: AVCaptureDevice, on connection: AVCaptureConnection) -> CGFloat {
        if #available(iOS 27.0, *) {
            return AVCaptureDevice.RotationCoordinator(device: device, previewLayer: nil)
                .videoRotationAngleRelative(toDeviceOrientation: orientation.videoOrientation)
        }
        return captureAngle(orientation, sensorOffset: sensorOffset(of: connection), external: device.position == .unspecified)
    }

    /// A connection's angle before anything set it, remembered so a later rotation on the same
    /// connection reads the sensor's offset and not the last angle set (see `captureAngle`).
    private static var sensorOffsets: [ObjectIdentifier: CGFloat] = [:]
    private static let sensorOffsetsLock = NSLock()

    @available(iOS 17.0, *)
    private static func sensorOffset(of connection: AVCaptureConnection) -> CGFloat {
        sensorOffsetsLock.lock()
        defer { sensorOffsetsLock.unlock() }
        let id = ObjectIdentifier(connection)
        if let known = sensorOffsets[id] { return known }
        let offset = connection.videoRotationAngle
        sensorOffsets[id] = offset
        return offset
    }
    #else
    /// A Mac has no orientation source (`platformOrientationSource`), so this is never reached
    /// there: a Mac's camera is upright already and the rotation APIs are not applied to it.
    private static func rotate(_ connection: AVCaptureConnection, of device: AVCaptureDevice, to orientation: InterfaceOrientation) throws {
        throw CubeVisionError.capture("frame rotation is not applied on macOS")
    }
    #endif

    /// The pre-iOS-27 table: `orientation`'s classic angle plus the sensor's own offset, modulo a
    /// turn; 0 for an external camera whatever the orientation. See `captureAngle(for:of:on:)`.
    static func captureAngle(_ orientation: InterfaceOrientation, sensorOffset: CGFloat, external: Bool) -> CGFloat {
        if external { return 0 }
        return (orientation.captureAngle + sensorOffset).truncatingRemainder(dividingBy: 360)
    }

    /// Set `angle` on a connection that supports it; one that does not is a refusal that names the
    /// angle (`isVideoRotationAngleSupported` is the documented gate, and a set past it throws an
    /// Objective-C exception, which is not an error Swift can catch).
    static func rotate(_ connection: RotatableConnection, to angle: CGFloat) throws {
        guard connection.isVideoRotationAngleSupported(angle) else {
            throw CubeVisionError.capture("the capture connection does not support a rotation of \(Int(angle))°")
        }
        connection.videoRotationAngle = angle
    }

    /// Keep the connection turned the interface's way for as long as this open lasts: every change
    /// the source reports is applied, and one the connection refuses is recorded as a fault on
    /// THIS generation — the scan ends with the reason rather than reading sideways frames — and
    /// a change reported after the open ended says nothing. Internal so the tests can drive it
    /// with a source and an `apply` of their own.
    func followRotation(from source: InterfaceOrientationSource, generation: Int,
                        apply: @escaping (InterfaceOrientation) throws -> Void) {
        rotationObservation = source.observe { [weak self] orientation in
            guard let self else { return }
            guard self.isLive(generation) else { return }
            do {
                try apply(orientation)
            } catch {
                self.stopped("the frames could not be turned to follow the interface: \(error)", generation: generation)
            }
        }
    }

    private func isLive(_ generation: Int) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        return lifecycle.generation == generation
    }

    /// The one owner of teardown: the session stopped and emptied, every per-open observer and
    /// delegate dropped, the lifecycle closed. `open` calls it first and then only adds.
    public func close() {
        if session.isRunning { session.stopRunning() }
        if let deviceObserver {
            NotificationCenter.default.removeObserver(deviceObserver)
            self.deviceObserver = nil
        }
        rotationObservation = nil
        // Released, not merely stopped: an input left attached is what made the next `open` on iOS
        // fail its `canAddInput`, and a stopped session still holds the device it was given.
        Camera.configure(session) { _ in
            session.inputs.forEach(session.removeInput)
            for output in session.outputs {
                (output as? AVCaptureVideoDataOutput)?.setSampleBufferDelegate(nil, queue: nil)
                session.removeOutput(output)
            }
        }
        sink = nil
        lock.lock()
        lifecycle = .closed
        frame = nil
        opened = nil
        lock.unlock()
    }

    /// The OS said the camera stopped for good. The frame goes — it is a picture from a camera that
    /// is not there — and the FIRST reason is kept: a disconnect is followed by the session's own
    /// error for the same event, and "the camera X was disconnected" is the sentence a person can
    /// act on. Cleared by `open` and `close`, never by a frame: none can arrive. `generation` is
    /// the open the report is about; nil is the session's own report, which is about whichever
    /// open is live. A report about an open that has ended is ignored: it is not this camera's.
    private func stopped(_ reason: String, generation: Int?) {
        lock.lock()
        defer { lock.unlock() }
        guard let live = lifecycle.generation, generation == nil || generation == live else { return }
        if case .stopped = lifecycle { return }
        lifecycle = .stopped(live, reason)
        frame = nil
    }

    /// The device `open` opened went away: the handler of `AVCaptureDeviceWasDisconnected`, with
    /// the label and generation the observer captured when it was installed, and the tests' way of
    /// recording one. Internal, so no C symbol, no Rust caller and no page can reach it — only
    /// `@testable import` (Tests/CubeVisionTests).
    func deviceWasDisconnected(label: String, generation: Int) {
        stopped("the camera \(label) was disconnected", generation: generation)
    }

    /// The session was interrupted — on iOS a call, another app taking the device, the app leaving
    /// the foreground, system pressure; macOS gives no reason. It is a pause, not an end: each of
    /// those has an `AVCaptureSessionInterruptionEnded` after which frames resume by themselves,
    /// and through the commonest one (the background) the webview is not ticking at all. So the
    /// lifecycle says `interrupted` — the frame is dropped, the next tick answers "no frame", the
    /// Rust side's clock bounds how long that may go on, and nothing published meanwhile is served,
    /// not even a sample callback that was already queued when the OS spoke (audit finding 45) —
    /// and no fault is recorded, because a fault would end a scan the OS is about to resume.
    private func interrupted() {
        lock.lock()
        defer { lock.unlock() }
        guard case .running(let generation) = lifecycle else { return }
        lifecycle = .interrupted(generation)
        frame = nil
    }

    /// The interruption ended: frames are served again from the next one to arrive.
    private func interruptionEnded() {
        lock.lock()
        defer { lock.unlock() }
        guard case .interrupted(let generation) = lifecycle else { return }
        lifecycle = .running(generation)
    }

    /// A frame from the sink of `generation`: kept only while that generation is running. A
    /// callback still queued from the last camera, or one that arrives during an interruption,
    /// is dropped here, under the same lock the lifecycle changes under.
    fileprivate func publish(_ frame: Frame, generation: Int) {
        lock.lock()
        defer { lock.unlock() }
        guard lifecycle == .running(generation) else { return }
        self.frame = frame
    }

    /// Tests only: stands in for `open` — a new generation goes live for a camera called `label`,
    /// with no session, no device and no lens, so the per-tick entry can be driven end to end
    /// (Tests/CubeVisionTests). Returns the generation, which is what the observers carry. Internal,
    /// so no C symbol, no Rust caller and no page can reach it — only `@testable import`. In every
    /// build configuration rather than DEBUG only: `swift test -c release` compiles the tests with
    /// testable imports, and a hook that exists in one configuration fails that build (round-3 audit).
    @discardableResult
    func openForTests(label: String = "Injected frame") -> Int {
        let generation = nextGeneration()
        lock.lock()
        lifecycle = .running(generation)
        frame = nil
        opened = CameraInfo(deviceId: "test", label: label, facing: nil)
        lock.unlock()
        return generation
    }

    /// Tests only: a frame `age` seconds old, published the way the sink publishes — under
    /// `generation`, or the live one when nil — and so subject to the same rule: a recorded fault
    /// is NOT cleared (a frame does not un-stop a camera), an interrupted or ended open drops it.
    func injectForTests(_ frame: (bytes: [UInt8], width: Int, height: Int), age: TimeInterval = 0, generation: Int? = nil) {
        lock.lock()
        let target = generation ?? lifecycle.generation ?? 0
        lock.unlock()
        publish((frame.bytes, frame.width, frame.height, Camera.now() - age), generation: target)
    }

    /// Tests only: the session, so a test can post AVFoundation's own notifications to it and prove
    /// the observers `init` installs are the ones that answer.
    var sessionForTests: AVCaptureSession { session }

    /// What the camera has for this tick — see `LatestFrame`. A recorded fault outranks a frame in
    /// hand, an interrupted or closed camera has nothing, and a frame older than `frameStaleAfter`
    /// is nothing.
    public func latestFrame() -> LatestFrame {
        lock.lock()
        defer { lock.unlock() }
        switch lifecycle {
        case .stopped(_, let reason):
            return .stopped(reason)
        case .closed, .interrupted:
            return .none
        case .running:
            guard let frame, Camera.now() - frame.at < Camera.frameStaleAfter else { return .none }
            return .frame(bytes: frame.bytes, width: frame.width, height: frame.height)
        }
    }
}

/// The sample-buffer delegate of ONE open. It carries the generation it was made for, so a
/// callback AVFoundation had already queued when that open ended — `stopRunning()` returns while
/// the frames queue still holds work — publishes under a generation that is no longer live and is
/// dropped, rather than being served as the next camera's picture. The camera holds it for the
/// life of the open (`Camera.sink`); the output's own reference is weak.
private final class FrameSink: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate {
    let generation: Int
    private weak var camera: Camera?

    init(generation: Int, camera: Camera) {
        self.generation = generation
        self.camera = camera
    }

    func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
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
        camera?.publish((rgba, w, h, Camera.now()), generation: generation)
    }
}

#if os(iOS)
extension InterfaceOrientation {
    var videoOrientation: AVCaptureVideoOrientation {
        switch self {
        case .portrait: return .portrait
        case .portraitUpsideDown: return .portraitUpsideDown
        case .landscapeLeft: return .landscapeLeft
        case .landscapeRight: return .landscapeRight
        }
    }

    /// UIKit's orientation, or nil for `.unknown` — which is not an orientation to turn frames to.
    init?(_ ui: UIInterfaceOrientation) {
        switch ui {
        case .portrait: self = .portrait
        case .portraitUpsideDown: self = .portraitUpsideDown
        case .landscapeLeft: self = .landscapeLeft
        case .landscapeRight: self = .landscapeRight
        default: return nil
        }
    }
}

/// The interface orientation as UIKit resolves it: the window scene's `effectiveGeometry`, which
/// honours the app's supported orientations (a phone is portrait-locked, an iPad rotates freely —
/// gen/apple/project.yml) and so is what the webview is drawn in. Read on the main thread, which
/// is where UIKit answers; `open` runs on a Tauri worker, so the read is a bounded hop there.
/// Changes are heard two ways, either of which re-reads the geometry: key-value observation of
/// `effectiveGeometry`, and the device-orientation notification, whose handler runs after UIKit
/// has resolved the interface's response to the turn. The same orientation twice is delivered once.
///
/// UNVERIFIED ON A DEVICE (2026-09-21): it type-checks for the iOS target; see `Camera.orient` for
/// the check owed.
final class UIKitInterfaceOrientation: InterfaceOrientationSource {
    /// How long a read may wait for the main thread. Every command that reaches this code is a
    /// Tauri `(async)` command (crates/cube-vision/src/apple.rs), so the main thread never waits
    /// on the caller; a main thread that does not answer in this long is a frozen app, and the
    /// open fails naming the wait rather than guessing an orientation.
    static let mainThreadWait: TimeInterval = 5

    func current() throws -> InterfaceOrientation {
        let read: () -> InterfaceOrientation? = {
            MainActor.assumeIsolated { UIKitInterfaceOrientation.orientationNow() }
        }
        let value: InterfaceOrientation?
        if Thread.isMainThread {
            value = read()
        } else {
            let answered = DispatchSemaphore(value: 0)
            var got: InterfaceOrientation?
            DispatchQueue.main.async {
                got = read()
                answered.signal()
            }
            guard answered.wait(timeout: .now() + Self.mainThreadWait) != .timedOut else {
                throw CubeVisionError.capture(
                    "the interface orientation could not be read: the main thread did not answer within \(Int(Self.mainThreadWait))s")
            }
            value = got
        }
        guard let value else {
            throw CubeVisionError.capture("the interface orientation could not be read: no window scene is on screen, or its orientation is unknown")
        }
        return value
    }

    func observe(_ onChange: @escaping (InterfaceOrientation) -> Void) -> AnyObject {
        let observation = Observation(onChange)
        DispatchQueue.main.async { observation.install() }
        return observation
    }

    /// The scene the app is drawn in: the foreground-active window scene, else any window scene.
    @MainActor
    static func scene() -> UIWindowScene? {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        return scenes.first { $0.activationState == .foregroundActive } ?? scenes.first
    }

    /// The interface orientation now, or nil when there is no scene or it does not know.
    @MainActor
    static func orientationNow() -> InterfaceOrientation? {
        guard let ui = scene()?.effectiveGeometry.interfaceOrientation else { return nil }
        return InterfaceOrientation(ui)
    }

    private final class Observation {
        private let onChange: (InterfaceOrientation) -> Void
        private var last: InterfaceOrientation?
        private var geometry: NSKeyValueObservation?
        private var turned: NSObjectProtocol?

        init(_ onChange: @escaping (InterfaceOrientation) -> Void) {
            self.onChange = onChange
        }

        @MainActor
        func install() {
            last = UIKitInterfaceOrientation.orientationNow()
            geometry = UIKitInterfaceOrientation.scene()?.observe(\.effectiveGeometry, options: [.new]) { [weak self] scene, _ in
                self?.deliver(scene.effectiveGeometry.interfaceOrientation)
            }
            UIDevice.current.beginGeneratingDeviceOrientationNotifications()
            turned = NotificationCenter.default.addObserver(
                forName: UIDevice.orientationDidChangeNotification, object: nil, queue: .main
            ) { [weak self] _ in
                MainActor.assumeIsolated {
                    self?.deliver(UIKitInterfaceOrientation.scene()?.effectiveGeometry.interfaceOrientation)
                }
            }
        }

        private func deliver(_ ui: UIInterfaceOrientation?) {
            guard let ui, let orientation = InterfaceOrientation(ui), orientation != last else { return }
            last = orientation
            onChange(orientation)
        }

        deinit {
            geometry = nil
            if let turned {
                NotificationCenter.default.removeObserver(turned)
                DispatchQueue.main.async {
                    MainActor.assumeIsolated { UIDevice.current.endGeneratingDeviceOrientationNotifications() }
                }
            }
        }
    }
}
#endif
