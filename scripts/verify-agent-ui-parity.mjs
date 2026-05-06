#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);

const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const exists = (rel) => fs.existsSync(path.join(root, rel));

const checks = [
  {
    id: "agent.api_key.local_storage",
    description: "Agent API keys are stored locally on every app surface.",
    platforms: {
      macos: [
        ["macos/EMWaver/EMWaver/Auth/AuthenticationManager.swift", /KeychainStore\.setString[\s\S]*agent/i],
        ["macos/EMWaver/EMWaver/Auth/SignInSheet.swift", /Agent API Key|Agent API key/],
      ],
      ios: [
        ["ios/EMWaver/Auth/AuthenticationManager.swift", /KeychainStore\.setString[\s\S]*agent/i],
        ["ios/EMWaver/Auth/SignInSheet.swift", /Agent API Key|Agent API key/],
      ],
      windows: [
        ["windows/EMWaver/Services/Agent/AgentApiKeyStore.cs", /SaveApiKeyAsync/],
        ["windows/EMWaver/Dialogs/AccountDialog.xaml", /Agent API Key|Agent API key/],
      ],
      android: [
        ["android/app/src/main/java/com/emwaver/emwaverandroidapp/agent/AgentApiKeyStore.java", /SharedPreferences[\s\S]*api_key/],
        ["android/app/src/main/res/layout/dialog_sign_in.xml", /Agent API key/],
      ],
    },
  },
  {
    id: "agent.chat.local_sqlite",
    description: "Agent chat conversations and messages are local SQLite-backed state.",
    platforms: {
      macos: [["apple/EMWaverAppleCore/Sources/EMWaverScriptsUI/AgentChatStore.swift", /SQLite3[\s\S]*agent_conversations[\s\S]*agent_messages/]],
      ios: [["ios/EMWaver/Views/ScriptsContainerView.swift", /ScriptsRootView/], ["apple/EMWaverAppleCore/Sources/EMWaverScriptsUI/AgentChatStore.swift", /SQLite3/]],
      windows: [["windows/EMWaver/Services/Agent/AgentChatStore.cs", /Microsoft\.Data\.Sqlite[\s\S]*agent_conversations[\s\S]*agent_messages/]],
      android: [["android/app/src/main/java/com/emwaver/emwaverandroidapp/agent/AgentChatStore.java", /SQLiteOpenHelper[\s\S]*agent_conversations[\s\S]*agent_messages/]],
    },
  },
  {
    id: "agent.backend_contract",
    description: "Agent clients send bearer-authenticated MGPT-style universe/userInput requests.",
    platforms: {
      macos: [
        ["apple/EMWaverAppleCore/Sources/EMWaverScriptsUI/AgentEndpointAPI.swift", /Authorization[\s\S]*Bearer/],
        ["apple/EMWaverAppleCore/Sources/EMWaverScriptsUI/AgentEndpointAPI.swift", /userInput/],
      ],
      ios: [["apple/EMWaverAppleCore/Sources/EMWaverScriptsUI/AgentEndpointAPI.swift", /universe[\s\S]*userInput/]],
      windows: [["windows/EMWaver/Services/Agent/AgentApi.cs", /AuthenticationHeaderValue\("Bearer"[\s\S]*UserInput/]],
      android: [["android/app/src/main/java/com/emwaver/emwaverandroidapp/agent/AgentEndpointApi.java", /Authorization[\s\S]*Bearer[\s\S]*userInput/]],
    },
  },
  {
    id: "transport.ble_runtime",
    description: "BLE runtime transport exists where native apps own device control.",
    platforms: {
      macos: [["macos/EMWaver/EMWaver/MacUSBManager.swift", /CoreBluetooth[\s\S]*CBCentralManager[\s\S]*bleServiceUUID/]],
      ios: [["ios/EMWaver/Managers/USBManager.swift", /CoreBluetooth[\s\S]*CBCentralManager[\s\S]*bleServiceUUID/]],
      windows: [["windows/EMWaver/Services/WindowsDeviceManager.cs", /BluetoothLEDevice|Gatt|BLE/]],
      android: [["android/app/src/main/java/com/emwaver/emwaverandroidapp/USBService.java", /BluetoothLeScanner|BluetoothGatt[\s\S]*EMW_BLE_SERVICE_UUID/]],
    },
  },
  {
    id: "local_first.no_hosted_account_gate",
    description: "Native app source does not keep Firebase/Google sign-in or hosted cloud account gates.",
    forbidden: [
      ["android/app/src/main", /\bFirebase\b|firebase|GoogleSignIn|Google Sign-In|sign_in_google/],
      ["ios/EMWaver", /\bFirebase\b|firebase|GoogleSignIn|Google Sign-In/],
      ["macos/EMWaver/EMWaver", /\bFirebase\b|firebase|GoogleSignIn|Google Sign-In/],
      ["windows/EMWaver", /\bFirebase\b|firebase|GoogleSignIn|Google Sign-In/],
    ],
  },
];

function listFiles(target) {
  const full = path.join(root, target);
  if (!fs.existsSync(full)) return [];
  const stat = fs.statSync(full);
  if (stat.isFile()) return [target];
  const out = [];
  const stack = [target];
  while (stack.length) {
    const rel = stack.pop();
    for (const entry of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
      const child = path.join(rel, entry.name);
      if (entry.isDirectory()) {
        if (!["build", "bin", "obj", ".gradle", "DerivedData"].includes(entry.name)) stack.push(child);
      } else {
        out.push(child);
      }
    }
  }
  return out;
}

const failures = [];
const rows = [];

for (const check of checks) {
  if (check.platforms) {
    for (const [platform, requirements] of Object.entries(check.platforms)) {
      for (const [file, pattern] of requirements) {
        if (!exists(file)) {
          failures.push(`${check.id}/${platform}: missing ${file}`);
          continue;
        }
        const content = read(file);
        if (!pattern.test(content)) {
          failures.push(`${check.id}/${platform}: ${file} did not match ${pattern}`);
        }
      }
      rows.push({ id: check.id, platform, status: "checked" });
    }
  }

  if (check.forbidden) {
    for (const [target, pattern] of check.forbidden) {
      for (const file of listFiles(target)) {
        const content = read(file);
        if (pattern.test(content)) {
          failures.push(`${check.id}: forbidden pattern ${pattern} found in ${file}`);
        }
      }
    }
    rows.push({ id: check.id, platform: "all", status: "checked" });
  }
}

const summary = rows.reduce((acc, row) => {
  acc[row.id] ||= [];
  acc[row.id].push(row.platform);
  return acc;
}, {});

console.log("Agent UI parity checks:");
for (const [id, platforms] of Object.entries(summary)) {
  console.log(`- ${id}: ${platforms.join(", ")}`);
}

if (failures.length > 0) {
  console.error("\nFailures:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("\nAgent UI parity verification passed.");
