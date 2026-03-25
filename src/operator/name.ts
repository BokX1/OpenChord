import { loadConfig, saveConfig } from "../store/config.js";

function readAssistantNameLabel(name: string): string {
  return name.trim() || "OpenChord";
}

export function runNameShow(): void {
  const config = loadConfig();
  console.log(`Assistant name: ${readAssistantNameLabel(config.identity.assistantName)}`);
}

export function runNameSet(params: { name?: string }): void {
  const nextName = params.name?.trim();
  if (!nextName) {
    throw new Error("Provide --name with a non-empty assistant name.");
  }

  const config = loadConfig();
  const next = {
    ...config,
    identity: {
      ...config.identity,
      assistantName: nextName,
    },
  };

  saveConfig(next);
  console.log(`Assistant name: ${next.identity.assistantName}`);
  console.log("Reset channel sessions if you want existing threads to pick up the new name immediately.");
}

export function runNameClear(): void {
  const config = loadConfig();
  const next = {
    ...config,
    identity: {
      ...config.identity,
      assistantName: "OpenChord",
    },
  };

  saveConfig(next);
  console.log("Assistant name: OpenChord");
  console.log("Reset channel sessions if you want existing threads to pick up the new name immediately.");
}
