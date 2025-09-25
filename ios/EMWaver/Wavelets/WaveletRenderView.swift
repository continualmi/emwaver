import SwiftUI

struct WaveletRenderView: View {
    let tree: WaveletTree?
    let invokeHandler: (String) -> Void

    init(tree: WaveletTree?, invokeHandler: @escaping (String) -> Void) {
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
            return AnyView(
                Text(node.props.text ?? "")
                    .applyWaveletModifiers(node.props)
            )
        case .button:
            return AnyView(
                Button(action: {
                    if let token = node.props.handlerId(for: .tap) {
                        invokeHandler(token)
                    }
                }) {
                    Text(node.props.label ?? "Button")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .applyWaveletModifiers(node.props)
            )
        case .slider:
            return AnyView(
                WaveletSliderView(node: node)
                    .applyWaveletModifiers(node.props)
            )
        case .logViewer:
            return AnyView(
                WaveletLogViewerView(node: node)
                    .applyWaveletModifiers(node.props)
            )
        }
    }
}

private struct WaveletSliderView: View {
    let node: WaveletNode
    @State private var value: Double = 0

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let label = node.props.label {
                Text(label)
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
            Slider(value: $value, in: 0...1)
        }
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
        .background(Color(.systemGray6))
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }
}

private extension View {
    func applyWaveletModifiers(_ props: WaveletNodeProps) -> AnyView {
        var modified = AnyView(self)
        if let padding = props.padding {
            modified = AnyView(modified.padding(padding))
        }
        if let width = props.frameWidth {
            modified = AnyView(modified.frame(width: width, alignment: .leading))
        }
        return modified
    }
}
