import { z } from "zod";

export const ReplyModeSchema = z.enum(["mention", "always"]);
export type ReplyMode = z.infer<typeof ReplyModeSchema>;

export const PrivilegedIntentSchema = z.enum(["message_content", "server_members", "presence"]);
export type PrivilegedIntent = z.infer<typeof PrivilegedIntentSchema>;

export const SupportedModelSchema = z.enum([
  "gpt-5.4",
  "gpt-5.4-mini",
  "gpt-5.3-codex",
  "gpt-5.2-codex",
  "gpt-5.2",
  "gpt-5.1-codex-max",
  "gpt-5.1-codex-mini",
]);
export type SupportedModel = z.infer<typeof SupportedModelSchema>;

export const ReasoningSchema = z.enum(["low", "medium", "high", "xhigh"]);
export type ReasoningLevel = z.infer<typeof ReasoningSchema>;

export const ProviderBackendSchema = z.literal("codex-app-server");
export type ProviderBackend = z.infer<typeof ProviderBackendSchema>;

export const HostToolProfileSchema = z.enum(["strict-read-only", "sandboxed-workspace-write"]);
export type HostToolProfile = z.infer<typeof HostToolProfileSchema>;

export const ChannelBindingSchema = z.object({
  guildId: z.string(),
  guildName: z.string().optional(),
  channelId: z.string(),
  channelName: z.string().optional(),
  mode: ReplyModeSchema.default("mention"),
  enabled: z.boolean().default(true),
});
export type ChannelBinding = z.infer<typeof ChannelBindingSchema>;

export const AuthorityRoleSchema = z.enum(["owner", "admin", "user"]);
export type AuthorityRole = z.infer<typeof AuthorityRoleSchema>;

export const BridgeConfigSchema = z.object({
  version: z.literal(2),
  identity: z
    .object({
      assistantName: z.string().trim().min(1).max(80).default("OpenChord"),
    })
    .default({
      assistantName: "OpenChord",
    }),
  authority: z
    .object({
      ownerUserId: z.string().default(""),
      adminUserIds: z.array(z.string()).default([]),
    })
    .default({
      ownerUserId: "",
      adminUserIds: [],
    }),
  transport: z
    .object({
      serverUrl: z.string().url().default("https://mcp.dis.gg/v1"),
      botTokenEnvVar: z.string().default("BOT_TOKEN"),
      ownerAccess: z.boolean().default(true),
      privilegedIntents: z.array(PrivilegedIntentSchema).default(["message_content", "server_members"]),
      fetchLimit: z.number().int().min(1).max(100).default(25),
      requestTimeoutMs: z.number().int().min(1000).default(15000),
      userAgent: z.string().default("openchord/0.1.0"),
    })
    .default({
      serverUrl: "https://mcp.dis.gg/v1",
      botTokenEnvVar: "BOT_TOKEN",
      ownerAccess: true,
      privilegedIntents: ["message_content", "server_members"],
      fetchLimit: 25,
      requestTimeoutMs: 15000,
      userAgent: "openchord/0.1.0",
    }),
  provider: z
    .object({
      backend: ProviderBackendSchema.default("codex-app-server"),
      codexCommand: z.string().default("codex"),
      hostToolProfile: HostToolProfileSchema.default("sandboxed-workspace-write"),
      isolatedCwd: z.string().default(""),
      model: z.union([SupportedModelSchema, z.literal("")]).default(""),
      reasoning: ReasoningSchema.optional(),
    })
    .default({
      backend: "codex-app-server",
      codexCommand: "codex",
      hostToolProfile: "sandboxed-workspace-write",
      isolatedCwd: "",
      model: "",
    }),
  safety: z
    .object({
      denyTools: z.array(z.string()).default([]),
      targetGuildsMode: z.enum(["bound-guild", "all"]).default("bound-guild"),
    })
    .default({
      denyTools: [],
      targetGuildsMode: "bound-guild",
    }),
  bindings: z.array(ChannelBindingSchema).default([]),
});
export type BridgeConfig = z.infer<typeof BridgeConfigSchema>;

export type DiscordAuthor = {
  id: string;
  username: string;
  global_name?: string | null;
};

export type DiscordAttachment = {
  id?: string;
  filename?: string;
  url?: string;
  content_type?: string | null;
};

export type DiscordMessageReference = {
  message_id?: string;
  channel_id?: string;
  guild_id?: string;
  author_id?: string;
};

export type DiscordMessage = {
  id: string;
  channel_id: string;
  content: string;
  author: DiscordAuthor;
  attachments?: DiscordAttachment[];
  message_reference?: DiscordMessageReference;
  timestamp?: string;
};

export type DiscordGuild = {
  id: string;
  name: string;
  approximate_member_count?: number;
  approximate_presence_count?: number;
};

export type DiscordGuildChannel = {
  id: string;
  guild_id?: string;
  name: string;
  type?: number;
  parent_id?: string | null;
};

export type DisGgTool = {
  name: string;
  description: string;
  inputSchema?: Record<string, unknown>;
  annotations?: {
    readOnlyHint?: boolean;
  };
  ["x-mcp-risk-level"]?: string | null;
};

export type DisGgCallContext = {
  currentUserId?: string;
  currentGuildId?: string;
  currentChannelId?: string;
  currentMessageId?: string;
  targetGuilds?: string[];
};

export type CodexTextInput = {
  type: "text";
  text: string;
  text_elements: [];
};

export type DynamicToolSpec = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

export type DynamicToolContentItem = {
  type: "inputText";
  text: string;
};

export type DynamicToolExecutionResult = {
  contentItems: DynamicToolContentItem[];
  success: boolean;
};

export type ProgressUpdate = {
  text: string;
  phase?: string;
};

export type ChannelSession = {
  channelKey: string;
  guildId: string;
  channelId: string;
  provider: "codex-app-server";
  model: string;
  threadId: string;
  lastSeenMessageId: string | null;
  updatedAt: number;
};

export type CodexThreadSummary = {
  id: string;
  preview: string;
  cwd: string;
  status: string;
  updatedAt: number;
  createdAt: number;
  name: string | null;
  modelProvider: string;
  cliVersion: string;
  turnCount: number;
};

export type CodexAuthStatus = {
  authMethod: string | null;
  authToken: string | null;
  requiresOpenaiAuth: boolean | null;
};
