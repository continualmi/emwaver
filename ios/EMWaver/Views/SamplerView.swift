import SwiftUI
import DGCharts
import UniformTypeIdentifiers

extension UTType {
    static var rawSignal: UTType {
        UTType(filenameExtension: "raw") ?? .data
    }
}

struct SignalDocument: FileDocument {
    static var readableContentTypes: [UTType] { [.rawSignal, .data] }
    var data: Data

    init(_ data: Data) {
        self.data = data
    }

    init(configuration: ReadConfiguration) throws {
        data = configuration.file.regularFileContents ?? Data()
    }

    func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper {
        FileWrapper(regularFileWithContents: data)
    }
}

struct LineChartViewController: UIViewControllerRepresentable {
    var entries: [ChartDataEntry]
    var onChartScale: ((Float, Float) -> Void)?
    var onChartTranslate: ((Float, Float) -> Void)?
    var onChartCreated: ((LineChartView) -> Void)?

    func makeCoordinator() -> Coordinator {
        Coordinator(self)
    }

    func makeUIViewController(context: Context) -> UIViewController {
        let controller = UIViewController()
        let chartView = LineChartView()
        chartView.translatesAutoresizingMaskIntoConstraints = false
        chartView.chartDescription.enabled = false
        chartView.legend.enabled = true
        chartView.leftAxis.axisMinimum = -128
        chartView.leftAxis.axisMaximum = 384
        chartView.rightAxis.enabled = false
        chartView.xAxis.labelPosition = .bottom
        chartView.dragEnabled = true
        chartView.pinchZoomEnabled = true
        chartView.dragDecelerationEnabled = false
        chartView.doubleTapToZoomEnabled = false
        chartView.drawGridBackgroundEnabled = false
        chartView.scaleYEnabled = false
        chartView.scaleXEnabled = true
        chartView.highlightPerTapEnabled = false
        chartView.maxVisibleCount = 0
        chartView.autoScaleMinMaxEnabled = false
        chartView.delegate = context.coordinator

        controller.view.addSubview(chartView)
        NSLayoutConstraint.activate([
            chartView.topAnchor.constraint(equalTo: controller.view.topAnchor),
            chartView.leadingAnchor.constraint(equalTo: controller.view.leadingAnchor),
            chartView.trailingAnchor.constraint(equalTo: controller.view.trailingAnchor),
            chartView.bottomAnchor.constraint(equalTo: controller.view.bottomAnchor)
        ])

        if let panGesture = chartView.gestureRecognizers?.first(where: { $0 is UIPanGestureRecognizer }) {
            panGesture.delegate = context.coordinator
        }

        context.coordinator.chartView = chartView
        onChartCreated?(chartView)
        updateChartData(chartView: chartView)
        return controller
    }

    func updateUIViewController(_ uiViewController: UIViewController, context: Context) {
        if let chartView = context.coordinator.chartView {
            updateChartData(chartView: chartView)
        }
    }

    class Coordinator: NSObject, ChartViewDelegate, UIGestureRecognizerDelegate {
        let parent: LineChartViewController
        weak var chartView: LineChartView?
        private var currentZoomLevel: Float = 1.0
        private var previousRangeStart: Float = 0
        private var previousRangeEnd: Float = 0

        init(_ parent: LineChartViewController) {
            self.parent = parent
        }

        func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer) -> Bool {
            gestureRecognizer is UIPanGestureRecognizer && otherGestureRecognizer is UIPanGestureRecognizer
        }

        func chartScaled(_ chartView: ChartViewBase, scaleX: CGFloat, scaleY: CGFloat) {
            guard let view = chartView as? LineChartView else { return }
            let newZoom = Float(view.scaleX)
            if abs(newZoom - currentZoomLevel) >= (newZoom / 10) {
                currentZoomLevel = newZoom
                parent.onChartScale?(newZoom, Float(scaleY))
            }
        }

        func chartTranslated(_ chartView: ChartViewBase, dX: CGFloat, dY: CGFloat) {
            guard let view = chartView as? LineChartView else { return }
            let rangeStart = Float(view.lowestVisibleX)
            let rangeEnd = Float(view.highestVisibleX)
            let span = rangeEnd - rangeStart
            let threshold = span / 100

            if (rangeStart <= 0 && dX > 0) || (rangeEnd >= Float(view.xAxis.axisMaximum) && dX < 0) {
                return
            }

            if (abs(rangeStart - previousRangeStart) > threshold || abs(rangeEnd - previousRangeEnd) > threshold) && span >= 10 {
                previousRangeStart = rangeStart
                previousRangeEnd = rangeEnd
                parent.onChartTranslate?(Float(dX), Float(dY))
            }
        }
    }

    private func updateChartData(chartView: LineChartView) {
        let dataSet = LineChartDataSet(entries: entries, label: "Demodulator")
        dataSet.drawCirclesEnabled = true
        dataSet.circleRadius = 2
        dataSet.drawValuesEnabled = false
        let color = UIColor(red: 0, green: 135.0 / 255.0, blue: 1, alpha: 1)
        dataSet.setColor(color)
        dataSet.setCircleColor(color)
        dataSet.lineWidth = 3
        dataSet.drawCircleHoleEnabled = false
        dataSet.mode = .linear

        chartView.data = LineChartData(dataSet: dataSet)
        chartView.notifyDataSetChanged()
    }
}

struct SamplerView: View {
    @EnvironmentObject var authManager: AuthenticationManager
    @EnvironmentObject var bleManager: BLEManager
    @StateObject private var viewModel = SamplerViewModel()

    @State private var selectedPinIndex = 4
    @State private var isRecording = false

    @State private var chartEntries: [ChartDataEntry] = []
    @State private var chartView: LineChartView?
    @State private var chartMinX: Double = 0
    @State private var chartMaxX: Double = 10000
    @State private var lastBufferSize: Int = -1
    @State private var refreshTimer: Timer?
    @State private var isSchedulerRunning = false

    @State private var showingFileImporter = false
    @State private var showingFileExporter = false
    @State private var showingExportDialog = false
    @State private var showingSettingsSheet = false
    @State private var exportFileName = "signal.raw"
    @State private var namePrompt: NamePrompt?
    @State private var showingDeleteConfirmation = false

    @State private var irpProtocol = "NEC1"
    @State private var irpDevice = "0"
    @State private var irpSubdevice = "0"
    @State private var irpFunction = "170"

    private let pins = [
        "GPIO0 (IO0)",
        "CC1101 GDO0 (IO1)",
        "CC1101 GDO2 (IO2)",
        "IR TX (IO4)",
        "IR RX (IO5)",
        "GPIO6 (IO6)",
        "GPIO7 (IO7)",
        "GPIO9 (IO9)",
        "CC1101 NSS (IO10)",
        "CC1101 MOSI (IO11)",
        "CC1101 SCK (IO12)",
        "CC1101 MISO (IO13)",
        "GPIO14 (IO14)",
        "GPIO15 (IO15)",
        "GPIO16 (IO16)"
    ]

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    if !bleManager.isConnected {
                        connectionBanner
                    }

                    chartSection
                    signalsSection
                    infraredSection
                }
                .padding(.vertical, 16)
            }
            .background(Color(.systemGroupedBackground).ignoresSafeArea())
            .navigationTitle("Sampler")
            .toolbar { toolbarContent }
            .onAppear { handleAppear() }
            .onChange(of: bleManager.isConnected) { handleConnectionChange($0) }
            .onChange(of: authManager.accessToken) { _ in loadSignals() }
            .onDisappear { stopScheduler() }
            .alert(item: $viewModel.notice) { notice in
                Alert(title: Text(notice.title), message: Text(notice.message), dismissButton: .default(Text("OK")))
            }
            .sheet(isPresented: $showingSettingsSheet) {
                SettingsSheet()
            }
            .sheet(item: $namePrompt) { prompt in
                NamePromptSheet(prompt: prompt) { value in
                    handleNamePrompt(prompt: prompt, value: value)
                } onCancel: {
                    namePrompt = nil
                }
            }
            .confirmationDialog("Delete signal?", isPresented: $showingDeleteConfirmation, titleVisibility: .visible) {
                Button("Delete", role: .destructive) {
                    performDelete()
                }
                Button("Cancel", role: .cancel) {
                    showingDeleteConfirmation = false
                }
            }
            .fileImporter(
                isPresented: $showingFileImporter,
                allowedContentTypes: [.rawSignal, .data],
                allowsMultipleSelection: false
            ) { result in
                if case let .success(urls) = result, let url = urls.first {
                    importSignal(from: url)
                } else if case let .failure(error) = result {
                    showToast("Error importing file: \(error.localizedDescription)")
                }
            }
            .fileExporter(
                isPresented: $showingFileExporter,
                document: SignalDocument(bleManager.getBuffer()),
                contentType: .rawSignal,
                defaultFilename: exportFileName
            ) { result in
                switch result {
                case .success:
                    showToast("Signal exported successfully")
                case let .failure(error):
                    showToast("Error exporting signal: \(error.localizedDescription)")
                }
            }
            .alert("Export Signal", isPresented: $showingExportDialog) {
                TextField("Filename", text: $exportFileName)
                    .submitLabel(.done)
                    .autocapitalization(.none)
                    .disableAutocorrection(true)
                Button("Cancel", role: .cancel) {}
                Button("Export") {
                    if !exportFileName.lowercased().hasSuffix(".raw") {
                        exportFileName += ".raw"
                    }
                    showingFileExporter = true
                }
            } message: {
                Text("Enter a name for the signal file.")
            }
        }
    }

    private var connectionBanner: some View {
        HStack {
            Circle()
                .fill(Color.red)
                .frame(width: 10, height: 10)
            Text("Not Connected")
                .font(.subheadline)
            Spacer()
        }
        .padding()
        .background(Color(.systemGray6))
        .cornerRadius(8)
        .padding(.horizontal)
    }

    private var chartSection: some View {
        VStack(spacing: 12) {
            LineChartViewController(
                entries: chartEntries,
                onChartScale: { _, _ in chartGestured() },
                onChartTranslate: { _, _ in chartGestured() },
                onChartCreated: { view in
                    chartView = view
                    view.xAxis.axisMinimum = chartMinX
                    view.xAxis.axisMaximum = chartMaxX
                    refreshChart(force: true)
                }
            )
            .frame(height: 300)
            .padding(.horizontal)

            HStack(spacing: 12) {
                Button {
                    isRecording ? stopRecording() : startRecording()
                } label: {
                    HStack {
                        Image(systemName: isRecording ? "stop.circle.fill" : "record.circle")
                        Text(isRecording ? "Stop" : "Record")
                    }
                    .frame(maxWidth: .infinity, minHeight: 44)
                }
                .buttonStyle(.borderedProminent)
                .tint(isRecording ? .red : .blue)

                Button {
                    retransmitSignal()
                } label: {
                    HStack {
                        Image(systemName: "arrow.up.circle")
                        Text("Transmit")
                    }
                    .frame(maxWidth: .infinity, minHeight: 44)
                }
                .buttonStyle(.borderedProminent)
                .tint(.green)
                .disabled(bleManager.getBuffer().isEmpty)
            }
            .padding(.horizontal)

            VStack(alignment: .leading, spacing: 8) {
                Text("GPIO Pin")
                    .font(.subheadline)
                    .foregroundColor(.secondary)

                Picker("", selection: $selectedPinIndex) {
                    ForEach(Array(pins.enumerated()), id: \.offset) { index, title in
                        Text(title).tag(index)
                    }
                }
                .pickerStyle(.menu)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal)
            }
        }
        .padding(.vertical, 12)
        .background(Color(.systemGray6), in: RoundedRectangle(cornerRadius: 12))
        .padding(.horizontal)
    }

    private var signalsSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Saved Signals")
                    .font(.headline)
                Spacer()
                Button {
                    loadSignals()
                } label: {
                    Label("Refresh", systemImage: "arrow.clockwise")
                }
                .labelStyle(.iconOnly)
                .disabled(!(authManager.accessToken?.isEmpty == false))
            }

            Text(viewModel.currentSignalSummary())
                .font(.subheadline)
                .foregroundColor(.secondary)

            let state = viewModel.saveButtonState(isAuthenticated: authManager.accessToken?.isEmpty == false)
            Button(state.title) {
                handleSaveTapped()
            }
            .buttonStyle(.borderedProminent)
            .disabled(!state.isEnabled)

            if viewModel.isSavingSignal {
                ProgressView()
            }

            if viewModel.isLoadingSignals {
                ProgressView("Loading...")
                    .frame(maxWidth: .infinity, alignment: .center)
            } else if authManager.accessToken?.isEmpty != false {
                Text("Sign in to access saved signals.")
                    .font(.subheadline)
                    .foregroundColor(.secondary)
            } else if viewModel.signals.isEmpty {
                Text("No signals saved yet.")
                    .font(.subheadline)
                    .foregroundColor(.secondary)
            } else {
                VStack(spacing: 0) {
                    ForEach(viewModel.signals) { item in
                        SignalRow(item: item) {
                            loadSignal(from: item.metadata)
                        }
                        if item.id != viewModel.signals.last?.id {
                            Divider()
                        }
                    }
                }
                .background(
                    RoundedRectangle(cornerRadius: 10)
                        .fill(Color(.secondarySystemBackground))
                )
            }
        }
        .padding()
        .background(Color(.systemBackground), in: RoundedRectangle(cornerRadius: 12))
        .padding(.horizontal)
    }

    private var infraredSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Infrared Tools")
                .font(.headline)

            HStack(spacing: 12) {
                Button("Get Timings") {
                    getTimings()
                }
                .buttonStyle(.bordered)

                Button("Decode IRP") {
                    decodeIrp()
                }
                .buttonStyle(.bordered)
                .disabled(bleManager.getBuffer().isEmpty || authManager.accessToken?.isEmpty != false)

                Button("Convert to IR") {
                    convertToIR()
                }
                .buttonStyle(.bordered)
                .disabled(bleManager.getBuffer().isEmpty)
            }

            VStack(spacing: 8) {
                TextField("Protocol", text: $irpProtocol)
                    .textInputAutocapitalization(.characters)
                    .disableAutocorrection(true)

                HStack {
                    TextField("Device (D)", text: $irpDevice)
                        .keyboardType(.numbersAndPunctuation)
                    TextField("Subdevice (S)", text: $irpSubdevice)
                        .keyboardType(.numbersAndPunctuation)
                    TextField("Function (F)", text: $irpFunction)
                        .keyboardType(.numbersAndPunctuation)
                }
            }

            Button("Render IRP") {
                renderIrp()
            }
            .buttonStyle(.borderedProminent)
            .disabled(authManager.accessToken?.isEmpty != false)

            TextEditor(text: $viewModel.outputText)
                .font(.system(.body, design: .monospaced))
                .frame(minHeight: 160)
                .overlay(
                    RoundedRectangle(cornerRadius: 8)
                        .stroke(Color(.separator), lineWidth: 1)
                )
        }
        .padding()
        .background(Color(.systemBackground), in: RoundedRectangle(cornerRadius: 12))
        .padding(.horizontal)
    }

    @ToolbarContentBuilder
    private var toolbarContent: some ToolbarContent {
        ToolbarItem(placement: .navigationBarTrailing) {
            Menu {
                Button("New Signal", action: createNewSignal)
                Button("Rename Signal", action: showRenamePrompt)
                    .disabled(viewModel.currentSignalMetadata == nil || viewModel.hasUnsavedChanges)
                Button("Delete Signal", action: { showingDeleteConfirmation = true })
                    .disabled(viewModel.currentSignalMetadata == nil || viewModel.hasUnsavedChanges)
                Divider()
                Button("Clear Buffer", action: clearBufferAndChart)
                Button("Import from Files") { showingFileImporter = true }
                Button("Export to Files") {
                    let buffer = bleManager.getBuffer()
                    if buffer.isEmpty {
                        showToast("Buffer is empty, nothing to export")
                    } else {
                        exportFileName = generateDefaultFileName()
                        showingExportDialog = true
                    }
                }
                Button("Settings") { showingSettingsSheet = true }
            } label: {
                Image(systemName: "ellipsis.circle")
            }
        }
    }

    private func handleAppear() {
        viewModel.attachBLEManager(bleManager)
        loadSignals()
        if bleManager.isConnected {
            initScheduler()
        }
    }

    private func handleConnectionChange(_ connected: Bool) {
        if connected {
            viewModel.attachBLEManager(bleManager)
            initScheduler()
        } else {
            stopScheduler()
        }
    }

    private func loadSignals() {
        guard let token = authManager.accessToken, !token.isEmpty else {
            viewModel.clearSignals()
            return
        }
        Task {
            await viewModel.refreshSignals(accessToken: token)
        }
    }

    private func chartGestured() {
        guard let chartView else { return }
        viewModel.setVisibleRangeStart(chartView.lowestVisibleX)
        viewModel.setVisibleRangeEnd(chartView.highestVisibleX)
        updateChartWithCompression(rangeStart: chartView.lowestVisibleX, rangeEnd: chartView.highestVisibleX)
    }

    private func handleSaveTapped() {
        let state = viewModel.saveButtonState(isAuthenticated: authManager.accessToken?.isEmpty == false)
        guard state.isEnabled else { return }
        guard let token = authManager.accessToken, !token.isEmpty else {
            viewModel.notice = SamplerViewModel.Notice(title: "Error", message: "Sign in required")
            return
        }
        let buffer = bleManager.getBuffer()
        if buffer.isEmpty {
            viewModel.notice = SamplerViewModel.Notice(title: "Error", message: "Buffer is empty")
            return
        }

        if viewModel.currentSignalMetadata == nil {
            let initial = viewModel.normalizeSignalName(viewModel.currentSignalName.isEmpty ? viewModel.generateNewSignalName() : viewModel.currentSignalName)
            namePrompt = NamePrompt(
                mode: .create(buffer),
                title: "Save Signal",
                message: "Enter a name for the signal.",
                initialValue: initial
            )
        } else {
            Task {
                await viewModel.saveSignal(buffer: buffer, accessToken: token)
            }
        }
    }

    private func handleNamePrompt(prompt: NamePrompt, value: String) {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            namePrompt = nil
            return
        }
        switch prompt.mode {
        case .create(let buffer):
            guard let token = authManager.accessToken, !token.isEmpty else {
                viewModel.notice = SamplerViewModel.Notice(title: "Error", message: "Sign in required")
                break
            }
            viewModel.markBufferDirty(resetMetadata: true, suggestedName: trimmed)
            Task {
                await viewModel.saveSignal(buffer: buffer, accessToken: token)
            }
        case .rename:
            guard let token = authManager.accessToken, !token.isEmpty else {
                viewModel.notice = SamplerViewModel.Notice(title: "Error", message: "Sign in required")
                break
            }
            Task {
                await viewModel.renameCurrentSignal(to: trimmed, accessToken: token)
            }
        }
        namePrompt = nil
    }

    private func performDelete() {
        showingDeleteConfirmation = false
        guard let token = authManager.accessToken, !token.isEmpty else {
            viewModel.notice = SamplerViewModel.Notice(title: "Error", message: "Sign in required")
            return
        }
        Task {
            await viewModel.deleteCurrentSignal(accessToken: token)
        }
    }

    private func startRecording() {
        guard let pin = selectedPinNumber() else { return }
        var command = Data("sample ".utf8)
        command.append(pin)
        bleManager.sendPacket(command)
        isRecording = true
    }

    private func stopRecording() {
        if let command = "stop".data(using: .utf8) {
            bleManager.sendPacket(command)
        }
        isRecording = false
        viewModel.markBufferDirty(resetMetadata: true, suggestedName: SamplerViewModel.defaultSignalName)
    }

    private func retransmitSignal() {
        guard !bleManager.getBuffer().isEmpty, let pin = selectedPinNumber() else { return }
        var command = Data("transmit ".utf8)
        command.append(pin)
        bleManager.sendPacket(command)
        bleManager.transmitBuffer()
    }

    private func getTimings() {
        let buffer = bleManager.getBuffer()
        guard !buffer.isEmpty else {
            viewModel.notice = SamplerViewModel.Notice(title: "Error", message: "Buffer is empty")
            return
        }
        viewModel.outputText = viewModel.buildSignedRawTimings(from: buffer)
    }

    private func decodeIrp() {
        guard let token = authManager.accessToken, !token.isEmpty else {
            viewModel.notice = SamplerViewModel.Notice(title: "Error", message: "Sign in required")
            return
        }
        let buffer = bleManager.getBuffer()
        Task {
            await viewModel.decode(buffer: buffer, accessToken: token)
        }
    }

    private func renderIrp() {
        guard let token = authManager.accessToken, !token.isEmpty else {
            viewModel.notice = SamplerViewModel.Notice(title: "Error", message: "Sign in required")
            return
        }
        let protocolName = irpProtocol.trimmingCharacters(in: .whitespacesAndNewlines)
        var parameters: [String: Int] = [:]
        if let value = parseNumericValue(irpDevice) { parameters["D"] = value }
        if let value = parseNumericValue(irpSubdevice) { parameters["S"] = value }
        if let value = parseNumericValue(irpFunction) { parameters["F"] = value }

        Task {
            if let data = await viewModel.renderSignal(protocolName: protocolName, parameters: parameters, accessToken: token) {
                bleManager.loadBuffer(data: data)
                viewModel.markBufferDirty(resetMetadata: false, suggestedName: nil)
                refreshChart(force: true)
            }
        }
    }

    private func convertToIR() {
        let buffer = bleManager.getBuffer()
        guard !buffer.isEmpty else { return }
        let utils = Utils()
        let converted = utils.convertToIRBuffer(buffer)
        bleManager.loadBuffer(data: converted)
        viewModel.markBufferDirty(resetMetadata: false, suggestedName: nil)
        refreshChart(force: true)
        showToast("Signal converted to 38kHz IR format")
    }

    private func clearBufferAndChart() {
        bleManager.clearBuffer()
        viewModel.markBufferDirty(resetMetadata: false, suggestedName: nil)
        refreshChart(force: true)
    }

    private func createNewSignal() {
        bleManager.clearBuffer()
        let name = viewModel.generateNewSignalName()
        viewModel.markBufferDirty(resetMetadata: true, suggestedName: name)
        refreshChart(force: true)
    }

    private func showRenamePrompt() {
        guard let metadata = viewModel.currentSignalMetadata else { return }
        namePrompt = NamePrompt(
            mode: .rename,
            title: "Rename Signal",
            message: "Enter a new name.",
            initialValue: metadata.name
        )
    }

    private func loadSignal(from metadata: UserFileMetadata) {
        guard let token = authManager.accessToken, !token.isEmpty else {
            viewModel.notice = SamplerViewModel.Notice(title: "Error", message: "Sign in required")
            return
        }
        Task {
            if let data = await viewModel.loadSignal(id: metadata.id, accessToken: token) {
                bleManager.loadBuffer(data: data)
                refreshChart(force: true)
            }
        }
    }

    private func initScheduler() {
        stopScheduler()
        let interval = Double(viewModel.refreshTime) / 1000.0
        guard interval > 0 else { return }
        isSchedulerRunning = true
        refreshTimer = Timer.scheduledTimer(withTimeInterval: interval, repeats: true) { _ in
            if isSchedulerRunning {
                refreshChartWithBufferCheck()
            }
        }
    }

    private func stopScheduler() {
        isSchedulerRunning = false
        refreshTimer?.invalidate()
        refreshTimer = nil
    }

    private func refreshChartWithBufferCheck() {
        if viewModel.isBufferSizeLimitReached(isRecording: isRecording) {
            stopRecording()
            showToast("Recording stopped: Buffer size limit reached. Adjust it in Settings.")
        }
        refreshChart()
    }

    private func refreshChart(force: Bool = false) {
        guard let chartView else { return }
        let bufferSize = bleManager.getBuffer().count
        if bufferSize != lastBufferSize || force {
            lastBufferSize = bufferSize
            chartMaxX = Double(bufferSize * 8)
            chartView.xAxis.axisMinimum = chartMinX
            chartView.xAxis.axisMaximum = chartMaxX
            chartGestured()
        }
    }

    private func updateChartWithCompression(rangeStart: Double, rangeEnd: Double) {
        let span = rangeEnd - rangeStart
        let start = max(0, rangeStart - span * 0.05)
        let end = rangeEnd + span * 0.05
        let entries = viewModel.updateChartWithCompression(rangeStart: start, rangeEnd: end)
        chartEntries = entries
        chartView?.notifyDataSetChanged()
    }

    private func importSignal(from url: URL) {
        guard url.startAccessingSecurityScopedResource() else {
            showToast("Failed to access file")
            return
        }
        defer { url.stopAccessingSecurityScopedResource() }

        do {
            let data = try Data(contentsOf: url)
            bleManager.loadBuffer(data: data)
            viewModel.markBufferDirty(resetMetadata: true, suggestedName: viewModel.normalizeSignalName(url.lastPathComponent))
            refreshChart(force: true)
            showToast("Imported \(url.lastPathComponent)")
        } catch {
            showToast("Error importing file: \(error.localizedDescription)")
        }
    }

    private func selectedPinNumber() -> UInt8? {
        guard selectedPinIndex >= 0 && selectedPinIndex < pins.count else { return nil }
        let text = pins[selectedPinIndex]
        let pattern = "\\(IO(\\d+)\\)"
        if let range = text.range(of: pattern, options: .regularExpression) {
            let match = text[range]
            let digits = match.dropFirst(3).dropLast()
            return UInt8(String(digits))
        }
        return nil
    }

    private func parseNumericValue(_ raw: String) -> Int? {
        var text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return nil }
        var sign = 1
        if text.hasPrefix("-") {
            sign = -1
            text.removeFirst()
        } else if text.hasPrefix("+") {
            text.removeFirst()
        }
        if text.isEmpty { return nil }
        let value: Int?
        if text.lowercased().hasPrefix("0x") {
            value = Int(text.dropFirst(2), radix: 16)
        } else if text.hasPrefix("#") {
            value = Int(text.dropFirst(), radix: 16)
        } else if text.hasPrefix("0") && text.count > 1 {
            value = Int(text, radix: 8)
        } else {
            value = Int(text, radix: 10)
        }
        guard let parsed = value else { return nil }
        return sign * parsed
    }

    private func generateDefaultFileName() -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyyMMdd_HHmmss"
        let pinName = pins[selectedPinIndex]
            .replacingOccurrences(of: " ", with: "_")
            .replacingOccurrences(of: "(", with: "")
            .replacingOccurrences(of: ")", with: "")
        return "signal_\(pinName)_\(formatter.string(from: Date())).raw"
    }

    private func showToast(_ message: String) {
        #if os(iOS)
        guard let scene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
              let controller = scene.windows.first?.rootViewController else {
            return
        }
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        controller.present(alert, animated: true)
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
            alert.dismiss(animated: true)
        }
        #endif
    }
}

private struct SignalRow: View {
    let item: SamplerViewModel.SignalListItem
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text(item.name)
                        .font(item.isActive ? .headline : .body)
                    Text(subtitle)
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
                Spacer()
                Image(systemName: "arrow.down.circle")
                    .foregroundColor(.accentColor)
            }
            .padding(12)
        }
        .buttonStyle(.plain)
        .background(item.isActive ? Color.accentColor.opacity(0.1) : Color.clear)
    }

    private var subtitle: String {
        var base = item.sizeDescription
        if item.isActive {
            base += item.isDirty ? " • Unsaved changes" : " • Active"
        }
        return base
    }
}

private struct NamePrompt: Identifiable {
    enum Mode {
        case create(Data)
        case rename
    }

    let id = UUID()
    let mode: Mode
    let title: String
    let message: String
    let initialValue: String
}

private struct NamePromptSheet: View {
    let prompt: NamePrompt
    let onSubmit: (String) -> Void
    let onCancel: () -> Void

    @State private var value: String

    init(prompt: NamePrompt, onSubmit: @escaping (String) -> Void, onCancel: @escaping () -> Void) {
        self.prompt = prompt
        self.onSubmit = onSubmit
        self.onCancel = onCancel
        _value = State(initialValue: prompt.initialValue)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section(footer: Text(prompt.message)) {
                    TextField("Name", text: $value)
                        .autocapitalization(.none)
                        .disableAutocorrection(true)
                }
            }
            .navigationTitle(prompt.title)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel", action: onCancel)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        onSubmit(value)
                    }
                }
            }
        }
    }
}
