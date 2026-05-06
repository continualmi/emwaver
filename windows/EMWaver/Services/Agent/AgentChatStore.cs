using System;
using System.Collections.Generic;
using System.IO;
using Microsoft.Data.Sqlite;

namespace EMWaver.Services.Agent;

internal sealed class AgentChatStore
{
    private readonly string _dbPath;

    internal AgentChatStore() : this(DefaultPath())
    {
    }

    internal AgentChatStore(string dbPath)
    {
        _dbPath = dbPath;
        Directory.CreateDirectory(Path.GetDirectoryName(_dbPath) ?? ".");
        Migrate();
    }

    internal List<AgentApi.Conversation> ListConversations()
    {
        using var db = Open();
        using var cmd = db.CreateCommand();
        cmd.CommandText = """
            select id, title, created_at_ms, updated_at_ms
            from agent_conversations
            where archived_at_ms is null
            order by updated_at_ms desc
            """;

        using var reader = cmd.ExecuteReader();
        var outRows = new List<AgentApi.Conversation>();
        while (reader.Read())
        {
            outRows.Add(new AgentApi.Conversation(
                reader.GetString(0),
                reader.IsDBNull(1) ? null : reader.GetString(1),
                reader.GetInt64(2),
                reader.GetInt64(3)));
        }
        return outRows;
    }

    internal AgentApi.Conversation CreateConversation(string? title)
    {
        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        var trimmed = (title ?? "").Trim();
        if (trimmed.Length > 48) trimmed = trimmed[..48].Trim();

        var conversation = new AgentApi.Conversation(
            Guid.NewGuid().ToString("D"),
            string.IsNullOrWhiteSpace(trimmed) ? "Chat" : trimmed,
            now,
            now);

        UpsertConversation(conversation);
        return conversation;
    }

    internal void UpsertConversation(AgentApi.Conversation conversation)
    {
        using var db = Open();
        using var cmd = db.CreateCommand();
        cmd.CommandText = """
            insert into agent_conversations (id, title, created_at_ms, updated_at_ms)
            values ($id, $title, $created, $updated)
            on conflict(id) do update set
              title = excluded.title,
              updated_at_ms = excluded.updated_at_ms,
              archived_at_ms = null
            """;
        cmd.Parameters.AddWithValue("$id", conversation.Id);
        cmd.Parameters.AddWithValue("$title", (object?)conversation.Title ?? DBNull.Value);
        cmd.Parameters.AddWithValue("$created", conversation.CreatedAtMs);
        cmd.Parameters.AddWithValue("$updated", conversation.UpdatedAtMs);
        cmd.ExecuteNonQuery();
    }

    internal void ArchiveConversation(string conversationId)
    {
        using var db = Open();
        using var cmd = db.CreateCommand();
        cmd.CommandText = "update agent_conversations set archived_at_ms = $archived where id = $id";
        cmd.Parameters.AddWithValue("$archived", DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
        cmd.Parameters.AddWithValue("$id", conversationId);
        cmd.ExecuteNonQuery();
    }

    internal List<AgentApi.Message> ListMessages(string conversationId)
    {
        using var db = Open();
        using var cmd = db.CreateCommand();
        cmd.CommandText = """
            select id, role, content, created_at_ms
            from agent_messages
            where conversation_id = $conversation
            order by created_at_ms asc
            """;
        cmd.Parameters.AddWithValue("$conversation", conversationId);

        using var reader = cmd.ExecuteReader();
        var rows = new List<AgentApi.Message>();
        while (reader.Read())
        {
            rows.Add(new AgentApi.Message(
                reader.GetString(0),
                reader.GetString(1),
                reader.GetString(2),
                reader.GetInt64(3)));
        }
        return rows;
    }

    internal AgentApi.Message AppendMessage(string conversationId, string role, string content)
    {
        var message = new AgentApi.Message(
            Guid.NewGuid().ToString("D"),
            role,
            content,
            DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
        UpsertMessage(conversationId, message);
        return message;
    }

    internal void UpsertMessage(string conversationId, AgentApi.Message message)
    {
        using var db = Open();
        using var tx = db.BeginTransaction();
        using (var cmd = db.CreateCommand())
        {
            cmd.Transaction = tx;
            cmd.CommandText = """
                insert into agent_messages (id, conversation_id, role, content, created_at_ms)
                values ($id, $conversation, $role, $content, $created)
                on conflict(id) do update set
                  role = excluded.role,
                  content = excluded.content,
                  created_at_ms = excluded.created_at_ms
                """;
            cmd.Parameters.AddWithValue("$id", message.Id);
            cmd.Parameters.AddWithValue("$conversation", conversationId);
            cmd.Parameters.AddWithValue("$role", message.Role);
            cmd.Parameters.AddWithValue("$content", message.Content);
            cmd.Parameters.AddWithValue("$created", message.CreatedAtMs);
            cmd.ExecuteNonQuery();
        }
        using (var touch = db.CreateCommand())
        {
            touch.Transaction = tx;
            touch.CommandText = "update agent_conversations set updated_at_ms = $updated where id = $id";
            touch.Parameters.AddWithValue("$updated", message.CreatedAtMs);
            touch.Parameters.AddWithValue("$id", conversationId);
            touch.ExecuteNonQuery();
        }
        tx.Commit();
    }

    private SqliteConnection Open()
    {
        var db = new SqliteConnection($"Data Source={_dbPath}");
        db.Open();
        using var pragma = db.CreateCommand();
        pragma.CommandText = "pragma journal_mode = wal; pragma foreign_keys = on";
        pragma.ExecuteNonQuery();
        return db;
    }

    private void Migrate()
    {
        using var db = Open();
        using var cmd = db.CreateCommand();
        cmd.CommandText = """
            create table if not exists agent_conversations (
              id text primary key,
              title text,
              created_at_ms integer not null,
              updated_at_ms integer not null,
              archived_at_ms integer
            );
            create table if not exists agent_messages (
              id text primary key,
              conversation_id text not null references agent_conversations(id) on delete cascade,
              role text not null,
              content text not null,
              created_at_ms integer not null,
              metadata_json text
            );
            create index if not exists idx_agent_messages_conversation_created on agent_messages(conversation_id, created_at_ms);
            create index if not exists idx_agent_conversations_updated on agent_conversations(updated_at_ms desc);
            """;
        cmd.ExecuteNonQuery();
    }

    private static string DefaultPath()
    {
        return Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "EMWaver",
            "agent-chat.sqlite");
    }
}
