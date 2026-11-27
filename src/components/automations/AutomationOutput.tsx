import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, ArrowUpRight, ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";
import { clockOptions } from "@/lib/clock-time";
import { botInDepartment } from "@/lib/department-filter";
import { intlLocale, t } from "@/lib/i18n";
import { routineRunLabel, routineRunText, routineRunTime, routineRunTone } from "@/lib/routine-display";
import type { RoutineRun } from "@/lib/routines";
import { useShowThreads } from "@/lib/thread-preferences";
import { useBotsApartFromTurns } from "@/state/apart-from-turns";
import { useRoutineRunsFrom } from "@/state/older-routine-runs";
import { api, openThread, useStore } from "@/state/store";
import { useStoreDispatch, useStoreSelector } from "@/state/store-select";
import type { WireMessage } from "../../../shared/wire";
import { MessageAttachmentGallery } from "../AttachmentGallery";
import { VoiceNoteBubble } from "../VoiceNoteBubble";
import { ChatMarkdown } from "../ChatMarkdown";
import { Select } from "../Select";

const textButton = "inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[13px] font-medium text-ink-secondary hover:bg-raised hover:text-ink";

interface RunOutputDetail {
  output?: string;
  partialOutput?: string;
  attachments?: WireMessage["attachments"];
}

function RunDetail({ run, botName, when }: { run: RoutineRun; botName: string; when: string }) {
  const { state, dispatch } = useStore();
  const showThreads = useShowThreads();
  const [full, setFull] = useState<{ run: RoutineRun; result: RunOutputDetail; failed?: boolean }>();
  useEffect(() => {
    if (run.outputCode && run.report?.state !== "posted") return;
    let current = true;
    api<RunOutputDetail>(`/api/routine-runs/${encodeURIComponent(run.id)}/output`)
      .then(result => { if (current) setFull({ run, result }); })
      .catch(() => { if (current) setFull({ run, result: {}, failed: true }); });
    return () => { current = false; };
  }, [run]);
  const result = full?.run === run ? full.result : undefined;
  const output = result?.output ?? routineRunText(run, "output");
  const report = run.report?.state === "posted" ? run.report : undefined;
  const files = result?.attachments;
  const failed = full?.run === run && full.failed;

  const threadId = run.executionThreadId ?? run.threadId;
  const owner = run.target === "room-goal" ? state.groups.find(group => group.id === run.groupId) : state.bots.find(bot => bot.id === run.botId);
  const hasTranscript = threadId && (owner?.threadId === threadId || owner?.tasks?.some(task => task.threadId === threadId));

  return <article className="mt-4 rounded-xl border border-hairline/50 bg-panel p-4 sm:p-6">
    <h2 className="break-words text-xl font-semibold text-ink">{run.routineName}</h2>
    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-ink-secondary">
      <span>{botName}</span><time dateTime={new Date(routineRunTime(run)).toISOString()}>{when}</time>
      <span className={routineRunTone(run)}>{routineRunLabel(run)}</span>
    </div>
    <div className="my-5 border-y border-hairline/40 py-4 text-[14px] leading-relaxed">
      {run.attention && <p className="mb-2 whitespace-pre-wrap break-words text-warning">{routineRunText(run, "attention")}</p>}
      {run.error && <p className="mb-2 whitespace-pre-wrap break-words text-danger">{routineRunText(run, "error")}</p>}
      {output && <ChatMarkdown text={output} />}
      {result?.partialOutput && <ChatMarkdown text={result.partialOutput} />}
      {report && files?.length ? <>
        <MessageAttachmentGallery text="" attachments={files} message={report} />
        {files.map(file => file.kind === "audio" && <VoiceNoteBubble key={file.path} attachment={file} />)}
      </> : !failed && !output && !run.error && !run.attention && (result || !report) && <p className="text-ink-secondary">{t("routines.noOutput")}</p>}
      {failed && <p role="alert" className="text-ink-secondary">{t("automations.output.detailLoadError")}</p>}
    </div>
    {hasTranscript && <button type="button" className={textButton}
      onClick={() => openThread(dispatch, { botId: run.botId, threadId }, state, showThreads)}>
      {t("automations.output.transcript")}<ArrowUpRight size={15} aria-hidden="true" />
    </button>}
  </article>;
}

function RunList({ items, renderRows, grouped = false }: {
  items: RoutineRun[]; renderRows: (items: RoutineRun[]) => ReactNode; grouped?: boolean;
}) {
  const [limit, setLimit] = useState(25);
  const [expanded, setExpanded] = useState(false);
  const list = (!grouped || expanded) && <>
    {renderRows(items.slice(0, limit))}
    {items.length > limit && <button type="button" className={textButton}
      onClick={() => setLimit(value => value + 25)}>{t("routines.loadMore")}</button>}
  </>;
  const surface = "overflow-hidden rounded-xl border border-hairline/50 bg-panel";
  if (!grouped) return <div className={surface}>{list}</div>;
  return <details open={expanded} className={cn("group", surface)}>
    <summary onClick={event => { event.preventDefault(); setExpanded(value => !value); }}
      className="flex cursor-pointer list-none items-center gap-2 px-3 py-3 text-[14px] font-medium text-ink hover:bg-raised sm:px-4">
      <ChevronDown size={15} className="-rotate-90 text-ink-secondary group-open:rotate-0" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate">{items[0].routineName}</span><span className="text-[12px] text-ink-secondary">{items.length}</span>
    </summary>
    {list}
  </details>;
}

export function AutomationOutput({ botFilter, department, runId }: { botFilter: string; department: string; runId?: string }) {
  const runs = useStoreSelector(state => state.routineRuns);
  const loadState = useStoreSelector(state => state.routinesLoadState);
  const dispatch = useStoreDispatch(), bots = useBotsApartFromTurns(), history = useRoutineRunsFrom(0);
  const [grouped, setGrouped] = useState(false);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const needle = query.trim().toLocaleLowerCase(intlLocale());
  const lastRow = useRef<HTMLButtonElement>(null);
  const back = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (runId) back.current?.focus();
    else lastRow.current?.focus();
  }, [runId]);
  const locale = intlLocale();
  const date = useMemo(() => new Intl.DateTimeFormat(locale, {
    year: "numeric", month: "short", day: "numeric", ...clockOptions(locale), second: "2-digit",
  }), [locale]);
  const owners = useMemo(() => new Map(bots.map(bot => [bot.id, bot])), [bots]);
  const listed = useMemo(() => runs.filter(run => run.report?.state !== "quiet" && (Boolean(run.output?.trim()) || Boolean(run.outputCode) || run.report?.state === "posted") &&
    (botFilter === "all" || run.botId === botFilter) &&
    (status === "all" || run.status === status) && run.routineName.toLocaleLowerCase(locale).includes(needle) &&
    botInDepartment(owners.get(run.botId), department)).sort((a, b) => routineRunTime(b) - routineRunTime(a)), [runs, botFilter, owners, department, needle, status, locale]);
  const groups = useMemo(() => {
    const byAutomation = new Map<string, RoutineRun[]>();
    for (const run of listed) {
      const id = run.webhookId ?? run.routineId;
      const group = byAutomation.get(id);
      if (group) group.push(run);
      else byAutomation.set(id, [run]);
    }
    return byAutomation;
  }, [listed]);
  const select = (id?: string) => dispatch({ type: "showRoutines", view: "output", runId: id, botId: botFilter === "all" ? undefined : botFilter });
  const selected = runId && runs.find(run => run.id === runId);
  const ownerName = (run: RoutineRun) => owners.get(run.botId)?.name ?? t("routines.unavailableBot");
  const waiting = loadState === "loading" || history.loading;
  const error = loadState === "error" || history.error;
  const rows = (items: RoutineRun[]) => <ul className="divide-y divide-hairline/35">
    {items.map(run => <li key={run.id}>
      <button type="button" data-run-id={run.id} onClick={event => {
        lastRow.current = event.currentTarget;
        select(run.id);
      }}
        className="flex w-full items-center gap-3 px-3 py-3 text-left hover:bg-raised focus-visible:bg-raised sm:px-4">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] font-medium text-ink">{run.routineName}</span>
          <span className="mt-0.5 block text-[12px] text-ink-secondary">{ownerName(run)} · <time dateTime={new Date(routineRunTime(run)).toISOString()}>{date.format(routineRunTime(run))}</time></span>
        </span>
        <span className={cn("text-[12px] font-medium", routineRunTone(run))}>{routineRunLabel(run)}</span>
        <ChevronRight size={14} className="text-ink-secondary" aria-hidden="true" />
      </button>
      {run.output && <div className="min-w-0 px-3 pb-4 text-[14px] leading-relaxed text-ink sm:px-4">
        <ChatMarkdown text={routineRunText(run, "output")} />
      </div>}
    </li>)}
  </ul>;
  return <div className="min-h-0 flex-1 overflow-y-auto">
    <div className="mx-auto max-w-3xl p-4 sm:p-6">
      {runId && <div>
        <button ref={back} type="button" onClick={() => select()} className={textButton}><ArrowLeft size={15} aria-hidden="true" />{t("automations.output.back")}</button>
        {selected ? <RunDetail key={selected.id} run={selected} botName={ownerName(selected)} when={date.format(routineRunTime(selected))} /> :
          !waiting && !error && <p className="mt-5 text-[14px] text-ink-secondary">{t("automations.output.missing")}</p>}
      </div>}
      <div hidden={Boolean(runId)}>
        <div role="group" aria-label={t("automations.output.title")} className="mb-4 flex gap-1">
          {([false, true] as const).map(value => <button key={String(value)} type="button" aria-pressed={grouped === value} onClick={() => setGrouped(value)}
            className={cn(textButton, grouped === value && "bg-raised text-ink")}>{t(value ? "automations.output.grouped" : "automations.output.all")}</button>)}
        </div>
        <div className="mb-3 flex flex-wrap gap-2">
          <input type="search" aria-label={t("automations.output.search")} placeholder={t("automations.output.search")}
            value={query} onChange={event => setQuery(event.target.value)}
            className="min-w-32 flex-1 rounded-lg border border-hairline/40 bg-inset px-3 py-1.5 text-[13px] text-ink" />
          <Select size="sm" aria-label={t("routines.allStatuses")} value={status} onChange={event => setStatus(event.target.value)}>
            <option value="all">{t("routines.allStatuses")}</option>
            {(["queued", "running", "waiting", "completed", "failed", "cancelled", "missed"] as const).map(value =>
              <option key={value} value={value}>{t(`routines.status.${value}`)}</option>)}
          </Select>
        </div>
        {listed.length ? grouped ? <div className="space-y-2">
          {[...groups].map(([id, items]) => <RunList key={id} grouped items={items} renderRows={rows} />)}
        </div> : <RunList items={listed} renderRows={rows} />
          : !waiting && !error && <p className="text-[14px] text-ink-secondary">{t(needle || status !== "all" || botFilter !== "all" || department !== "all" ? "routines.noMatchingRuns" : "automations.output.empty")}</p>}
      </div>
      {(!runId || !selected) && (error ? <div role="alert" className="mt-3 text-[13px] text-danger">{t(history.error ? "automations.output.loadError" : "routines.loadError")}
        {history.error && <button type="button" className={textButton} onClick={history.retry}>{t("automations.output.retry")}</button>}
      </div> : waiting && <p role="status" className="mt-3 text-[13px] text-ink-secondary">{t("automations.output.loading")}</p>)}
    </div>
  </div>;
}
