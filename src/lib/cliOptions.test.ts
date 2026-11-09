import { describe, expect, it } from "vitest";

import { effectiveModel, profileEnv, startOptions } from "./cliOptions";
import type { LoomConfig, ModelMap, Profile } from "./types";

function models(patch: Partial<ModelMap> = {}): ModelMap {
  return {
    opus: "", sonnet: "", haiku: "", fable: "", subagent: "", fallback: "",
    opusName: "", sonnetName: "", haikuName: "", fableName: "",
    opusMillion: false, sonnetMillion: false, haikuMillion: false, fableMillion: false,
    subagentMillion: false, fallbackMillion: false,
    ...patch,
  };
}

const profile: Profile = {
  id: "p1",
  name: "代理",
  notes: "",
  website: "",
  baseUrl: "https://proxy.test",
  apiKey: "sk-1",
  authField: "ANTHROPIC_AUTH_TOKEN",
  fullUrl: false,
  models: models({ opus: "m-opus", haiku: "m-haiku", fable: "m-fable", sonnet: "m-sonnet" }),
};

const config: LoomConfig = {
  activeProfileId: "p1",
  profiles: [profile],
  pluginDirs: [
    { path: "/plugins/a", enabled: true },
    { path: "/plugins/b", enabled: false },
  ],
  sessionFlags: {},
  cliPath: "/usr/local/bin/claude",
  permissionMode: "acceptEdits",
};

describe("CLI options", () => {
  it("默认使用 ANTHROPIC_AUTH_TOKEN（与 cc-switch 一致）并移除 API_KEY", () => {
    const { env, envRemove } = profileEnv(profile);
    expect(env.ANTHROPIC_BASE_URL).toBe("https://proxy.test");
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe("sk-1");
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(envRemove).toEqual(["ANTHROPIC_API_KEY"]);
  });

  it("可切换为 ANTHROPIC_API_KEY", () => {
    const { env, envRemove } = profileEnv({ ...profile, authField: "ANTHROPIC_API_KEY" });
    expect(env.ANTHROPIC_API_KEY).toBe("sk-1");
    expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
    expect(envRemove).toEqual(["ANTHROPIC_AUTH_TOKEN"]);
  });

  it("映射 Sonnet / Opus / Fable / Haiku / Subagent / 兜底模型", () => {
    const { env } = profileEnv(profile);
    expect(env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe("m-opus");
    expect(env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe("m-sonnet");
    expect(env.ANTHROPIC_DEFAULT_FABLE_MODEL).toBe("m-fable");
    expect(env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBe("m-haiku");
    expect(env.ANTHROPIC_MODEL).toBeUndefined();

    const full = profileEnv({
      ...profile,
      models: models({ subagent: "m-sub", fallback: "m-default", fableName: "Fable 显示名" }),
    });
    expect(full.env.CLAUDE_CODE_SUBAGENT_MODEL).toBe("m-sub");
    expect(full.env.ANTHROPIC_MODEL).toBe("m-default");
    expect(full.env.ANTHROPIC_DEFAULT_FABLE_MODEL_NAME).toBe("Fable 显示名");
  });

  it("1M 会追加 [1m]，且不重复追加", () => {
    expect(effectiveModel("deepseek-flash", true)).toBe("deepseek-flash[1m]");
    expect(effectiveModel("deepseek-flash[1m]", true)).toBe("deepseek-flash[1m]");
    expect(effectiveModel("deepseek-flash", false)).toBe("deepseek-flash");
    const { env } = profileEnv({ ...profile, models: models({ sonnet: "m-s", sonnetMillion: true, fallback: "m-d", fallbackMillion: true }) });
    expect(env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe("m-s[1m]");
    expect(env.ANTHROPIC_MODEL).toBe("m-d[1m]");
  });

  it("没有 Key 时不注入认证变量，也不移除继承的环境", () => {
    const { env, envRemove } = profileEnv({ ...profile, apiKey: "  " });
    expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
    expect(envRemove).toEqual([]);
    expect(env.ANTHROPIC_BASE_URL).toBe("https://proxy.test");
  });

  it("保留启用的插件目录并传递 cliPath / 权限模式", () => {
    const opts = startOptions(config, "/work", "sess-1");
    expect(opts.pluginDirs).toEqual(["/plugins/a"]);
    expect(opts.resume).toBe("sess-1");
    expect(opts.cliPath).toBe("/usr/local/bin/claude");
    expect(opts.permissionMode).toBe("acceptEdits");
    expect(opts.partialMessages).toBe(true);
  });

  it("没有当前配置时不注入任何东西", () => {
    const opts = startOptions({ ...config, activeProfileId: null, cliPath: null, permissionMode: null }, "/work");
    expect(opts.env).toEqual({});
    expect(opts.envRemove).toEqual([]);
    expect(opts.permissionMode).toBeUndefined();
    expect(opts.cliPath).toBeUndefined();
  });
});
