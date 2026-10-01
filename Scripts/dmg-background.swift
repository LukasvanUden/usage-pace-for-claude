// Draws the background of the Usage Pace disk image window, 640 × 440 points,
// as a TIFF with a 1x and a 2x image so it stays sharp on Retina screens.
//
//   swift Scripts/dmg-background.swift <output.tiff> [preview.png]
import AppKit

let size = NSSize(width: 640, height: 440)
/// Finder centers the two icons on this line, measured from the window's top.
let iconCenterFromTop: CGFloat = 230

func color(_ hex: UInt32) -> NSColor {
    NSColor(srgbRed: CGFloat((hex >> 16) & 0xff) / 255,
            green: CGFloat((hex >> 8) & 0xff) / 255,
            blue: CGFloat(hex & 0xff) / 255,
            alpha: 1)
}

/// Draws `text` centered horizontally, its top `top` points below the top edge.
func drawCentered(_ text: String, top: CGFloat, font: NSFont, color: NSColor) {
    let string = NSAttributedString(string: text, attributes: [.font: font, .foregroundColor: color])
    let textSize = string.size()
    string.draw(at: NSPoint(x: (size.width - textSize.width) / 2, y: size.height - top - textSize.height))
}

func render(scale: CGFloat) -> NSBitmapImageRep {
    let rep = NSBitmapImageRep(bitmapDataPlanes: nil,
                               pixelsWide: Int(size.width * scale), pixelsHigh: Int(size.height * scale),
                               bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
                               colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
    rep.size = size
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)

    color(0xF5F5F3).setFill()
    NSRect(origin: .zero, size: size).fill()

    drawCentered("Usage Pace", top: 52, font: .systemFont(ofSize: 26, weight: .semibold), color: color(0x1D1D1F))
    drawCentered("Drag the app onto Applications", top: 90, font: .systemFont(ofSize: 15), color: color(0x6E6E73))
    // Kept clear of the bottom edge: newer macOS versions have taller title
    // bars, which leave less of the window for the picture.
    drawCentered("Then open Usage Pace once and restart Claude.", top: 364,
                 font: .systemFont(ofSize: 13), color: color(0x8A8A8E))

    let y = size.height - iconCenterFromTop
    let arrow = NSBezierPath()
    arrow.move(to: NSPoint(x: 254, y: y))
    arrow.line(to: NSPoint(x: 386, y: y))
    arrow.move(to: NSPoint(x: 371, y: y + 15))
    arrow.line(to: NSPoint(x: 386, y: y))
    arrow.line(to: NSPoint(x: 371, y: y - 15))
    arrow.lineWidth = 4
    arrow.lineCapStyle = .round
    arrow.lineJoinStyle = .round
    color(0x2A78D6).setStroke()
    arrow.stroke()

    NSGraphicsContext.restoreGraphicsState()
    return rep
}

let reps = [render(scale: 1), render(scale: 2)]
guard let tiff = NSBitmapImageRep.tiffRepresentationOfImageReps(in: reps, using: .lzw, factor: 0) else {
    fatalError("Could not encode the background image")
}
try tiff.write(to: URL(fileURLWithPath: CommandLine.arguments[1]))
if CommandLine.arguments.count > 2, let png = reps[1].representation(using: .png, properties: [:]) {
    try png.write(to: URL(fileURLWithPath: CommandLine.arguments[2]))
}
