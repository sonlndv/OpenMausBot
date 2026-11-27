import { Check, Lock, Users } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type RefObject } from "react";
import { RESULTS_JUST_ME, RESULTS_NEW_THREAD } from "../../../shared/routines";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import type { Bot } from "@/state/store";
import { useTeamPeople } from "@/state/team-people";
import { usePopoverDismiss } from "@/hooks/use-popover-dismiss";
import { MENU_GUTTER, MENU_META, MENU_NOTE, MENU_ROW, MENU_SHEET } from "../menu-recipe";
import { nextMenuIndex } from "../SidebarPopoverMenu";
import { sharedChatAudience } from "../TeamPrivateChatsLine";

/** What of the app's state says where a routine's form was opened. */
export interface RoutinePlace {
  activeView: string;
  selectedId: string;
  bots: readonly Bot[];
  config?: { team?: { name: string } } | null;
}

/** A new routine starts with the audience of the place its form was opened from. On a team's Cloud that is the shared
 * chat only while this bot's shared chat is on screen; in a private chat, and anywhere that is no chat with this bot,
 * it is the person alone, so nothing is shared that they did not choose to share. Off a team: undefined. */
export function resultsOfPlace(place: RoutinePlace, botId: string | undefined): string | null | undefined {
  if (!place.config?.team) return undefined;
  const bot = place.bots.find((candidate) => candidate.id === botId);
  if (bot?.defaultBot?.person) return null;
  const shown = bot && place.activeView === "chat" && place.selectedId === bot.id ? bot.tasks?.find((task) => task.threadId === bot.threadId) : undefined;
  return shown && shown.private !== true && !shown.routineRunId ? bot!.mainThreadId ?? null : RESULTS_JUST_ME;
}

/** Whether a routine reporting here is the person's alone: their own MausBot's, "Just me", or one of their private chats. */
function onlyMine(bot: Bot, value: string | null | undefined, madeIn?: string): boolean {
  const own = (threadId: string | null | undefined) => typeof threadId === "string" && Boolean(bot.tasks?.some((task) => task.threadId === threadId && task.private === true));
  return Boolean(bot.defaultBot?.person) || value === RESULTS_JUST_ME || own(value) || own(madeIn);
}

/** On a team's Cloud, always in view in a routine's form: who will see the routine and what it reports, in the words
 * of the label by the message box. `madeIn`: the chat an existing routine was made in. */
export function RoutineAudience({ team, bot, value, madeIn }: { team?: { name: string } | null; bot?: Bot; value: string | null | undefined; madeIn?: string }) {
  if (!team || !bot) return null;
  const mine = onlyMine(bot, value, madeIn), Icon = mine ? Lock : Users;
  return <p role="note" data-routine-audience={mine ? "me" : "shared"} className="mt-2 flex items-center gap-1 text-[12px] leading-4 text-ink-secondary">
    <Icon size={12} aria-hidden="true" className="shrink-0" /><span>{mine ? t("team.privateHeader") : sharedChatAudience(team.name, bot.onlyPeopleAdded)}</span>
  </p>;
}

const webResults = () => typeof window === "undefined" || !window.ogb;

export function resultsDestinationLabel(): string {
  return t(webResults() ? "routines.results.futureLabel" : "routines.results.label");
}

export function defaultResultsTitle(bot?: Bot): string {
  if (!webResults()) return t("routines.results.main");
  const chat = bot?.tasks?.find((task) => task.threadId === bot.mainThreadId);
  return chat?.title ? t("routines.results.namedDefaultChat", { thread: chat.title }) : t("routines.results.defaultChat");
}

interface ThreadRow { threadId: string; title: string; folder: string }

/** The bot's visible conversations a routine may report into, each with the folder that tells duplicates apart. */
function threadRows(bot?: Bot): ThreadRow[] {
  const projects = bot?.projects ?? [];
  return (bot?.tasks ?? []).filter((task) => !task.routineRunId).map((task) => ({
    threadId: task.threadId,
    title: task.title,
    folder: projects.find((project) => project.id === task.projectId)?.name ?? t("folder.none"),
  }));
}

function ownPrivateChat(bot: Bot | undefined, value: string | null | undefined): boolean {
  return typeof value === "string" && Boolean(bot?.tasks?.some((task) => task.threadId === value && task.private === true));
}

/** The current destination in plain words. `missing`: a pinned thread that no longer exists, shown honestly. */
function destinationText(bot: Bot | undefined, value: string | null | undefined, team: boolean): { text: string; missing?: boolean } {
  if (team) return { text: value === RESULTS_JUST_ME || ownPrivateChat(bot, value) ? t("routines.results.justMe") : t("task.sharedChat") };
  if (value == null) return { text: defaultResultsTitle(bot) };
  if (value === RESULTS_NEW_THREAD) return { text: t("routines.results.newPending") };
  const thread = threadRows(bot).find((row) => row.threadId === value);
  if (!thread) return { text: t("routines.results.missing"), missing: true };
  return { text: bot?.projects?.length ? `${thread.title} · ${thread.folder}` : thread.title };
}

/** A compact row naming where results go, with a Change button that opens the destination picker. */
export function ResultsDestination({ bot, value, team, onChange }: {
  bot?: Bot;
  value: string | null | undefined;
  /** A Team Cloud, where the routine reports to the person alone or to the bot's shared chat; read from the app when unset. */
  team?: boolean;
  onChange: (threadId: string | null | undefined) => void;
}) {
  const labelId = useId(), people = useTeamPeople();
  const onTeam = team ?? people !== null;
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const changeRef = useRef<HTMLButtonElement>(null);
  usePopoverDismiss(open, rootRef, () => setOpen(false));
  const current = destinationText(bot, value, onTeam);
  // Closing without a choice never calls onChange, so Escape and a second Change click leave the value untouched.
  const closePicker = () => {
    setOpen(false);
    changeRef.current?.focus();
  };
  const pick = (threadId: string | null) => {
    onChange(threadId);
    closePicker();
  };
  return <div ref={rootRef} className="min-w-0 space-y-1.5">
    <span id={labelId} className="block text-[12px] font-medium text-ink">{resultsDestinationLabel()}</span>
    <div className="relative min-w-0">
      <div className="flex min-w-0 items-center gap-2">
        <span className={cn("min-w-0 flex-1 truncate text-[13px]", current.missing ? "text-warning" : "text-ink")} title={current.text}>{current.text}</span>
        <button ref={changeRef} type="button" disabled={!bot} aria-haspopup="true" aria-expanded={open} aria-describedby={labelId}
          className="ui-button ui-button-sm shrink-0" onClick={() => (open ? closePicker() : setOpen(true))}>
          {t("routines.results.change")}
        </button>
      </div>
      {open && (onTeam
        ? <TeamDestinationPicker bot={bot} value={value} labelId={labelId} onPick={pick} onClose={closePicker} />
        : <DestinationPicker bot={bot} value={value} labelId={labelId} onPick={pick} onClose={closePicker} />)}
    </div>
    <p className="text-[11px] leading-relaxed text-ink-secondary">{t(onTeam ? "routines.results.teamHelp" : webResults() ? "routines.results.futureHelp" : "routines.results.mainHelp")}</p>
  </div>;
}

// The row is the form's last field, so the picker opens upward to stay inside the window.
const PICKER_SHEET = cn(MENU_SHEET, "absolute bottom-full end-0 z-30 mb-1 w-[min(320px,calc(100vw-48px))] max-w-full rounded-xl");

/** Escape closes only the picker, before the dialog around it hears the key; arrows, Home and End walk the options. */
function usePickerKeys(popRef: RefObject<HTMLDivElement | null>, onClose: () => void) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const node = popRef.current;
    if (!node) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.isComposing) return;
      event.preventDefault();
      event.stopPropagation();
      closeRef.current();
    };
    node.addEventListener("keydown", onKey);
    return () => node.removeEventListener("keydown", onKey);
  }, [popRef]);
  return (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    const inSearch = target instanceof HTMLInputElement;
    if (inSearch && !["ArrowDown", "ArrowUp"].includes(event.key)) return;
    const options = [...event.currentTarget.querySelectorAll<HTMLElement>("[data-destination-option]:not(:disabled)")];
    const next = nextMenuIndex(event.key, options.indexOf(target), options.length);
    if (next === null) return;
    event.preventDefault();
    options[next]?.focus();
  };
}

function useFirstOptionFocus(popRef: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    popRef.current?.querySelector<HTMLElement>("[data-destination-option]:not(:disabled)")?.focus();
  }, [popRef]);
}

function Option({ picked, onClick, disabled, expanded, children, meta }: {
  picked: boolean; onClick?: () => void; disabled?: boolean; expanded?: boolean; children: ReactNode; meta?: string;
}) {
  return <button type="button" data-destination-option disabled={disabled} aria-expanded={expanded} onClick={onClick} className={MENU_ROW}>
    <span className={MENU_GUTTER}>{picked && <Check size={14} aria-hidden="true" />}</span>
    <span className="min-w-0 flex-1 truncate">{children}</span>
    {meta && <span className={MENU_META} title={meta}>{meta}</span>}
  </button>;
}

function DestinationPicker({ bot, value, labelId, onPick, onClose }: {
  bot?: Bot; value: string | null | undefined; labelId: string; onPick: (threadId: string | null) => void; onClose: () => void;
}) {
  const popRef = useRef<HTMLDivElement>(null);
  const [browsing, setBrowsing] = useState(() => typeof value === "string" && value !== RESULTS_NEW_THREAD);
  const [query, setQuery] = useState("");
  const onKeyDown = usePickerKeys(popRef, onClose);
  useFirstOptionFocus(popRef);
  const threads = threadRows(bot);
  const pinned = typeof value === "string" && value !== RESULTS_NEW_THREAD ? value : null;
  const missing = pinned !== null && !threads.some((row) => row.threadId === pinned);
  const hasFolders = Boolean(bot?.projects?.length);
  const typed = query.trim().toLowerCase();
  const shown = typed ? threads.filter((row) => `${row.title} ${row.folder}`.toLowerCase().includes(typed)) : threads;
  const searchKey = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter" || event.nativeEvent.isComposing || !shown[0]) return;
    event.preventDefault();
    onPick(shown[0].threadId);
  };
  return <div ref={popRef} role="group" aria-labelledby={labelId} onKeyDown={onKeyDown} className={PICKER_SHEET}>
    {missing && <Option picked disabled>{t("routines.results.unavailable")}</Option>}
    <Option picked={value == null} meta={defaultResultsTitle(bot)} onClick={() => onPick(null)}>{t("routines.results.useDefault")}</Option>
    <Option picked={pinned !== null && !missing} expanded={browsing} onClick={() => setBrowsing((state) => !state)}>{t("routines.results.choose")}</Option>
    {browsing && <>
      <input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={searchKey} dir="auto"
        aria-label={t("routines.results.search")} placeholder={t("routines.results.search")}
        className="mx-0.5 rounded-lg border border-hairline/50 bg-inset px-2.5 py-1.5 text-[13px] text-ink outline-none placeholder:text-ink-tertiary focus:border-accent" />
      <div className="max-h-60 overflow-y-auto">
        {shown.map((row) => <Option key={row.threadId} picked={row.threadId === pinned} meta={hasFolders ? row.folder : undefined} onClick={() => onPick(row.threadId)}>{row.title}</Option>)}
        {shown.length === 0 && <div className={MENU_NOTE}>{t("routines.results.noMatch")}</div>}
      </div>
    </>}
    <Option picked={value === RESULTS_NEW_THREAD} onClick={() => onPick(RESULTS_NEW_THREAD)}>{t("routines.results.new")}</Option>
  </div>;
}

/** On a Team Cloud the server honors only the person alone or the bot's shared chat, so the picker offers no more. */
function TeamDestinationPicker({ bot, value, labelId, onPick, onClose }: {
  bot?: Bot; value: string | null | undefined; labelId: string; onPick: (threadId: string | null) => void; onClose: () => void;
}) {
  const popRef = useRef<HTMLDivElement>(null);
  const onKeyDown = usePickerKeys(popRef, onClose);
  useFirstOptionFocus(popRef);
  const mine = value === RESULTS_JUST_ME || ownPrivateChat(bot, value);
  return <div ref={popRef} role="group" aria-labelledby={labelId} onKeyDown={onKeyDown} className={PICKER_SHEET}>
    <Option picked={mine} onClick={() => onPick(mine && typeof value === "string" ? value : RESULTS_JUST_ME)}>{t("routines.results.justMe")}</Option>
    <Option picked={!mine} onClick={() => onPick(bot?.mainThreadId ?? null)}>{t("task.sharedChat")}</Option>
  </div>;
}
