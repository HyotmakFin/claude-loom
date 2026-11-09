/**
 * Markdown 渲染：markdown-it（禁用原始 HTML）+ Shiki（自定义米白主题）。
 * 代码块先占位，再异步替换为高亮结果，避免同步阻塞首屏。
 */
import MarkdownIt from "markdown-it";
import { createHighlighter, type Highlighter, type ThemeRegistration } from "shiki";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";

export const loomLightTheme: ThemeRegistration = {
  name: "loom-light",
  type: "light",
  colors: {
    "editor.background": "#F4F2EC",
    "editor.foreground": "#1F1E1B",
  },
  settings: [
    { settings: { foreground: "#1F1E1B" } },
    { scope: ["comment", "punctuation.definition.comment"], settings: { foreground: "#98938A", fontStyle: "italic" } },
    { scope: ["keyword", "storage", "storage.type", "keyword.control"], settings: { foreground: "#B65E42" } },
    { scope: ["string", "string.quoted", "string.template"], settings: { foreground: "#5E7A52" } },
    { scope: ["constant.numeric", "constant.language", "constant.character"], settings: { foreground: "#A9772E" } },
    { scope: ["entity.name.function", "support.function", "meta.function-call"], settings: { foreground: "#3F6A86" } },
    { scope: ["entity.name.type", "support.class", "entity.name.class"], settings: { foreground: "#7A5A8E" } },
    { scope: ["entity.name.tag", "variable.other.property"], settings: { foreground: "#B65E42" } },
    { scope: ["punctuation", "meta.brace", "keyword.operator"], settings: { foreground: "#6B665C" } },
    { scope: ["markup.heading", "markup.bold"], settings: { foreground: "#1F1E1B", fontStyle: "bold" } },
  ],
};

export const loomDarkTheme: ThemeRegistration = {
  name: "loom-dark",
  type: "dark",
  colors: {
    "editor.background": "#2D2D2B",
    "editor.foreground": "#EDEAE3",
  },
  settings: [
    { settings: { foreground: "#EDEAE3" } },
    { scope: ["comment", "punctuation.definition.comment"], settings: { foreground: "#8C877D", fontStyle: "italic" } },
    { scope: ["keyword", "storage", "storage.type", "keyword.control"], settings: { foreground: "#E79A7F" } },
    { scope: ["string", "string.quoted", "string.template"], settings: { foreground: "#A8C79B" } },
    { scope: ["constant.numeric", "constant.language", "constant.character"], settings: { foreground: "#E0B36B" } },
    { scope: ["entity.name.function", "support.function", "meta.function-call"], settings: { foreground: "#8FB8D9" } },
    { scope: ["entity.name.type", "support.class", "entity.name.class"], settings: { foreground: "#C3A6D9" } },
    { scope: ["entity.name.tag", "variable.other.property"], settings: { foreground: "#E79A7F" } },
    { scope: ["punctuation", "meta.brace", "keyword.operator"], settings: { foreground: "#A8A298" } },
    { scope: ["markup.heading", "markup.bold"], settings: { foreground: "#EDEAE3", fontStyle: "bold" } },
  ],
};

const LANGS = [
  "javascript", "typescript", "tsx", "jsx", "json", "rust", "python", "bash", "shell", "markdown",
  "html", "css", "yaml", "toml", "diff", "sql", "go", "java", "c", "cpp",
];

let highlighterPromise: Promise<Highlighter> | null = null;
function highlighter(): Promise<Highlighter> {
  // 用 JS 正则引擎而非 Oniguruma WASM：Tauri 的 CSP 默认不允许 WebAssembly 编译，
  // 且不必额外放行 wasm-unsafe-eval。常见语言的高亮结果与 WASM 引擎基本一致。
  highlighterPromise ??= createHighlighter({
    themes: [loomLightTheme, loomDarkTheme],
    langs: LANGS,
    engine: createJavaScriptRegexEngine({ forgiving: true }),
  });
  return highlighterPromise;
}

const md = new MarkdownIt({ html: false, linkify: true, breaks: false });
const blocks: { code: string; lang: string }[] = [];

md.renderer.rules.fence = (tokens, idx) => {
  const token = tokens[idx]!;
  const lang = (token.info || "").trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  const i = blocks.push({ code: token.content, lang }) - 1;
  return `<div data-loom-code="${i}"></div>`;
};

md.renderer.rules.link_open = (tokens, idx, options, _env, self) => {
  tokens[idx]!.attrSet("target", "_blank");
  tokens[idx]!.attrSet("rel", "noreferrer");
  return self.renderToken(tokens, idx, options);
};

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

let latestRender = 0;

export type ThemeName = "light" | "dark";
const themeName = (t: ThemeName) => (t === "dark" ? "loom-dark" : "loom-light");

export async function renderMarkdown(source: string, theme: ThemeName = "light"): Promise<string> {
  blocks.length = 0;
  const html = md.render(source);
  if (!blocks.length) return html;

  const seq = ++latestRender;
  const hl = await highlighter();
  if (seq !== latestRender) return html; // 已有更新的渲染，放弃本次高亮

  const rendered = blocks.map(({ code, lang }) => {
    if (code.length > 60_000) {
      return `<pre class="loom-code-plain"><code>${escapeHtml(code)}</code></pre>`;
    }
    try {
      const use = (hl.getLoadedLanguages() as string[]).includes(lang) ? lang : "text";
      return hl.codeToHtml(code, { lang: use, theme: themeName(theme) });
    } catch {
      return `<pre class="loom-code-plain"><code>${escapeHtml(code)}</code></pre>`;
    }
  });

  const wrap = (block: string) =>
    `<div class="loom-code"><button type="button" class="loom-copy" data-loom-copy>复制</button>${block}</div>`;
  return html.replace(/<div data-loom-code="(\d+)"><\/div>/g, (_, i: string) => wrap(rendered[Number(i)] ?? ""));
}

/** 给纯代码文本高亮（预览面板用） */
export async function highlightCode(code: string, lang: string, theme: ThemeName = "light"): Promise<string> {
  const hl = await highlighter();
  try {
    const use = (hl.getLoadedLanguages() as string[]).includes(lang) ? lang : "text";
    return hl.codeToHtml(code, { lang: use, theme: themeName(theme) });
  } catch {
    return `<pre class="loom-code-plain"><code>${escapeHtml(code)}</code></pre>`;
  }
}

export const EXT_LANG: Record<string, string> = {
  js: "javascript", mjs: "javascript", cjs: "javascript", jsx: "jsx",
  ts: "typescript", tsx: "tsx", json: "json", jsonl: "json",
  rs: "rust", py: "python", sh: "bash", bash: "bash", zsh: "bash",
  md: "markdown", markdown: "markdown", html: "html", htm: "html",
  css: "css", yaml: "yaml", yml: "yaml", toml: "toml", diff: "diff",
  patch: "diff", sql: "sql", go: "go", java: "java", c: "c", cpp: "cpp", h: "c",
};
