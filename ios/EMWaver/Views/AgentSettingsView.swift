import SwiftUI

struct AgentSettingsView: View {
    @Environment(\.dismiss) private var dismiss
    @ObservedObject var service: AgentService
    
    @State private var baseURL: String
    @State private var apiKey: String
    @State private var model: String
    @State private var instructions: String
    
    init(service: AgentService) {
        self.service = service
        _baseURL = State(initialValue: service.baseURL)
        _apiKey = State(initialValue: service.apiKey)
        _model = State(initialValue: service.model)
        _instructions = State(initialValue: service.customInstructions)
    }
    
    var body: some View {
        NavigationView {
            Form {
                Section(header: Text("API Configuration")) {
                    TextField("Base URL", text: $baseURL)
                        .autocapitalization(.none)
                        .disableAutocorrection(true)
                    
                    SecureField("API Key", text: $apiKey)
                        .autocapitalization(.none)
                        .disableAutocorrection(true)
                    
                    TextField("Model", text: $model)
                        .autocapitalization(.none)
                        .disableAutocorrection(true)
                }
                
                Section(header: Text("Custom Instructions")) {
                    TextEditor(text: $instructions)
                        .frame(minHeight: 100)
                }
            }
            .navigationTitle("Agent Settings")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        dismiss()
                    }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        service.baseURL = baseURL.trimmingCharacters(in: .whitespacesAndNewlines)
                        service.apiKey = apiKey.trimmingCharacters(in: .whitespacesAndNewlines)
                        service.model = model.trimmingCharacters(in: .whitespacesAndNewlines)
                        service.customInstructions = instructions.trimmingCharacters(in: .whitespacesAndNewlines)
                        dismiss()
                    }
                }
            }
        }
    }
}
