import SwiftUI
import AppKit

struct ProUpgradeSheet: View {
    @EnvironmentObject private var auth: AuthenticationManager
    @ObservedObject var entitlements: EntitlementsManager

    let featureName: String

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("EMWaver Pro")
                .font(.title2.weight(.semibold))

            Text("\(featureName) requires EMWaver Pro.")
                .foregroundStyle(.secondary)

            VStack(alignment: .leading, spacing: 10) {
                Label("Remote host sessions", systemImage: "dot.radiowaves.left.and.right")
                Label("File storage + sync across devices", systemImage: "arrow.triangle.2.circlepath")
                Label("AI Agent (Pro-only)", systemImage: "sparkles")
            }
            .padding(.top, 6)

            Divider()

            if !auth.isSignedIn {
                Text("To subscribe, sign in and attach a genuine EMWaver device to your account first.")
                    .foregroundStyle(.secondary)

                Button("Sign In…") {
                    auth.isSignInSheetPresented = true
                }
                .buttonStyle(.borderedProminent)
            } else {
                if let el = entitlements.eligibility {
                    if el.canPurchasePro {
                        Text("Eligible to subscribe.")
                            .foregroundStyle(.secondary)

                        Button("Get Pro…") {
                            openProPurchase()
                        }
                        .buttonStyle(.borderedProminent)

                        Button("Manage on web") {
                            openProPurchase()
                        }
                        .buttonStyle(.bordered)
                    } else {
                        if el.reason == "no_device" {
                            Text("To subscribe, connect and attach a genuine EMWaver device to your account first.")
                                .foregroundStyle(.secondary)
                        } else {
                            Text("You’re not eligible to subscribe yet.")
                                .foregroundStyle(.secondary)
                        }

                        // Not sure where your attach UI will live; today DeviceRegistryService attaches automatically when signed in.
                        HStack(spacing: 10) {
                            Button("Get Pro…") {
                                openProPurchase()
                            }
                            .buttonStyle(.borderedProminent)

                            Button("Refresh") {
                                Task { await entitlements.refresh(auth: auth, force: true) }
                            }
                            .buttonStyle(.bordered)
                        }
                    }
                } else {
                    HStack(spacing: 10) {
                        ProgressView()
                        Text("Checking eligibility…")
                            .foregroundStyle(.secondary)
                    }
                }
            }

            if let err = entitlements.lastError, !err.isEmpty {
                Text(err)
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .padding(.top, 6)
            }

            Spacer()
        }
        .padding(18)
        .frame(minWidth: 520, minHeight: 360)
        .task {
            await entitlements.refresh(auth: auth, force: true)
        }
    }

    private func openProPurchase() {
        guard var base = FrontendUrl.resolve() else { return }
        base.appendPathComponent("pro")
        NSWorkspace.shared.open(base)
    }
}
