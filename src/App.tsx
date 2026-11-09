import { useEffect, useState } from "react";

import { ByokView } from "@/features/byok/ByokView";
import { CliConsole } from "@/features/debug/CliConsole";
import { PluginsView } from "@/features/plugins/PluginsView";
import { SessionsView } from "@/features/sessions/SessionsView";
import { AppShell, type Route } from "@/features/shell/AppShell";
import { SkillsView } from "@/features/skills/SkillsView";
import { StatusDot } from "@/components/ui/StatusDot";
import { useConfig } from "@/stores/config";
import { errorText, ipc, type CliInfo } from "@/lib/ipc";

export function App() {
  const [route, setRoute] = useState<Route>("sessions");
  const [cli, setCli] = useState<CliInfo | { error: string } | null>(null);
  const cfg = useConfig((s) => s.config);
  const init = useConfig((s) => s.init);
  const profile = cfg.profiles.find((p) => p.id === cfg.activeProfileId);

  useEffect(() => {
    void init();
    ipc.cliLocate(cfg.cliPath || undefined).then(setCli, (e) => setCli({ error: errorText(e) }));
    // cliPath 变化后重新定位
  }, [init, cfg.cliPath]);

  const footer = (
    <div
      title={cli ? ("error" in cli ? cli.error : cli.path) : undefined}
      className="flex items-center gap-2.5 rounded-card border border-line bg-surface px-3 py-2.5 shadow-subtle"
    >
      <StatusDot tone={cli === null ? "idle" : "error" in cli ? "danger" : "ok"} pulse={cli === null} />
      <div className="min-w-0 font-sans leading-tight">
        <div className="text-[12px] font-medium text-ink">Claude Code</div>
        <div className="truncate text-[11px] text-ink-faint">
          {cli === null ? "正在查找…" : "error" in cli ? "未找到 CLI" : (cli.version?.split(" ")[0] ?? "已就绪")}
          {profile ? ` · ${profile.name}` : ""}
        </div>
      </div>
    </div>
  );

  return (
    <AppShell route={route} onRoute={setRoute} footer={footer}>
      {route === "sessions" && <SessionsView />}
      {route === "byok" && <ByokView />}
      {route === "skills" && <SkillsView />}
      {route === "plugins" && <PluginsView />}
      {route === "debug" && <CliConsole />}
    </AppShell>
  );
}
