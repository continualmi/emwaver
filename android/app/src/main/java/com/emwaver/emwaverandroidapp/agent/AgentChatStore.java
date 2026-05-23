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

import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;

public final class AgentChatStore extends SQLiteOpenHelper {
    private static final String DB_NAME = "agent-chat.sqlite";
    private static final int DB_VERSION = 2;

    private static volatile AgentChatStore instance;

    @NonNull
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
                "universe_id text, " +
                "title text, " +
                "created_at_ms integer not null, " +
                "updated_at_ms integer not null, " +
                "archived_at_ms integer)");
        db.execSQL("create table if not exists agent_messages (" +
                "id text primary key, " +
                "conversation_id text not null references agent_conversations(id) on delete cascade, " +
                "role text not null, " +
                "text text not null, " +
                "created_at_ms integer not null, " +
                "metadata_json text)");
        db.execSQL("create index if not exists idx_agent_messages_conversation_created " +
                "on agent_messages(conversation_id, created_at_ms)");
        db.execSQL("create index if not exists idx_agent_conversations_updated " +
                "on agent_conversations(updated_at_ms desc)");
    }

    @Override
    public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) {
        if (oldVersion < 2) {
            // Add universe_id column to conversations
            try {
                db.execSQL("alter table agent_conversations add column universe_id text");
            } catch (Exception ignored) {}
            // Add metadata_json column to messages
            try {
                db.execSQL("alter table agent_messages add column metadata_json text");
            } catch (Exception ignored) {}
        }
    }

    // ── Conversations ───────────────────────────────────────────────

    @NonNull
    public List<AgentConversationInfo> listConversations() {
        SQLiteDatabase db = getReadableDatabase();
        List<AgentConversationInfo> rows = new ArrayList<>();
        try (Cursor c = db.rawQuery(
                "select id, universe_id, title, created_at_ms, updated_at_ms " +
                "from agent_conversations where archived_at_ms is null order by updated_at_ms desc",
                null)) {
            while (c.moveToNext()) {
                String idStr = c.getString(0);
                UUID id = safeUuid(idStr);
                if (id == null) continue;
                rows.add(new AgentConversationInfo(
                        id,
                        c.isNull(1) ? null : c.getString(1),
                        c.isNull(2) ? "Chat" : c.getString(2),
                        c.getLong(3),
                        c.getLong(4)));
            }
        }
        return rows;
    }

    @NonNull
    public AgentConversationInfo createConversation(@Nullable String title) {
        long now = System.currentTimeMillis();
        String trimmed = title != null ? title.trim() : "";
        if (trimmed.length() > 48) trimmed = trimmed.substring(0, 48).trim();
        UUID id = UUID.randomUUID();
        AgentConversationInfo conversation = new AgentConversationInfo(
                id, null,
                trimmed.isEmpty() ? "Chat" : trimmed,
                now, now);
        upsertConversation(conversation);
        return conversation;
    }

    public void upsertConversation(@NonNull AgentConversationInfo conversation) {
        SQLiteDatabase db = getWritableDatabase();
        db.execSQL("insert or replace into agent_conversations " +
                "(id, universe_id, title, created_at_ms, updated_at_ms, archived_at_ms) " +
                "values (?, ?, ?, ?, ?, null)",
                new Object[]{conversation.id.toString(), conversation.universeId,
                        conversation.title, conversation.createdAtMs, conversation.updatedAtMs});
    }

    public void archiveConversation(@NonNull String id) {
        SQLiteDatabase db = getWritableDatabase();
        db.execSQL("update agent_conversations set archived_at_ms = ? where id = ?",
                new Object[]{System.currentTimeMillis(), id});
    }

    // ── Messages ────────────────────────────────────────────────────

    @NonNull
    public List<AgentChatMessage> listMessages(@NonNull String conversationId) {
        SQLiteDatabase db = getReadableDatabase();
        List<AgentChatMessage> rows = new ArrayList<>();
        try (Cursor c = db.rawQuery(
                "select id, role, text, created_at_ms, metadata_json " +
                "from agent_messages where conversation_id = ? order by created_at_ms asc",
                new String[]{conversationId})) {
            while (c.moveToNext()) {
                UUID id = safeUuid(c.getString(0));
                if (id == null) continue;
                String roleRaw = c.getString(1);
                AgentChatRole role = AgentChatRole.fromApi(roleRaw != null ? roleRaw : "user");
                rows.add(new AgentChatMessage(
                        id, role,
                        c.isNull(2) ? "" : c.getString(2),
                        c.getLong(3),
                        parseToolMeta(c.isNull(4) ? null : c.getString(4))));
            }
        }
        return rows;
    }

    @NonNull
    public AgentChatMessage appendMessage(@NonNull String conversationId,
                                          @NonNull AgentChatRole role, @NonNull String content) {
        AgentChatMessage message = new AgentChatMessage(role, content);
        upsertMessage(conversationId, message);
        return message;
    }

    public void upsertMessage(@NonNull String conversationId, @NonNull AgentChatMessage message) {
        SQLiteDatabase db = getWritableDatabase();
        db.beginTransaction();
        try {
            db.execSQL("insert or replace into agent_messages " +
                    "(id, conversation_id, role, text, created_at_ms, metadata_json) " +
                    "values (?, ?, ?, ?, ?, ?)",
                    new Object[]{message.id.toString(), conversationId,
                            message.role.apiName, message.text, message.createdAtMs,
                            encodeToolMeta(message.toolMeta)});
            db.execSQL("update agent_conversations set updated_at_ms = ? where id = ?",
                    new Object[]{message.createdAtMs, conversationId});
            db.setTransactionSuccessful();
        } finally {
            db.endTransaction();
        }
    }

    public void updateMessage(@NonNull String conversationId, @NonNull AgentChatMessage message) {
        upsertMessage(conversationId, message);
    }

    // ── Tool-meta JSON helpers ──────────────────────────────────────

    @Nullable
    private static String encodeToolMeta(@Nullable AgentChatToolMeta meta) {
        if (meta == null) return null;
        try {
            JSONObject obj = new JSONObject();
            if (meta.arguments != null) {
                obj.put("arguments", AgentEndpointApi.toolJsonToOrg(meta.arguments));
            }
            if (meta.output != null) {
                obj.put("output", AgentEndpointApi.toolJsonToOrg(meta.output));
            }
            if (meta.ok != null) {
                obj.put("ok", meta.ok);
            }
            return obj.toString();
        } catch (Exception e) {
            return null;
        }
    }

    @Nullable
    private static AgentChatToolMeta parseToolMeta(@Nullable String raw) {
        if (raw == null || raw.trim().isEmpty()) return null;
        try {
            JSONObject obj = new JSONObject(raw);
            Map<String, AgentToolJSON> args = AgentEndpointApi.parseToolJsonMap(
                    obj.optJSONObject("arguments"));
            AgentToolJSON output = AgentEndpointApi.parseToolJson(obj.opt("output"));
            Boolean ok = obj.has("ok") ? obj.getBoolean("ok") : null;
            return new AgentChatToolMeta(args, output, ok);
        } catch (Exception e) {
            return null;
        }
    }

    @Nullable
    private static UUID safeUuid(@Nullable String s) {
        if (s == null) return null;
        try { return UUID.fromString(s); } catch (Exception e) { return null; }
    }
}
