/*
 * EMWaver
 * Copyright (c) 2026 Luis Marnoto
 * All rights reserved.
 */

import SwiftUI
import EMWaverScriptModel

#if canImport(Charts)
import Charts
#endif

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
#if canImport(Charts)
    @State private var plotAreaFrame: CGRect = .zero
#endif
#if canImport(AppKit)
    @State private var isHovering: Bool = false
    @State private var hoverX: CGFloat = 0
    @State private var scrollWheelMonitor: Any? = nil
    @State private var scrollViewportWorkItem: DispatchWorkItem? = nil
#endif

    init(node: ScriptNode, invokeHandler: @escaping (String, [Any]) -> Void) {
        self.node = node
        self.invokeHandler = invokeHandler
        _domain = State(initialValue: PlotDomain.fromProps(node.props.raw) ?? PlotDomain(min: 0, max: 1))
    }

    var body: some View {
        let config = PlotConfig(node: node)

        return GeometryReader { geo in
            ZStack(alignment: .topLeading) {
#if canImport(Charts)
                chartPlot(config: config, size: geo.size)
#else
                Canvas { context, size in
                    drawPlot(config: config, in: size, context: &context)
                }
                .contentShape(Rectangle())
                .gesture(dragGesture(config: config, size: geo.size))
                .simultaneousGesture(magnificationGesture(config: config, size: geo.size))
#endif

                if let errorText = config.errorText, !errorText.isEmpty {
                    Text("Chart error: \(errorText)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .padding(10)
                        .allowsHitTesting(false)
                } else if let overlay = config.overlayText, !overlay.isEmpty {
                    Text(overlay)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .padding(10)
                        .allowsHitTesting(false)
                }
            }
#if canImport(AppKit)
            .onContinuousHover { phase in
                switch phase {
                case .active(let location):
                    #if canImport(Charts)
                    if plotAreaFrame != .zero {
                        isHovering = plotAreaFrame.contains(location)
                        hoverX = location.x - plotAreaFrame.minX
                    } else {
                        isHovering = true
                        hoverX = location.x
                    }
                    #else
                    isHovering = true
                    hoverX = location.x
                    #endif
                case .ended:
                    isHovering = false
                }
            }
            .onAppear {
                installScrollWheelMonitor(size: geo.size)
            }
            .onChange(of: geo.size) { next in
                installScrollWheelMonitor(size: next)
            }
            .onDisappear {
                removeScrollWheelMonitor()
            }
#endif
        }
        .frame(height: config.height)
        .onChange(of: PlotDomain.fromProps(node.props.raw)) { next in
            guard let next else { return }
            if !isInteracting {
                domain = next
            }
        }
    }

#if canImport(Charts)
    private func chartPlot(config: PlotConfig, size: CGSize) -> some View {
        let points = config.points
        let displayPoints = decimate(points: points, width: size.width)

        return Chart(displayPoints) { p in
            LineMark(
                x: .value("x", p.x),
                y: .value("y", p.y)
            )
            .foregroundStyle(.primary)
            .lineStyle(StrokeStyle(lineWidth: 1.5, lineCap: .round, lineJoin: .round))
        }
        .chartXScale(domain: domain.min...domain.max)
        .chartYScale(domain: config.yMin...config.yMax)
        .chartXAxis(.hidden)
        .chartYAxis(.hidden)
        .chartLegend(.hidden)
        .chartPlotStyle { plotArea in
            plotArea
                .background(.clear)
        }
        .chartOverlay { proxy in
            GeometryReader { geo in
                let plotFrame = geo[proxy.plotAreaFrame]
                Color.clear
                    .contentShape(Rectangle())
                    .onAppear {
                        plotAreaFrame = plotFrame
                    }
                    .onChange(of: plotFrame) { next in
                        plotAreaFrame = next
                    }
                    .gesture(dragGestureUsingPlotArea(config: config, size: geo.size, plotFrame: plotFrame))
                    .simultaneousGesture(magnificationGesture(config: config, size: plotFrame.size))
                    .overlay {
                        selectionOverlay(plotFrame: plotFrame)
                    }
            }
        }
    }

    private func decimate(points: [PlotPoint], width: CGFloat) -> [PlotPoint] {
        if points.isEmpty { return [] }
        let maxSegments = max(64, Int(max(1, width)) * 2)
        let step = points.count > maxSegments ? max(1, points.count / maxSegments) : 1
        if step <= 1 { return points }
        var out: [PlotPoint] = []
        out.reserveCapacity((points.count / step) + 1)
        for idx in stride(from: 0, to: points.count, by: step) {
            out.append(points[idx])
        }
        return out
    }

    private func selectionOverlay(plotFrame: CGRect) -> some View {
        Group {
            if let selection, selection.upperBound > selection.lowerBound {
                let domainRange = max(.leastNonzeroMagnitude, domain.max - domain.min)
                let x0 = CGFloat((selection.lowerBound - domain.min) / domainRange) * plotFrame.width + plotFrame.minX
                let x1 = CGFloat((selection.upperBound - domain.min) / domainRange) * plotFrame.width + plotFrame.minX
                let rect = CGRect(x: min(x0, x1), y: plotFrame.minY, width: abs(x1 - x0), height: plotFrame.height)

                Rectangle()
                    .fill(Color.accentColor.opacity(0.15))
                    .frame(width: rect.width, height: rect.height)
                    .position(x: rect.midX, y: rect.midY)
                    .overlay(
                        Rectangle()
                            .stroke(Color.accentColor.opacity(0.35), lineWidth: 1)
                    )
                    .allowsHitTesting(false)
            } else {
                EmptyView()
            }
        }
    }

    private func dragGestureUsingPlotArea(config: PlotConfig, size: CGSize, plotFrame: CGRect) -> some Gesture {
        DragGesture(minimumDistance: 0)
            .onChanged { value in
                guard plotFrame.width > 2 else { return }
                guard plotFrame.contains(value.location) || plotFrame.contains(value.startLocation) else { return }
                isInteracting = true

                if isSelectionMode {
                    if selectionStartX == nil {
                        selectionStartX = xValue(from: value.startLocation.x - plotFrame.minX, plotWidth: plotFrame.width)
                    }
                    let start = selectionStartX ?? xValue(from: value.startLocation.x - plotFrame.minX, plotWidth: plotFrame.width)
                    let end = xValue(from: value.location.x - plotFrame.minX, plotWidth: plotFrame.width)
                    selection = min(start, end)...max(start, end)
                    return
                }

                // Pan horizontally.
                let dx = value.translation.width
                let domainRange = max(.leastNonzeroMagnitude, domain.max - domain.min)
                let deltaX = Double(-dx / plotFrame.width) * domainRange
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
                    let start = selectionStartX ?? xValue(from: value.startLocation.x - plotFrame.minX, plotWidth: plotFrame.width)
                    let end = xValue(from: value.location.x - plotFrame.minX, plotWidth: plotFrame.width)
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

    private func xValue(from xPx: CGFloat, plotWidth: CGFloat) -> Double {
        let domainRange = max(.leastNonzeroMagnitude, domain.max - domain.min)
        let t = min(1, max(0, xPx / max(1, plotWidth)))
        return domain.min + Double(t) * domainRange
    }
#endif

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
            context.stroke(path, with: .color(.primary), lineWidth: 1.5)
        }

        if let selection, selection.upperBound > selection.lowerBound {
            let x0 = CGFloat((selection.lowerBound - domain.min) / domainRange) * size.width
            let x1 = CGFloat((selection.upperBound - domain.min) / domainRange) * size.width
            let rect = CGRect(x: min(x0, x1), y: 0, width: abs(x1 - x0), height: size.height)
            context.fill(Path(rect), with: .color(Color.accentColor.opacity(0.15)))
            context.stroke(Path(rect), with: .color(Color.accentColor.opacity(0.35)), lineWidth: 1)
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

#if canImport(AppKit)
    private func installScrollWheelMonitor(size: CGSize) {
        if scrollWheelMonitor != nil {
            return
        }
        scrollWheelMonitor = NSEvent.addLocalMonitorForEvents(matching: [.scrollWheel]) { event in
            if isHovering {
                handleScrollWheel(event, size: size)
                return nil
            }
            return event
        }
    }

    private func removeScrollWheelMonitor() {
        if let scrollWheelMonitor {
            NSEvent.removeMonitor(scrollWheelMonitor)
        }
        scrollWheelMonitor = nil
        scrollViewportWorkItem?.cancel()
        scrollViewportWorkItem = nil
    }

    private func handleScrollWheel(_ event: NSEvent, size: CGSize) {
        let effectiveWidth: CGFloat
        #if canImport(Charts)
        effectiveWidth = plotAreaFrame != .zero ? plotAreaFrame.width : size.width
        #else
        effectiveWidth = size.width
        #endif

        guard effectiveWidth > 2 else { return }

        let dy = Double(event.scrollingDeltaY)
        if dy == 0 || !dy.isFinite {
            return
        }

        isInteracting = true

        let domainRange = max(.leastNonzeroMagnitude, domain.max - domain.min)
        let z = exp(dy * 0.002)
        let nextRange = max(domainRange * z, 1)

        let t = Double(min(1, max(0, hoverX / max(1, effectiveWidth))))
        let anchor = domain.min + t * domainRange

        let nextMin = anchor - t * nextRange
        let nextMax = nextMin + nextRange
        if nextMax > nextMin, nextMin.isFinite, nextMax.isFinite {
            domain = PlotDomain(min: nextMin, max: nextMax)
        }

        emitViewportSoon()
    }

    private func emitViewportSoon() {
        scrollViewportWorkItem?.cancel()

        let minX = domain.min
        let maxX = domain.max
        let token = node.props.handlerId(for: .viewport)

        let work = DispatchWorkItem {
            isInteracting = false
            guard let token else { return }
            invokeHandler(token, [["min": minX, "max": maxX]])
        }
        scrollViewportWorkItem = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.12, execute: work)
    }
#endif
}

private struct PlotPoint: Identifiable {
    let id: Int
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
                out.append(PlotPoint(id: i, x: xs[i], y: ys[i]))
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
