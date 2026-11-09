/**
 * 应用外框：侧栏铺在画布色上，主工作区是一块内缩的白色圆角面板。
 * 各模块完成后把 NAV 中对应项的 ready 置为 true。
 */
import type { ReactNode } from "react";

import markUrl from "@/assets/brand/loom-mark.svg";
import { Icon, type IconName } from "@/components/ui/Icon";

export type Route = "sessions" | "byok" | "skills" | "plugins" | "debug";

const NAV: { group: string; items: { id: Route; label: string; icon: IconName; ready: boolean }[] }[] = [
  {
    group: "工作区",
    items: [{ id: "sessions", label: "会话", icon: "chat", ready: true }],
  },
  {
    group: "配置",
    items: [
      { id: "byok", label: "API 配置", icon: "key", ready: true },
      { id: "skills", label: "Skill", icon: "spark", ready: true },
      { id: "plugins", label: "插件", icon: "puzzle", ready: true },
    ],
  },
  {
    group: "开发",
    items: [{ id: "debug", label: "CLI 调试", icon: "terminal", ready: true }],
  },
];

interface Props {
  route: Route;
  onRoute: (r: Route) => void;
  footer?: ReactNode;
  children: ReactNode;
}

function Logo() {
  return <img src={markUrl} alt="" width={26} height={26} className="select-none" draggable={false} />;
}

export function AppShell({ route, onRoute, footer, children }: Props) {
  return (
    <div className="flex h-full gap-2 bg-canvas p-2 pl-0">
      <aside className="flex w-56 shrink-0 flex-col pl-3">
        <div className="flex h-12 items-center gap-2 px-1.5">
          <Logo />
          <span className="font-serif text-[17px] font-semibold tracking-[-0.01em] text-ink">Loom</span>
        </div>

        <nav className="mt-2 flex flex-col gap-5">
          {NAV.map((g) => (
            <div key={g.group} className="flex flex-col gap-0.5">
              <div className="px-2.5 pb-1 font-sans text-[11px] font-medium tracking-wide text-ink-faint">{g.group}</div>
              {g.items.map((n) => {
                const active = n.id === route;
                return (
                  <button
                    key={n.id}
                    type="button"
                    disabled={!n.ready}
                    onClick={() => onRoute(n.id)}
                    aria-current={active ? "page" : undefined}
                    className={
                      "group flex h-8 items-center gap-2.5 rounded-control px-2.5 text-left font-sans text-[13px] " +
                      "transition-colors duration-150 disabled:cursor-default " +
                      (active
                        ? "bg-surface font-medium text-ink shadow-panel"
                        : "text-ink-muted hover:bg-hover hover:text-ink disabled:hover:bg-transparent disabled:hover:text-ink-muted")
                    }
                  >
                    <Icon
                      name={n.icon}
                      size={15}
                      className={active ? "text-accent" : "text-ink-faint group-hover:text-ink-muted"}
                    />
                    <span className="flex-1">{n.label}</span>
                    {!n.ready && (
                      <span className="rounded-chip border border-line px-1.5 text-[10px] leading-4 text-ink-faint">
                        即将
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="mt-auto pb-1">{footer}</div>
      </aside>

      <main className="min-w-0 flex-1 overflow-hidden rounded-panel border border-line bg-surface shadow-panel">
        {children}
      </main>
    </div>
  );
}
