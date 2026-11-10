/** 对 Rust 命令的类型化封装。命令定义见 sidecar/backend 下的 commands 模块。 */
import { invoke } from "./electron";

import type {
  AppInfo,
  FilePreview,
  GitInfo,
  LoomConfig,
  PluginDirInfo,
  PluginsListing,
  SessionDetail,
  SessionSummary,
  SkillDoc,
  SkillInfo,
} from "./types";

export interface CliInfo {
  path: string;
  version: string | null;
}

export interface StartOptions {
  cwd: string;
  resume?: string;
  permissionMode?: string;
  pluginDirs?: string[];
  partialMessages?: boolean;
  cliPath?: string;
}

export const ipc = {
  // CLI 进程
  cliLocate: (cliPath?: string) => invoke<CliInfo>("cli_locate", { cliPath }),
  cliStart: (options: StartOptions) => invoke<string>("cli_start", { options }),
  cliSend: (runId: string, message: unknown) => invoke<void>("cli_send", { runId, message }),
  cliStop: (runId: string) => invoke<void>("cli_stop", { runId }),
  cliStopAll: () => invoke<void>("cli_stop_all"),
  settingsStamp: () => invoke<string>("settings_stamp"),

  // 环境
  appInfo: () => invoke<AppInfo>("app_info"),
  systemFonts: () => invoke<{ sans: string[] }>("system_fonts"),

  // 配置
  configGet: () => invoke<LoomConfig>("config_get"),
  configSave: (config: LoomConfig) => invoke<void>("config_save", { config }),

  // 会话
  sessionList: (query?: string, includeArchived?: boolean) =>
    invoke<SessionSummary[]>("session_list", { query, includeArchived }),
  sessionMessages: (sessionId: string) => invoke<SessionDetail>("session_messages", { sessionId }),
  sessionDelete: (sessionId: string) => invoke<void>("session_delete", { sessionId }),
  sessionSetFlag: (sessionId: string, pinned?: boolean, archived?: boolean) =>
    invoke<void>("session_set_flag", { sessionId, pinned, archived }),
  sessionFork: (sessionId: string, uptoUuid: string) =>
    invoke<SessionSummary>("session_fork", { sessionId, uptoUuid }),
  sessionDeleteMessage: (sessionId: string, uuid: string) =>
    invoke<void>("session_delete_message", { sessionId, uuid }),

  // Skill
  skillsList: () => invoke<SkillInfo[]>("skills_list"),
  skillDoc: (dir: string) => invoke<SkillDoc>("skill_doc", { dir }),
  skillSave: (dir: string, name: string, description: string, body: string) =>
    invoke<void>("skill_save", { dir, name, description, body }),
  skillToggle: (dir: string, enabled: boolean) => invoke<void>("skill_toggle", { dir, enabled }),
  skillCreate: (name: string, description: string) => invoke<SkillInfo>("skill_create", { name, description }),

  // 插件
  pluginsList: () => invoke<PluginsListing>("plugins_list"),
  pluginAddDir: (path: string) => invoke<PluginDirInfo>("plugin_add_dir", { path }),
  pluginRemoveDir: (path: string) => invoke<void>("plugin_remove_dir", { path }),
  pluginToggle: (path: string, enabled: boolean) => invoke<void>("plugin_toggle", { path, enabled }),

  // 预览 / 环境
  previewFile: (path: string) => invoke<FilePreview>("preview_file", { path }),
  gitInfo: (path: string) => invoke<GitInfo>("git_info", { path }),
};

export function errorText(e: unknown): string {
  return typeof e === "string" ? e : e instanceof Error ? e.message : JSON.stringify(e);
}
