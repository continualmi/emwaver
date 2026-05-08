import Foundation

enum LocalDeviceLabelFormatter {
    static func label(for descriptor: LocalDeviceDescriptor) -> String {
        let board = boardDisplayName(descriptor.boardType)
        if let module = descriptor.moduleLabel, !module.isEmpty {
            return "\(board) / \(module)"
        }
        if let suffix = shortIdentifier(for: descriptor.id) {
            return "\(board) / \(suffix)"
        }
        return descriptor.displayName.isEmpty ? board : "\(board) / \(descriptor.displayName)"
    }

    static func boardDisplayName(_ boardType: String?) -> String {
        switch (boardType ?? "").lowercased() {
        case "esp32s3":
            return "ESP32-S3"
        case "stm32f042":
            return "STM32F042"
        default:
            return boardType?.isEmpty == false ? boardType! : "Device"
        }
    }

    private static func shortIdentifier(for id: String) -> String? {
        if id.hasPrefix("uid:") {
            return tail(String(id.dropFirst("uid:".count)))
        }
        if id.hasPrefix("ble:") {
            return tail(String(id.dropFirst("ble:".count)).replacingOccurrences(of: "-", with: ""))
        }
        if id.hasPrefix("wifi:") {
            return String(id.dropFirst("wifi:".count))
        }
        return nil
    }

    private static func tail(_ value: String) -> String? {
        let clean = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !clean.isEmpty else { return nil }
        return String(clean.suffix(min(6, clean.count))).uppercased()
    }
}
