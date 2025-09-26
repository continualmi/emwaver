import SwiftUI

struct WaveletRenderView: View {
    let tree: WaveletTree?
    let invokeHandler: (String, [Any]) -> Void

    init(tree: WaveletTree?, invokeHandler: @escaping (String, [Any]) -> Void) {
        self.tree = tree
        self.invokeHandler = invokeHandler
    }

    var body: some View {
        renderRoot()
    }

    private func renderRoot() -> AnyView {
        guard let root = tree?.root else {
            return AnyView(EmptyView())
        }
        return render(node: root)
    }

    private func render(node: WaveletNode) -> AnyView {
        switch node.type {
        case .column:
            return AnyView(
                VStack(alignment: node.props.alignment ?? .leading, spacing: node.props.spacing) {
                    ForEach(node.children) { child in
                        render(node: child)
                    }
                }
                .applyWaveletModifiers(node.props)
            )
        case .row:
            return AnyView(
                HStack(spacing: node.props.spacing) {
                    ForEach(node.children) { child in
                        render(node: child)
                    }
                }
                .applyWaveletModifiers(node.props)
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
                if #available(iOS 17.0, *), let mapped = mapFontDesign(from: design) {
                    textView = textView.fontDesign(mapped)
                }
            }
            if let color = node.props.foregroundColor {
                textView = textView.foregroundColor(color)
            }
            return AnyView(textView.applyWaveletModifiers(node.props))
        case .button:
            return AnyView(
                WaveletButtonView(node: node, invokeHandler: invokeHandler)
                    .applyWaveletModifiers(node.props)
            )
        case .slider:
            return AnyView(
                WaveletSliderView(node: node, invokeHandler: invokeHandler)
                    .applyWaveletModifiers(node.props)
            )
        case .logViewer:
            return AnyView(
                WaveletLogViewerView(node: node)
                    .applyWaveletModifiers(node.props)
            )
        case .scroll:
            return AnyView(
                WaveletScrollView(node: node, renderChild: render)
                    .applyWaveletModifiers(node.props)
            )
        case .textField:
            return AnyView(
                WaveletTextFieldView(node: node, invokeHandler: invokeHandler)
                    .applyWaveletModifiers(node.props)
            )
        case .textEditor:
            return AnyView(
                WaveletTextEditorView(node: node, invokeHandler: invokeHandler)
                    .applyWaveletModifiers(node.props)
            )
        case .picker:
            return AnyView(
                WaveletPickerView(node: node, invokeHandler: invokeHandler)
                    .applyWaveletModifiers(node.props)
            )
        case .grid:
            return AnyView(
                WaveletGridView(node: node, renderChild: render)
                    .applyWaveletModifiers(node.props)
            )
        case .spacer:
            return AnyView(
                Spacer(minLength: node.props.spacerMinLength)
            )
        case .divider:
            return AnyView(
                Divider()
                    .applyWaveletModifiers(node.props)
            )
        case .progress:
            return AnyView(
                WaveletProgressView(node: node)
                    .applyWaveletModifiers(node.props)
            )
        }
    }
}

@available(iOS 17.0, *)
private func mapFontDesign(from value: String) -> Font.Design? {
    switch value.lowercased() {
    case "monospaced": return .monospaced
    case "rounded": return .rounded
    case "serif": return .serif
    default: return nil
    }
}

private struct WaveletButtonView: View {
    let node: WaveletNode
    let invokeHandler: (String, [Any]) -> Void

    var body: some View {
        let backgroundColorProvided = node.props.backgroundColor != nil
        let labelColor = node.props.foregroundColor ?? (backgroundColorProvided ? .white : nil)
        let button = Button(action: {
            if let token = node.props.handlerId(for: .tap) {
                invokeHandler(token, [])
            }
        }) {
            WaveletButtonLabel(
                node: node,
                labelColor: labelColor,
                fillsWidth: node.props.fillsWidth,
                controlSize: node.props.controlSize
            )
        }
        let styledButton = configureButtonStyle(button, backgroundColorProvided: backgroundColorProvided)
        return styledButton.applyControlSize(node.props.controlSize)
    }

    private func configureButtonStyle(_ button: Button<WaveletButtonLabel>, backgroundColorProvided: Bool) -> AnyView {
        if let style = node.props.buttonStyle {
            switch style {
            case .plain:
                return AnyView(button.buttonStyle(PlainButtonStyle()))
            case .bordered:
                if #available(iOS 15.0, *) {
                    return AnyView(button.buttonStyle(.bordered))
                } else {
                    return AnyView(button.buttonStyle(DefaultButtonStyle()))
                }
            case .borderedProminent:
                if #available(iOS 15.0, *) {
                    return AnyView(button.buttonStyle(.borderedProminent))
                } else {
                    return AnyView(button.buttonStyle(DefaultButtonStyle()))
                }
            case .automatic:
                if #available(iOS 15.0, *) {
                    return AnyView(button.buttonStyle(.automatic))
                } else {
                    return AnyView(button.buttonStyle(DefaultButtonStyle()))
                }
            }
        }

        if backgroundColorProvided {
            return AnyView(button.buttonStyle(PlainButtonStyle()))
        } else {
            if #available(iOS 15.0, *) {
                return AnyView(button.buttonStyle(.borderedProminent))
            } else {
                return AnyView(button.buttonStyle(DefaultButtonStyle()))
            }
        }
    }
}

private struct WaveletButtonLabel: View {
    let node: WaveletNode
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

        if let labelColor {
            return AnyView(baseLabel.foregroundColor(labelColor))
        }
        return AnyView(baseLabel)
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
        if #available(iOS 15.0, *) {
            return AnyView(self.controlSize(controlSize))
        }
        return AnyView(self)
    }
}

private struct WaveletSliderView: View {
    let node: WaveletNode
    let invokeHandler: (String, [Any]) -> Void
    @State private var value: Double

    init(node: WaveletNode, invokeHandler: @escaping (String, [Any]) -> Void) {
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
        .modifier(WaveletOnChange(value: node.props.sliderValue) { newValue in
            if abs(newValue - value) > .ulpOfOne {
                value = newValue
            }
        })
    }
}

private struct WaveletLogViewerView: View {
    let node: WaveletNode

    var body: some View {
        ScrollView {
            Text(node.props.text ?? "")
                .font(.system(.footnote, design: .monospaced))
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(node.props.backgroundColor ?? Color(.systemGray6))
        .clipShape(RoundedRectangle(cornerRadius: node.props.cornerRadius ?? 8))
    }
}

private struct WaveletScrollView: View {
    let node: WaveletNode
    let renderChild: (WaveletNode) -> AnyView

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

private struct WaveletTextFieldView: View {
    let node: WaveletNode
    let invokeHandler: (String, [Any]) -> Void
    @State private var value: String

    init(node: WaveletNode, invokeHandler: @escaping (String, [Any]) -> Void) {
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
        .modifier(WaveletOnChange(value: node.props.textFieldValue) { newValue in
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
        let base = TextField(node.props.placeholder, text: binding)
            .textContentType(node.props.textContentType)
            .keyboardType(node.props.keyboardType)

        let configured: AnyView
        if #available(iOS 15.0, *), let autocap = node.props.autocapitalizationMode {
            configured = AnyView(base.textInputAutocapitalization(textInputAutocap(from: autocap)))
        } else {
            configured = AnyView(base)
        }

        let styled: AnyView
#if os(iOS)
        if #available(iOS 15.0, *) {
            styled = AnyView(configured.textFieldStyle(.roundedBorder))
        } else {
            styled = AnyView(configured.textFieldStyle(RoundedBorderTextFieldStyle()))
        }
#else
        styled = configured
#endif

        return AnyView(styled.onSubmit {
            if let token = node.props.handlerId(for: .submit) {
                invokeHandler(token, [value])
            }
        })
    }

    private func secureField(for binding: Binding<String>) -> AnyView {
        let base = SecureField(node.props.placeholder, text: binding)
            .textContentType(node.props.textContentType)

        let configured: AnyView
        if #available(iOS 15.0, *), let autocap = node.props.autocapitalizationMode {
            configured = AnyView(base.textInputAutocapitalization(textInputAutocap(from: autocap)))
        } else {
            configured = AnyView(base)
        }

        let styled: AnyView
#if os(iOS)
        if #available(iOS 15.0, *) {
            styled = AnyView(configured.textFieldStyle(.roundedBorder))
        } else {
            styled = AnyView(configured.textFieldStyle(RoundedBorderTextFieldStyle()))
        }
#else
        styled = configured
#endif

        return AnyView(styled.onSubmit {
            if let token = node.props.handlerId(for: .submit) {
                invokeHandler(token, [value])
            }
        })
    }
}

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

private struct WaveletTextEditorView: View {
    let node: WaveletNode
    let invokeHandler: (String, [Any]) -> Void
    @State private var value: String

    init(node: WaveletNode, invokeHandler: @escaping (String, [Any]) -> Void) {
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
        .modifier(WaveletOnChange(value: node.props.textFieldValue) { newValue in
            if newValue != value {
                value = newValue
            }
        })
    }
}

private struct WaveletPickerView: View {
    let node: WaveletNode
    let invokeHandler: (String, [Any]) -> Void
    @State private var selection: String

    init(node: WaveletNode, invokeHandler: @escaping (String, [Any]) -> Void) {
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
        .modifier(WaveletOnChange(value: node.props.pickerSelection) { newValue in
            if newValue != selection {
                selection = newValue
            }
        })
    }

    @ViewBuilder
    private func styledPickerView(selection: Binding<String>) -> some View {
        let picker = Picker(node.props.label ?? "Picker", selection: selection) {
            ForEach(node.props.pickerOptions) { option in
                Text(option.label).tag(option.value)
            }
        }

        if node.props.pickerStyle == "segmented" {
            picker.pickerStyle(.segmented)
        } else if node.props.pickerStyle == "menu" {
            if #available(iOS 14.0, *) {
                picker.pickerStyle(.menu)
            } else {
                picker.pickerStyle(.automatic)
            }
        } else {
            picker.pickerStyle(.automatic)
        }
    }
}

private struct WaveletProgressView: View {
    let node: WaveletNode

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

private struct WaveletGridView: View {
    let node: WaveletNode
    let renderChild: (WaveletNode) -> AnyView

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
    func applyWaveletModifiers(_ props: WaveletNodeProps) -> AnyView {
        var modified = AnyView(self)
        if let padding = props.padding {
            modified = AnyView(modified.padding(padding))
        }
        if let width = props.frameWidth, let height = props.frameHeight {
            modified = AnyView(modified.frame(width: width, height: height, alignment: .leading))
        } else if let width = props.frameWidth {
            modified = AnyView(modified.frame(width: width, alignment: .leading))
        } else if let height = props.frameHeight {
            modified = AnyView(modified.frame(height: height, alignment: .leading))
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
        return modified
    }
}

private struct WaveletOnChange<T: Equatable>: ViewModifier {
    let value: T
    let action: (T) -> Void

    @ViewBuilder
    func body(content: Content) -> some View {
        if #available(iOS 17.0, *) {
            content.onChange(of: value) { _, newValue in
                action(newValue)
            }
        } else {
            content.onChange(of: value, perform: action)
        }
    }
}
