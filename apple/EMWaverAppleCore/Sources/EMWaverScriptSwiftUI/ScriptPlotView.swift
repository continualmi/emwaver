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

#if canImport(AppKit)
import AppKit
#endif

struct ScriptPlotView: View {
    let node: ScriptNode
    let invokeHandler: (String, [Any]) -> Void

    @State private var domain: PlotDomain
    @State private var isInteracting: Bool = false
    @State private var selectionStartX: Double? = nil
    @State private var selection: ClosedRange<Double>? = nil

    init(node: ScriptNode, invokeHandler: @escaping (String, [Any]) -> Void) {
        self.node = node
        self.invokeHandler = invokeHandler
        _domain = State(initialValue: PlotDomain.fromProps(node.props.raw) ?? PlotDomain(min: 0, max: 1))
    }

    var body: some View {
        let config = PlotConfig(node: node)

        return GeometryReader { geo in
            ZStack(alignment: .topLeading) {
                Canvas { context, size in
                    drawPlot(config: config, in: size, context: &context)
                }
                .contentShape(Rectangle())
                .gesture(dragGesture(config: config, size: geo.size))
                .simultaneousGesture(magnificationGesture(config: config, size: geo.size))

                if let errorText = config.errorText, !errorText.isEmpty {
                    ZStack {
                        Color.black.opacity(0.55)
                        Text("Chart error: \(errorText)")
                            .font(.footnote)
                            .foregroundColor(.white)
                    }
                    .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                    .padding(10)
                } else if let overlay = config.overlayText, !overlay.isEmpty {
                    Text(overlay)
                        .font(.caption2)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 6)
                        .background(Color.black.opacity(0.35))
                        .foregroundColor(.white)
                        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                        .padding(10)
                        .allowsHitTesting(false)
                }
            }
        }
        .frame(height: config.height)
        .background(Color.gray.opacity(0.06))
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .stroke(Color.gray.opacity(0.18), lineWidth: 1)
        )
        .onChange(of: PlotDomain.fromProps(node.props.raw)) { next in
            guard let next else { return }
            if !isInteracting {
                domain = next
            }
        }
    }

    private func drawPlot(config: PlotConfig, in size: CGSize, context: inout GraphicsContext) {
        let points = config.points
        if points.isEmpty || size.width <= 2 || size.height <= 2 {
            return
        }

        let domainRange = max(.leastNonzeroMagnitude, domain.max - domain.min)
        let yRange = max(.leastNonzeroMagnitude, config.yMax - config.yMin)

        let maxSegments = max(64, Int(size.width) * 2)
        let step = points.count > maxSegments ? max(1, points.count / maxSegments) : 1

        var path = Path()
        var didMove = false
        for idx in stride(from: 0, to: points.count, by: step) {
            let p = points[idx]
            let xT = (p.x - domain.min) / domainRange
            if xT < 0 || xT > 1 {
                continue
            }
            let yT = (p.y - config.yMin) / yRange
            let x = CGFloat(xT) * size.width
            let y = (1 - CGFloat(yT)) * size.height

            if !didMove {
                path.move(to: CGPoint(x: x, y: y))
                didMove = true
            } else {
                path.addLine(to: CGPoint(x: x, y: y))
            }
        }

        if didMove {
            context.stroke(path, with: .color(Color(red: 0.0, green: 0.34, blue: 0.6)), lineWidth: 2)
        }

        if let selection, selection.upperBound > selection.lowerBound {
            let x0 = CGFloat((selection.lowerBound - domain.min) / domainRange) * size.width
            let x1 = CGFloat((selection.upperBound - domain.min) / domainRange) * size.width
            let rect = CGRect(x: min(x0, x1), y: 0, width: abs(x1 - x0), height: size.height)
            context.fill(Path(rect), with: .color(Color.blue.opacity(0.18)))
            context.stroke(Path(rect), with: .color(Color.blue.opacity(0.35)), lineWidth: 1)
        }
    }

    private func dragGesture(config: PlotConfig, size: CGSize) -> some Gesture {
        DragGesture(minimumDistance: 0)
            .onChanged { value in
                guard size.width > 2 else { return }

                isInteracting = true

                if isSelectionMode {
                    if selectionStartX == nil {
                        selectionStartX = xValue(from: value.startLocation.x, size: size)
                    }
                    let start = selectionStartX ?? xValue(from: value.startLocation.x, size: size)
                    let end = xValue(from: value.location.x, size: size)
                    selection = min(start, end)...max(start, end)
                    return
                }

                // Pan horizontally.
                let dx = value.translation.width
                let domainRange = max(.leastNonzeroMagnitude, domain.max - domain.min)
                let deltaX = Double(-dx / size.width) * domainRange
                domain = PlotDomain(min: domain.min + deltaX, max: domain.max + deltaX)
            }
            .onEnded { value in
                defer {
                    isInteracting = false
                    selectionStartX = nil
                    selection = nil
                }

                if isSelectionMode {
                    guard let token = node.props.handlerId(for: .select) else { return }
                    let start = selectionStartX ?? xValue(from: value.startLocation.x, size: size)
                    let end = xValue(from: value.location.x, size: size)
                    let minX = min(start, end)
                    let maxX = max(start, end)
                    if maxX > minX {
                        invokeHandler(token, [["min": minX, "max": maxX]])
                    }
                    return
                }

                if let token = node.props.handlerId(for: .viewport) {
                    invokeHandler(token, [["min": domain.min, "max": domain.max]])
                }
            }
    }

    private func magnificationGesture(config: PlotConfig, size: CGSize) -> some Gesture {
        MagnificationGesture()
            .onChanged { scale in
                guard scale.isFinite else { return }
                isInteracting = true
                let domainRange = max(.leastNonzeroMagnitude, domain.max - domain.min)
                let center = (domain.min + domain.max) * 0.5
                let nextRange = max(domainRange / Double(scale), 1)
                domain = PlotDomain(min: center - nextRange * 0.5, max: center + nextRange * 0.5)
            }
            .onEnded { _ in
                isInteracting = false
                if let token = node.props.handlerId(for: .viewport) {
                    invokeHandler(token, [["min": domain.min, "max": domain.max]])
                }
            }
    }

    private var isSelectionMode: Bool {
#if canImport(AppKit)
        return NSEvent.modifierFlags.contains(.shift)
#else
        return false
#endif
    }

    private func xValue(from xPx: CGFloat, size: CGSize) -> Double {
        let domainRange = max(.leastNonzeroMagnitude, domain.max - domain.min)
        let t = min(1, max(0, xPx / max(1, size.width)))
        return domain.min + Double(t) * domainRange
    }
}

private struct PlotPoint {
    let x: Double
    let y: Double
}

private struct PlotDomain: Equatable {
    let min: Double
    let max: Double

    static func fromProps(_ raw: [String: Any]) -> PlotDomain? {
        guard let min = extractDouble(raw["xMin"]),
              let max = extractDouble(raw["xMax"]) else {
            return nil
        }
        if !min.isFinite || !max.isFinite || max <= min {
            return nil
        }
        return PlotDomain(min: min, max: max)
    }

    private static func extractDouble(_ value: Any?) -> Double? {
        if let n = value as? NSNumber { return n.doubleValue }
        if let d = value as? Double { return d }
        if let i = value as? Int { return Double(i) }
        if let s = value as? String { return Double(s) }
        return nil
    }
}

private struct PlotConfig {
    let height: CGFloat
    let yMin: Double
    let yMax: Double
    let overlayText: String?
    let errorText: String?
    let points: [PlotPoint]

    init(node: ScriptNode) {
        let raw = node.props.raw

        height = CGFloat((raw["height"] as? NSNumber)?.doubleValue ?? 400)
        yMin = (raw["yMin"] as? NSNumber)?.doubleValue ?? -128
        yMax = (raw["yMax"] as? NSNumber)?.doubleValue ?? 384
        overlayText = raw["overlayText"] as? String
        errorText = raw["errorText"] as? String

        let xs = PlotConfig.extractDoubleArray(raw["dataX"])
        let ys = PlotConfig.extractDoubleArray(raw["dataY"])
        let count = min(xs.count, ys.count)
        if count <= 0 {
            points = []
        } else {
            var out: [PlotPoint] = []
            out.reserveCapacity(count)
            for i in 0..<count {
                out.append(PlotPoint(x: xs[i], y: ys[i]))
            }
            points = out
        }
    }

    private static func extractDoubleArray(_ value: Any?) -> [Double] {
        if let arr = value as? [Double] { return arr }
        if let arr = value as? [NSNumber] { return arr.map { $0.doubleValue } }
        if let arr = value as? [Any] {
            return arr.compactMap { element in
                if let n = element as? NSNumber { return n.doubleValue }
                if let d = element as? Double { return d }
                if let i = element as? Int { return Double(i) }
                if let s = element as? String { return Double(s) }
                return nil
            }
        }
        return []
    }
}

