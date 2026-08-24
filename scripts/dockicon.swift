// Ask macOS what it would actually draw for a bundle in the Dock.
//
// Rendering the icon source proves nothing: the Liquid Glass treatment — the
// squircle mask, the background gradient, the per-layer specular and the drop
// shadow — is applied by the SYSTEM at composite time, not stored in any file.
// NSWorkspace.icon(forFile:) returns the composited result.
//
// `qlmanage -t` is the obvious tool for this and it hangs. This one answers.
//
//   swift dockicon.swift <path-to.app> <out.png> [size]

import AppKit

let args = CommandLine.arguments
guard args.count >= 3 else {
    FileHandle.standardError.write("usage: dockicon.swift <app> <out.png> [size]\n".data(using: .utf8)!)
    exit(2)
}
let appPath = args[1]
let outPath = args[2]
let size = args.count > 3 ? Int(args[3]) ?? 512 : 512

guard FileManager.default.fileExists(atPath: appPath) else {
    FileHandle.standardError.write("no such bundle: \(appPath)\n".data(using: .utf8)!)
    exit(1)
}

let icon = NSWorkspace.shared.icon(forFile: appPath)
icon.size = NSSize(width: size, height: size)

// Draw into a bitmap at the requested pixel size. Going through
// NSBitmapImageRep directly (rather than icon.tiffRepresentation) is what
// gives an exact pixel count instead of whichever representation AppKit feels
// like handing back.
guard let rep = NSBitmapImageRep(
    bitmapDataPlanes: nil,
    pixelsWide: size, pixelsHigh: size,
    bitsPerSample: 8, samplesPerPixel: 4,
    hasAlpha: true, isPlanar: false,
    colorSpaceName: .deviceRGB,
    bytesPerRow: 0, bitsPerPixel: 0
) else {
    FileHandle.standardError.write("could not allocate bitmap\n".data(using: .utf8)!)
    exit(1)
}
rep.size = NSSize(width: size, height: size)

NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
icon.draw(in: NSRect(x: 0, y: 0, width: size, height: size),
          from: .zero, operation: .sourceOver, fraction: 1.0)
NSGraphicsContext.restoreGraphicsState()

guard let data = rep.representation(using: .png, properties: [:]) else {
    FileHandle.standardError.write("could not encode PNG\n".data(using: .utf8)!)
    exit(1)
}
try data.write(to: URL(fileURLWithPath: outPath))
print("wrote \(outPath) at \(size)x\(size) from \(appPath)")
