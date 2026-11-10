import { describe, expect, it } from "vitest";

import { startOptions } from "./cliOptions";
import type { LoomConfig } from "./types";

const config: LoomConfig = {
  pluginDirs: [
    { path: "/plugins/a", enabled: true },
    { path: "/plugins/b", enabled: false },
  ],
  sessionFlags: {},
  cliPath: "/usr/local/bin/claude",
  permissionMode: "acceptEdits",
};

describe("CLI options", () => {
  it("保留启用的插件目录并传递 cliPath / 权限模式 / resume", () => {
    const opts = startOptions(config, "/work", "sess-1");
    expect(opts.pluginDirs).toEqual(["/plugins/a"]);
    expect(opts.resume).toBe("sess-1");
    expect(opts.cliPath).toBe("/usr/local/bin/claude");
    expect(opts.permissionMode).toBe("acceptEdits");
    expect(opts.partialMessages).toBe(true);
  });

  it("空配置不传 cliPath / 权限模式", () => {
    const opts = startOptions(
      { pluginDirs: [], sessionFlags: {}, cliPath: null, permissionMode: null },
      "/work",
    );
    expect(opts.pluginDirs).toEqual([]);
    expect(opts.permissionMode).toBeUndefined();
    expect(opts.cliPath).toBeUndefined();
  });
});
