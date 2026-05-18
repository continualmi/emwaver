/*
 * EMWaver
 * Copyright (c) 2026 Luis Marnoto
 * SPDX-License-Identifier: Apache-2.0
 */

import Foundation
import SQLite3

struct StoredAgentConversation: Equatable {
    let id: UUID
    let universeId: String?
    let title: String
    let createdAt: Date
    let updatedAt: Date
}

final class AgentChatStore {
    enum StoreError: Error {
        case openFailed(String)
        case prepareFailed(String)
        case stepFailed(String)
    }

    static let shared = AgentChatStore()

    private let dbURL: URL
    private var db: OpaquePointer?
    private let decoder = JSONDecoder()
    private let encoder = JSONEncoder()

    init(fileManager: FileManager = .default) {
        let base = fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? fileManager.urls(for: .documentDirectory, in: .userDomainMask).first
            ?? URL(fileURLWithPath: NSTemporaryDirectory())
        let dir = base.appendingPathComponent("EMWaver", isDirectory: true)
        try? fileManager.createDirectory(at: dir, withIntermediateDirectories: true)
        self.dbURL = dir.appendingPathComponent("agent-chat.sqlite")
        try? open()
        try? migrate()
    }

    deinit {
        if let db {
            sqlite3_close(db)
        }
    }

    func conversations() throws -> [StoredAgentConversation] {
        try query(
            """
            select id, universe_id, title, created_at, updated_at
            from agent_conversations
            where archived_at is null
            order by updated_at desc
            """
        ) { stmt in
            guard let id = UUID(uuidString: text(stmt, 0) ?? "") else { return nil }
            return StoredAgentConversation(
                id: id,
                universeId: text(stmt, 1),
                title: text(stmt, 2) ?? "Chat",
                createdAt: Date(timeIntervalSince1970: sqlite3_column_double(stmt, 3)),
                updatedAt: Date(timeIntervalSince1970: sqlite3_column_double(stmt, 4))
            )
        }
    }

    func messages(conversationId: UUID) throws -> [AgentChatMessage] {
        try query(
            """
            select id, role, text, created_at, metadata_json
            from agent_messages
            where conversation_id = ?
            order by created_at asc
            """,
            bindings: [.text(conversationId.uuidString)]
        ) { stmt in
            guard let id = UUID(uuidString: text(stmt, 0) ?? ""),
                  let roleRaw = text(stmt, 1),
                  let role = AgentChatRole(rawValue: roleRaw) else {
                return nil
            }
            return AgentChatMessage(
                id: id,
                role: role,
                text: text(stmt, 2) ?? "",
                createdAt: Date(timeIntervalSince1970: sqlite3_column_double(stmt, 3)),
                toolMeta: decodeToolMeta(text(stmt, 4))
            )
        }
    }

    func upsertConversation(_ conversation: StoredAgentConversation) throws {
        try execute(
            """
            insert into agent_conversations (id, universe_id, title, created_at, updated_at)
            values (?, ?, ?, ?, ?)
            on conflict(id) do update set
              universe_id = excluded.universe_id,
              title = excluded.title,
              updated_at = excluded.updated_at,
              archived_at = null
            """,
            [
                .text(conversation.id.uuidString),
                .optionalText(conversation.universeId),
                .text(conversation.title),
                .double(conversation.createdAt.timeIntervalSince1970),
                .double(conversation.updatedAt.timeIntervalSince1970),
            ]
        )
    }

    func upsertMessage(_ message: AgentChatMessage, conversationId: UUID) throws {
        try execute(
            """
            insert into agent_messages (id, conversation_id, role, text, created_at, metadata_json)
            values (?, ?, ?, ?, ?, ?)
            on conflict(id) do update set
              role = excluded.role,
              text = excluded.text,
              created_at = excluded.created_at,
              metadata_json = excluded.metadata_json
            """,
            [
                .text(message.id.uuidString),
                .text(conversationId.uuidString),
                .text(message.role.rawValue),
                .text(message.text),
                .double(message.createdAt.timeIntervalSince1970),
                .optionalText(encodeToolMeta(message.toolMeta)),
            ]
        )
    }

    func archiveConversation(_ id: UUID) throws {
        try execute(
            "update agent_conversations set archived_at = ? where id = ?",
            [.double(Date().timeIntervalSince1970), .text(id.uuidString)]
        )
    }

    private func open() throws {
        if db != nil { return }
        if sqlite3_open(dbURL.path, &db) != SQLITE_OK {
            throw StoreError.openFailed(lastError)
        }
        try execute("pragma journal_mode = wal")
        try execute("pragma foreign_keys = on")
    }

    private func migrate() throws {
        try execute(
            """
            create table if not exists agent_conversations (
              id text primary key,
              universe_id text,
              title text not null,
              created_at real not null,
              updated_at real not null,
              archived_at real
            )
            """
        )
        try execute(
            """
            create table if not exists agent_messages (
              id text primary key,
              conversation_id text not null references agent_conversations(id) on delete cascade,
              role text not null,
              text text not null,
              created_at real not null,
              metadata_json text
            )
            """
        )
        try execute("create index if not exists idx_agent_messages_conversation_created on agent_messages(conversation_id, created_at)")
        try execute("create index if not exists idx_agent_conversations_updated on agent_conversations(updated_at desc)")
    }

    private enum Binding {
        case text(String)
        case optionalText(String?)
        case double(Double)
    }

    private func execute(_ sql: String, _ bindings: [Binding] = []) throws {
        var stmt: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else {
            throw StoreError.prepareFailed(lastError)
        }
        defer { sqlite3_finalize(stmt) }
        bind(bindings, to: stmt)
        guard sqlite3_step(stmt) == SQLITE_DONE else {
            throw StoreError.stepFailed(lastError)
        }
    }

    private func query<T>(_ sql: String, bindings: [Binding] = [], row: (OpaquePointer?) -> T?) throws -> [T] {
        var stmt: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else {
            throw StoreError.prepareFailed(lastError)
        }
        defer { sqlite3_finalize(stmt) }
        bind(bindings, to: stmt)
        var out: [T] = []
        while sqlite3_step(stmt) == SQLITE_ROW {
            if let value = row(stmt) {
                out.append(value)
            }
        }
        return out
    }

    private func bind(_ bindings: [Binding], to stmt: OpaquePointer?) {
        for (index, binding) in bindings.enumerated() {
            let i = Int32(index + 1)
            switch binding {
            case .text(let value):
                sqlite3_bind_text(stmt, i, value, -1, SQLITE_TRANSIENT)
            case .optionalText(let value):
                if let value {
                    sqlite3_bind_text(stmt, i, value, -1, SQLITE_TRANSIENT)
                } else {
                    sqlite3_bind_null(stmt, i)
                }
            case .double(let value):
                sqlite3_bind_double(stmt, i, value)
            }
        }
    }

    private func text(_ stmt: OpaquePointer?, _ column: Int32) -> String? {
        guard let cString = sqlite3_column_text(stmt, column) else { return nil }
        return String(cString: cString)
    }

    private func encodeToolMeta(_ meta: AgentChatToolMeta?) -> String? {
        guard let meta, let data = try? encoder.encode(meta) else { return nil }
        return String(data: data, encoding: .utf8)
    }

    private func decodeToolMeta(_ raw: String?) -> AgentChatToolMeta? {
        guard let raw, let data = raw.data(using: .utf8) else { return nil }
        return try? decoder.decode(AgentChatToolMeta.self, from: data)
    }

    private var lastError: String {
        guard let db else { return "SQLite database is not open" }
        return String(cString: sqlite3_errmsg(db))
    }
}

private let SQLITE_TRANSIENT = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
