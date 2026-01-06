/*
 * EMWaver
 * Copyright (c) 2026 Luís Marnoto
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

struct WelcomeView: View {
    @Environment(\.openURL) private var openURL
    let onDismiss: () -> Void
    
    var body: some View {
        NavigationView {
            VStack(spacing: 20) {
                Spacer()
                
                // App Logo/Icon
                Image(systemName: "wave.3.right.circle.fill")
                    .font(.system(size: 80))
                    .foregroundColor(.blue)
                    .shadow(radius: 4)
                
                // Welcome Title
                Text("Welcome to EMWaver!")
                    .font(.title)
                    .fontWeight(.bold)
                    .multilineTextAlignment(.center)
                
                // Welcome Message - More compact
                VStack(spacing: 12) {
                    Text("Thank you for downloading EMWaver")
                        .font(.title3)
                        .multilineTextAlignment(.center)
                    
                    Text("You'll need an EMWaver hardware device that connects via USB.")
                        .font(.body)
                        .multilineTextAlignment(.center)
                        .foregroundColor(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                    
                    Text("Features CC1101 for sub-GHz RF, infrared, and 16 GPIO pins.")
                        .font(.body)
                        .multilineTextAlignment(.center)
                        .foregroundColor(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(.horizontal, 20)
                
                Spacer()
                
                // Action Buttons
                VStack(spacing: 12) {
                    // Help & Documentation Button
                    Button(action: {
                        if let url = URL(string: "https://docs.emwaver.com") {
                            openURL(url)
                        }
                    }) {
                        HStack {
                            Image(systemName: "book.circle.fill")
                                .font(.title3)
                            Text("Documentation & Setup")
                                .font(.body)
                                .fontWeight(.medium)
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 12)
                        .background(Color.blue)
                        .foregroundColor(.white)
                        .cornerRadius(10)
                    }
                    
                    // Get Started Button
                    Button(action: {
                        onDismiss()
                    }) {
                        HStack {
                            Image(systemName: "arrow.right.circle.fill")
                                .font(.title3)
                            Text("Get Started")
                                .font(.body)
                                .fontWeight(.medium)
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 12)
                        .background(Color.green)
                        .foregroundColor(.white)
                        .cornerRadius(10)
                    }
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 30)
            }
            .navigationBarHidden(true)
        }
        .navigationViewStyle(StackNavigationViewStyle())
    }
}

#Preview {
    WelcomeView(onDismiss: {})
} 
