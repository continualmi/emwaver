/*
 * EMWaver
 * Copyright (c) 2026 Luis Marnoto
 * All rights reserved.
 */

import SwiftUI
import EMWaverScriptModel
import EMWaverScriptRuntime

import Charts

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
    @State private var internalPoints: [PlotPoint] = []
    @State private var internalBounds: PlotDomain? = nil
    @State private var recomputeWorkItem: DispatchWorkItem? = nil
    @State private var pendingRecompute: Bool = false
    @State private var lastInteractiveRecomputeAt: TimeInterval = 0
    @State private var plotAreaFrame: CGRect = .zero
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
        let boundsForInteractions = config.xBounds ?? internalBounds
        let points = config.sourceId != nil ? internalPoints : config.points

        return GeometryReader { geo in
            ZStack(alignment: .topLeading) {
                chartPlot(config: config, size: geo.size, points: points, bounds: boundsForInteractions)

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
                    if plotAreaFrame != .zero {
                        isHovering = plotAreaFrame.contains(location)
                        hoverX = location.x - plotAreaFrame.minX
                    } else {
                        isHovering = true
                        hoverX = location.x
                    }
                case .ended:
                    isHovering = false
                }
            }
            .onAppear {
                installScrollWheelMonitor(size: geo.size)
                scheduleInternalRecompute(config: config, immediate: true)
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
        .onChange(of: config.sourceKey) { _ in
            scheduleInternalRecompute(config: config, immediate: true)
        }
        .onChange(of: config.bins) { _ in
            scheduleInternalRecompute(config: config, immediate: true)
        }
        .onChange(of: domain) { _ in
            scheduleInternalRecompute(config: config, immediate: false)
        }
        .onChange(of: PlotDomain.fromProps(node.props.raw)) { next in
            guard let next else { return }
            if !isInteracting {
                domain = next
            }
        }
    }

    private func chartPlot(config: PlotConfig, size: CGSize, points: [PlotPoint], bounds: PlotDomain?) -> some View {
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
                    .gesture(dragGestureUsingPlotArea(config: config, bounds: bounds, size: geo.size, plotFrame: plotFrame))
                    .simultaneousGesture(magnificationGesture(config: config, bounds: bounds, size: plotFrame.size))
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

    private func dragGestureUsingPlotArea(config: PlotConfig, bounds: PlotDomain?, size: CGSize, plotFrame: CGRect) -> some Gesture {
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
                let next = PlotDomain(min: domain.min + deltaX, max: domain.max + deltaX)
                domain = clampDomain(next, bounds: bounds)
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

    private func magnificationGesture(config: PlotConfig, bounds: PlotDomain?, size: CGSize) -> some Gesture {
        MagnificationGesture()
            .onChanged { scale in
                guard scale.isFinite else { return }
                isInteracting = true
                let domainRange = max(.leastNonzeroMagnitude, domain.max - domain.min)
                let center = (domain.min + domain.max) * 0.5
                let nextRange = max(domainRange / Double(scale), 1)
                let next = PlotDomain(min: center - nextRange * 0.5, max: center + nextRange * 0.5)
                domain = clampDomain(next, bounds: bounds)
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

    // Canvas-only helper removed (Charts is the only plot backend).

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
        let effectiveWidth: CGFloat = plotAreaFrame != .zero ? plotAreaFrame.width : size.width

        guard effectiveWidth > 2 else { return }

        let dy = Double(event.scrollingDeltaY)
        if dy == 0 || !dy.isFinite {
            return
        }

        isInteracting = true

        let domainRange = max(.leastNonzeroMagnitude, domain.max - domain.min)
        // Invert zoom direction: scrolling up should zoom out.
        let z = exp(-dy * 0.002)
        let nextRange = max(domainRange * z, 1)

        let t = Double(min(1, max(0, hoverX / max(1, effectiveWidth))))
        let anchor = domain.min + t * domainRange

        let nextMin = anchor - t * nextRange
        let nextMax = nextMin + nextRange
        if nextMax > nextMin, nextMin.isFinite, nextMax.isFinite {
            let next = PlotDomain(min: nextMin, max: nextMax)
            let bounds = PlotDomain.boundsFromProps(node.props.raw) ?? internalBounds
            domain = clampDomain(next, bounds: bounds)
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

    private func scheduleInternalRecompute(config: PlotConfig, immediate: Bool) {
        guard let sourceId = config.sourceId, !sourceId.isEmpty else {
            internalPoints = []
            internalBounds = nil
            return
        }

        // During continuous zoom/pan, domain changes can arrive faster than recompute.
        // If we cancel-and-reschedule every time, the recompute may never run until the gesture ends.
        // Strategy:
        // - While interacting: throttle recompute rate and temporarily reduce bins so refreshes land mid-gesture.
        // - Coalesce additional changes via a pending flag.
        if isInteracting {
            let now = Date().timeIntervalSinceReferenceDate
            // ~30 fps max recompute scheduling.
            if now - lastInteractiveRecomputeAt < 0.033 {
                pendingRecompute = true
                return
            }
            lastInteractiveRecomputeAt = now

            if recomputeWorkItem != nil {
                pendingRecompute = true
                return
            }
        }

        recomputeWorkItem?.cancel()
        let bins = isInteracting ? min(config.bins, 100) : config.bins
        let work = DispatchWorkItem { [sourceId, bins] in
            recomputeInternalPoints(sourceId: sourceId, bins: bins)
            DispatchQueue.main.async {
                recomputeWorkItem = nil
                if pendingRecompute {
                    pendingRecompute = false
                    scheduleInternalRecompute(config: config, immediate: false)
                }
            }
        }
        recomputeWorkItem = work

        let delay: Double
        if immediate {
            delay = 0
        } else if isInteracting {
            delay = 0.0
        } else {
            delay = 0.02
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: work)
    }

    private func recomputeInternalPoints(sourceId: String, bins: Int) {
        let bytes = PlotBufferStore.shared.getBytes(id: sourceId)
        let totalBits = max(0, bytes.count * 8)
        if totalBits <= 0 {
            internalBounds = nil
            internalPoints = []
            return
        }

        if PlotDomain.boundsFromProps(node.props.raw) == nil {
            internalBounds = PlotDomain(min: 0, max: Double(totalBits))
        }

        let startBit = max(0, min(totalBits, Int(floor(domain.min))))
        let endBit = max(startBit, min(totalBits, Int(ceil(domain.max))))
        let span = max(0, endBit - startBit)
        if span <= 0 {
            internalPoints = []
            return
        }

        let clampedBins = max(1, min(max(1, bins), max(1, span)))

        DispatchQueue.global(qos: .userInitiated).async {
            let (xs, ys) = Self.compressBits(bytes: bytes, startBit: startBit, endBit: endBit, bins: clampedBins)
            let count = min(xs.count, ys.count)
            var out: [PlotPoint] = []
            out.reserveCapacity(count)
            for i in 0..<count {
                out.append(PlotPoint(id: i, x: xs[i], y: ys[i]))
            }
            DispatchQueue.main.async {
                internalPoints = out
            }
        }
    }

    private static func compressBits(bytes: Data, startBit: Int, endBit: Int, bins: Int) -> ([Double], [Double]) {
#if canImport(Darwin)
        let rs = Int32(min(startBit, Int(Int32.max)))
        let re = Int32(min(endBit, Int(Int32.max)))
        let nb = Int32(min(bins, Int(Int32.max)))
        if let (timeValues, dataValues) = RustBufferCore.compressViewport(
            bufferBytes: bytes,
            rangeStart: rs,
            rangeEnd: re,
            numberBins: nb
        ) {
            return (timeValues, dataValues)
        }
#endif

        // Fallback: match `emwaver-buffer-core` `compress_bits` behavior.
        let span = max(0, endBit - startBit)
        if span <= 0 {
            return ([], [])
        }

        func bitAt(_ idx: Int) -> Int {
            let byteIndex = idx >> 3
            let bitIndex = idx & 7
            guard byteIndex >= 0, byteIndex < bytes.count else { return 0 }
            let byte = bytes[bytes.index(bytes.startIndex, offsetBy: byteIndex)]
            return ((byte >> bitIndex) & 1) == 1 ? 1 : 0
        }

        var timeValues: [Double] = []
        var dataValues: [Double] = []

        if span <= bins * 2 {
            timeValues.reserveCapacity(span)
            dataValues.reserveCapacity(span)
            for i in startBit..<endBit {
                timeValues.append(Double(i))
                dataValues.append(bitAt(i) == 1 ? 255.0 : 0.0)
            }
            return (timeValues, dataValues)
        }

        let binWidth = Double(span) / Double(bins)
        timeValues.reserveCapacity(bins * 2)
        dataValues.reserveCapacity(bins * 2)

        for bin in 0..<bins {
            let binStart = Int(floor(Double(startBit) + Double(bin) * binWidth))
            var binEnd = Int(floor(Double(binStart) + binWidth))
            if binEnd > endBit { binEnd = endBit }
            if binEnd <= binStart { continue }

            var hasLow = false
            var hasHigh = false

            var i = binStart
            while i < binEnd {
                let byteIndex = i >> 3
                if byteIndex >= bytes.count { break }

                if (i & 7) == 0, i + 8 <= binEnd {
                    let byte = bytes[bytes.index(bytes.startIndex, offsetBy: byteIndex)]
                    if byte == 0 {
                        hasLow = true
                    } else if byte == 255 {
                        hasHigh = true
                    } else {
                        hasLow = true
                        hasHigh = true
                    }
                    i += 8
                } else {
                    if bitAt(i) == 1 {
                        hasHigh = true
                    } else {
                        hasLow = true
                    }
                    i += 1
                }

                if hasLow, hasHigh { break }
            }

            if hasLow || hasHigh {
                timeValues.append(Double(binStart))
                dataValues.append(hasLow ? 0.0 : 255.0)
                timeValues.append(Double(max(binStart, binEnd - 1)))
                dataValues.append(hasHigh ? 255.0 : 0.0)
            }
        }
        return (timeValues, dataValues)
    }

    private func clampDomain(_ proposed: PlotDomain, bounds: PlotDomain?) -> PlotDomain {
        guard proposed.min.isFinite, proposed.max.isFinite, proposed.max > proposed.min else {
            return domain
        }
        guard let bounds, bounds.min.isFinite, bounds.max.isFinite, bounds.max > bounds.min else {
            return proposed
        }

        let boundsRange = bounds.max - bounds.min
        let range = proposed.max - proposed.min
        if range >= boundsRange {
            return bounds
        }

        var minV = proposed.min
        var maxV = proposed.max
        if minV < bounds.min {
            let delta = bounds.min - minV
            minV += delta
            maxV += delta
        }
        if maxV > bounds.max {
            let delta = maxV - bounds.max
            minV -= delta
            maxV -= delta
        }

        if minV < bounds.min {
            minV = bounds.min
        }
        if maxV > bounds.max {
            maxV = bounds.max
        }
        if maxV <= minV {
            return bounds
        }
        return PlotDomain(min: minV, max: maxV)
    }
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

    static func boundsFromProps(_ raw: [String: Any]) -> PlotDomain? {
        let min = extractDouble(raw["xBoundsMin"]) ?? extractDouble(raw["xDomainMin"])
        let max = extractDouble(raw["xBoundsMax"]) ?? extractDouble(raw["xDomainMax"])
        guard let min, let max else { return nil }
        if !min.isFinite || !max.isFinite || max <= min {
            return nil
        }
        return PlotDomain(min: min, max: max)
    }

    fileprivate static func extractDouble(_ value: Any?) -> Double? {
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
    let xBounds: PlotDomain?
    let bins: Int
    let sourceId: String?
    let sourceKey: String
    let overlayText: String?
    let errorText: String?
    let points: [PlotPoint]

    init(node: ScriptNode) {
        let raw = node.props.raw

        height = CGFloat((raw["height"] as? NSNumber)?.doubleValue ?? 400)
        yMin = (raw["yMin"] as? NSNumber)?.doubleValue ?? -128
        yMax = (raw["yMax"] as? NSNumber)?.doubleValue ?? 384
        xBounds = PlotDomain.boundsFromProps(raw)
        bins = {
            if let n = raw["bins"] as? NSNumber {
                return max(1, min(12000, n.intValue))
            }
            if let i = raw["bins"] as? Int {
                return max(1, min(12000, i))
            }
            if let s = raw["bins"] as? String, let i = Int(s.trimmingCharacters(in: .whitespacesAndNewlines)) {
                return max(1, min(12000, i))
            }
            return 900
        }()
        sourceId = PlotConfig.extractSourceId(raw["source"])
        sourceKey = (sourceId ?? "") + ":" + String(bins)
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

    private static func extractSourceId(_ value: Any?) -> String? {
        if let s = value as? String {
            let trimmed = s.trimmingCharacters(in: .whitespacesAndNewlines)
            return trimmed.isEmpty ? nil : trimmed
        }
        if let dict = value as? [String: Any] {
            if let kind = dict["kind"] as? String {
                if kind == "samplerBits" {
                    return "samplerBits"
                }
                if kind == "buffer" {
                    if let id = dict["id"] as? String {
                        let trimmed = id.trimmingCharacters(in: .whitespacesAndNewlines)
                        return trimmed.isEmpty ? nil : trimmed
                    }
                }
            }
            if let id = dict["id"] as? String {
                let trimmed = id.trimmingCharacters(in: .whitespacesAndNewlines)
                return trimmed.isEmpty ? nil : trimmed
            }
        }
        return nil
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
