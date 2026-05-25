# Agent Feature Parity

The executable Agent contract now lives in `docs/parity/features/agent.json` and runs as
part of the broader platform feature parity suite.

## Required Capabilities

| Capability | macOS | iOS | Windows | Android |
| --- | --- | --- | --- | --- |
| Agent API-key entry | Keychain-backed | Keychain-backed | local credential-backed | app-local key store |
| Agent endpoint request | MGPT `universe` + `userInput` | shared Apple client | MGPT `universe` + `userInput` | MGPT `universe` + `userInput` |
| Local chat list | SQLite | shared Apple SQLite | SQLite | SQLite |
| Local message history | SQLite | shared Apple SQLite | SQLite | SQLite |
| New chat | local conversation | shared Apple UI | local conversation | local conversation |
| Select chat | restores messages | shared Apple UI | restores messages | restores messages |
| Delete/archive chat | local archive | shared Apple UI | local archive API | local archive API |
| Missing-key behavior | local app still works | local app still works | local app still works | local app still works |
| Script context in Agent prompt | current script/tool context | shared Apple runtime | current script source | current script source |

## Test Expectations

Each platform test suite should cover these behaviors:

1. Saving and clearing an Agent API key does not affect local script/device use.
2. Creating a chat persists the conversation locally.
3. Sending a user message persists both the user message and the assistant reply.
4. Restarting/reopening the Agent UI restores the selected chat and message history.
5. Missing Agent endpoint or key produces a setup message, not a local hardware gate.
6. Backend requests use the shared Agent boundary: bearer key plus `universe` and
   `userInput`; production prompts and private routing policy stay server-side.

The repo-level static parity check is:

```bash
node scripts/parity/verify-platform-parity.mjs
```

Run this check manually when changing platform parity contracts. It verifies
the cross-platform contract that can be checked without a physical device or
simulator: local Agent key storage, local SQLite chat storage, shared Agent
request shape, BLE runtime presence, and absence of Firebase/Google sign-in
style hosted account gates in native app source.

## Current Notes

- macOS and iOS use the shared Apple `AgentChatStore` SQLite implementation.
- Windows now has `Services/Agent/AgentChatStore.cs` and stores local chat
  history in `%LOCALAPPDATA%/EMWaver/agent-chat.sqlite`.
- Android now has `agent/AgentChatStore.java` and stores local chat history in
  app-local SQLite as `agent-chat.sqlite`.
- Android now reads the activity-scoped `ScriptsViewModel` when the Agent sheet
  sends a message and appends the current script source to Agent `userInput`,
  matching the Windows request envelope and Apple tool-context path.
