import { type NextRequest } from "next/server";

import { loadRepoAgentSystemPrompt } from "@/server/agentPrompt";
import { ToolError, toolSchemasV1 } from "@/server/agentTools";
import { unauthorizedJson, requireIdentity } from "@/server/http";
import { createChatCompletion, type ChatMessage, openAIModel } from "@/server/openaiCompat";
import { agentStore } from "@/server/store/agent";
import { getRemoteSessionState } from "@/server/ws/state";
import { hostsList, remoteAttach, remoteRunScript, remoteSendUiEvent, remoteWaitForUi } from "@/server/agentTools";

function sse(event: string, data: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function streamResponse(run: (controller: ReadableStreamDefaultController<Uint8Array>) => Promise<void>) {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      async start(controller) {
        try {
          await run(controller);
        } finally {
          controller.close();
        }
      },
    }),
    {
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        "x-accel-buffering": "no",
      },
    },
  );
}

async function executeTool(identityUid: string, toolName: string, argsJson: string) {
  const remoteState = getRemoteSessionState();
  const args = JSON.parse(argsJson || "{}") as Record<string, unknown>;
  try {
    switch (toolName) {
      case "hosts_list":
        return hostsList(identityUid);
      case "remote_attach":
        return remoteAttach(remoteState, identityUid, String(args.hostSessionId || ""));
      case "remote_run_script":
        return remoteRunScript(remoteState, identityUid, String(args.hostSessionId || ""), String(args.name || ""), String(args.source || ""));
      case "remote_wait_for_ui":
        return await remoteWaitForUi(
          remoteState,
          identityUid,
          String(args.hostSessionId || ""),
          Number.parseInt(String(args.minRev ?? 0), 10) || 0,
          Number.parseFloat(String(args.timeoutSeconds ?? 10)) || 10,
        );
      case "remote_send_ui_event":
        return remoteSendUiEvent(remoteState, identityUid, {
          hostSessionId: String(args.hostSessionId || ""),
          scriptInstanceId: String(args.scriptInstanceId || ""),
          targetNodeId: String(args.targetNodeId || ""),
          name: String(args.name || ""),
          payload: typeof args.payload === "object" && args.payload ? (args.payload as Record<string, unknown>) : {},
          baseRev: args.baseRev == null ? null : Number.parseInt(String(args.baseRev), 10),
        });
      default:
        return { error: `unknown_tool:${toolName}` };
    }
  } catch (error) {
    if (error instanceof ToolError) return { error: error.message };
    return { error: String(error) };
  }
}

export async function POST(request: NextRequest) {
  const identity = await requireIdentity(request);
  if (!identity) return unauthorizedJson();

  const payload = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!payload || typeof payload !== "object") {
    return new Response(JSON.stringify({ error: "Invalid JSON payload" }), { status: 400 });
  }
  const conversationId = String(payload.conversation_id || "");
  const userContent = String(payload.message || "");
  const maxTokens = Number.parseInt(String(payload.max_tokens ?? 700), 10) || 700;
  const temperature = Number.parseFloat(String(payload.temperature ?? 0.2)) || 0.2;
  if (!conversationId || !userContent.trim()) {
    return new Response(JSON.stringify({ error: "Missing conversation_id/message" }), { status: 400 });
  }

  const conversation = agentStore.getConversation(conversationId);
  if (!conversation || conversation.firebase_uid !== identity.uid) {
    return new Response(JSON.stringify({ error: "Not found" }), { status: 404 });
  }

  agentStore.appendMessage({
    conversation_id: conversationId,
    firebase_uid: identity.uid,
    role: "user",
    content: userContent,
  });

  const model = openAIModel();
  const encoder = new TextEncoder();

  return streamResponse(async (controller) => {
    try {
      let messages: ChatMessage[] = agentStore.listMessages(conversationId, identity.uid).map((message) => ({
        role: message.role,
        content: message.content,
      }));
      const sysPrompt = loadRepoAgentSystemPrompt();
      if (sysPrompt) {
        messages = [{ role: "system", content: sysPrompt }, ...messages];
      }

      let assistantText = "";
      let toolIterations = 0;
      let sawToolCall = false;
      controller.enqueue(encoder.encode(": connected\n\n"));

      while (toolIterations < 8) {
        toolIterations += 1;
        const response = await createChatCompletion({
          model,
          messages,
          max_tokens: maxTokens,
          temperature,
          tools: toolSchemasV1(),
        });

        const choices = (response.choices as Array<Record<string, unknown>> | undefined) || [];
        const message = (choices[0]?.message as Record<string, unknown> | undefined) || {};
        const toolCalls = (message.tool_calls as Array<Record<string, unknown>> | undefined) || [];
        if (message.content) assistantText = String(message.content);
        if (!toolCalls.length) break;
        sawToolCall = true;

        messages.push({
          role: "assistant",
          content: String(message.content || ""),
          tool_calls: toolCalls.map((toolCall) => ({
            id: String(toolCall.id),
            type: "function",
            function: {
              name: String((toolCall.function as Record<string, unknown>)?.name || ""),
              arguments: String((toolCall.function as Record<string, unknown>)?.arguments || ""),
            },
          })),
        });

        for (const toolCall of toolCalls) {
          const fn = (toolCall.function as Record<string, unknown>) || {};
          const toolName = String(fn.name || "");
          const toolArguments = String(fn.arguments || "");
          controller.enqueue(encoder.encode(sse("tool", { name: toolName, arguments: toolArguments })));
          const result = await executeTool(identity.uid, toolName, toolArguments);
          controller.enqueue(encoder.encode(sse("tool", { name: toolName, result })));
          messages.push({
            role: "tool",
            tool_call_id: String(toolCall.id),
            content: JSON.stringify(result),
          });
        }
      }

      assistantText = assistantText.trim();
      if (!assistantText) {
        if (sawToolCall) {
          if (toolIterations >= 8) {
            assistantText = "I hit the tool-call limit before producing a final reply. Please try again with a narrower request."
          } else {
            assistantText = "I completed tool calls, but the model returned no final text. Please review the tool activity above and try again."
          }
        } else {
          controller.enqueue(encoder.encode(sse("error", { error: "Upstream produced no content" })));
          return;
        }
      }

      const persisted = agentStore.appendMessage({
        conversation_id: conversationId,
        firebase_uid: identity.uid,
        role: "assistant",
        content: assistantText,
      });

      for (let index = 0; index < assistantText.length; index += 64) {
        controller.enqueue(encoder.encode(sse("delta", { text: assistantText.slice(index, index + 64) })));
      }
      controller.enqueue(encoder.encode(sse("done", { message: persisted, model, tool_iterations: toolIterations })));
    } catch (error) {
      controller.enqueue(encoder.encode(sse("error", { error: String(error) })));
    }
  });
}
