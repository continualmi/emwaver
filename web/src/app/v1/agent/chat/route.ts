import { NextResponse, type NextRequest } from "next/server";

import { loadRepoAgentSystemPrompt } from "@/server/agentPrompt";
import { ToolError, toolSchemasV1 } from "@/server/agentTools";
import { unauthorizedJson, requireIdentity } from "@/server/http";
import { createChatCompletion, openAIModel, type ChatMessage } from "@/server/openaiCompat";
import { agentStore } from "@/server/store/agent";
import { getRemoteSessionState } from "@/server/ws/state";
import { hostsList, remoteAttach, remoteRunScript, remoteSendUiEvent, remoteWaitForUi } from "@/server/agentTools";

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

  const payload = await request.json().catch(() => null);
  if (!payload || typeof payload !== "object") {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const conversationId = String((payload as Record<string, unknown>).conversation_id || "");
  const userContent = String((payload as Record<string, unknown>).message || "");
  const maxTokens = Number.parseInt(String((payload as Record<string, unknown>).max_tokens ?? 512), 10);
  const temperature = Number.parseFloat(String((payload as Record<string, unknown>).temperature ?? 0.2));
  if (!conversationId) return NextResponse.json({ error: "Missing 'conversation_id'" }, { status: 400 });
  if (!userContent.trim()) return NextResponse.json({ error: "Missing 'message'" }, { status: 400 });

  const conversation = agentStore.getConversation(conversationId);
  if (!conversation || conversation.firebase_uid !== identity.uid) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  agentStore.appendMessage({
    conversation_id: conversationId,
    firebase_uid: identity.uid,
    role: "user",
    content: userContent,
  });

  try {
    const model = openAIModel();
    let messages: ChatMessage[] = agentStore
      .listMessages(conversationId, identity.uid)
      .map((message) => ({ role: message.role, content: message.content }));
    const sysPrompt = loadRepoAgentSystemPrompt();
    if (sysPrompt) {
      messages = [{ role: "system", content: sysPrompt }, ...messages];
    }

    let assistantContent = "";
    let toolIterations = 0;

    while (toolIterations < 8) {
      toolIterations += 1;
      const response = await createChatCompletion({
        model,
        messages,
        max_tokens: Number.isNaN(maxTokens) ? 512 : maxTokens,
        temperature: Number.isNaN(temperature) ? 0.2 : temperature,
        tools: toolSchemasV1(),
      });

      const choices = (response.choices as Array<Record<string, unknown>> | undefined) || [];
      const message = (choices[0]?.message as Record<string, unknown> | undefined) || {};
      const toolCalls = (message.tool_calls as Array<Record<string, unknown>> | undefined) || [];
      if (message.content) assistantContent = String(message.content);
      if (!toolCalls.length) break;
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
        const result = await executeTool(identity.uid, String(fn.name || ""), String(fn.arguments || ""));
        messages.push({
          role: "tool",
          tool_call_id: String(toolCall.id),
          content: JSON.stringify(result),
        });
      }
    }

    assistantContent = assistantContent.trim();
    if (!assistantContent) {
      if (toolIterations >= 8) {
        throw new Error("Agent loop hit the tool-call limit without a final assistant message");
      }
      throw new Error("Upstream response missing assistant message content");
    }

    const message = agentStore.appendMessage({
      conversation_id: conversationId,
      firebase_uid: identity.uid,
      role: "assistant",
      content: assistantContent,
    });

    return NextResponse.json({ message, model });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
