// mac-camera-lab: a live bench for every camera this Mac has, including the ones the webview
// cannot reach.
//
// Why this exists, given the other two scripts. `mac-camera-probe` reads capability flags without
// opening a session, and `mac-camera-grab` takes exactly one frame. Neither answers the question
// that actually decides whether a scanner can work off a given camera: what does a LIVE stream
// from it look like, held the way a person would hold a cube, and is it good enough to read?
//
// It exists in particular for the DESK VIEW cameras. macOS exposes them to AVFoundation, but
// getUserMedia does not enumerate them, so they are invisible to the app and can only be judged
// from native code. If Desk View turns out to be a good scanning surface, that is an argument for
// giving the desktop app a native capability the web build cannot have — a decision this bench is
// meant to inform, not to pre-empt.
//
// It measures rather than shows, because "looks fine" is not a finding:
//   - mean luminance     — is this real pixels, or the black frame a dormant Desk View returns?
//   - Laplacian variance — sharpness. A fixed-focus camera's usable range is found by moving the
//                          cube and watching this number, which is the only honest way to answer
//                          "how close can I hold it?" on hardware that reports no focus modes.
//   - delivered fps      — what the pipeline would actually get, not what the format advertises.
//
// Usage: swiftc -O -o mac-camera-lab mac-camera-lab.swift && ./mac-camera-lab
// Save a frame with S, quit with Q or Cmd-W.

import AVFoundation
import AppKit
import CoreImage

// MARK: - Frame statistics

/// What one frame tells us. Computed on a subsampled grid so this stays free at 30 fps.
struct FrameStats {
    var luma: Double = 0
    var sharpness: Double = 0
    var width: Int = 0
    var height: Int = 0
}

/// Mean luma and variance-of-Laplacian, read straight off a BGRA pixel buffer.
///
/// Subsampled by `step` in both axes: a cube sticker is hundreds of pixels across at these
/// resolutions, so nothing we care about lives at the pixel scale, and the full-resolution
/// version of this loop is what makes a Swift preview stutter.
func stats(from buffer: CVPixelBuffer, step: Int = 4) -> FrameStats {
    CVPixelBufferLockBaseAddress(buffer, .readOnly)
    defer { CVPixelBufferUnlockBaseAddress(buffer, .readOnly) }

    let w = CVPixelBufferGetWidth(buffer)
    let h = CVPixelBufferGetHeight(buffer)
    guard let base = CVPixelBufferGetBaseAddress(buffer) else { return FrameStats() }
    let stride = CVPixelBufferGetBytesPerRow(buffer)
    let px = base.assumingMemoryBound(to: UInt8.self)

    // BGRA → luma, on the sampled grid only.
    let cols = w / step
    let rows = h / step
    guard cols > 2, rows > 2 else { return FrameStats() }
    var luma = [Double](repeating: 0, count: cols * rows)
    var sum = 0.0
    for r in 0..<rows {
        let y = r * step
        for c in 0..<cols {
            let o = y * stride + (c * step) * 4
            let v = 0.114 * Double(px[o]) + 0.587 * Double(px[o + 1]) + 0.299 * Double(px[o + 2])
            luma[r * cols + c] = v
            sum += v
        }
    }

    // Variance of the Laplacian over the interior.
    var lapSum = 0.0
    var lapSq = 0.0
    var n = 0
    for r in 1..<(rows - 1) {
        for c in 1..<(cols - 1) {
            let i = r * cols + c
            let lap = 4 * luma[i] - luma[i - 1] - luma[i + 1] - luma[i - cols] - luma[i + cols]
            lapSum += lap
            lapSq += lap * lap
            n += 1
        }
    }
    let mean = lapSum / Double(n)
    return FrameStats(
        luma: sum / Double(cols * rows),
        sharpness: lapSq / Double(n) - mean * mean,
        width: w,
        height: h
    )
}

// MARK: - Capability text

func focusModes(_ d: AVCaptureDevice) -> String {
    var out: [String] = []
    if d.isFocusModeSupported(.locked) { out.append("locked") }
    if d.isFocusModeSupported(.autoFocus) { out.append("auto") }
    if d.isFocusModeSupported(.continuousAutoFocus) { out.append("continuous") }
    // An empty list is the finding, not a missing value — say so rather than printing nothing.
    return out.isEmpty ? "NONE (fixed focus)" : out.joined(separator: "+")
}

func describe(_ d: AVCaptureDevice) -> String {
    let sizes = Set(d.formats.map { f -> String in
        let dim = CMVideoFormatDescriptionGetDimensions(f.formatDescription)
        return "\(dim.width)x\(dim.height)"
    })
    let ordered = sizes.sorted { a, b in
        (Int(a.split(separator: "x")[0]) ?? 0) < (Int(b.split(separator: "x")[0]) ?? 0)
    }
    let desk = d.deviceType == .deskViewCamera ? "  ·  DESK VIEW (invisible to getUserMedia)" : ""
    // The id is here because the name is not always unique — see reloadDevices().
    return "focus: \(focusModes(d))  ·  id \(d.uniqueID)\(desk)\n\(ordered.joined(separator: "  "))"
}

// MARK: - App

final class Lab: NSObject, NSApplicationDelegate, AVCaptureVideoDataOutputSampleBufferDelegate {
    var window: NSWindow!
    var preview: AVCaptureVideoPreviewLayer?
    var session: AVCaptureSession?
    let picker = NSPopUpButton(frame: .zero, pullsDown: false)
    let formatPicker = NSPopUpButton(frame: .zero, pullsDown: false)
    let capsLabel = NSTextField(labelWithString: "")
    let statsLabel = NSTextField(labelWithString: "")
    let videoView = NSView()
    var devices: [AVCaptureDevice] = []
    var formats: [AVCaptureDevice.Format] = []

    private var latest: CVPixelBuffer?
    private var frameCount = 0
    private var windowStart = CFAbsoluteTimeGetCurrent()
    private var fps = 0.0
    private var saveNext = false

    func applicationDidFinishLaunching(_: Notification) {
        buildWindow()
        reloadDevices()
        AVCaptureDevice.requestAccess(for: .video) { ok in
            DispatchQueue.main.async {
                if ok {
                    self.start()
                } else {
                    self.statsLabel.stringValue =
                        "Camera access denied. Grant it to the app that launched this "
                        + "(usually Terminal) in System Settings › Privacy & Security › Camera."
                }
            }
        }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_: NSApplication) -> Bool { true }

    // MARK: UI

    func buildWindow() {
        window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1000, height: 760),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered, defer: false
        )
        window.title = "Camera lab — cubus"
        window.center()

        let content = window.contentView!
        videoView.wantsLayer = true
        videoView.layer?.backgroundColor = NSColor.black.cgColor
        videoView.translatesAutoresizingMaskIntoConstraints = false
        picker.translatesAutoresizingMaskIntoConstraints = false
        formatPicker.translatesAutoresizingMaskIntoConstraints = false
        capsLabel.translatesAutoresizingMaskIntoConstraints = false
        statsLabel.translatesAutoresizingMaskIntoConstraints = false

        capsLabel.font = .monospacedSystemFont(ofSize: 11, weight: .regular)
        capsLabel.textColor = .secondaryLabelColor
        capsLabel.maximumNumberOfLines = 2
        statsLabel.font = .monospacedSystemFont(ofSize: 13, weight: .medium)
        statsLabel.maximumNumberOfLines = 3

        picker.target = self
        picker.action = #selector(deviceChanged)
        formatPicker.target = self
        formatPicker.action = #selector(formatChanged)

        for v in [videoView, picker, formatPicker, capsLabel, statsLabel] { content.addSubview(v) }
        NSLayoutConstraint.activate([
            picker.topAnchor.constraint(equalTo: content.topAnchor, constant: 14),
            picker.leadingAnchor.constraint(equalTo: content.leadingAnchor, constant: 16),
            picker.widthAnchor.constraint(equalToConstant: 460),
            formatPicker.centerYAnchor.constraint(equalTo: picker.centerYAnchor),
            formatPicker.leadingAnchor.constraint(equalTo: picker.trailingAnchor, constant: 10),
            formatPicker.widthAnchor.constraint(equalToConstant: 190),

            capsLabel.topAnchor.constraint(equalTo: picker.bottomAnchor, constant: 8),
            capsLabel.leadingAnchor.constraint(equalTo: content.leadingAnchor, constant: 18),
            capsLabel.trailingAnchor.constraint(equalTo: content.trailingAnchor, constant: -16),

            videoView.topAnchor.constraint(equalTo: capsLabel.bottomAnchor, constant: 10),
            videoView.leadingAnchor.constraint(equalTo: content.leadingAnchor, constant: 16),
            videoView.trailingAnchor.constraint(equalTo: content.trailingAnchor, constant: -16),
            videoView.bottomAnchor.constraint(equalTo: statsLabel.topAnchor, constant: -10),

            statsLabel.leadingAnchor.constraint(equalTo: content.leadingAnchor, constant: 18),
            statsLabel.trailingAnchor.constraint(equalTo: content.trailingAnchor, constant: -16),
            statsLabel.bottomAnchor.constraint(equalTo: content.bottomAnchor, constant: -14),
        ])

        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    func reloadDevices() {
        // .deskViewCamera is the reason this list is spelled out rather than using .video default
        // discovery: it is exactly the type the webview does not enumerate.
        let types: [AVCaptureDevice.DeviceType] = [
            .builtInWideAngleCamera, .continuityCamera, .deskViewCamera, .external,
        ]
        devices = AVCaptureDevice.DiscoverySession(
            deviceTypes: types, mediaType: .video, position: .unspecified
        ).devices
        picker.removeAllItems()
        // Two Studio Displays report the SAME localizedName, and NSPopUpButton.addItem(withTitle:)
        // removes any existing item with that title — so the second display silently deleted the
        // first and the menu offered one camera where the machine has two. Titles must be unique
        // or the control lies about the hardware; the uniqueID tail is what makes them so.
        var seenNames: [String: Int] = [:]
        for d in devices { seenNames[d.localizedName, default: 0] += 1 }
        for d in devices {
            let tag = d.deviceType == .deskViewCamera ? "🖥 " : ""
            let suffix = seenNames[d.localizedName, default: 0] > 1
                ? "  ·  \(String(d.uniqueID.suffix(8)))" : ""
            picker.addItem(withTitle: "\(tag)\(d.localizedName)\(suffix)")
        }
        // Belt and braces: if the count still disagrees with the device list, the control dropped
        // something and every later index is wrong. Better to know than to preview the wrong camera.
        if picker.numberOfItems != devices.count {
            NSLog("camera-lab: picker holds %d items for %d devices", picker.numberOfItems, devices.count)
        }
    }

    // MARK: Session

    @objc func deviceChanged() { start() }

    @objc func formatChanged() {
        guard let device = currentDevice, formatPicker.indexOfSelectedItem < formats.count else { return }
        let f = formats[formatPicker.indexOfSelectedItem]
        do {
            try device.lockForConfiguration()
            device.activeFormat = f
            device.unlockForConfiguration()
        } catch {
            statsLabel.stringValue = "could not set that format: \(error.localizedDescription)"
        }
    }

    var currentDevice: AVCaptureDevice? {
        let i = picker.indexOfSelectedItem
        return i >= 0 && i < devices.count ? devices[i] : nil
    }

    func start() {
        session?.stopRunning()
        preview?.removeFromSuperlayer()
        guard let device = currentDevice else { return }

        capsLabel.stringValue = describe(device)
        // Distinct sizes only: a device lists many formats that differ solely in frame rate.
        var seen = Set<String>()
        formats = device.formats.filter { f in
            let d = CMVideoFormatDescriptionGetDimensions(f.formatDescription)
            return seen.insert("\(d.width)x\(d.height)").inserted
        }
        formatPicker.removeAllItems()
        for f in formats {
            let d = CMVideoFormatDescriptionGetDimensions(f.formatDescription)
            // Aspect ratio is not cosmetic here: a 4:3 format of the same sensor usually sees
            // further DOWN than the 16:9 one, which is a vertical crop — i.e. more desk.
            let aspect = String(format: "%.2f", Double(d.width) / Double(d.height))
            formatPicker.addItem(withTitle: "\(d.width)x\(d.height)  (\(aspect):1)")
        }

        let s = AVCaptureSession()
        guard let input = try? AVCaptureDeviceInput(device: device), s.canAddInput(input) else {
            statsLabel.stringValue = "cannot open \(device.localizedName) — is it in use, or asleep?"
            return
        }
        s.addInput(input)

        let out = AVCaptureVideoDataOutput()
        out.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA]
        out.alwaysDiscardsLateVideoFrames = true
        out.setSampleBufferDelegate(self, queue: DispatchQueue(label: "lab.frames"))
        if s.canAddOutput(out) { s.addOutput(out) }

        let layer = AVCaptureVideoPreviewLayer(session: s)
        layer.videoGravity = .resizeAspect
        layer.frame = videoView.bounds
        layer.autoresizingMask = [.layerWidthSizable, .layerHeightSizable]
        videoView.layer?.addSublayer(layer)
        preview = layer

        session = s
        frameCount = 0
        windowStart = CFAbsoluteTimeGetCurrent()
        statsLabel.stringValue = "starting \(device.localizedName)…"
        DispatchQueue.global(qos: .userInitiated).async { s.startRunning() }

        // A device that is discoverable but dormant — a Desk View whose lid is shut, an iPhone not
        // mounted — accepts the session and then delivers nothing. Silence IS the answer, so say
        // it out loud instead of leaving a black rectangle to be interpreted.
        let expected = device.localizedName
        DispatchQueue.main.asyncAfter(deadline: .now() + 3) { [weak self] in
            guard let self, self.currentDevice?.localizedName == expected, self.frameCount == 0
            else { return }
            self.statsLabel.stringValue =
                "\(expected): session opened but NO FRAMES in 3s.\n"
                + "Desk View needs its source awake — MacBook lid open, or iPhone mounted with "
                + "Continuity Camera + Desk View active."
        }
    }

    // MARK: Frames

    func captureOutput(
        _: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from _: AVCaptureConnection
    ) {
        guard let buf = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        frameCount += 1
        let elapsed = CFAbsoluteTimeGetCurrent() - windowStart
        if elapsed >= 1 {
            fps = Double(frameCount) / elapsed
            frameCount = 0
            windowStart = CFAbsoluteTimeGetCurrent()
        }
        let st = stats(from: buf)
        if saveNext {
            saveNext = false
            save(buf)
        }
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            // A frame this dark is not a picture of a dark room, it is a dormant device.
            let dead = st.luma < 2 ? "   ← BLACK FRAME: device is dormant, not dark" : ""
            self.statsLabel.stringValue = String(
                format: "%dx%d  ·  %.1f fps  ·  luma %.1f  ·  sharpness %.0f%@",
                st.width, st.height, self.fps, st.luma, st.sharpness, dead
            )
        }
    }

    func save(_ buffer: CVPixelBuffer) {
        let ci = CIImage(cvPixelBuffer: buffer)
        let ctx = CIContext()
        guard let cg = ctx.createCGImage(ci, from: ci.extent) else { return }
        let rep = NSBitmapImageRep(cgImage: cg)
        guard let data = rep.representation(using: .jpeg, properties: [.compressionFactor: 0.9])
        else { return }
        let name = "camera-lab-\(Int(Date().timeIntervalSince1970)).jpg"
        let url = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Downloads").appendingPathComponent(name)
        try? data.write(to: url)
        DispatchQueue.main.async { print("saved \(url.path)") }
    }

    func requestSave() { saveNext = true }
}

let app = NSApplication.shared
app.setActivationPolicy(.regular)
let lab = Lab()
app.delegate = lab

// S saves a frame, Q quits. A menu bar exists only so Cmd-Q behaves as anyone would expect.
let menu = NSMenu()
let item = NSMenuItem()
menu.addItem(item)
let sub = NSMenu()
sub.addItem(NSMenuItem(title: "Quit", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q"))
item.submenu = sub
app.mainMenu = menu

NSEvent.addLocalMonitorForEvents(matching: .keyDown) { event in
    if event.charactersIgnoringModifiers?.lowercased() == "s", !event.modifierFlags.contains(.command) {
        lab.requestSave()
        return nil
    }
    return event
}

app.run()
