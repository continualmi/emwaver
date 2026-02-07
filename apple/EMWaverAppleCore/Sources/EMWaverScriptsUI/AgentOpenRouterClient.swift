/*
 * EMWaver
 * Copyright (c) 2026 Luis Marnoto
 * All rights reserved.
 */

import Foundation

/// OpenRouter chat-completions client (API key).
/// Uses OpenAI-compatible `chat/completions` with streaming SSE.
final class AgentOpenRouterClient {
    struct ToolSpec {
        let name: String
        let description: String
        let parameters: [String: Any]

        func asChatTool() -> [String: Any] {
            return [
                "type": "function",
                "function": [
                    "name": name,
                    "description": description,
                    "parameters": parameters,
                ],
            ]
        }
    }

    struct OpenRouterError: LocalizedError {
        let message: String
        var errorDescription: String? { message }
    }

    private let baseURL = URL(string: "https://openrouter.ai/api/v1/chat/completions")!

    func sendStream(
        apiKey: String,
        model: String,
        messages: [[String: Any]],
        tools: [ToolSpec]
    ) async throws -> [String: Any] {
        var req = URLRequest(url: baseURL)
        req.httpMethod = "POST"
        req.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue("text/event-stream", forHTTPHeaderField: "Accept")

        // OpenRouter recommended attribution headers (matches opencode behavior).
        req.setValue("https://emwavers.com/", forHTTPHeaderField: "HTTP-Referer")
        req.setValue("EMWaver", forHTTPHeaderField: "X-Title")

        let body: [String: Any] = [
            "model": model,
            "messages": messages,
            "tools": tools.map { $0.asChatTool() },
            "stream": true,
        ]

        req.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (bytes, resp) = try await URLSession.shared.bytes(for: req)
        let http = resp as? HTTPURLResponse
        let status = http?.statusCode ?? -1
        if status < 200 || status >= 300 {
            // Best-effort body for debugging.
            var text = ""
            for try await line in bytes.lines {
                text += line + "\n"
            }
            throw OpenRouterError(message: "OpenRouter HTTP \(status): \(text)")
        }

        var finalAssistant: [String: Any] = [:]
        var contentParts: [String] = []
        var toolCallsByIndex: [Int: [String: Any]] = [:]

        func ensureToolCall(_ index: Int) -> [String: Any] {
            if let existing = toolCallsByIndex[index] { return existing }
            let empty: [String: Any] = [
                "id": "",
                "type": "function",
                "function": ["name": "", "arguments": ""],
            ]
            toolCallsByIndex[index] = empty
            return empty
        }

        for try await rawLine in bytes.lines {
            let line = rawLine.trimmingCharacters(in: .whitespacesAndNewlines)
            if line.isEmpty { continue }
            guard line.hasPrefix("data:") else { continue }
            let payload = line.dropFirst("data:".count).trimmingCharacters(in: .whitespaces)
            if payload == "[DONE]" { break }

            guard let data = payload.data(using: .utf8),
                  let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                continue
            }

            // Standard OpenAI-style stream chunk.
            if let choices = obj["choices"] as? [Any],
               let c0 = choices.first as? [String: Any],
               let delta = c0["delta"] as? [String: Any] {

                if let content = delta["content"] as? String {
                    contentParts.append(content)
                }

                if let toolCalls = delta["tool_calls"] as? [Any] {
                    for tcAny in toolCalls {
                        guard let tc = tcAny as? [String: Any] else { continue }
                        let idx = (tc["index"] as? Int) ?? 0
                        var agg = ensureToolCall(idx)

                        if let idPart = tc["id"] as? String, !idPart.isEmpty {
                            agg["id"] = idPart
                        }
                        if let typePart = tc["type"] as? String, !typePart.isEmpty {
                            agg["type"] = typePart
                        }
                        if let fn = tc["function"] as? [String: Any] {
                            var fnAgg = (agg["function"] as? [String: Any]) ?? ["name": "", "arguments": ""]
                            if let n = fn["name"] as? String, !n.isEmpty {
                                fnAgg["name"] = n
                            }
                            if let a = fn["arguments"] as? String, !a.isEmpty {
                                let prev = (fnAgg["arguments"] as? String) ?? ""
                                fnAgg["arguments"] = prev + a
                            }
                            agg["function"] = fnAgg
                        }

                        toolCallsByIndex[idx] = agg
                    }
                }

                // Some providers include final message in a non-delta field.
                if let msg = c0["message"] as? [String: Any] {
                    finalAssistant = msg
                }
            }
        }

        // Build assistant message object.
        var assistant: [String: Any] = [
            "role": "assistant",
            "content": contentParts.joined(),
        ]

        let toolCalls = toolCallsByIndex.keys.sorted().compactMap { toolCallsByIndex[$0] }
        if !toolCalls.isEmpty {
            assistant["tool_calls"] = toolCalls
        }

        // If provider returned a final message, merge its fields but keep our aggregated content/tool_calls.
        if !finalAssistant.isEmpty {
            for (k, v) in finalAssistant {
                assistant[k] = v
            }
            assistant["role"] = "assistant"
            assistant["content"] = contentParts.joined()
            if !toolCalls.isEmpty { assistant["tool_calls"] = toolCalls }
        }

        return assistant
    }
}
