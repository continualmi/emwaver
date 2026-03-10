import Foundation

enum AppEnvironment {
    private static let bundledValues: [String: String] = {
        guard let url = Bundle.main.url(forResource: "EMWaverEnv", withExtension: "plist"),
              let data = try? Data(contentsOf: url),
              let plist = try? PropertyListSerialization.propertyList(from: data, options: [], format: nil),
              let dict = plist as? [String: Any]
        else {
            return [:]
        }

        var values: [String: String] = [:]
        for (key, value) in dict {
            guard let stringValue = value as? String else { continue }
            values[key] = stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        }
        return values
    }()

    static func string(_ key: String) -> String {
        let runtimeValue = (ProcessInfo.processInfo.environment[key] ?? "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        if !runtimeValue.isEmpty {
            return runtimeValue
        }
        return bundledValues[key] ?? ""
    }
}
