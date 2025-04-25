import SwiftUI
import DGCharts

struct LineChartViewController: UIViewControllerRepresentable {
    // Data to be displayed
    var entries: [ChartDataEntry]

    func makeUIViewController(context: Context) -> UIViewController {
        // Simple UIViewController to host the chart view
        let viewController = UIViewController()
        let chartView = LineChartView()
        
        // Basic chart setup (similar to Android)
        chartView.translatesAutoresizingMaskIntoConstraints = false
        chartView.chartDescription.enabled = false
        chartView.legend.enabled = true
        chartView.leftAxis.axisMinimum = -20 // Give some padding below 0
        chartView.leftAxis.axisMaximum = 275 // Give some padding above 255
        chartView.rightAxis.enabled = false
        chartView.xAxis.labelPosition = .bottom
        chartView.dragEnabled = true
        chartView.pinchZoomEnabled = true
        chartView.setScaleEnabled(true)
        chartView.drawGridBackgroundEnabled = false
        chartView.scaleYEnabled = false // Disable Y-axis scaling
        chartView.scaleXEnabled = true  // Enable X-axis scaling only

        // Add chartView as a subview and set constraints
        viewController.view.addSubview(chartView)
        NSLayoutConstraint.activate([
            chartView.topAnchor.constraint(equalTo: viewController.view.topAnchor),
            chartView.leadingAnchor.constraint(equalTo: viewController.view.leadingAnchor),
            chartView.trailingAnchor.constraint(equalTo: viewController.view.trailingAnchor),
            chartView.bottomAnchor.constraint(equalTo: viewController.view.bottomAnchor)
        ])

        // Store chart view in coordinator for updates
        context.coordinator.chartView = chartView
        updateChartData(chartView: chartView)
        
        return viewController
    }

    func updateUIViewController(_ uiViewController: UIViewController, context: Context) {
        // Update the chart data when SwiftUI state changes
        if let chartView = context.coordinator.chartView {
            updateChartData(chartView: chartView)
        }
    }
    
    func makeCoordinator() -> Coordinator {
        Coordinator(self)
    }
    
    class Coordinator: NSObject {
        var parent: LineChartViewController
        var chartView: LineChartView? // Store the chart view instance

        init(_ parent: LineChartViewController) {
            self.parent = parent
        }
    }

    // Helper to update chart data
    private func updateChartData(chartView: LineChartView) {
        let dataSet = LineChartDataSet(entries: entries, label: "Signal")
        dataSet.drawCirclesEnabled = false
        dataSet.drawValuesEnabled = false
        dataSet.lineWidth = 1.5
        dataSet.setColor(.systemBlue)
        // dataSet.mode = .stepped // Make it look like a digital signal
        
        let data = LineChartData(dataSet: dataSet)
        chartView.data = data
        // Optional: Notify chart data has changed if updates are frequent
        // chartView.notifyDataSetChanged()
    }
}

// MARK: - Sampler View
struct SamplerView: View {
    @State private var chartEntries: [ChartDataEntry] = []

    var body: some View {
        VStack {
            // Display the chart
            LineChartViewController(entries: chartEntries)
                .frame(height: 300) // Give the chart a specific height
            
            // Button to load test data
            Button("Load Test Pattern 1") {
                loadTestPattern1()
            }
            .padding()
            
            Spacer() // Push content to the top
        }
        .navigationTitle("Sampler")
        .onAppear {
            // Load initial test data when view appears
            loadTestPattern1()
        }
    }

    // Generates Pattern 1: Alternating bytes of 0xFF and 0x00
    func generatePattern1(totalBytes: Int) -> Data {
        var testSignal = Data(capacity: totalBytes)
        for i in 0..<totalBytes {
            testSignal.append((i % 2 == 0) ? 0xFF : 0x00)
        }
        return testSignal
    }
    
    // Converts Data (bytes) into ChartDataEntry array (bits)
    func dataToChartEntries(data: Data) -> [ChartDataEntry] {
        var entries: [ChartDataEntry] = []
        // Pre-allocate capacity for performance
        entries.reserveCapacity(data.count * 8)
        
        for (byteIndex, byte) in data.enumerated() {
            for bitIndex in 0..<8 {
                let bit = (byte >> bitIndex) & 1
                let xValue = Double(byteIndex * 8 + bitIndex)
                let yValue = Double(bit * 255) // Plot 0 or 255
                entries.append(ChartDataEntry(x: xValue, y: yValue))
            }
        }
        return entries
    }
    
    // Loads test pattern 1 and updates the chart
    func loadTestPattern1() {
        print("Loading Test Pattern 1...")
        let testData = generatePattern1(totalBytes: 2000) // Generate 2000 bytes
        self.chartEntries = dataToChartEntries(data: testData)
        print("Test Pattern 1 loaded, \(chartEntries.count) data points.")
    }
}

#Preview {
    NavigationView {
        SamplerView()
    }
} 
