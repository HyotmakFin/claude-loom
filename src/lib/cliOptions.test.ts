import { describe, expect, it } from "vitest";

import { profileEnv, startOptions } from "./cliOptions";
import type { LoomConfig, Profile } from "./types";

const profile: Profile = {
  id: "p1",
  name: "代理",
  baseUrl: "https://proxy.test",
  apiKey: "sk-1",
  models: { opus: "m-opus", sonnet: "", haiku: "m-haiku" },
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
  it("maps BYOK to the官方环境变量", () => {
    const { env, envRemove } = profileEnv(profile);
    expect(env.ANTHROPIC_BASE_URL).toBe("https://proxy.test");
    expect(env.ANTHROPIC_API_KEY).toBe("sk-1");
    expect(env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe("m-opus");
    expect(env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBeUndefined();
    expect(envRemove).toContain("ANTHROPIC_AUTH_TOKEN");
  });

  it("keeps only enabled plugin dirs and passes cliPath/permission mode", () => {
    const opts = startOptions(config, "/work", "sess-1");
    expect(opts.pluginDirs).toEqual(["/plugins/a"]);
    expect(opts.resume).toBe("sess-1");
    expect(opts.cliPath).toBe("/usr/local/bin/claude");
    expect(opts.permissionMode).toBe("acceptEdits");
    expect(opts.partialMessages).toBe(true);
  });

  it("without an active profile nothing is injected", () => {
    const opts = startOptions({ ...config, activeProfileId: null, cliPath: null, permissionMode: null }, "/work");
    expect(opts.env).toEqual({});
    expect(opts.envRemove).toEqual([]);
    expect(opts.permissionMode).toBeUndefined();
    expect(opts.cliPath).toBeUndefined();
  });
});
