/*
 * EMWaver
 * Copyright (c) 2026 Luis Marnoto
 * SPDX-License-Identifier: Apache-2.0
 */

package com.emwaver.emwaverandroidapp.agent;

import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

public final class AgentChatStore extends SQLiteOpenHelper {
    private static final String DB_NAME = "agent-chat.sqlite";
    private static final int DB_VERSION = 1;

    private static volatile AgentChatStore instance;

    public static AgentChatStore getInstance(@NonNull Context context) {
        if (instance == null) {
            synchronized (AgentChatStore.class) {
                if (instance == null) {
                    instance = new AgentChatStore(context.getApplicationContext());
                }
            }
        }
        return instance;
    }

    private AgentChatStore(@NonNull Context context) {
        super(context, DB_NAME, null, DB_VERSION);
    }

    @Override
    public void onCreate(SQLiteDatabase db) {
        db.execSQL("create table if not exists agent_conversations (" +
                "id text primary key, " +
                "title text, " +
                "created_at_ms integer not null, " +
                "updated_at_ms integer not null, " +
                "archived_at_ms integer)");
        db.execSQL("create table if not exists agent_messages (" +
                "id text primary key, " +
                "conversation_id text not null references agent_conversations(id) on delete cascade, " +
                "role text not null, " +
                "content text not null, " +
                "created_at_ms integer not null, " +
                "metadata_json text)");
        db.execSQL("create index if not exists idx_agent_messages_conversation_created on agent_messages(conversation_id, created_at_ms)");
        db.execSQL("create index if not exists idx_agent_conversations_updated on agent_conversations(updated_at_ms desc)");
    }

    @Override
    public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) {
        onCreate(db);
    }

    @NonNull
    public List<AgentEndpointApi.Conversation> listConversations() {
        SQLiteDatabase db = getReadableDatabase();
        List<AgentEndpointApi.Conversation> rows = new ArrayList<>();
        try (Cursor c = db.rawQuery(
                "select id, title, created_at_ms, updated_at_ms from agent_conversations where archived_at_ms is null order by updated_at_ms desc",
                null)) {
            while (c.moveToNext()) {
                rows.add(new AgentEndpointApi.Conversation(
                        c.getString(0),
                        c.isNull(1) ? null : c.getString(1),
                        c.getLong(2),
                        c.getLong(3)));
            }
        }
        return rows;
    }

    @NonNull
    public AgentEndpointApi.Conversation createConversation(@Nullable String title) {
        long now = System.currentTimeMillis();
        String trimmed = title != null ? title.trim() : "";
        if (trimmed.length() > 48) trimmed = trimmed.substring(0, 48).trim();
        AgentEndpointApi.Conversation conversation = new AgentEndpointApi.Conversation(
                UUID.randomUUID().toString(),
                trimmed.isEmpty() ? "Chat" : trimmed,
                now,
                now);
        upsertConversation(conversation);
        return conversation;
    }

    public void upsertConversation(@NonNull AgentEndpointApi.Conversation conversation) {
        SQLiteDatabase db = getWritableDatabase();
        db.execSQL("insert or replace into agent_conversations (id, title, created_at_ms, updated_at_ms, archived_at_ms) values (?, ?, ?, ?, null)",
                new Object[]{conversation.id, conversation.title, conversation.createdAtMs, conversation.updatedAtMs});
    }

    public void archiveConversation(@NonNull String id) {
        SQLiteDatabase db = getWritableDatabase();
        db.execSQL("update agent_conversations set archived_at_ms = ? where id = ?",
                new Object[]{System.currentTimeMillis(), id});
    }

    @NonNull
    public List<AgentEndpointApi.Message> listMessages(@NonNull String conversationId) {
        SQLiteDatabase db = getReadableDatabase();
        List<AgentEndpointApi.Message> rows = new ArrayList<>();
        try (Cursor c = db.rawQuery(
                "select id, role, content, created_at_ms from agent_messages where conversation_id = ? order by created_at_ms asc",
                new String[]{conversationId})) {
            while (c.moveToNext()) {
                rows.add(new AgentEndpointApi.Message(c.getString(0), c.getString(1), c.getString(2), c.getLong(3)));
            }
        }
        return rows;
    }

    @NonNull
    public AgentEndpointApi.Message appendMessage(@NonNull String conversationId, @NonNull String role, @NonNull String content) {
        AgentEndpointApi.Message message = new AgentEndpointApi.Message(
                UUID.randomUUID().toString(),
                role,
                content,
                System.currentTimeMillis());
        upsertMessage(conversationId, message);
        return message;
    }

    public void upsertMessage(@NonNull String conversationId, @NonNull AgentEndpointApi.Message message) {
        SQLiteDatabase db = getWritableDatabase();
        db.beginTransaction();
        try {
            db.execSQL("insert or replace into agent_messages (id, conversation_id, role, content, created_at_ms) values (?, ?, ?, ?, ?)",
                    new Object[]{message.id, conversationId, message.role, message.content, message.createdAtMs});
            db.execSQL("update agent_conversations set updated_at_ms = ? where id = ?",
                    new Object[]{message.createdAtMs, conversationId});
            db.setTransactionSuccessful();
        } finally {
            db.endTransaction();
        }
    }
}
