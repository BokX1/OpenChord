import Database from "better-sqlite3";
import type { ChannelBinding, ChannelSession } from "../types.js";
import { ensureParentDir } from "../utils/file-system.js";
import { resolveStateDbPath } from "./paths.js";

function toChannelKey(guildId: string, channelId: string): string {
  return `${guildId}:${channelId}`;
}

const SESSION_SELECT = `
  SELECT
    channel_key AS channelKey,
    guild_id AS guildId,
    channel_id AS channelId,
    provider,
    model,
    thread_id AS threadId,
    last_seen_message_id AS lastSeenMessageId,
    updated_at AS updatedAt
  FROM channel_sessions
`;

export class StateDb {
  readonly db: Database.Database;

  constructor() {
    const filePath = resolveStateDbPath();
    ensureParentDir(filePath);
    this.db = new Database(filePath);
    this.db.pragma("journal_mode = WAL");
    this.initializeSchema();
  }

  private initializeSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS channel_sessions (
        channel_key TEXT PRIMARY KEY,
        guild_id TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        thread_id TEXT NOT NULL,
        last_seen_message_id TEXT,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS processed_messages (
        message_id TEXT PRIMARY KEY,
        channel_key TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
    `);
  }

  listSessions(): ChannelSession[] {
    return this.db.prepare(`${SESSION_SELECT} ORDER BY updated_at DESC, channel_key ASC`).all() as ChannelSession[];
  }

  getSession(binding: Pick<ChannelBinding, "guildId" | "channelId">): ChannelSession | null {
    const row = this.db
      .prepare(`${SESSION_SELECT} WHERE channel_key = ?`)
      .get(toChannelKey(binding.guildId, binding.channelId)) as ChannelSession | undefined;
    return row ?? null;
  }

  saveSession(session: ChannelSession): ChannelSession {
    this.db
      .prepare(`
        INSERT INTO channel_sessions (
          channel_key,
          guild_id,
          channel_id,
          provider,
          model,
          thread_id,
          last_seen_message_id,
          updated_at
        ) VALUES (
          @channelKey,
          @guildId,
          @channelId,
          @provider,
          @model,
          @threadId,
          @lastSeenMessageId,
          @updatedAt
        )
        ON CONFLICT(channel_key) DO UPDATE SET
          provider = excluded.provider,
          model = excluded.model,
          thread_id = excluded.thread_id,
          last_seen_message_id = excluded.last_seen_message_id,
          updated_at = excluded.updated_at
      `)
      .run(session);
    return session;
  }

  saveBindingSession(
    binding: Pick<ChannelBinding, "guildId" | "channelId">,
    params: { model: string; threadId: string; lastSeenMessageId: string | null },
  ): ChannelSession {
    const next: ChannelSession = {
      channelKey: toChannelKey(binding.guildId, binding.channelId),
      guildId: binding.guildId,
      channelId: binding.channelId,
      provider: "codex-app-server",
      model: params.model,
      threadId: params.threadId,
      lastSeenMessageId: params.lastSeenMessageId,
      updatedAt: Date.now(),
    };
    return this.saveSession(next);
  }

  deleteSession(binding: Pick<ChannelBinding, "guildId" | "channelId">): void {
    this.db.prepare("DELETE FROM channel_sessions WHERE channel_key = ?").run(
      toChannelKey(binding.guildId, binding.channelId),
    );
  }

  hasProcessedMessage(messageId: string): boolean {
    const row = this.db
      .prepare("SELECT 1 FROM processed_messages WHERE message_id = ?")
      .get(messageId) as Record<string, unknown> | undefined;
    return Boolean(row);
  }

  markProcessed(messageId: string, binding: Pick<ChannelBinding, "guildId" | "channelId">): void {
    this.db
      .prepare(
        "INSERT OR IGNORE INTO processed_messages (message_id, channel_key, created_at) VALUES (?, ?, ?)",
      )
      .run(messageId, toChannelKey(binding.guildId, binding.channelId), Date.now());
  }

  close(): void {
    this.db.close();
  }
}
