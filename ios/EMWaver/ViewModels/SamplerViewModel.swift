import SwiftUI
import Combine
import DGCharts

class SamplerViewModel: ObservableObject {
    // Visible range values
    @Published var visibleRangeStart: Double = 0.0
    @Published var visibleRangeEnd: Double = 10000.0
    
    // Chart state tracking
    @Published var chartEntries: [ChartDataEntry] = []
    @Published var currentZoomLevel: CGFloat = 1.0
    @Published var prevRangeStart: Double = 0.0
    @Published var prevRangeEnd: Double = 10000.0
    
    // Chart compression parameters
    let numberBins = 500 // Match Android refreshChartFromBuffer logic
    
    // Reference to BLE manager for buffer access
    var bleManager: BLEManager
    
    // Compression debounce publisher
    let needsCompressionUpdate = PassthroughSubject<Void, Never>()
    
    init(bleManager: BLEManager) {
        self.bleManager = bleManager
        
        // Set up debounced compression updates
        setupCompressionUpdates()
    }
    
    private func setupCompressionUpdates() {
        // This could be expanded if needed
    }
    
    // Match Android's getVisibleRangeStart
    func getVisibleRangeStart() -> Double {
        return visibleRangeStart
    }
    
    // Match Android's getVisibleRangeEnd
    func getVisibleRangeEnd() -> Double {
        return visibleRangeEnd
    }
    
    // Match Android's setVisibleRangeStart
    func setVisibleRangeStart(_ range: Double) {
        visibleRangeStart = range
    }
    
    // Match Android's setVisibleRangeEnd
    func setVisibleRangeEnd(_ range: Double) {
        visibleRangeEnd = range
    }
    
    // Handle chart range changes similar to Android implementation
    func handleVisibleRangeChange(low: Double, high: Double, chartView: LineChartView?, isGestureEnded: Bool = false) {
        guard let chartView = chartView else {
            print("Chart view ref not available yet for gesture handling")
            return
        }
        
        let newZoomLevel = chartView.scaleX
        let visibleRangeStart = low
        let visibleRangeEnd = high
        
        // If this is a gesture end notification, just update our state to match current view
        // without triggering further updates that could cause continuous zooming
        if isGestureEnded {
            self.visibleRangeStart = max(0, visibleRangeStart)
            self.visibleRangeEnd = visibleRangeEnd
            self.prevRangeStart = self.visibleRangeStart
            self.prevRangeEnd = self.visibleRangeEnd
            self.currentZoomLevel = newZoomLevel
            return
        }
        
        var needsUpdate = false
        
        // --- Scale Check (Mirroring Android onChartScale) ---
        if abs(newZoomLevel - currentZoomLevel) >= max(0.01, (currentZoomLevel / 10.0)) {
            print("Significant Zoom Detected: Old=\(currentZoomLevel), New=\(newZoomLevel)")
            currentZoomLevel = newZoomLevel
            // Update state immediately to reflect the gesture's effect
            self.visibleRangeStart = max(0, visibleRangeStart)
            self.visibleRangeEnd = visibleRangeEnd
            // Update prev range as well, as zoom changes the boundaries
            self.prevRangeStart = self.visibleRangeStart
            self.prevRangeEnd = self.visibleRangeEnd
            needsUpdate = true
        }
        
        // --- Translate Check (Mirroring Android onChartTranslate) ---
        let span = visibleRangeEnd - visibleRangeStart
        // Avoid threshold checks if span is too small or invalid
        if span > 10 { // Added guard similar to Android comment
            // Use a small epsilon or minimum threshold
            let translationThreshold = max(1.0, span / 100.0) // 1% threshold or min 1.0
            
            // Check absolute difference from previously recorded range start/end
            if abs(visibleRangeStart - prevRangeStart) > translationThreshold || 
               abs(visibleRangeEnd - prevRangeEnd) > translationThreshold {
                print("Significant Pan Detected: Old=[\(prevRangeStart)-\(prevRangeEnd)], New=[\(visibleRangeStart)-\(visibleRangeEnd)]")
                // Update state immediately
                self.visibleRangeStart = max(0, visibleRangeStart)
                self.visibleRangeEnd = visibleRangeEnd
                // Update prev range to the new position
                self.prevRangeStart = self.visibleRangeStart
                self.prevRangeEnd = self.visibleRangeEnd
                needsUpdate = true
            }
        }
        
        // If significant change detected by either zoom or pan
        if needsUpdate {
            // Send event to trigger debounced compression
            needsCompressionUpdate.send()
        }
    }
    
    // Update chart with compressed data (similar to Android's updateChartWithCompression)
    func updateChartWithCompression(rangeStart: Double, rangeEnd: Double) {
        let bufferData = bleManager.getBuffer()
        let totalBits = bufferData.count * 8
        
        // Check if buffer is larger than current visible range end
        if Double(totalBits) > visibleRangeEnd && visibleRangeEnd >= rangeEnd {
            // Only auto-expand if user is viewing the right edge (end of data)
            let viewingRightEdge = (rangeEnd >= visibleRangeEnd * 0.95) // Within 5% of current end
            
            if viewingRightEdge {
                // Auto-expand the visible range to show all data
                print("Auto-expanding visible range from \(visibleRangeEnd) to \(totalBits)")
                visibleRangeEnd = Double(totalBits)
                prevRangeEnd = visibleRangeEnd
                
                // Also update the range parameters for this compression call
                let expandedRangeEnd = Double(totalBits)
                return updateChartWithCompression(rangeStart: rangeStart, rangeEnd: expandedRangeEnd)
            }
        }
        
        if totalBits == 0 {
            // Reset state when buffer clears
            self.chartEntries = []
            self.visibleRangeStart = 0
            self.visibleRangeEnd = 10000 // Default range
            self.prevRangeStart = 0
            self.prevRangeEnd = 10000
            self.currentZoomLevel = 1.0
            print("Updated chart with 0 data points (empty buffer).")
            return
        }
        
        // Clamp the requested range to the actual data bounds [0, totalBits]
        let clampedStart = max(0, Int(rangeStart.rounded()))
        let clampedEnd = min(totalBits, Int(rangeEnd.rounded()))
        // Prevent negative range if start > end after clamping/rounding
        let effectiveStart = (clampedEnd < clampedStart) ? clampedEnd : clampedStart
        let effectiveEnd = max(clampedStart, clampedEnd)
        
        // Avoid compression if the range is invalid or effectively zero
        guard effectiveEnd > effectiveStart else {
            print("Skipping compression: Invalid or zero range [\(effectiveStart), \(effectiveEnd)] after clamping")
            return
        }
        
        print("Compressing data for range: [\(effectiveStart), \(effectiveEnd)] with \(numberBins) bins")
        
        // Call the compression function
        let (timeValues, dataValues) = bleManager.compressDataBits(
            rangeStart: effectiveStart,
            rangeEnd: effectiveEnd,
            numberBins: numberBins
        )
        
        var entries: [ChartDataEntry] = []
        entries.reserveCapacity(timeValues.count)
        for i in 0..<timeValues.count {
            guard i < dataValues.count else { break }
            entries.append(ChartDataEntry(x: Double(timeValues[i]), y: Double(dataValues[i])))
        }
        
        // Update chart entries
        DispatchQueue.main.async {
            self.chartEntries = entries
            print("Updated chart data with \(entries.count) compressed points for range [\(effectiveStart)-\(effectiveEnd)]")
        }
    }
} 