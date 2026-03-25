import { loadConfig, saveConfig } from "../store/config.js";
import { ReasoningSchema, SupportedModelSchema, type ReasoningLevel, type SupportedModel } from "../types.js";

function readModelLabel(model: string): string {
  return model.trim() || "auto (Codex default)";
}

function readReasoningLabel(reasoning: ReasoningLevel | undefined): string {
  return reasoning || "auto (Codex default)";
}

export function runModelShow(): void {
  const config = loadConfig();
  console.log(`Model: ${readModelLabel(config.provider.model)}`);
  console.log(`Reasoning: ${readReasoningLabel(config.provider.reasoning)}`);
}

export function runModelSet(params: { model?: string; reasoning?: string }): void {
  if (!params.model && !params.reasoning) {
    throw new Error("Provide --model, --reasoning, or both.");
  }

  const config = loadConfig();
  const next = {
    ...config,
    provider: {
      ...config.provider,
    },
  };

  if (params.model) {
    next.provider.model = SupportedModelSchema.parse(params.model.trim()) as SupportedModel;
  }

  if (params.reasoning) {
    next.provider.reasoning = ReasoningSchema.parse(params.reasoning.trim()) as ReasoningLevel;
  }

  saveConfig(next);
  console.log(`Model: ${readModelLabel(next.provider.model)}`);
  console.log(`Reasoning: ${readReasoningLabel(next.provider.reasoning)}`);
}

export function runModelClear(): void {
  const config = loadConfig();
  const next = {
    ...config,
    provider: {
      ...config.provider,
      model: "" as const,
      reasoning: undefined,
    },
  };
  saveConfig(next);
  console.log("Model: auto (Codex default)");
  console.log("Reasoning: auto (Codex default)");
}
