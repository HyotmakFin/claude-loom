/**
 * 内置预览：Markdown / 图片 / 代码（Shiki）与 localhost 网页。
 * 三个平台的 WebView 内嵌能力不一致，所以网页模式始终提供"在系统浏览器打开"兜底。
 */
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Icon } from "@/components/ui/Icon";
import { Markdown } from "@/components/ui/Markdown";
import { TextField } from "@/components/ui/TextField";
import { errorText, ipc } from "@/lib/ipc";
import { EXT_LANG, escapeHtml, highlightCode } from "@/lib/markdown";
import { formatBytes } from "@/lib/format";
import type { FilePreview } from "@/lib/types";
import { useTheme } from "@/stores/theme";

type Mode = "file" | "web";

export function PreviewPanel({ onClose, cwd }: { onClose: () => void; cwd: string | null }) {
  const [mode, setMode] = useState<Mode>("file");
  const [path, setPath] = useState("");
  const [file, setFile] = useState<FilePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async (p: string) => {
    if (!p.trim()) return;
    setLoading(true);
    setError(null);
    try {
      setFile(await ipc.previewFile(p.trim()));
    } catch (e) {
      setError(errorText(e));
      setFile(null);
    } finally {
      setLoading(false);
    }
  };

  const pick = async () => {
    const selected = await openDialog({ multiple: false, directory: false, defaultPath: cwd ?? undefined });
    if (typeof selected === "string") {
      setPath(selected);
      void load(selected);
    }
  };

  return (
    <aside className="flex h-full w-[46%] min-w-[360px] max-w-[720px] shrink-0 flex-col border-l border-line bg-canvas">
      <div className="flex h-11 shrink-0 items-center gap-1 border-b border-line px-3">
        <div className="flex rounded-control border border-line bg-surface p-0.5 shadow-subtle">
          {(["file", "web"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={
                "inline-flex h-6 items-center gap-1.5 rounded-chip px-2 font-sans text-[12px] transition-colors " +
                (mode === m ? "bg-canvas text-ink" : "text-ink-muted hover:text-ink")
              }
            >
              <Icon name={m === "file" ? "file" : "globe"} size={12} />
              {m === "file" ? "文件" : "网页"}
            </button>
          ))}
        </div>
        <span className="ml-2 font-sans text-[11px] text-ink-faint">预览</span>
        <Button variant="ghost" size="sm" icon="x" aria-label="关闭预览" className="ml-auto" onClick={onClose} />
      </div>

      {mode === "file" ? (
        <FileMode path={path} setPath={setPath} file={file} error={error} loading={loading} onLoad={() => load(path)} onPick={pick} />
      ) : (
        <WebMode cwd={cwd} />
      )}
    </aside>
  );
}

function FileMode({ path, setPath, file, error, loading, onLoad, onPick }: {
  path: string;
  setPath: (v: string) => void;
  file: FilePreview | null;
  error: string | null;
  loading: boolean;
  onLoad: () => void;
  onPick: () => void;
}) {
  return (
    <>
      <div className="flex shrink-0 items-center gap-1.5 px-3 py-2.5">
        <TextField
          icon="file"
          className="flex-1 font-mono text-[12px]"
          value={path}
          placeholder="文件路径"
          onChange={(e) => setPath(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && onLoad()}
        />
        <Button size="sm" onClick={onPick}>
          选择
        </Button>
        <Button size="sm" variant="primary" icon="refresh" aria-label="打开" disabled={!path.trim() || loading} onClick={onLoad} />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        {error && <p className="rounded-control border border-line bg-surface px-3 py-2 font-sans text-[12px] text-danger">{error}</p>}
        {!file && !error && (
          <EmptyState icon="file" title="没有打开文件" hint="输入路径或从磁盘选择 Markdown、代码、图片。" />
        )}
        {file && <FileBody file={file} />}
      </div>
    </>
  );
}

function FileBody({ file }: { file: FilePreview }) {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  const theme = useTheme((s) => s.theme);
  const [codeHtml, setCodeHtml] = useState("");

  useEffect(() => {
    if (file.kind !== "text" || file.content == null) return;
    let alive = true;
    setCodeHtml("");
    highlightCode(file.content, EXT_LANG[ext] ?? "text", theme).then((h) => alive && setCodeHtml(h));
    return () => {
      alive = false;
    };
  }, [file, ext, theme]);

  return (
    <div>
      <div className="mb-2 flex items-center gap-2 font-sans text-[11px] text-ink-faint">
        <span className="truncate font-mono text-ink-muted">{file.name}</span>
        <span className="ml-auto shrink-0">{formatBytes(file.size)}</span>
      </div>
      {file.kind === "image" && file.dataUrl && (
        <div className="flex items-center justify-center rounded-card border border-line bg-surface p-4">
          <img src={file.dataUrl} alt={file.name} className="max-h-[70vh] max-w-full rounded-chip" />
        </div>
      )}
      {file.kind === "markdown" && file.content != null && (
        <div className="rounded-card border border-line bg-surface px-5 py-4">
          <Markdown source={file.content} />
        </div>
      )}
      {file.kind === "text" &&
        file.content != null &&
        (codeHtml ? (
          <div className="overflow-x-auto [&_pre]:rounded-card [&_pre]:border [&_pre]:border-line [&_pre]:p-3 [&_pre]:text-[12.5px]" dangerouslySetInnerHTML={{ __html: codeHtml }} />
        ) : (
          <pre className="overflow-auto rounded-card border border-line bg-surface p-3 text-[12.5px] leading-relaxed text-ink">
            {escapeHtml(file.content)}
          </pre>
        ))}
      {file.kind === "binary" && (
        <EmptyState icon="file" title="无法预览二进制文件" hint={`${file.name}（${formatBytes(file.size)}）`} />
      )}
      {file.truncated && <p className="mt-2 font-sans text-[11px] text-warn">文件较大，仅显示前 512 KB。</p>}
    </div>
  );
}

const isLocal = (u: string) => /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i.test(u) || /^http:\/\/localhost:\d+/.test(u);

function WebMode({ cwd }: { cwd: string | null }) {
  const [url, setUrl] = useState("http://localhost:3000");
  const [current, setCurrent] = useState(url);
  const [nonce, setNonce] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const local = useMemo(() => isLocal(current), [current]);

  const go = () => {
    if (!/^https?:\/\//i.test(url.trim())) {
      setError("请输入以 http:// 或 https:// 开头的地址");
      return;
    }
    setError(null);
    setCurrent(url.trim());
    setNonce((n) => n + 1);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-1.5 px-3 py-2.5">
        <TextField
          icon="globe"
          className="flex-1 font-mono text-[12px]"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && go()}
          placeholder="http://localhost:3000"
        />
        <Button size="sm" variant="primary" icon="refresh" aria-label="刷新" onClick={go} />
        <Button
          size="sm"
          icon="external"
          aria-label="在系统浏览器打开"
          onClick={() => {
            setError(null);
            openUrl(current).catch((e) => setError(errorText(e)));
          }}
        />
      </div>
      {error && <p className="px-3 pb-2 font-sans text-[12px] text-danger">{error}</p>}
      {!local && (
        <p className="mx-3 mb-2 flex items-start gap-1.5 rounded-control border border-line bg-surface px-2.5 py-2 font-sans text-[11px] leading-relaxed text-ink-muted">
          <Icon name="warning" size={12} className="mt-px shrink-0 text-warn" />
          只有 localhost 地址能在内置 WebView 中打开；其他站点请使用右侧按钮在系统浏览器中查看。
        </p>
      )}
      <div className="min-h-0 flex-1 px-3 pb-3">
        {local ? (
          <iframe
            key={nonce}
            src={current}
            title="网页预览"
            className="size-full rounded-card border border-line bg-surface"
            sandbox="allow-scripts allow-forms allow-same-origin allow-popups"
          />
        ) : (
          <div className="flex h-full items-center justify-center rounded-card border border-dashed border-line bg-surface">
            <EmptyState
              icon="globe"
              title="此地址不支持内嵌"
              hint="macOS / Windows / Linux 的 WebView 对外部站点策略不同，Loom 只内嵌 localhost。"
              action={<Button icon="external" onClick={() => openUrl(current)}>在系统浏览器打开</Button>}
            />
          </div>
        )}
      </div>
      {cwd && <p className="shrink-0 border-t border-line px-3 py-1.5 font-sans text-[11px] text-ink-faint">工作目录 {cwd}</p>}
    </div>
  );
}
