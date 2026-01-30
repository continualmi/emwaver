/*
 * EMWaver
 * Copyright (c) 2026 Luís Marnoto
 * All rights reserved.
 */

import SwiftUI

struct LoadingDialogView: View {
    let title: String
    let progress: Double
    let completedSteps: Int
    let totalSteps: Int
    let currentCommand: String
    let onCancel: () -> Void
    
    var body: some View {
        NavigationView {
            VStack(spacing: 20) {
                Text(title)
                    .font(.headline)
                    .padding(.top)
                
                ProgressView(value: progress)
                    .progressViewStyle(LinearProgressViewStyle())
                    .padding(.horizontal)
                
                HStack {
                    Spacer()
                    Text("\(completedSteps) / \(totalSteps)")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
                .padding(.horizontal)
                
                VStack(alignment: .leading, spacing: 4) {
                    Text("Current Command:")
                        .font(.caption)
                        .foregroundColor(.secondary)
                    Text(currentCommand)
                        .font(.system(.caption, design: .monospaced))
                        .foregroundColor(.primary)
                        .lineLimit(3)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .padding(.horizontal)
                .padding(.vertical, 8)
                .background(Color(.systemGray6))
                .cornerRadius(8)
                .padding(.horizontal)
                
                Spacer()
            }
            .padding()
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Cancel") {
                        onCancel()
                    }
                }
            }
        }
    }
}

#Preview {
    LoadingDialogView(
        title: "Initializing CC1101",
        progress: 0.5,
        completedSteps: 25,
        totalSteps: 50,
        currentCommand: "spi xfer --cs=10 --tx=0xF1,0x00 --rx=2",
        onCancel: {}
    )
}
