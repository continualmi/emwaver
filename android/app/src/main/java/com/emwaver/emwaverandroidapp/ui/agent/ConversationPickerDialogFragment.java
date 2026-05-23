/*
 * EMWaver
 * Copyright (c) 2026 Luis Marnoto
 * SPDX-License-Identifier: Apache-2.0
 */

package com.emwaver.emwaverandroidapp.ui.agent;

import android.os.Bundle;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.ImageButton;
import android.widget.TextView;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.lifecycle.ViewModelProvider;
import androidx.recyclerview.widget.LinearLayoutManager;
import androidx.recyclerview.widget.RecyclerView;

import com.emwaver.emwaverandroidapp.R;
import com.emwaver.emwaverandroidapp.agent.AgentConversationInfo;
import com.google.android.material.bottomsheet.BottomSheetDialogFragment;

import java.util.ArrayList;
import java.util.List;

public class ConversationPickerDialogFragment extends BottomSheetDialogFragment {

    public interface Listener {
        void onConversationSelected(@NonNull String conversationId);
        void onConversationDelete(@NonNull String conversationId);
    }

    @Nullable private Listener listener;

    public void setListener(@Nullable Listener listener) {
        this.listener = listener;
    }

    @Nullable
    @Override
    public View onCreateView(
            @NonNull LayoutInflater inflater,
            @Nullable ViewGroup container,
            @Nullable Bundle savedInstanceState
    ) {
        return inflater.inflate(R.layout.dialog_conversation_picker, container, false);
    }

    @Override
    public void onViewCreated(@NonNull View view, @Nullable Bundle savedInstanceState) {
        super.onViewCreated(view, savedInstanceState);

        AgentChatViewModel viewModel = new ViewModelProvider(requireActivity()).get(AgentChatViewModel.class);

        RecyclerView recyclerView = view.findViewById(R.id.conversation_picker_list);
        recyclerView.setLayoutManager(new LinearLayoutManager(requireContext()));

        ConversationAdapter adapter = new ConversationAdapter();
        recyclerView.setAdapter(adapter);

        // Observe conversations
        viewModel.getConversations().observe(getViewLifecycleOwner(), conversations -> {
            adapter.setConversations(conversations);
        });

        view.findViewById(R.id.conversation_picker_close).setOnClickListener(v -> dismiss());

        // Refresh on first load
        viewModel.refreshConversations();
    }

    private class ConversationAdapter extends RecyclerView.Adapter<ConversationAdapter.ViewHolder> {

        private final List<AgentConversationInfo> conversations = new ArrayList<>();

        void setConversations(@Nullable List<AgentConversationInfo> list) {
            conversations.clear();
            if (list != null) conversations.addAll(list);
            notifyDataSetChanged();
        }

        @NonNull
        @Override
        public ViewHolder onCreateViewHolder(@NonNull ViewGroup parent, int viewType) {
            View v = LayoutInflater.from(parent.getContext())
                    .inflate(R.layout.item_conversation_picker, parent, false);
            return new ViewHolder(v);
        }

        @Override
        public void onBindViewHolder(@NonNull ViewHolder holder, int position) {
            holder.bind(conversations.get(position));
        }

        @Override
        public int getItemCount() {
            return conversations.size();
        }

        class ViewHolder extends RecyclerView.ViewHolder {
            private final TextView title;
            private final ImageButton deleteButton;

            ViewHolder(@NonNull View itemView) {
                super(itemView);
                title = itemView.findViewById(R.id.conversation_item_title);
                deleteButton = itemView.findViewById(R.id.conversation_item_delete);
            }

            void bind(@NonNull AgentConversationInfo convo) {
                title.setText(convo.displayTitle());

                // Select conversation on row click
                itemView.setOnClickListener(v -> {
                    if (listener != null) {
                        listener.onConversationSelected(convo.id.toString());
                    }
                    dismiss();
                });

                // Delete conversation on delete button click
                deleteButton.setOnClickListener(v -> {
                    if (listener != null) {
                        listener.onConversationDelete(convo.id.toString());
                    }
                    // Remove from list immediately for responsive UX
                    int idx = conversations.indexOf(convo);
                    if (idx >= 0) {
                        conversations.remove(idx);
                        notifyItemRemoved(idx);
                    }
                });
            }
        }
    }
}
