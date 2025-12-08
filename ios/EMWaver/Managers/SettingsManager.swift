import Foundation

class SettingsManager: ObservableObject {
    static let shared = SettingsManager()
    
    @Published var refreshTime: Int = 50
    @Published var bufferSizeLimit: Int = 393216
    @Published var rfm69CsPin: String = "36"
    @Published var rfm69CsActiveHigh: Bool = true
    
    private let userDefaults = UserDefaults.standard
    
    // Keys for UserDefaults
    private let refreshTimeKey = "refresh_time"
    private let bufferSizeLimitKey = "buffer_size_limit"
    private let rfm69CsPinKey = "rfm69_cs_pin"
    private let rfm69CsActiveHighKey = "rfm69_cs_active_high"
    
    // Available options for refresh time (in milliseconds)
    let refreshTimeOptions = [
        RefreshTimeOption(display: "10 ms", value: 10),
        RefreshTimeOption(display: "50 ms", value: 50),
        RefreshTimeOption(display: "100 ms", value: 100),
        RefreshTimeOption(display: "150 ms", value: 150),
        RefreshTimeOption(display: "200 ms", value: 200),
        RefreshTimeOption(display: "300 ms", value: 300),
        RefreshTimeOption(display: "400 ms", value: 400),
        RefreshTimeOption(display: "500 ms", value: 500)
    ]
    
    // Available options for buffer size limit (in bytes)
    let bufferSizeLimitOptions = [
        BufferSizeLimitOption(display: "128 KB (~10 seconds)", value: 131072),
        BufferSizeLimitOption(display: "256 KB (~20 seconds)", value: 262144),
        BufferSizeLimitOption(display: "384 KB (~30 seconds)", value: 393216),
        BufferSizeLimitOption(display: "512 KB (~40 seconds)", value: 524288),
        BufferSizeLimitOption(display: "768 KB (~60 seconds)", value: 786432),
        BufferSizeLimitOption(display: "1 MB (~80 seconds)", value: 1048576),
        BufferSizeLimitOption(display: "No limit", value: 0)
    ]
    
    private init() {
        loadSettings()
    }
    
    private func loadSettings() {
        // Load refresh time with default of 50ms
        if userDefaults.object(forKey: refreshTimeKey) != nil {
            refreshTime = userDefaults.integer(forKey: refreshTimeKey)
        } else {
            refreshTime = 50
            userDefaults.set(refreshTime, forKey: refreshTimeKey)
        }
        
        // Load buffer size limit with default of 384KB
        if userDefaults.object(forKey: bufferSizeLimitKey) != nil {
            bufferSizeLimit = userDefaults.integer(forKey: bufferSizeLimitKey)
        } else {
            bufferSizeLimit = 393216
            userDefaults.set(bufferSizeLimit, forKey: bufferSizeLimitKey)
        }
        
        // Load RFM69 CS pin with default of 36
        if let csPin = userDefaults.string(forKey: rfm69CsPinKey) {
            rfm69CsPin = csPin
        } else {
            rfm69CsPin = "36"
            userDefaults.set(rfm69CsPin, forKey: rfm69CsPinKey)
        }
        
        // Load RFM69 CS active high with default of true
        if userDefaults.object(forKey: rfm69CsActiveHighKey) != nil {
            rfm69CsActiveHigh = userDefaults.bool(forKey: rfm69CsActiveHighKey)
        } else {
            rfm69CsActiveHigh = true
            userDefaults.set(rfm69CsActiveHigh, forKey: rfm69CsActiveHighKey)
        }
    }
    
    func updateRefreshTime(_ newValue: Int) {
        refreshTime = newValue
        userDefaults.set(newValue, forKey: refreshTimeKey)
    }
    
    func updateBufferSizeLimit(_ newValue: Int) {
        bufferSizeLimit = newValue
        userDefaults.set(newValue, forKey: bufferSizeLimitKey)
    }
    
    func getRefreshTimeDisplay() -> String {
        return refreshTimeOptions.first { $0.value == refreshTime }?.display ?? "50 ms"
    }
    
    func getBufferSizeLimitDisplay() -> String {
        return bufferSizeLimitOptions.first { $0.value == bufferSizeLimit }?.display ?? "384 KB (~30 seconds)"
    }
    
    func updateRfm69CsPin(_ newValue: String) {
        rfm69CsPin = newValue
        userDefaults.set(newValue, forKey: rfm69CsPinKey)
    }
    
    func updateRfm69CsActiveHigh(_ newValue: Bool) {
        rfm69CsActiveHigh = newValue
        userDefaults.set(newValue, forKey: rfm69CsActiveHighKey)
    }
}

// Helper structs for setting options
struct RefreshTimeOption: Identifiable {
    let id = UUID()
    let display: String
    let value: Int
}

struct BufferSizeLimitOption: Identifiable {
    let id = UUID()
    let display: String
    let value: Int
} 