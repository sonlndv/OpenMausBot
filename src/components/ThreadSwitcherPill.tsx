import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Check, ChevronDown, Pin, Plus, X } from "lucide-react";
import { useModalDialog } from "@/hooks/use-modal-dialog";
import { useCanWriteIn } from "@/lib/cloud-guest";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { localizedTaskTitle } from "@/lib/task-title";
import type { Bot } from "@/state/store";
import { useStoreDispatch } from "@/state/store-select";
import { ELEVATED_FLOAT, ELEVATED_HOVER } from "./elevated";
import { Layer } from "./Layer";
import { openTabId, stripTabs, type ThreadTab } from "./thread-tabs";

const FOCUS = "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus";
const ROW = "flex min-h-12 w-full items-center gap-3 rounded-xl px-3 py-2 text-start text-base hover:bg-raised";
const tabTitle = (tab: ThreadTab) => tab.draft ? t("task.newShort") : localizedTaskTitle(tab.title || "New thread");

function ThreadDropdown({ anchor, bot, tabs, active, canWrite, id, onClose }: {
  anchor: HTMLButtonElement; bot: Bot; tabs: ThreadTab[]; active: string; canWrite: boolean; id: string; onClose: () => void;
}) {
  const dispatch = useStoreDispatch();
  const dialog = useRef<HTMLElement>(null);
  const firstFocus = useRef<HTMLButtonElement>(null);
  const [focusId, setFocusId] = useState(tabs.find(tab => tab.threadId === active)?.threadId ?? tabs[0]?.threadId);
  useLayoutEffect(() => {
    const place = () => {
      const rect = anchor.getBoundingClientRect();
      dialog.current?.style.setProperty("--thread-anchor-center", `${rect.left + rect.width / 2}px`);
      dialog.current?.style.setProperty("--thread-dropdown-top", `${rect.bottom + 6}px`);
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(anchor);
    window.addEventListener("resize", place);
    return () => { observer.disconnect(); window.removeEventListener("resize", place); };
  }, [anchor]);
  useModalDialog(dialog, onClose);
  useEffect(() => { firstFocus.current?.focus(); }, []);

  const moveFocus = (event: KeyboardEvent<HTMLDivElement>) => {
    const options = event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="option"]');
    const at = Array.from(options).indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    const to = event.key === "ArrowDown" ? Math.min(at + 1, options.length - 1) : event.key === "ArrowUp" ? Math.max(at - 1, 0)
      : event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 : null;
    if (to === null) return;
    event.preventDefault();
    options[to]?.focus();
  };

  return <div className="fixed inset-0 z-[60]"
    onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={dialog} id={id} role="dialog" aria-modal="true" aria-labelledby={`${id}-heading`} tabIndex={-1}
      className="thread-dropdown absolute flex flex-col overflow-hidden rounded-2xl border border-hairline bg-panel text-ink shadow-xl outline-none">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-hairline/50 py-2 ps-5 pe-2">
        <h2 id={`${id}-heading`} className="min-w-0 font-semibold [overflow-wrap:anywhere]">{t("task.namedList", { name: bot.name })}</h2>
        <button type="button" aria-label={t("common.close")} onClick={onClose} className={cn("flex size-11 shrink-0 items-center justify-center rounded-full text-ink-secondary hover:bg-raised", FOCUS)}>
          <X size={18} aria-hidden="true" />
        </button>
      </header>
      <div role="listbox" aria-labelledby={`${id}-heading`} aria-orientation="vertical" onKeyDown={moveFocus}
        className="flex min-h-0 flex-col overflow-y-auto overscroll-contain p-2">
        {tabs.map(tab => {
          const selected = tab.threadId === active;
          const focusable = tab.threadId === focusId;
          return <button key={tab.threadId} type="button" role="option" aria-selected={selected} data-thread-chip={tab.threadId}
            ref={focusable ? firstFocus : undefined} tabIndex={focusable ? 0 : -1} onFocus={() => setFocusId(tab.threadId)}
            onClick={() => {
              if (!selected) dispatch({ type: "switchTask", botId: bot.id, threadId: tab.threadId });
              onClose();
            }}
            className={cn(ROW, FOCUS, "shrink-0", selected && "bg-raised font-medium")}>
            <span dir="auto" className="min-w-0 flex-1 [overflow-wrap:anywhere]">{tabTitle(tab)}</span>
            {tab.working && <span role="img" aria-label={t("chat.activity.working")} className="size-2 shrink-0 animate-pulse rounded-full bg-success motion-reduce:animate-none" />}
            {tab.pinned && <Pin size={15} role="img" aria-label={t("task.pinned")} className="shrink-0 text-ink-tertiary" />}
            {selected && <Check size={18} aria-hidden="true" className="shrink-0 text-accent" />}
          </button>;
        })}
      </div>
      {canWrite && <div className="shrink-0 border-t border-hairline/50 p-2">
        <button type="button" data-thread-chip-new onClick={() => { dispatch({ type: "newTask", botId: bot.id }); onClose(); }}
          className={cn(ROW, FOCUS, "font-medium")}>
          <Plus size={18} aria-hidden="true" />{t("task.newShort")}
        </button>
      </div>}
    </section>
  </div>;
}

export function ThreadSwitcherPill({ bot, avatar, badges }: { bot: Bot; avatar: ReactNode; badges: ReactNode }) {
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const id = useId();
  const tabs = useMemo(() => stripTabs(bot), [bot.id, bot.threadId, bot.switchingTo, bot.mainThreadId, bot.tasks, bot.busy]);
  const active = openTabId(bot);
  const current = tabs.find(tab => tab.threadId === active);
  const canWrite = useCanWriteIn(bot.threadId, bot.yourAccess);
  return <>
    <button type="button" data-chathead-pill data-chathead-threads aria-haspopup="dialog" aria-controls={anchor ? id : undefined} aria-expanded={!!anchor}
      onClick={event => { event.currentTarget.focus({ preventScroll: true }); setAnchor(event.currentTarget); }}
      className={cn("phone-header-surface flex min-h-11 min-w-0 max-w-full items-center gap-2 rounded-full ps-2 pe-3 py-1 text-start text-ink", ELEVATED_FLOAT, ELEVATED_HOVER, FOCUS)}>
      <span aria-hidden="true" className="shrink-0">{avatar}</span>
      <span className="flex min-w-0 flex-col">
        <span className="flex min-w-0 items-center gap-1 text-xs leading-4 text-ink-secondary">
          <span className="shrink-0 font-medium">{t("task.list")}</span><span aria-hidden="true">·</span>
          <span dir="auto" className="min-w-0 truncate">{bot.name}</span>{badges}
        </span>
        <span data-chathead-conversation dir="auto" className="line-clamp-2 text-base font-semibold leading-5 [overflow-wrap:anywhere]">{current ? tabTitle(current) : t("task.untitledChat")}</span>
      </span>
      <ChevronDown size={15} aria-hidden="true" className={cn("shrink-0 text-ink-secondary", anchor && "rotate-180")} />
    </button>
    {anchor && <Layer modal><ThreadDropdown anchor={anchor} id={id} bot={bot} tabs={tabs} active={active} canWrite={canWrite === true} onClose={() => setAnchor(null)} /></Layer>}
  </>;
}
