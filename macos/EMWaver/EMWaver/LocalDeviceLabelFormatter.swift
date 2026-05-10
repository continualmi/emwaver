import Foundation

enum LocalDeviceLabelFormatter {
    static func label(for descriptor: LocalDeviceDescriptor) -> String {
        let board = boardDisplayName(descriptor.boardType)
        if let uid = hardwareUID(from: descriptor.identifierText) {
            return "\(board) / \(uid)"
        }
        if let module = descriptor.moduleLabel, !module.isEmpty {
            return "\(board) / \(module)"
        }
        return descriptor.displayName.isEmpty ? board : "\(board) / \(descriptor.displayName)"
    }

    static func boardDisplayName(_ boardType: String?) -> String {
        switch (boardType ?? "").lowercased() {
        case "esp32":
            return "ESP32"
        case "esp32s2":
            return "ESP32-S2"
        case "esp32s3":
            return "ESP32-S3"
        case "stm32f042":
            return "STM32F042"
        default:
            return boardType?.isEmpty == false ? boardType! : "Device"
        }
    }

    private static func hardwareUID(from identifierText: String?) -> String? {
        guard let identifierText, identifierText.hasPrefix("UID ") else { return nil }
        return cleanIdentifier(String(identifierText.dropFirst("UID ".count)))
    }

    private static func cleanIdentifier(_ value: String) -> String? {
        let clean = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard clean.count == 12, clean.allSatisfy(\.isHexDigit) else { return nil }
        return clean
    }
}
