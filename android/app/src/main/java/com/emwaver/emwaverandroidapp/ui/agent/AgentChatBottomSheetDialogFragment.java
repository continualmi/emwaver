/*
 * EMWaver
 * Copyright (c) 2026 Luis Marnoto
 * All rights reserved.
 */

package com.emwaver.emwaverandroidapp.ui.agent;

import android.os.Bundle;
import android.text.TextUtils;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.view.inputmethod.EditorInfo;
import android.widget.EditText;
import android.widget.ImageButton;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.lifecycle.ViewModelProvider;
import androidx.recyclerview.widget.LinearLayoutManager;
import androidx.recyclerview.widget.RecyclerView;

import com.emwaver.emwaverandroidapp.R;
import com.google.android.material.bottomsheet.BottomSheetDialogFragment;
import com.google.android.material.button.MaterialButton;

import java.util.ArrayList;
import java.util.List;

public class AgentChatBottomSheetDialogFragment extends BottomSheetDialogFragment {

    private AgentChatViewModel viewModel;

    private RecyclerView recyclerView;
    private EditText input;
    private ImageButton sendButton;
    private MaterialButton clearButton;

    private MessagesAdapter adapter;

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

        recyclerView = view.findViewById(R.id.agent_chat_list);
        input = view.findViewById(R.id.agent_chat_input);
        sendButton = view.findViewById(R.id.agent_chat_send);
        clearButton = view.findViewById(R.id.agent_chat_clear);

        adapter = new MessagesAdapter();
        recyclerView.setLayoutManager(new LinearLayoutManager(requireContext()));
        recyclerView.setAdapter(adapter);

        viewModel.getMessages().observe(getViewLifecycleOwner(), messages -> {
            adapter.setMessages(messages);
            if (messages != null && !messages.isEmpty()) {
                recyclerView.scrollToPosition(messages.size() - 1);
            }
        });

        if (sendButton != null) {
            sendButton.setOnClickListener(v -> sendNow());
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
    }

    private void sendNow() {
        if (input == null) {
            return;
        }
        String text = input.getText() != null ? input.getText().toString() : "";
        if (TextUtils.isEmpty(text.trim())) {
            return;
        }
        viewModel.sendUserMessage(text);
        input.setText("");
    }

    private static final class MessagesAdapter extends RecyclerView.Adapter<MessageViewHolder> {
        private final List<AgentChatViewModel.Message> messages = new ArrayList<>();

        void setMessages(@Nullable List<AgentChatViewModel.Message> updated) {
            messages.clear();
            if (updated != null) {
                messages.addAll(updated);
            }
            notifyDataSetChanged();
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

    private static final class MessageViewHolder extends RecyclerView.ViewHolder {
        private final View bubble;
        private final android.widget.TextView text;
        private final android.widget.FrameLayout row;

        MessageViewHolder(@NonNull View itemView) {
            super(itemView);
            row = itemView.findViewById(R.id.agent_chat_row);
            bubble = itemView.findViewById(R.id.agent_chat_bubble);
            text = itemView.findViewById(R.id.agent_chat_text);
        }

        void bind(@NonNull AgentChatViewModel.Message msg) {
            text.setText(msg.text);

            boolean isUser = msg.role == AgentChatViewModel.Role.USER;
            if (row != null) {
                android.widget.FrameLayout.LayoutParams lp =
                        (android.widget.FrameLayout.LayoutParams) bubble.getLayoutParams();
                lp.gravity = isUser ? android.view.Gravity.END : android.view.Gravity.START;
                bubble.setLayoutParams(lp);
            }

            bubble.setBackgroundResource(isUser ? R.drawable.user_message_bubble : R.drawable.agent_message_bubble);
            int color = androidx.core.content.ContextCompat.getColor(
                    itemView.getContext(),
                    isUser ? android.R.color.white : R.color.textPrimary
            );
            text.setTextColor(color);
        }
    }
}
