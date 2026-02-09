/*
 * EMWaver
 * Copyright (c) 2026 Luis Marnoto
 * All rights reserved.
 */

import Foundation
import SwiftUI

#if canImport(UIKit)
import UIKit
#endif

// Represents the UI node type that EMW scripts can construct.
public enum ScriptNodeType: String {
    case column
    case row
    case card
    case tile
    case text
    case button
    case slider
    case logViewer
    case scroll
    case textField
    case textEditor
    case picker
    case toggle
    case grid
    case plot
    case modal
    case spacer
    case divider
    case progress
}

// Supported event types for script UI nodes.
public enum ScriptEventType: String {
    case tap
    case change
    case submit
    case viewport
    case select
    case cursor
    case close
}

// Stored properties associated with a script node.
public struct ScriptNodeProps {
    public var raw: [String: Any]
    public var eventHandlers: [ScriptEventType: String]

    public init(raw: [String: Any], eventHandlers: [ScriptEventType: String] = [:]) {
        self.raw = raw
        self.eventHandlers = eventHandlers
    }

    public var label: String? {
        raw["label"] as? String
    }

    public var text: String? {
        if let value = raw["text"] as? String {
            return value
        }
        return raw["label"] as? String
    }

    public var spacing: CGFloat? {
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

    public var padding: EdgeInsets? {
        guard let value = raw["padding"] else { return nil }
        if let number = value as? NSNumber {
            let inset = CGFloat(truncating: number)
            return EdgeInsets(top: inset, leading: inset, bottom: inset, trailing: inset)
        }
        if let dict = value as? [String: Any] {
            let top = ScriptNodeProps.extractCGFloat(dict["top"]) ?? 0
            let bottom = ScriptNodeProps.extractCGFloat(dict["bottom"]) ?? 0
            let leading = ScriptNodeProps.extractCGFloat(dict["leading"]) ?? 0
            let trailing = ScriptNodeProps.extractCGFloat(dict["trailing"]) ?? 0
            return EdgeInsets(top: top, leading: leading, bottom: bottom, trailing: trailing)
        }
        return nil
    }

    public var alignment: HorizontalAlignment? {
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

    public var frameWidth: CGFloat? {
        ScriptNodeProps.extractCGFloat(raw["width"])
    }

    public var frameHeight: CGFloat? {
        ScriptNodeProps.extractCGFloat(raw["height"])
    }

    public var minFrameWidth: CGFloat? {
        ScriptNodeProps.extractCGFloat(raw["minWidth"])
    }

    public var maxFrameWidth: CGFloat? {
        ScriptNodeProps.extractCGFloat(raw["maxWidth"])
    }

    public var minFrameHeight: CGFloat? {
        ScriptNodeProps.extractCGFloat(raw["minHeight"])
    }

    public var maxFrameHeight: CGFloat? {
        ScriptNodeProps.extractCGFloat(raw["maxHeight"])
    }

    public var cornerRadius: CGFloat? {
        ScriptNodeProps.extractCGFloat(raw["cornerRadius"])
    }

    public var backgroundColor: Color? {
        ScriptNodeProps.parseColor(raw["backgroundColor"])
    }

    public var foregroundColor: Color? {
        ScriptNodeProps.parseColor(raw["foregroundColor"])
    }

    public var fillsWidth: Bool {
        if let value = raw["fillsWidth"] as? Bool { return value }
        if let number = raw["fillsWidth"] as? NSNumber { return number.boolValue }
        return true
    }

    public var font: Font? {
        guard let value = (raw["font"] as? String)?.lowercased() else { return nil }
        switch value {
        case "largetitle": return .largeTitle
        case "title": return .title
        case "title2": return .title2
        case "title3": return .title3
        case "headline": return .headline
        case "subheadline": return .subheadline
        case "body": return .body
        case "callout": return .callout
        case "caption": return .caption
        case "caption2": return .caption2
        case "footnote": return .footnote
        default: return nil
        }
    }

    public var fontWeight: Font.Weight? {
        guard let value = (raw["fontWeight"] as? String)?.lowercased() else { return nil }
        switch value {
        case "ultralight": return .ultraLight
        case "thin": return .thin
        case "light": return .light
        case "regular": return .regular
        case "medium": return .medium
        case "semibold": return .semibold
        case "bold": return .bold
        case "heavy": return .heavy
        case "black": return .black
        default: return nil
        }
    }

    public var fontDesign: String? {
        (raw["fontDesign"] as? String)?.lowercased()
    }

    public var systemIconName: String? {
        raw["icon"] as? String
    }

    public var axis: Axis.Set {
        guard let rawAxis = (raw["axis"] as? String)?.lowercased() else { return .vertical }
        switch rawAxis {
        case "horizontal":
            return .horizontal
        case "both":
            return [.horizontal, .vertical]
        default:
            return .vertical
        }
    }

    public var showsIndicators: Bool {
        if let value = raw["showsIndicators"] as? Bool { return value }
        if let number = raw["showsIndicators"] as? NSNumber { return number.boolValue }
        return true
    }

    public var textFieldValue: String {
        raw["value"] as? String ?? ""
    }

    public var textEditorValue: String {
        raw["value"] as? String ?? ""
    }

    public var placeholder: String {
        raw["placeholder"] as? String ?? ""
    }

#if canImport(UIKit)
    public var textContentType: UITextContentType? {
        guard let value = (raw["textContentType"] as? String)?.lowercased() else { return nil }
        switch value {
        case "username": return .username
        case "password": return .password
        case "email": return .emailAddress
        case "name": return .name
        case "telephone": return .telephoneNumber
        default: return nil
        }
    }

    public var keyboardType: UIKeyboardType {
        guard let value = (raw["keyboard"] as? String)?.lowercased() else { return .default }
        switch value {
        case "number": return .numberPad
        case "decimal": return .decimalPad
        case "email": return .emailAddress
        case "url": return .URL
        case "ascii": return .asciiCapable
        case "phone": return .phonePad
        case "password": return .asciiCapable
        default: return .default
        }
    }
#endif

    public var autocapitalizationMode: String? {
        (raw["autocapitalize"] as? String)?.lowercased()
    }

    public var isSecureField: Bool {
        (raw["secure"] as? Bool) ?? false
    }

    public var buttonStyle: ScriptButtonStyleOption? {
        guard let value = (raw["buttonStyle"] as? String)?.lowercased() else { return nil }
        switch value {
        case "plain": return .plain
        case "bordered": return .bordered
        case "borderedprominent", "prominent": return .borderedProminent
        case "automatic": return .automatic
        default: return nil
        }
    }

    public var controlSize: ControlSize? {
        guard let value = (raw["controlSize"] as? String)?.lowercased() else { return nil }
        switch value {
        case "mini": return .mini
        case "small": return .small
        case "regular": return .regular
        case "large": return .large
        default: return nil
        }
    }

    public var pickerOptions: [ScriptPickerOption] {
        guard let rawOptions = raw["options"] as? [[String: Any]] else { return [] }
        return rawOptions.compactMap { ScriptPickerOption(dictionary: $0) }
    }

    public var pickerSelection: String {
        raw["selected"] as? String ?? ""
    }

    // Back-compat alias (older call sites used pickerSelected)
    public var pickerSelected: String {
        pickerSelection
    }

    public var pickerStyle: String? {
        (raw["style"] as? String)?.lowercased()
    }

    public var gridColumns: Int {
        if let value = raw["columns"] as? Int { return max(1, value) }
        if let number = raw["columns"] as? NSNumber { return max(1, number.intValue) }
        return 2
    }

    public var gridMinColumnWidth: CGFloat? {
        ScriptNodeProps.extractCGFloat(raw["minColumnWidth"])
    }

    public var gridSpacing: CGFloat {
        ScriptNodeProps.extractCGFloat(raw["spacing"]) ?? 8
    }

    public var sliderValue: Double {
        if let number = raw["value"] as? NSNumber { return number.doubleValue }
        if let double = raw["value"] as? Double { return double }
        if let string = raw["value"] as? String, let parsed = Double(string) { return parsed }
        return 0
    }

    public var sliderRange: ClosedRange<Double> {
        let minValue: Double
        if let number = raw["min"] as? NSNumber {
            minValue = number.doubleValue
        } else if let string = raw["min"] as? String, let parsed = Double(string) {
            minValue = parsed
        } else {
            minValue = 0
        }

        let maxValue: Double
        if let number = raw["max"] as? NSNumber {
            maxValue = number.doubleValue
        } else if let string = raw["max"] as? String, let parsed = Double(string) {
            maxValue = parsed
        } else {
            maxValue = 1
        }

        if minValue > maxValue {
            return maxValue...minValue
        }
        return minValue...maxValue
    }

    public var sliderStep: Double? {
        ScriptNodeProps.extractDouble(raw["step"])
    }

    public func handlerId(for event: ScriptEventType) -> String? {
        eventHandlers[event]
    }

    public var spacerMinLength: CGFloat? {
        ScriptNodeProps.extractCGFloat(raw["minLength"])
    }

    public var progressValue: Double? {
        ScriptNodeProps.extractDouble(raw["value"])
    }

    public var progressTotal: Double? {
        if let explicit = ScriptNodeProps.extractDouble(raw["total"]) {
            return explicit
        }
        if let explicit = ScriptNodeProps.extractDouble(raw["max"]) {
            return explicit
        }
        return nil
    }

    public var progressDetail: String? {
        raw["detail"] as? String
    }

    public var layoutPriority: Double? {
        if let explicit = ScriptNodeProps.extractDouble(raw["layoutPriority"]) {
            return explicit
        }
        if let flex = ScriptNodeProps.extractDouble(raw["flex"]) {
            return flex
        }
        return nil
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
        if let string = value as? String, let parsed = Double(string) {
            return CGFloat(parsed)
        }
        return nil
    }

    private static func extractDouble(_ value: Any?) -> Double? {
        guard let value = value else { return nil }
        if let number = value as? NSNumber {
            return number.doubleValue
        }
        if let double = value as? Double {
            return double
        }
        if let int = value as? Int {
            return Double(int)
        }
        if let string = value as? String {
            return Double(string)
        }
        return nil
    }

    private static func parseColor(_ value: Any?) -> Color? {
        guard let string = value as? String else { return nil }
        let trimmed = string.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.hasPrefix("#") {
            let hexString = String(trimmed.dropFirst())
            return colorFromHex(hexString)
        }
        if trimmed.lowercased().hasPrefix("0x") {
            let hexString = String(trimmed.dropFirst(2))
            return colorFromHex(hexString)
        }
        switch trimmed.lowercased() {
        case "blue": return .blue
        case "green": return .green
        case "red": return .red
        case "orange": return .orange
        case "yellow": return .yellow
        case "pink": return .pink
        case "purple": return .purple
        case "gray": return .gray
        case "white": return .white
        case "black": return .black
        case "teal": return .teal
        case "mint": return .mint
        case "cyan": return .cyan
        case "indigo": return .indigo
        case "brown": return .brown
        default: return nil
        }
    }

    private static func colorFromHex(_ hex: String) -> Color? {
        let cleaned = hex.replacingOccurrences(of: "_", with: "").replacingOccurrences(of: " ", with: "")
        guard cleaned.count == 6 || cleaned.count == 8 else { return nil }
        var value: UInt64 = 0
        guard Scanner(string: cleaned).scanHexInt64(&value) else { return nil }
        if cleaned.count == 6 {
            let r = Double((value & 0xFF0000) >> 16) / 255.0
            let g = Double((value & 0x00FF00) >> 8) / 255.0
            let b = Double(value & 0x0000FF) / 255.0
            return Color(red: r, green: g, blue: b)
        } else {
            let r = Double((value & 0xFF000000) >> 24) / 255.0
            let g = Double((value & 0x00FF0000) >> 16) / 255.0
            let b = Double((value & 0x0000FF00) >> 8) / 255.0
            let a = Double(value & 0x000000FF) / 255.0
            return Color(red: r, green: g, blue: b, opacity: a)
        }
    }
}

public struct ScriptPickerOption: Identifiable {
    public let id = UUID()
    public let label: String
    public let value: String

    public init?(dictionary: [String: Any]) {
        guard let label = dictionary["label"] as? String else { return nil }
        self.label = label
        if let value = dictionary["value"] as? String {
            self.value = value
        } else if let number = dictionary["value"] as? NSNumber {
            self.value = number.stringValue
        } else {
            self.value = label
        }
    }
}

// Node representation used to render script UI inside SwiftUI.
public struct ScriptNode: Identifiable {
    public let id: String
    public let type: ScriptNodeType
    public var props: ScriptNodeProps
    public var children: [ScriptNode]

    public init(id: String, type: ScriptNodeType, props: ScriptNodeProps, children: [ScriptNode] = []) {
        self.id = id
        self.type = type
        self.props = props
        self.children = children
    }
}

// Root tree returned from the script engine when a script invokes UI.render.
public struct ScriptTree {
    public let root: ScriptNode
    public let metadata: [String: Any]

    public init(root: ScriptNode, metadata: [String: Any] = [:]) {
        self.root = root
        self.metadata = metadata
    }
}

public enum ScriptButtonStyleOption {
    case plain
    case bordered
    case borderedProminent
    case automatic
}
