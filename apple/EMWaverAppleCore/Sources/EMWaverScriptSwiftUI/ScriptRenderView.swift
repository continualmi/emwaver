/*
 * EMWaver
 * Copyright (c) 2026 Luis Marnoto
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

import SwiftUI
import EMWaverScriptModel

public struct ScriptRenderView: View {
    public let tree: ScriptTree?
    public let invokeHandler: (String, [Any]) -> Void

    public init(tree: ScriptTree?, invokeHandler: @escaping (String, [Any]) -> Void) {
        self.tree = tree
        self.invokeHandler = invokeHandler
    }

    public var body: some View {
        renderRoot()
    }

    private func renderRoot() -> AnyView {
        guard let root = tree?.root else {
            return AnyView(EmptyView())
        }
        return render(node: root)
    }

    private func render(node: ScriptNode) -> AnyView {
        switch node.type {
        case .column:
            return AnyView(
                VStack(alignment: node.props.alignment ?? .leading, spacing: node.props.spacing) {
                    ForEach(node.children) { child in
                        render(node: child)
                    }
                }
                .applyScriptModifiers(node.props)
            )
        case .row:
            return AnyView(
                HStack(spacing: node.props.spacing) {
                    ForEach(node.children) { child in
                        render(node: child)
                    }
                }
                .applyScriptModifiers(node.props)
            )
        case .text:
            var textView = Text(node.props.text ?? "")
            if let font = node.props.font {
                textView = textView.font(font)
            }
            if let weight = node.props.fontWeight {
                textView = textView.fontWeight(weight)
            }
            if let design = node.props.fontDesign {
                if #available(iOS 17.0, macOS 14.0, *), let mapped = mapFontDesign(from: design) {
                    textView = textView.fontDesign(mapped)
                }
            }
            if let color = node.props.foregroundColor {
                textView = textView.foregroundColor(color)
            }
            return AnyView(textView.applyScriptModifiers(node.props))
        case .button:
            return AnyView(
                ScriptButtonView(node: node, invokeHandler: invokeHandler)
                    .applyScriptModifiers(node.props)
            )
        case .slider:
            return AnyView(
                ScriptSliderView(node: node, invokeHandler: invokeHandler)
                    .applyScriptModifiers(node.props)
            )
        case .logViewer:
            return AnyView(
                ScriptLogViewerView(node: node)
                    .applyScriptModifiers(node.props)
            )
        case .scroll:
            return AnyView(
                ScriptScrollView(node: node, renderChild: render)
                    .applyScriptModifiers(node.props)
            )
        case .textField:
            return AnyView(
                ScriptTextFieldView(node: node, invokeHandler: invokeHandler)
                    .applyScriptModifiers(node.props)
            )
        case .textEditor:
            return AnyView(
                ScriptTextEditorView(node: node, invokeHandler: invokeHandler)
                    .applyScriptModifiers(node.props)
            )
        case .picker:
            return AnyView(
                ScriptPickerView(node: node, invokeHandler: invokeHandler)
                    .applyScriptModifiers(node.props)
            )
        case .grid:
            return AnyView(
                ScriptGridView(node: node, renderChild: render)
                    .applyScriptModifiers(node.props)
            )
        case .spacer:
            return AnyView(
                Spacer(minLength: node.props.spacerMinLength)
            )
        case .divider:
            return AnyView(
                Divider()
                    .applyScriptModifiers(node.props)
            )
        case .progress:
            return AnyView(
                ScriptProgressView(node: node)
                    .applyScriptModifiers(node.props)
            )
        }
    }
}

@available(iOS 17.0, macOS 14.0, *)
private func mapFontDesign(from value: String) -> Font.Design? {
    switch value.lowercased() {
    case "monospaced": return .monospaced
    case "rounded": return .rounded
    case "serif": return .serif
    default: return nil
    }
}

private struct ScriptButtonView: View {
    let node: ScriptNode
    let invokeHandler: (String, [Any]) -> Void

    var body: some View {
        let backgroundColorProvided = node.props.backgroundColor != nil
        let labelColor = node.props.foregroundColor ?? (backgroundColorProvided ? .white : nil)
        let button = Button(action: {
            if let token = node.props.handlerId(for: .tap) {
                invokeHandler(token, [])
            }
        }) {
            ScriptButtonLabel(
                node: node,
                labelColor: labelColor,
                fillsWidth: node.props.fillsWidth,
                controlSize: node.props.controlSize
            )
        }
        let styledButton = configureButtonStyle(button, backgroundColorProvided: backgroundColorProvided)
        return styledButton.applyControlSize(node.props.controlSize)
    }

    private func configureButtonStyle(_ button: Button<ScriptButtonLabel>, backgroundColorProvided: Bool) -> AnyView {
        if let style = node.props.buttonStyle {
            switch style {
            case .plain:
                return AnyView(button.buttonStyle(PlainButtonStyle()))
            case .bordered:
                if #available(iOS 15.0, macOS 12.0, *) {
                    return AnyView(button.buttonStyle(.bordered))
                } else {
                    return AnyView(button.buttonStyle(DefaultButtonStyle()))
                }
            case .borderedProminent:
                if #available(iOS 15.0, macOS 12.0, *) {
                    return AnyView(button.buttonStyle(.borderedProminent))
                } else {
                    return AnyView(button.buttonStyle(DefaultButtonStyle()))
                }
            case .automatic:
                if #available(iOS 15.0, macOS 12.0, *) {
                    return AnyView(button.buttonStyle(.automatic))
                } else {
                    return AnyView(button.buttonStyle(DefaultButtonStyle()))
                }
            }
        }

        if backgroundColorProvided {
            return AnyView(button.buttonStyle(PlainButtonStyle()))
        }
        if #available(iOS 15.0, macOS 12.0, *) {
            return AnyView(button.buttonStyle(.borderedProminent))
        }
        return AnyView(button.buttonStyle(DefaultButtonStyle()))
    }
}

private struct ScriptButtonLabel: View {
    let node: ScriptNode
    let labelColor: Color?
    let fillsWidth: Bool
    let controlSize: ControlSize?

    var body: some View {
        let baseLabel = HStack(spacing: 8) {
            if let icon = node.props.systemIconName {
                Image(systemName: icon)
            }
            Text(node.props.label ?? "Button")
                .frame(maxWidth: fillsWidth ? .infinity : nil, alignment: .center)
        }
        .padding(.vertical, verticalPadding)
        .padding(.horizontal, horizontalPadding)

        var labelView: AnyView = AnyView(baseLabel)

        if let labelColor {
            labelView = AnyView(labelView.foregroundColor(labelColor))
        }

        return labelView
    }

    private var verticalPadding: CGFloat {
        guard let controlSize else { return 12 }
        switch controlSize {
        case .mini: return 6
        case .small: return 8
        case .regular: return 12
        case .large: return 14
        case .extraLarge: return 16
        @unknown default:
            return 12
        }
    }

    private var horizontalPadding: CGFloat {
        guard let controlSize else { return 16 }
        switch controlSize {
        case .mini: return 10
        case .small: return 12
        case .regular: return 16
        case .large: return 20
        case .extraLarge:
            return 24
        @unknown default:
            return 16
        }
    }
}

private extension View {
    func applyControlSize(_ controlSize: ControlSize?) -> AnyView {
        guard let controlSize else { return AnyView(self) }
        if #available(iOS 15.0, macOS 11.0, *) {
            return AnyView(self.controlSize(controlSize))
        }
        return AnyView(self)
    }
}

private struct ScriptSliderView: View {
    let node: ScriptNode
    let invokeHandler: (String, [Any]) -> Void
    @State private var value: Double

    init(node: ScriptNode, invokeHandler: @escaping (String, [Any]) -> Void) {
        self.node = node
        self.invokeHandler = invokeHandler
        _value = State(initialValue: node.props.sliderValue)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let label = node.props.label {
                Text(label)
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
            Slider(value: Binding(
                get: { value },
                set: { newValue in
                    value = newValue
                    if let token = node.props.handlerId(for: .change) {
                        invokeHandler(token, [newValue])
                    }
                }
            ), in: node.props.sliderRange)
        }
        .modifier(ScriptOnChange(value: node.props.sliderValue) { newValue in
            if abs(newValue - value) > .ulpOfOne {
                value = newValue
            }
        })
    }
}

private struct ScriptLogViewerView: View {
    let node: ScriptNode

    var body: some View {
        ScrollView {
            Text(node.props.text ?? "")
                .font(.system(.footnote, design: .monospaced))
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(node.props.backgroundColor ?? Color.gray.opacity(0.08))
        .clipShape(RoundedRectangle(cornerRadius: node.props.cornerRadius ?? 8))
    }
}

private struct ScriptScrollView: View {
    let node: ScriptNode
    let renderChild: (ScriptNode) -> AnyView

    var body: some View {
        let axis = node.props.axis
        if axis == .horizontal {
            ScrollView(.horizontal, showsIndicators: node.props.showsIndicators) {
                HStack(alignment: .top, spacing: node.props.spacing) {
                    ForEach(node.children) { child in
                        renderChild(child)
                    }
                }
            }
        } else {
            ScrollView(.vertical, showsIndicators: node.props.showsIndicators) {
                VStack(alignment: node.props.alignment ?? .leading, spacing: node.props.spacing) {
                    ForEach(node.children) { child in
                        renderChild(child)
                    }
                }
            }
        }
    }
}

private struct ScriptTextFieldView: View {
    let node: ScriptNode
    let invokeHandler: (String, [Any]) -> Void
    @State private var value: String

    init(node: ScriptNode, invokeHandler: @escaping (String, [Any]) -> Void) {
        self.node = node
        self.invokeHandler = invokeHandler
        _value = State(initialValue: node.props.textFieldValue)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if let label = node.props.label {
                Text(label)
                    .font(.headline)
            }
            textField
        }
        .modifier(ScriptOnChange(value: node.props.textFieldValue) { newValue in
            if newValue != value {
                value = newValue
            }
        })
    }

    @ViewBuilder
    private var textField: some View {
        let binding = Binding(
            get: { value },
            set: { newValue in
                value = newValue
                if let token = node.props.handlerId(for: .change) {
                    invokeHandler(token, [newValue])
                }
            }
        )

        if node.props.isSecureField {
            secureField(for: binding)
        } else {
            standardTextField(for: binding)
        }
    }

    private func standardTextField(for binding: Binding<String>) -> AnyView {
        var view = AnyView(TextField(node.props.placeholder, text: binding))

#if canImport(UIKit)
        view = AnyView(
            view
                .textContentType(node.props.textContentType)
                .keyboardType(node.props.keyboardType)
        )

        if #available(iOS 15.0, *), let autocap = node.props.autocapitalizationMode {
            view = AnyView(view.textInputAutocapitalization(textInputAutocap(from: autocap)))
        }
#endif

        if node.props.fillsWidth {
            view = AnyView(view.frame(maxWidth: .infinity))
        }

        return AnyView(view.onSubmit {
            if let token = node.props.handlerId(for: .submit) {
                invokeHandler(token, [value])
            }
        })
    }

    private func secureField(for binding: Binding<String>) -> AnyView {
        var view = AnyView(SecureField(node.props.placeholder, text: binding))

#if canImport(UIKit)
        view = AnyView(view.textContentType(node.props.textContentType))
        if #available(iOS 15.0, *), let autocap = node.props.autocapitalizationMode {
            view = AnyView(view.textInputAutocapitalization(textInputAutocap(from: autocap)))
        }
#endif

        if node.props.fillsWidth {
            view = AnyView(view.frame(maxWidth: .infinity))
        }

        return AnyView(view.onSubmit {
            if let token = node.props.handlerId(for: .submit) {
                invokeHandler(token, [value])
            }
        })
    }
}

#if canImport(UIKit)
@available(iOS 15.0, *)
private func textInputAutocap(from mode: String) -> TextInputAutocapitalization {
    switch mode {
    case "none": return .never
    case "words": return .words
    case "sentences": return .sentences
    case "all": return .characters
    default: return .sentences
    }
}
#endif

private struct ScriptTextEditorView: View {
    let node: ScriptNode
    let invokeHandler: (String, [Any]) -> Void
    @State private var value: String

    init(node: ScriptNode, invokeHandler: @escaping (String, [Any]) -> Void) {
        self.node = node
        self.invokeHandler = invokeHandler
        _value = State(initialValue: node.props.textFieldValue)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if let label = node.props.label {
                Text(label)
                    .font(.headline)
            }
            ZStack(alignment: .topLeading) {
                TextEditor(text: Binding(
                    get: { value },
                    set: { newValue in
                        value = newValue
                        if let token = node.props.handlerId(for: .change) {
                            invokeHandler(token, [newValue])
                        }
                    }
                ))
                .frame(minHeight: 80)
                .overlay(
                    RoundedRectangle(cornerRadius: 8)
                        .stroke(Color.gray.opacity(0.2), lineWidth: 1)
                )

                if value.isEmpty && !node.props.placeholder.isEmpty {
                    Text(node.props.placeholder)
                        .foregroundColor(.secondary)
                        .padding(.top, 8)
                        .padding(.leading, 5)
                }
            }
        }
        .modifier(ScriptOnChange(value: node.props.textFieldValue) { newValue in
            if newValue != value {
                value = newValue
            }
        })
    }
}

private struct ScriptPickerView: View {
    let node: ScriptNode
    let invokeHandler: (String, [Any]) -> Void
    @State private var selection: String

    init(node: ScriptNode, invokeHandler: @escaping (String, [Any]) -> Void) {
        self.node = node
        self.invokeHandler = invokeHandler
        _selection = State(initialValue: node.props.pickerSelection)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if let label = node.props.label {
                Text(label)
                    .font(.headline)
            }
            let binding = Binding(
                get: { selection },
                set: { newValue in
                    selection = newValue
                    if let token = node.props.handlerId(for: .change) {
                        invokeHandler(token, [newValue])
                    }
                }
            )
            styledPickerView(selection: binding)
        }
        .modifier(ScriptOnChange(value: node.props.pickerSelection) { newValue in
            if newValue != selection {
                selection = newValue
            }
        })
    }

    private func styledPickerView(selection: Binding<String>) -> AnyView {
        let picker = Picker(node.props.label ?? "Picker", selection: selection) {
            ForEach(node.props.pickerOptions) { option in
                Text(option.label).tag(option.value)
            }
        }

        let styled: AnyView
        if node.props.pickerStyle == "segmented" {
            styled = AnyView(picker.pickerStyle(.segmented))
        } else if node.props.pickerStyle == "menu" {
            styled = AnyView(picker.pickerStyle(.menu))
        } else {
            styled = AnyView(picker.pickerStyle(.automatic))
        }

        if node.props.fillsWidth {
            return AnyView(styled.frame(maxWidth: .infinity, alignment: .leading))
        }

        return styled
    }
}

private struct ScriptProgressView: View {
    let node: ScriptNode

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if let value = node.props.progressValue {
                let total = node.props.progressTotal ?? 1.0
                if let label = node.props.label {
                    ProgressView(label, value: min(value, total), total: max(total, .leastNonzeroMagnitude))
                } else {
                    ProgressView(value: min(value, total), total: max(total, .leastNonzeroMagnitude))
                }
            } else {
                if let label = node.props.label {
                    ProgressView(label)
                } else {
                    ProgressView()
                }
            }

            if let detail = node.props.progressDetail, !detail.isEmpty {
                Text(detail)
                    .font(.footnote)
                    .foregroundColor(.secondary)
            }
        }
    }
}

private struct ScriptGridView: View {
    let node: ScriptNode
    let renderChild: (ScriptNode) -> AnyView

    var body: some View {
        let columns = Array(repeating: GridItem(.flexible(), spacing: node.props.gridSpacing), count: node.props.gridColumns)
        return LazyVGrid(columns: columns, spacing: node.props.gridSpacing) {
            ForEach(node.children) { child in
                renderChild(child)
            }
        }
    }
}

private extension View {
    func applyScriptModifiers(_ props: ScriptNodeProps) -> AnyView {
        var modified = AnyView(self)
        if let padding = props.padding {
            modified = AnyView(modified.padding(padding))
        }

        var minWidth = props.minFrameWidth
        let idealWidth = props.frameWidth
        var maxWidth = props.maxFrameWidth
        var minHeight = props.minFrameHeight
        let idealHeight = props.frameHeight
        var maxHeight = props.maxFrameHeight

        if let ideal = idealWidth {
            minWidth = minWidth ?? ideal
            maxWidth = maxWidth ?? ideal
        }

        if let ideal = idealHeight {
            minHeight = minHeight ?? ideal
            maxHeight = maxHeight ?? ideal
        }

        if props.fillsWidth {
            maxWidth = .infinity
            if minWidth == nil {
                minWidth = 0
            }
        }

        if minWidth != nil || idealWidth != nil || maxWidth != nil || minHeight != nil || idealHeight != nil || maxHeight != nil || props.fillsWidth {
            let alignment = Alignment(horizontal: props.alignment ?? .leading, vertical: .center)
            modified = AnyView(
                modified.frame(
                    minWidth: minWidth,
                    idealWidth: idealWidth,
                    maxWidth: maxWidth,
                    minHeight: minHeight,
                    idealHeight: idealHeight,
                    maxHeight: maxHeight,
                    alignment: alignment
                )
            )
        }
        if let background = props.backgroundColor {
            modified = AnyView(modified.background(background))
        }
        if let cornerRadius = props.cornerRadius {
            modified = AnyView(modified.cornerRadius(cornerRadius))
        }
        if let foreground = props.foregroundColor {
            modified = AnyView(modified.foregroundColor(foreground))
        }
        if let priority = props.layoutPriority {
            modified = AnyView(modified.layoutPriority(priority))
        }
        return modified
    }
}

private struct ScriptOnChange<T: Equatable>: ViewModifier {
    let value: T
    let action: (T) -> Void

    @ViewBuilder
    func body(content: Content) -> some View {
        if #available(iOS 17.0, macOS 14.0, *) {
            content.onChange(of: value) { _, newValue in
                action(newValue)
            }
        } else {
            content.onChange(of: value, perform: action)
        }
    }
}
