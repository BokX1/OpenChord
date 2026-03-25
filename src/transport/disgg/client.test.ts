import { describe, expect, it } from "vitest";
import { makeTestConfig } from "../../test/test-config.js";
import { DisGgClient } from "./client.js";

describe("DisGgClient schema sanitization", () => {
  it("normalizes array schemas that are missing items", async () => {
    const client = new DisGgClient({
      config: makeTestConfig(),
      token: "test-token",
    });

    client.listTools = async () => [
      {
        name: "send_embeds",
        description: "Send embeds",
        inputSchema: {
          type: "object",
          properties: {
            embeds: {
              type: "array",
            },
          },
        },
      },
    ];

    const tools = await client.buildExecutableTools({});
    const parameters = tools[0]?.spec.inputSchema as { properties?: Record<string, { items?: unknown }> };
    expect(parameters.properties?.embeds?.items).toEqual({});
  });

  it("only hides tools that are explicitly denied locally", async () => {
    const client = new DisGgClient({
      config: makeTestConfig({
        safety: {
          denyTools: ["delete_channel"],
          targetGuildsMode: "bound-guild",
        },
      }),
      token: "test-token",
    });

    client.listTools = async () => [
      {
        name: "delete_channel",
        description: "Delete a channel",
        inputSchema: { type: "object" },
        "x-mcp-risk-level": "high",
      },
      {
        name: "ban_member",
        description: "Ban a member",
        inputSchema: { type: "object" },
        "x-mcp-risk-level": "high",
      },
    ];

    const tools = await client.buildExecutableTools({});
    expect(tools.map((tool) => tool.spec.name)).toEqual(["ban_member"]);
  });
});
