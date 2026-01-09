/*
 * EMWaver
 * Copyright (c) 2026 Luís Marnoto
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import Foundation
import SwiftUI
import UIKit

// Represents the UI node type that Script scripts can construct.
enum ScriptNodeType: String {
    case column
    case row
    case text
    case button
    case slider
    case logViewer
    case scroll
    case textField
    case textEditor
    case picker
    case grid
    case spacer
    case divider
    case progress
}

// Supported event types for Script UI nodes.
enum ScriptEventType: String {
    case tap
    case change
    case submit
}

// Stored properties associated with a Script node.
struct ScriptNodeProps {
    var raw: [String: Any]
    var eventHandlers: [ScriptEventType: String]

    init(raw: [String: Any], eventHandlers: [ScriptEventType: String] = [:]) {
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
            let top = ScriptNodeProps.extractCGFloat(dict["top"]) ?? 0
            let bottom = ScriptNodeProps.extractCGFloat(dict["bottom"]) ?? 0
            let leading = ScriptNodeProps.extractCGFloat(dict["leading"]) ?? 0
            let trailing = ScriptNodeProps.extractCGFloat(dict["trailing"]) ?? 0
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
        ScriptNodeProps.extractCGFloat(raw["width"])
    }

    var frameHeight: CGFloat? {
        ScriptNodeProps.extractCGFloat(raw["height"])
    }

    var minFrameWidth: CGFloat? {
        ScriptNodeProps.extractCGFloat(raw["minWidth"])
    }

    var maxFrameWidth: CGFloat? {
        ScriptNodeProps.extractCGFloat(raw["maxWidth"])
    }

    var minFrameHeight: CGFloat? {
        ScriptNodeProps.extractCGFloat(raw["minHeight"])
    }

    var maxFrameHeight: CGFloat? {
        ScriptNodeProps.extractCGFloat(raw["maxHeight"])
    }

    var cornerRadius: CGFloat? {
        ScriptNodeProps.extractCGFloat(raw["cornerRadius"])
    }

    var backgroundColor: Color? {
        ScriptNodeProps.parseColor(raw["backgroundColor"])
    }

    var foregroundColor: Color? {
        ScriptNodeProps.parseColor(raw["foregroundColor"])
    }

    var fillsWidth: Bool {
        if let value = raw["fillsWidth"] as? Bool { return value }
        if let number = raw["fillsWidth"] as? NSNumber { return number.boolValue }
        return true
    }

    var font: Font? {
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

    var fontWeight: Font.Weight? {
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

    var fontDesign: String? {
        (raw["fontDesign"] as? String)?.lowercased()
    }

    var systemIconName: String? {
        raw["icon"] as? String
    }

    var axis: Axis.Set {
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

    var showsIndicators: Bool {
        if let value = raw["showsIndicators"] as? Bool { return value }
        if let number = raw["showsIndicators"] as? NSNumber { return number.boolValue }
        return true
    }

    var textFieldValue: String {
        raw["value"] as? String ?? ""
    }

    var placeholder: String {
        raw["placeholder"] as? String ?? ""
    }

    var textContentType: UITextContentType? {
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

    var keyboardType: UIKeyboardType {
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

    var autocapitalizationMode: String? {
        (raw["autocapitalize"] as? String)?.lowercased()
    }

    var isSecureField: Bool {
        (raw["secure"] as? Bool) ?? false
    }

    var buttonStyle: ScriptButtonStyleOption? {
        guard let value = (raw["buttonStyle"] as? String)?.lowercased() else { return nil }
        switch value {
        case "plain": return .plain
        case "bordered": return .bordered
        case "borderedprominent", "prominent": return .borderedProminent
        case "automatic": return .automatic
        default: return nil
        }
    }

    var controlSize: ControlSize? {
        guard let value = (raw["controlSize"] as? String)?.lowercased() else { return nil }
        switch value {
        case "mini": return .mini
        case "small": return .small
        case "regular": return .regular
        case "large": return .large
        default: return nil
        }
    }

    var pickerOptions: [ScriptPickerOption] {
        guard let rawOptions = raw["options"] as? [[String: Any]] else { return [] }
        return rawOptions.compactMap { ScriptPickerOption(dictionary: $0) }
    }

    var pickerSelection: String {
        raw["selected"] as? String ?? ""
    }

    var pickerStyle: String? {
        (raw["style"] as? String)?.lowercased()
    }

    var gridColumns: Int {
        if let value = raw["columns"] as? Int { return max(1, value) }
        if let number = raw["columns"] as? NSNumber { return max(1, number.intValue) }
        return 2
    }

    var gridSpacing: CGFloat {
        ScriptNodeProps.extractCGFloat(raw["spacing"]) ?? 8
    }

    var sliderValue: Double {
        if let number = raw["value"] as? NSNumber { return number.doubleValue }
        if let double = raw["value"] as? Double { return double }
        if let string = raw["value"] as? String, let parsed = Double(string) { return parsed }
        return 0
    }

    var sliderRange: ClosedRange<Double> {
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

    func handlerId(for event: ScriptEventType) -> String? {
        eventHandlers[event]
    }

    var spacerMinLength: CGFloat? {
        ScriptNodeProps.extractCGFloat(raw["minLength"])
    }

    var progressValue: Double? {
        ScriptNodeProps.extractDouble(raw["value"])
    }

    var progressTotal: Double? {
        if let explicit = ScriptNodeProps.extractDouble(raw["total"]) {
            return explicit
        }
        if let explicit = ScriptNodeProps.extractDouble(raw["max"]) {
            return explicit
        }
        return nil
    }

    var progressDetail: String? {
        raw["detail"] as? String
    }

    var layoutPriority: Double? {
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
        case "systemgray6": return Color(.systemGray6)
        case "systemgray5": return Color(.systemGray5)
        case "systemgray4": return Color(.systemGray4)
        case "systemgray3": return Color(.systemGray3)
        case "systemgray2": return Color(.systemGray2)
        case "systemgray": return Color(.systemGray)
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

struct ScriptPickerOption: Identifiable {
    let id = UUID()
    let label: String
    let value: String

    init?(dictionary: [String: Any]) {
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

// Node representation used to render Script UI inside SwiftUI.
struct ScriptNode: Identifiable {
    let id: String
    let type: ScriptNodeType
    var props: ScriptNodeProps
    var children: [ScriptNode]

    init(id: String, type: ScriptNodeType, props: ScriptNodeProps, children: [ScriptNode] = []) {
        self.id = id
        self.type = type
        self.props = props
        self.children = children
    }
}

// Root tree returned from the Script engine when a script invokes UI.render.
struct ScriptTree {
    let root: ScriptNode
    let metadata: [String: Any]

    init(root: ScriptNode, metadata: [String: Any] = [:]) {
        self.root = root
        self.metadata = metadata
    }
}
enum ScriptButtonStyleOption {
    case plain
    case bordered
    case borderedProminent
    case automatic
}
