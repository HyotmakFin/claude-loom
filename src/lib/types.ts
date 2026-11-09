/** 与 Rust 侧 serde 输出一一对应的类型（src-tauri/src/**）。 */

export interface AppInfo {
  claudeDir: string;
  configDir: string;
  projectsDir: string;
  sessionsDir: string;
  skillsDir: string;
  pluginsDir: string;
}

export interface ModelMap {
  opus: string;
  sonnet: string;
  haiku: string;
  fable: string;
  subagent: string;
  fallback: string;
  opusName: string;
  sonnetName: string;
  haikuName: string;
  fableName: string;
  opusMillion: boolean;
  sonnetMillion: boolean;
  haikuMillion: boolean;
  fableMillion: boolean;
  subagentMillion: boolean;
  fallbackMillion: boolean;
}

export interface Profile {
  id: string;
  name: string;
  notes: string;
  website: string;
  baseUrl: string;
  apiKey: string;
  /** ANTHROPIC_AUTH_TOKEN（默认）或 ANTHROPIC_API_KEY */
  authField: string;
  fullUrl: boolean;
  models: ModelMap;
}

export interface PluginDirCfg {
  path: string;
  enabled: boolean;
}

export interface SessionFlag {
  pinned: boolean;
  archived: boolean;
}

export interface LoomConfig {
  activeProfileId: string | null;
  profiles: Profile[];
  pluginDirs: PluginDirCfg[];
  sessionFlags: Record<string, SessionFlag>;
  cliPath: string | null;
  permissionMode: string | null;
}

export interface LiveSession {
  pid: number;
  status: string;
  name: string | null;
}

export interface SessionSummary {
  id: string;
  title: string;
  projectPath: string | null;
  gitBranch: string | null;
  createdAt: number | null;
  updatedAt: number;
  messageCount: number;
  lastPrompt: string | null;
  live: LiveSession | null;
  pinned: boolean;
  archived: boolean;
}

export interface ToolUse {
  id: string;
  name: string;
  input: unknown;
}

export interface ToolResult {
  toolUseId: string;
  content: string;
  isError: boolean;
}

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  /** 对应 JSONL 行的 uuid；用于分叉 / 删除 */
  uuid: string | null;
  timestamp: string | null;
  text: string | null;
  thinking: string | null;
  toolUses: ToolUse[];
  toolResults: ToolResult[];
}

export interface SessionDetail {
  session: SessionSummary;
  messages: ChatMessage[];
}

export interface SkillInfo {
  dir: string;
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  extra: [string, string][];
}

export interface SkillDoc {
  dir: string;
  name: string;
  description: string;
  body: string;
  enabled: boolean;
  raw: string;
}

export interface InstalledPlugin {
  key: string;
  version: string | null;
  path: string;
  lastUpdated: string | null;
}

export interface PluginDirInfo {
  path: string;
  enabled: boolean;
  exists: boolean;
  pluginName: string | null;
  pluginVersion: string | null;
}

export interface PluginsListing {
  installed: InstalledPlugin[];
  dirs: PluginDirInfo[];
}

export interface FilePreview {
  path: string;
  name: string;
  kind: "markdown" | "image" | "text" | "binary";
  mime: string | null;
  content: string | null;
  dataUrl: string | null;
  truncated: boolean;
  size: number;
}
