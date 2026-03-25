import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { StateDb } from "./state-db.js";

describe("StateDb", () => {
  let tempDir: string;
  let db: StateDb;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "openchord-state-"));
    process.env.OPENCHORD_HOME = tempDir;
    db = new StateDb();
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
    delete process.env.OPENCHORD_HOME;
  });

  it("creates and persists a channel session across restarts", () => {
    const session = db.saveBindingSession(
      {
        guildId: "guild-1",
        channelId: "channel-1",
      },
      {
        model: "gpt-5.4",
        threadId: "thread-1",
        lastSeenMessageId: "message-99",
      },
    );

    db.close();
    db = new StateDb();

    const reloaded = db.getSession({ guildId: "guild-1", channelId: "channel-1" });
    expect(reloaded).not.toBeNull();
    expect(reloaded).toEqual(session);
  });

  it("tracks processed messages without duplicates", () => {
    expect(db.hasProcessedMessage("mid-1")).toBe(false);
    db.markProcessed("mid-1", { guildId: "guild-1", channelId: "channel-1" });
    db.markProcessed("mid-1", { guildId: "guild-1", channelId: "channel-1" });
    expect(db.hasProcessedMessage("mid-1")).toBe(true);
  });
});
