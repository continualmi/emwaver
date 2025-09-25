import Foundation
import SwiftUI

// Represents the UI node type that Wavelet scripts can construct.
enum WaveletNodeType: String {
    case column
    case row
    case text
    case button
    case slider
    case logViewer
}

// Supported event types for Wavelet UI nodes.
enum WaveletEventType: String {
    case tap
}

// Stored properties associated with a Wavelet node.
struct WaveletNodeProps {
    var raw: [String: Any]
    var eventHandlers: [WaveletEventType: String]

    init(raw: [String: Any], eventHandlers: [WaveletEventType: String] = [:]) {
        self.raw = raw
        self.eventHandlers = eventHandlers
    }

    var label: String? {
        raw["label"] as? String
    }

    var text: String? {
        if let value = raw["text"] as? String {
            return value
        }
        return raw["label"] as? String
    }

    var spacing: CGFloat? {
        guard let value = raw["spacing"] else { return nil }
        if let number = value as? NSNumber {
            return CGFloat(truncating: number)
        }
        if let double = value as? Double {
            return CGFloat(double)
        }
        if let int = value as? Int {
            return CGFloat(int)
        }
        return nil
    }

    var padding: EdgeInsets? {
        guard let value = raw["padding"] else { return nil }
        if let number = value as? NSNumber {
            let inset = CGFloat(truncating: number)
            return EdgeInsets(top: inset, leading: inset, bottom: inset, trailing: inset)
        }
        if let dict = value as? [String: Any] {
            let top = WaveletNodeProps.extractCGFloat(dict["top"]) ?? 0
            let bottom = WaveletNodeProps.extractCGFloat(dict["bottom"]) ?? 0
            let leading = WaveletNodeProps.extractCGFloat(dict["leading"]) ?? 0
            let trailing = WaveletNodeProps.extractCGFloat(dict["trailing"]) ?? 0
            return EdgeInsets(top: top, leading: leading, bottom: bottom, trailing: trailing)
        }
        return nil
    }

    var alignment: HorizontalAlignment? {
        guard let value = raw["alignment"] as? String else { return nil }
        switch value.lowercased() {
        case "leading", "start":
            return .leading
        case "trailing", "end":
            return .trailing
        case "center":
            return .center
        default:
            return nil
        }
    }

    var frameWidth: CGFloat? {
        WaveletNodeProps.extractCGFloat(raw["width"])
    }

    func handlerId(for event: WaveletEventType) -> String? {
        eventHandlers[event]
    }

    private static func extractCGFloat(_ value: Any?) -> CGFloat? {
        guard let value = value else { return nil }
        if let number = value as? NSNumber {
            return CGFloat(truncating: number)
        }
        if let double = value as? Double {
            return CGFloat(double)
        }
        if let int = value as? Int {
            return CGFloat(int)
        }
        return nil
    }
}

// Node representation used to render Wavelet UI inside SwiftUI.
struct WaveletNode: Identifiable {
    let id: String
    let type: WaveletNodeType
    var props: WaveletNodeProps
    var children: [WaveletNode]

    init(id: String, type: WaveletNodeType, props: WaveletNodeProps, children: [WaveletNode] = []) {
        self.id = id
        self.type = type
        self.props = props
        self.children = children
    }
}

// Root tree returned from the Wavelet engine when a script invokes UI.render.
struct WaveletTree {
    let root: WaveletNode
    let metadata: [String: Any]

    init(root: WaveletNode, metadata: [String: Any] = [:]) {
        self.root = root
        self.metadata = metadata
    }
}
