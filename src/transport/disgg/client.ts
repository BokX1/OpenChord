import type {
  ChannelBinding,
  DynamicToolExecutionResult,
  DynamicToolSpec,
  DisGgCallContext,
  DisGgTool,
  DiscordGuild,
  DiscordGuildChannel,
  DiscordMessage,
  BridgeConfig,
} from "../../types.js";

type ToolListResponse = { tools: DisGgTool[] };

type ClientOptions = {
  config: BridgeConfig;
  token: string;
};

export type DiscordPostedMessage = {
  id: string;
};

export type ExecutableTool = {
  metadata: DisGgTool;
  spec: DynamicToolSpec;
  execute: (args: Record<string, unknown>) => Promise<DynamicToolExecutionResult>;
};

const RETRYABLE_STATUS_CODES = new Set([408, 425, 429, 500, 502, 503, 504]);
const DEFAULT_RETRY_ATTEMPTS = 3;
const RETRY_BACKOFF_MS = 400;
const SAFE_REPLY_ALLOWED_MENTIONS = JSON.stringify({
  parse: [],
  replied_user: false,
});
const DISCORD_API_BASE_URL = "https://discord.com/api/v10";

function sanitizeSchemaNode(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { type: "object", properties: {}, additionalProperties: true };
  }

  const record = { ...(value as Record<string, unknown>) };

  if (record.type === "array" && !("items" in record)) {
    record.items = {};
  }

  if (record.type === "object") {
    if (!("properties" in record) || !record.properties || typeof record.properties !== "object" || Array.isArray(record.properties)) {
      record.properties = {};
    }
    const properties = record.properties as Record<string, unknown>;
    record.properties = Object.fromEntries(
      Object.entries(properties).map(([key, child]) => [key, sanitizeSchemaNode(child)]),
    );
    if (!("additionalProperties" in record)) {
      record.additionalProperties = true;
    }
  }

  if (record.items && typeof record.items === "object" && !Array.isArray(record.items)) {
    record.items = sanitizeSchemaNode(record.items);
  }

  for (const key of ["anyOf", "allOf", "oneOf"]) {
    if (Array.isArray(record[key])) {
      record[key] = (record[key] as unknown[]).map((entry) => sanitizeSchemaNode(entry));
    }
  }

  if (record.not && typeof record.not === "object" && !Array.isArray(record.not)) {
    record.not = sanitizeSchemaNode(record.not);
  }

  return record;
}

export class DisGgClient {
  constructor(private readonly options: ClientOptions) {}

  private async withReadRetry<T>(fn: () => Promise<T>): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt < DEFAULT_RETRY_ATTEMPTS; attempt += 1) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        if (!this.isRetryableError(error) || attempt === DEFAULT_RETRY_ATTEMPTS - 1) {
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, RETRY_BACKOFF_MS * (attempt + 1)));
      }
    }
    throw lastError;
  }

  private async post<T>(
    endpoint: string,
    body: Record<string, unknown>,
    context?: DisGgCallContext,
    headerOverrides?: Record<string, string>,
  ): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.config.transport.requestTimeoutMs);
    try {
      const response = await fetch(`${this.options.config.transport.serverUrl}/${endpoint}`, {
        method: "POST",
        headers: this.buildHeaders(context, headerOverrides),
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const text = await response.text();
      const parsed = text ? (JSON.parse(text) as unknown) : null;
      if (!response.ok) {
        const message =
          parsed && typeof parsed === "object" && "error" in parsed
            ? JSON.stringify((parsed as { error: unknown }).error)
            : text;
        const error = new Error(`mcp.dis.gg ${endpoint} failed (${response.status}): ${message}`) as Error & {
          status?: number;
        };
        error.status = response.status;
        throw error;
      }
      return parsed as T;
    } finally {
      clearTimeout(timer);
    }
  }

  private async postDiscord<T>(path: string, body: Record<string, unknown>): Promise<T> {
    return this.writeDiscord<T>("POST", path, body);
  }

  private async patchDiscord<T>(path: string, body: Record<string, unknown>): Promise<T> {
    return this.writeDiscord<T>("PATCH", path, body);
  }

  private async writeDiscord<T>(method: "POST" | "PATCH", path: string, body: Record<string, unknown>): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.config.transport.requestTimeoutMs);
    try {
      const response = await fetch(`${DISCORD_API_BASE_URL}${path}`, {
        method,
        headers: {
          Authorization: `Bot ${this.options.token}`,
          "Content-Type": "application/json",
          "User-Agent": this.options.config.transport.userAgent,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const text = await response.text();
      const parsed = text ? (JSON.parse(text) as unknown) : null;
      if (!response.ok) {
        const message = parsed ? JSON.stringify(parsed) : text;
        throw new Error(`Discord ${path} failed (${response.status}): ${message}`);
      }
      return parsed as T;
    } finally {
      clearTimeout(timer);
    }
  }

  private isRetryableError(error: unknown): boolean {
    if (error instanceof DOMException && error.name === "AbortError") {
      return true;
    }
    if (error instanceof TypeError) {
      return true;
    }
    if (error instanceof Error && "status" in error) {
      const status = (error as Error & { status?: number }).status;
      return typeof status === "number" && RETRYABLE_STATUS_CODES.has(status);
    }
    return false;
  }

  private buildHeaders(
    context?: DisGgCallContext,
    headerOverrides?: Record<string, string>,
  ): HeadersInit {
    const privilegedIntents = this.options.config.transport.privilegedIntents.join(",");
    const headers: Record<string, string> = {
      Authorization: `Bot ${this.options.token}`,
      "Content-Type": "application/json",
      "User-Agent": this.options.config.transport.userAgent,
    };
    if (this.options.config.transport.ownerAccess) {
      headers["X-Owner-Access"] = "1";
    }
    if (privilegedIntents) {
      headers["X-Privileged-Intents"] = privilegedIntents;
    }
    if (context?.currentGuildId) {
      headers["X-Current-Guild"] = context.currentGuildId;
    }
    if (context?.currentChannelId) {
      headers["X-Current-Channel"] = context.currentChannelId;
    }
    if (context?.currentMessageId) {
      headers["X-Current-Message"] = context.currentMessageId;
    }
    if (context?.currentUserId) {
      headers["X-Current-User"] = context.currentUserId;
    }
    if (context?.targetGuilds?.length) {
      headers["X-Target-Guilds"] = context.targetGuilds.join(",");
    }
    if (headerOverrides) {
      Object.assign(headers, headerOverrides);
    }
    return headers;
  }

  async listTools(context?: DisGgCallContext): Promise<DisGgTool[]> {
    const result = await this.withReadRetry(() => this.post<ToolListResponse>("tools/list", {}, context));
    return result.tools ?? [];
  }

  async callTool<T>(name: string, args: Record<string, unknown>, context?: DisGgCallContext): Promise<T> {
    return this.post<T>("tools/call", { name, arguments: args }, context);
  }

  async getAccessContext(): Promise<{ app_id: string; privileged_intents?: string[] }> {
    return this.withReadRetry(() => this.callTool("mcp_get_access_context", {}));
  }

  async listCurrentUserGuilds(limit = 50): Promise<DiscordGuild[]> {
    return this.withReadRetry(() =>
      this.callTool("list_current_user_guilds", {
        limit,
        with_counts: true,
      }),
    );
  }

  async listGuildChannels(binding: Pick<ChannelBinding, "guildId">): Promise<DiscordGuildChannel[]> {
    return this.withReadRetry(() =>
      this.callTool("list_guild_channels", {
        guild_id: binding.guildId,
      }),
    );
  }

  async resolveBinding(args: {
    guildId?: string;
    guildName?: string;
    channelId?: string;
    channelName?: string;
  }): Promise<ChannelBinding> {
    let guildId = args.guildId;
    let guildName = args.guildName;
    if (!guildId && guildName) {
      const guild = await this.withReadRetry(() =>
        this.callTool<{ id: string; name: string }>("get_guild", { guild_name: guildName }),
      );
      guildId = guild.id;
      guildName = guild.name;
    }
    let channelId = args.channelId;
    let channelName = args.channelName;
    if (!channelId && channelName) {
      const channel = await this.withReadRetry(() =>
        this.callTool<{ id: string; name: string }>("get_channel", {
          channel_name: channelName,
          ...(guildId ? { guild_id: guildId } : {}),
          ...(guildName ? { guild_name: guildName } : {}),
        }),
      );
      channelId = channel.id;
      channelName = channel.name;
    }
    if (!guildId || !channelId) {
      throw new Error("Both guild and channel must resolve to IDs.");
    }
    return {
      guildId,
      channelId,
      ...(guildName ? { guildName } : {}),
      ...(channelName ? { channelName } : {}),
      mode: "mention",
      enabled: true,
    };
  }

  async fetchMessages(binding: ChannelBinding, after?: string | null, limit?: number): Promise<DiscordMessage[]> {
    return this.withReadRetry(() =>
      this.callTool("fetch_messages", {
        channel_id: binding.channelId,
        guild_id: binding.guildId,
        limit: limit ?? this.options.config.transport.fetchLimit,
        ...(after ? { after } : {}),
      }),
    );
  }

  async sendMessage(
    binding: Pick<ChannelBinding, "guildId" | "channelId">,
    content: string,
    options?: { replyToMessageId?: string },
  ): Promise<unknown> {
    if (options?.replyToMessageId) {
      return this.postDiscord<DiscordPostedMessage>(`/channels/${binding.channelId}/messages`, {
        content,
        allowed_mentions: {
          parse: [],
          replied_user: false,
        },
        message_reference: {
          message_id: options.replyToMessageId,
        },
      });
    }

    return this.post(
      "tools/call",
      {
        name: "send_message",
        arguments: {
          guild_id: binding.guildId,
          channel_id: binding.channelId,
          content,
        },
      },
      undefined,
      {
        "X-Allowed-Mentions": SAFE_REPLY_ALLOWED_MENTIONS,
      },
    );
  }

  async editMessage(
    binding: Pick<ChannelBinding, "channelId">,
    messageId: string,
    content: string,
  ): Promise<DiscordPostedMessage> {
    return this.patchDiscord<DiscordPostedMessage>(`/channels/${binding.channelId}/messages/${messageId}`, {
      content,
      allowed_mentions: {
        parse: [],
        replied_user: false,
      },
    });
  }

  async sendTyping(binding: Pick<ChannelBinding, "channelId">): Promise<void> {
    await this.postDiscord<void>(`/channels/${binding.channelId}/typing`, {});
  }

  async buildExecutableTools(context: DisGgCallContext): Promise<ExecutableTool[]> {
    const tools = await this.listTools(context);
    return tools
      .filter((tool) => this.isToolAllowed(tool))
      .map((tool) => ({
        metadata: tool,
        spec: {
          name: tool.name,
          description: tool.description,
          inputSchema: sanitizeSchemaNode((tool.inputSchema as Record<string, unknown>) ?? { type: "object" }),
        },
        execute: async (args) => {
          try {
            const result = await this.callTool<unknown>(tool.name, args, context);
            return {
              contentItems: [
                {
                  type: "inputText",
                  text: JSON.stringify(result, null, 2),
                },
              ],
              success: true,
            };
          } catch (error) {
            return {
              contentItems: [
                {
                  type: "inputText",
                  text: error instanceof Error ? error.message : String(error),
                },
              ],
              success: false,
            };
          }
        },
      }));
  }

  private isToolAllowed(tool: DisGgTool): boolean {
    return !this.options.config.safety.denyTools.includes(tool.name);
  }
}
