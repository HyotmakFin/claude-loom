import { describe, expect, it } from "vitest";

import type { ChatMessage, LoomConfig } from "./types";
import { contextOf, formatTokens, modelLabel, modelOf } from "./hud";

const emptyConfig: LoomConfig = {
  activeProfileId: null,
  profiles: [],
  pluginDirs: [],
  sessionFlags: {},
  cliPath: null,
  permissionMode: null,
};

const assistant = (model: string, usage: Partial<ChatMessage["usage"]>): ChatMessage => ({
  role: "assistant",
  uuid: "u1",
  timestamp: null,
  text: "hi",
  thinking: null,
  model,
  usage: {
    inputTokens: 1_000,
    outputTokens: 100,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    ...usage,
  },
  toolUses: [],
  toolResults: [],
});

describe("hud helpers", () => {
  it("shows used context from the last assistant usage", () => {
    const messages = [assistant("claude-sonnet-5-5", { inputTokens: 2_000, cacheReadInputTokens: 98_000 })];
    const ctx = contextOf(undefined, messages, emptyConfig);
    expect(ctx).not.toBeNull();
    expect(ctx!.used).toBe(100_000);
    expect(ctx!.window).toBe(200_000);
    expect(ctx!.percent).toBe(50);
    expect(modelOf(undefined, messages)).toBe("claude-sonnet-5-5");
  });

  it("infers a 1M window when usage exceeds 200k", () => {
    const messages = [assistant("deepseek-flash", { inputTokens: 1_000, cacheReadInputTokens: 540_000 })];
    const ctx = contextOf(undefined, messages, emptyConfig)!;
    expect(ctx.window).toBe(1_000_000);
    expect(Math.round(ctx.percent)).toBe(54);
  });

  it("uses the profile million flag", () => {
    const cfg: LoomConfig = {
      ...emptyConfig,
      activeProfileId: "p",
      profiles: [
        {
          id: "p",
          name: "x",
          notes: "",
          website: "",
          baseUrl: "",
          apiKey: "",
          authField: "",
          fullUrl: false,
          models: {
            opus: "claude-opus-5-5",
            sonnet: "claude-sonnet-5-5",
            haiku: "",
            fable: "",
            subagent: "",
            fallback: "",
            opusName: "",
            sonnetName: "",
            haikuName: "",
            fableName: "",
            opusMillion: false,
            sonnetMillion: true,
            haikuMillion: false,
            fableMillion: false,
            subagentMillion: false,
            fallbackMillion: false,
          },
        },
      ],
    };
    const ctx = contextOf(undefined, [assistant("claude-sonnet-5-5", { inputTokens: 1_000 })], cfg)!;
    expect(ctx.window).toBe(1_000_000);
  });

  it("formats labels and tokens", () => {
    expect(modelLabel("claude-sonnet-5-5")).toBe("Sonnet 5.5");
    expect(modelLabel("deepseek-flash")).toBe("deepseek-flash");
    expect(formatTokens(540_000)).toBe("540k");
    expect(formatTokens(1_000_000)).toBe("1.0M");
  });
});
