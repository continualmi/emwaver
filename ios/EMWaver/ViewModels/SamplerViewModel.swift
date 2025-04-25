import SwiftUI
import Combine
import DGCharts

class SamplerViewModel: ObservableObject {
    // Visible range values - match Android exactly
    @Published var visibleRangeStart: Double = 0.0
    @Published var visibleRangeEnd: Double = 10000.0
    
    // Chart state tracking is now separate from model like in Android
    
    // Reference to BLE manager for buffer access
    var bleManager: BLEManager
    
    // Compression debounce publisher
    let needsCompressionUpdate = PassthroughSubject<Void, Never>()
    
    init(bleManager: BLEManager) {
        self.bleManager = bleManager
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
    
    // Update chart with compressed data (similar to Android's updateChartWithCompression)
    func updateChartWithCompression(rangeStart: Double, rangeEnd: Double) -> [ChartDataEntry] {
        let bufferData = bleManager.getBuffer()
        let totalBits = bufferData.count * 8
        
        if totalBits == 0 {
            return []
        }
        
        // Clamp the requested range to the actual data bounds [0, totalBits]
        let clampedStart = max(0, Int(rangeStart.rounded()))
        let clampedEnd = min(totalBits, Int(rangeEnd.rounded()))
        let effectiveStart = clampedStart
        let effectiveEnd = max(clampedStart, clampedEnd)
        
        // Number of bins - match Android exactly
        let numberBins = 500
        
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
        
        return entries
    }
} 