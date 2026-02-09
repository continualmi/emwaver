import SwiftUI
import EMWaverScriptModel

// Local copy of ScriptRenderView's modifier application.
// RemoteHostControlView builds its own tree renderer, so we need this helper here.
// Keep it intentionally small; expand only as needed.

extension View {
    func applyScriptModifiers(_ props: ScriptNodeProps) -> AnyView {
        var v: AnyView = AnyView(self)

        if let padding = props.padding {
            v = AnyView(v.padding(padding))
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
            if minWidth == nil { minWidth = 0 }
        }

        if minWidth != nil || idealWidth != nil || maxWidth != nil || minHeight != nil || idealHeight != nil || maxHeight != nil || props.fillsWidth {
            let alignment = Alignment(horizontal: props.alignment ?? .leading, vertical: .center)
            v = AnyView(
                v.frame(
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

        return v
    }
}
