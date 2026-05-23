/*
 * EMWaver
 * Copyright (c) 2026 Luis Marnoto
 * SPDX-License-Identifier: Apache-2.0
 */

package com.emwaver.emwaverandroidapp.ui.agent;

import android.os.Bundle;
import android.text.TextUtils;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.view.inputmethod.EditorInfo;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.core.content.ContextCompat;
import androidx.lifecycle.ViewModelProvider;
import androidx.recyclerview.widget.LinearLayoutManager;
import androidx.recyclerview.widget.RecyclerView;

import com.emwaver.emwaverandroidapp.R;
import com.emwaver.emwaverandroidapp.agent.AgentChatMessage;
import com.emwaver.emwaverandroidapp.agent.AgentChatRole;
import com.emwaver.emwaverandroidapp.agent.AgentChatToolMeta;
import com.emwaver.emwaverandroidapp.agent.AgentConversationInfo;
import com.emwaver.emwaverandroidapp.agent.AgentToolJSON;

import java.util.Map;
import java.util.UUID;
import com.emwaver.emwaverandroidapp.agent.AgentToolJSON;
import com.emwaver.emwaverandroidapp.ui.scripts.ScriptsViewModel;
import com.google.android.material.bottomsheet.BottomSheetDialogFragment;
import com.google.android.material.button.MaterialButton;
import com.google.android.material.floatingactionbutton.FloatingActionButton;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import io.noties.markwon.Markwon;

public class AgentChatBottomSheetDialogFragment extends BottomSheetDialogFragment {

    private AgentChatViewModel viewModel;
    private ScriptsViewModel scriptsViewModel;

    // Views
    private RecyclerView recyclerView;
    private EditText input;
    private MaterialButton sendButton;
    private MaterialButton stopButton;
    private MaterialButton clearButton;
    private MaterialButton conversationsButton;
    private MaterialButton newButton;
    private MaterialButton getKeyButton;
    private LinearLayout proNotice;
    private LinearLayout errorBubble;
    private TextView errorText;
    private LinearLayout suggestions;
    private View loadingOverlay;
    private FloatingActionButton scrollFab;

    private MessagesAdapter adapter;
    private Markwon markwon;
    private boolean isScrolledToBottom = true;

    @Nullable
    @Override
    public View onCreateView(
            @NonNull LayoutInflater inflater,
            @Nullable ViewGroup container,
            @Nullable Bundle savedInstanceState
    ) {
        return inflater.inflate(R.layout.dialog_agent_chat, container, false);
    }

    @Override
    public void onViewCreated(@NonNull View view, @Nullable Bundle savedInstanceState) {
        super.onViewCreated(view, savedInstanceState);

        viewModel = new ViewModelProvider(requireActivity()).get(AgentChatViewModel.class);
        scriptsViewModel = new ViewModelProvider(requireActivity()).get(ScriptsViewModel.class);

        markwon = Markwon.create(requireContext());

        // Find views
        recyclerView = view.findViewById(R.id.agent_chat_list);
        input = view.findViewById(R.id.agent_chat_input);
        sendButton = view.findViewById(R.id.agent_chat_send);
        stopButton = view.findViewById(R.id.agent_chat_stop);
        clearButton = view.findViewById(R.id.agent_chat_clear);
        conversationsButton = view.findViewById(R.id.agent_chat_conversations);
        newButton = view.findViewById(R.id.agent_chat_new);
        getKeyButton = view.findViewById(R.id.agent_chat_get_key);
        proNotice = view.findViewById(R.id.agent_chat_pro_notice);
        errorBubble = view.findViewById(R.id.agent_chat_error_bubble);
        errorText = view.findViewById(R.id.agent_chat_error_text);
        suggestions = view.findViewById(R.id.agent_chat_suggestions);
        loadingOverlay = view.findViewById(R.id.agent_chat_loading_overlay);
        scrollFab = view.findViewById(R.id.agent_chat_scroll_fab);

        // RecyclerView setup
        adapter = new MessagesAdapter();
        LinearLayoutManager layoutManager = new LinearLayoutManager(requireContext());
        recyclerView.setLayoutManager(layoutManager);
        recyclerView.setAdapter(adapter);

        // Scroll detection for FAB
        recyclerView.addOnScrollListener(new RecyclerView.OnScrollListener() {
            @Override
            public void onScrolled(@NonNull RecyclerView rv, int dx, int dy) {
                LinearLayoutManager lm = (LinearLayoutManager) rv.getLayoutManager();
                if (lm == null) return;
                int lastVisible = lm.findLastCompletelyVisibleItemPosition();
                int total = adapter.getItemCount();
                boolean atBottom = lastVisible >= total - 1 || total == 0;
                if (atBottom != isScrolledToBottom) {
                    isScrolledToBottom = atBottom;
                    if (scrollFab != null) {
                        scrollFab.setVisibility(atBottom ? View.GONE : View.VISIBLE);
                    }
                }
            }
        });

        // Messages observer
        viewModel.getMessages().observe(getViewLifecycleOwner(), messages -> {
            adapter.setMessages(messages);
            boolean empty = messages == null || messages.isEmpty();
            if (suggestions != null) {
                suggestions.setVisibility(empty ? View.VISIBLE : View.GONE);
            }
            if (messages != null && !messages.isEmpty()) {
                recyclerView.scrollToPosition(messages.size() - 1);
                isScrolledToBottom = true;
            }
        });

        // Error observer
        viewModel.getLastError().observe(getViewLifecycleOwner(), err -> {
            if (err != null && !err.isEmpty()) {
                if (errorBubble != null) {
                    errorBubble.setVisibility(View.VISIBLE);
                }
                if (errorText != null) {
                    errorText.setText(err);
                }
            } else {
                if (errorBubble != null) {
                    errorBubble.setVisibility(View.GONE);
                }
            }
        });

        // Sending state observer
        viewModel.getIsSending().observe(getViewLifecycleOwner(), sending -> {
            boolean isSending = sending != null && sending;
            if (sendButton != null) sendButton.setVisibility(isSending ? View.GONE : View.VISIBLE);
            if (stopButton != null) stopButton.setVisibility(isSending ? View.VISIBLE : View.GONE);
        });

        // Loading conversation observer
        viewModel.getIsLoadingConversation().observe(getViewLifecycleOwner(), loading -> {
            boolean isLoading = loading != null && loading;
            if (loadingOverlay != null) {
                loadingOverlay.setVisibility(isLoading ? View.VISIBLE : View.GONE);
            }
        });

        // Conversations observer
        viewModel.getConversations().observe(getViewLifecycleOwner(), list -> {
            updateConversationButton(list);
        });

        // Pro notice
        updateProNotice();

        // Click listeners
        if (sendButton != null) {
            sendButton.setOnClickListener(v -> sendNow());
        }
        if (stopButton != null) {
            stopButton.setOnClickListener(v -> viewModel.stop());
        }
        if (input != null) {
            input.setOnEditorActionListener((v, actionId, event) -> {
                if (actionId == EditorInfo.IME_ACTION_SEND) {
                    sendNow();
                    return true;
                }
                return false;
            });
        }
        if (clearButton != null) {
            clearButton.setOnClickListener(v -> viewModel.clear());
        }
        if (newButton != null) {
            newButton.setOnClickListener(v -> viewModel.newChat());
        }
        if (conversationsButton != null) {
            conversationsButton.setOnClickListener(v -> showConversationsPicker());
        }
        if (getKeyButton != null) {
            getKeyButton.setOnClickListener(v -> {
                // Navigate to settings / API key screen
                dismiss();
            });
        }
        if (scrollFab != null) {
            scrollFab.setOnClickListener(v -> scrollToBottom());
        }

        // Suggestion cards
        bindSuggestionCard(view, R.id.agent_suggestion_usb, "How do I connect an EMWaver device over USB?");
        bindSuggestionCard(view, R.id.agent_suggestion_script, "Help me write a script for a connected board.");
        bindSuggestionCard(view, R.id.agent_suggestion_gpio, "Help me write a script to blink a GPIO pin.");
        bindSuggestionCard(view, R.id.agent_suggestion_ir, "How do I capture and replay an IR remote?");

        viewModel.bootstrap();
    }

    private void updateProNotice() {
        if (proNotice == null) return;
        boolean configured = viewModel.isAgentConfigured();
        proNotice.setVisibility(configured ? View.GONE : View.VISIBLE);
    }

    private void updateConversationButton(@Nullable List<AgentConversationInfo> list) {
        if (conversationsButton == null) return;
        String label = "Chats";
        UUID selectedId = viewModel.getSelectedConversationId();
        if (selectedId != null && list != null) {
            for (AgentConversationInfo c : list) {
                if (c.id.equals(selectedId)) {
                    label = c.displayTitle();
                    break;
                }
            }
        }
        conversationsButton.setText(label);
    }

    private void bindSuggestionCard(@NonNull View root, int viewId, @NonNull String text) {
        LinearLayout card = root.findViewById(viewId);
        if (card == null) return;
        card.setOnClickListener(v -> {
            if (input != null) {
                // Get the text from the TextView inside the card
                TextView tv = (TextView) ((LinearLayout) v).getChildAt(1);
                String label = tv != null ? tv.getText().toString() : text;
                input.setText(label);
                input.setSelection(input.getText() != null ? input.getText().length() : 0);
                input.requestFocus();
            }
        });
    }

    private void showConversationsPicker() {
        List<AgentConversationInfo> list = viewModel.getConversations().getValue();
        if (list == null || list.isEmpty()) {
            viewModel.refreshConversations();
            return;
        }

        String[] items = new String[list.size()];
        for (int i = 0; i < list.size(); i++) {
            items[i] = list.get(i).displayTitle();
        }

        new androidx.appcompat.app.AlertDialog.Builder(requireContext())
                .setTitle("Conversations")
                .setItems(items, (d, which) -> {
                    if (which >= 0 && which < list.size()) {
                        viewModel.selectConversation(list.get(which).id);
                    }
                })
                .setPositiveButton("Refresh", (d, w) -> viewModel.refreshConversations())
                .setNegativeButton("Close", null)
                .show();
    }

    private void sendNow() {
        if (input == null) return;
        String text = input.getText() != null ? input.getText().toString() : "";
        if (TextUtils.isEmpty(text.trim())) return;

        // Update pro notice (may disappear once key is configured)
        updateProNotice();

        viewModel.setScriptContext(
                scriptsViewModel.getLastScriptName(),
                scriptsViewModel.getLastScriptContent());
        viewModel.send(text);
        input.setText("");
    }

    private void scrollToBottom() {
        if (adapter.getItemCount() > 0) {
            recyclerView.scrollToPosition(adapter.getItemCount() - 1);
        }
    }

    // ── RecyclerView Adapter ────────────────────────────────────────

    private final class MessagesAdapter extends RecyclerView.Adapter<MessageViewHolder> {
        private final List<AgentChatMessage> messages = new ArrayList<>();

        void setMessages(@Nullable List<AgentChatMessage> updated) {
            messages.clear();
            if (updated != null) messages.addAll(updated);
            notifyDataSetChanged();
        }

        @Override
        public int getItemViewType(int position) {
            AgentChatMessage msg = messages.get(position);
            if (msg.role == AgentChatRole.USER) return 0;
            if (msg.role == AgentChatRole.SYSTEM) return 2;
            return 1;
        }

        @NonNull
        @Override
        public MessageViewHolder onCreateViewHolder(@NonNull ViewGroup parent, int viewType) {
            View v = LayoutInflater.from(parent.getContext())
                    .inflate(R.layout.item_agent_chat_message, parent, false);
            return new MessageViewHolder(v);
        }

        @Override
        public void onBindViewHolder(@NonNull MessageViewHolder holder, int position) {
            holder.bind(messages.get(position));
        }

        @Override
        public int getItemCount() {
            return messages.size();
        }
    }

    private final class MessageViewHolder extends RecyclerView.ViewHolder {
        private final View agentContainer;
        private final View userContainer;
        private final TextView agentText;
        private final TextView userText;
        private final View toolHeader;
        private final TextView toolName;
        private final TextView toolExpand;
        private final View toolDetails;
        private final TextView toolArgsLabel;
        private final TextView toolArgs;
        private final TextView toolOutputLabel;
        private final TextView toolOutput;
        private final TextView toolErrorLabel;
        private final TextView toolError;

        private boolean toolExpanded;

        MessageViewHolder(@NonNull View itemView) {
            super(itemView);
            agentContainer = itemView.findViewById(R.id.agent_chat_bubble_container);
            userContainer = itemView.findViewById(R.id.agent_chat_user_bubble);
            agentText = itemView.findViewById(R.id.agent_chat_text);
            userText = itemView.findViewById(R.id.agent_chat_user_text);
            toolHeader = itemView.findViewById(R.id.agent_chat_tool_header);
            toolName = itemView.findViewById(R.id.agent_chat_tool_name);
            toolExpand = itemView.findViewById(R.id.agent_chat_tool_expand);
            toolDetails = itemView.findViewById(R.id.agent_chat_tool_details);
            toolArgsLabel = itemView.findViewById(R.id.agent_chat_tool_args_label);
            toolArgs = itemView.findViewById(R.id.agent_chat_tool_args);
            toolOutputLabel = itemView.findViewById(R.id.agent_chat_tool_output_label);
            toolOutput = itemView.findViewById(R.id.agent_chat_tool_output);
            toolErrorLabel = itemView.findViewById(R.id.agent_chat_tool_error_label);
            toolError = itemView.findViewById(R.id.agent_chat_tool_error);
        }

        void bind(@NonNull AgentChatMessage msg) {
            boolean isUser = msg.role == AgentChatRole.USER;
            boolean isTool = msg.role == AgentChatRole.SYSTEM;

            // Reset visibility
            agentContainer.setVisibility(isUser ? View.GONE : View.VISIBLE);
            userContainer.setVisibility(isUser ? View.VISIBLE : View.GONE);

            if (isUser) {
                // User message — simple text
                userText.setText(msg.text);
            } else if (isTool) {
                // Tool bubble
                agentText.setVisibility(View.GONE);
                toolHeader.setVisibility(View.VISIBLE);
                toolName.setText(extractToolName(msg.text));

                // Tool details
                toolExpanded = false;
                toolDetails.setVisibility(View.GONE);
                toolExpand.setText("▸");

                if (msg.toolMeta != null) {
                    if (msg.toolMeta.arguments != null && !msg.toolMeta.arguments.isEmpty()) {
                        toolArgsLabel.setVisibility(View.VISIBLE);
                        toolArgs.setVisibility(View.VISIBLE);
                        toolArgs.setText(formatToolJson(msg.toolMeta.arguments));
                    } else {
                        toolArgsLabel.setVisibility(View.GONE);
                        toolArgs.setVisibility(View.GONE);
                    }

                    if (msg.toolMeta.output != null) {
                        boolean isOk = msg.toolMeta.ok != null && msg.toolMeta.ok;
                        if (isOk) {
                            toolOutputLabel.setVisibility(View.VISIBLE);
                            toolOutput.setVisibility(View.VISIBLE);
                            toolOutput.setText(formatToolJsonValue(msg.toolMeta.output));
                            toolErrorLabel.setVisibility(View.GONE);
                            toolError.setVisibility(View.GONE);
                        } else {
                            toolErrorLabel.setVisibility(View.VISIBLE);
                            toolError.setVisibility(View.VISIBLE);
                            toolError.setText(formatToolJsonValue(msg.toolMeta.output));
                            toolOutputLabel.setVisibility(View.GONE);
                            toolOutput.setVisibility(View.GONE);
                        }
                    } else {
                        toolOutputLabel.setVisibility(View.GONE);
                        toolOutput.setVisibility(View.GONE);
                        toolErrorLabel.setVisibility(View.GONE);
                        toolError.setVisibility(View.GONE);
                    }
                } else {
                    toolArgsLabel.setVisibility(View.GONE);
                    toolArgs.setVisibility(View.GONE);
                    toolOutputLabel.setVisibility(View.GONE);
                    toolOutput.setVisibility(View.GONE);
                    toolErrorLabel.setVisibility(View.GONE);
                    toolError.setVisibility(View.GONE);
                }

                // Click to expand/collapse tool details
                toolHeader.setOnClickListener(v -> {
                    toolExpanded = !toolExpanded;
                    toolDetails.setVisibility(toolExpanded ? View.VISIBLE : View.GONE);
                    toolExpand.setText(toolExpanded ? "▾" : "▸");
                });

            } else {
                // Agent message — Markwon for markdown
                agentText.setVisibility(View.VISIBLE);
                toolHeader.setVisibility(View.GONE);
                toolDetails.setVisibility(View.GONE);
                markwon.setMarkdown(agentText, msg.text);
            }
        }

        @NonNull
        private String extractToolName(@NonNull String raw) {
            String t = raw.replace("[tool]", "").trim();
            return t.isEmpty() ? "Tool" : t;
        }

        @NonNull
        private String formatToolJson(@NonNull Map<String, AgentToolJSON> map) {
            StringBuilder sb = new StringBuilder();
            for (Map.Entry<String, AgentToolJSON> e : map.entrySet()) {
                sb.append(e.getKey()).append(": ").append(formatToolJsonValue(e.getValue())).append("\n");
            }
            return sb.toString().trim();
        }

        @NonNull
        private String formatToolJsonValue(@Nullable AgentToolJSON json) {
            if (json == null || json.isNull()) return "null";
            String s = json.asString();
            if (s != null) return s;
            Double n = json.asNumber();
            if (n != null) {
                if (n == Math.floor(n) && Math.abs(n) < 1e15) return String.valueOf(n.longValue());
                return String.valueOf(n);
            }
            Boolean b = json.asBool();
            if (b != null) return b ? "true" : "false";
            // For objects and arrays, use toString
            return json.toString();
        }
    }
}
