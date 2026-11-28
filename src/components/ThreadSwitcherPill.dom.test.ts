// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Action, Bot, Task } from "@/state/store";

const dispatch = vi.hoisted(() => vi.fn());
const store = vi.hoisted(() => ({ state: {} as Record<string, unknown> }));
vi.mock("@/state/store-select", () => ({ useStoreDispatch: () => dispatch, useStoreSelector: (select: (state: unknown) => unknown) => select(store.state) }));
vi.mock("./Avatar", () => ({ BotAvatar: () => null }));
vi.mock("@/lib/cloud-guest", () => ({
  useCanWriteIn: (threadId: string, level?: string) => level !== "view" && threadId !== "guest-readonly",
}));

import { ChatHeadPill } from "./ChatHeadPill";
import { useThreadCycleKeys } from "./thread-cycle";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const task = (threadId: string, title: string, at: number, extra: Partial<Task> = {}): Task => ({ threadId, title, createdAt: at, lastThreadOrderAt: at, ...extra });
const pepper = (tasks: Task[], threadId: string): Bot => ({ id: "pepper", name: "Pepper", threadId, mainThreadId: "sales", tasks, messages: [] } as unknown as Bot);
const THREADS = [task("sales", "Weekly sales", 5, { busy: true }), task("launch", "Launch plan", 1, { pinned: true }), task("trip", "Berlin trip", 3)];

let root: Root | null = null;
const onToggle = vi.fn();
/** The compact header and the app's Ctrl+Tab listener. */
function Header({ bot }: { bot: Bot }) {
  useThreadCycleKeys();
  return createElement(ChatHeadPill, { bot, avatar: {} as never, privacy: null, onToggle, switcher: true });
}
const render = (bot: Bot, others: Bot[] = []) => {
  store.state = { settingsOpen: false, pendingQueued: {}, bots: [bot, ...others], selectedId: bot.id, activeView: "chat", shortcutsOpen: false, newChat: null };
  if (!root) root = createRoot(document.body.appendChild(document.createElement("div")));
  act(() => root!.render(createElement(Header, { bot })));
};
const q = <T extends Element = HTMLElement>(selector: string) => document.querySelector<T & HTMLElement>(selector);
const chips = () => [...document.querySelectorAll<HTMLElement>("[role=option]")];
const sent = () => dispatch.mock.calls.map(([action]) => action as Action);
const trigger = () => q<HTMLButtonElement>("[data-chathead-threads]")!;
const open = () => act(() => trigger().click());
const key = (key: string, modifiers: KeyboardEventInit = {}) => act(() => {
  document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...modifiers }));
});

beforeEach(() => { dispatch.mockClear(); onToggle.mockClear(); });
afterEach(() => { act(() => root?.unmount()); root = null; document.body.innerHTML = ""; });

describe("the pill's thread switcher", () => {
  it("names the action, bot and current thread on one button, without opening the profile", () => {
    render(pepper(THREADS, "launch"));
    expect(trigger().textContent).toContain("Threads");
    expect(trigger().textContent).toContain("Pepper");
    expect(trigger().querySelector("[data-chathead-conversation]")?.textContent).toBe("Launch plan");
    expect(trigger().getAttribute("aria-haspopup")).toBe("dialog");
    act(() => { trigger().dispatchEvent(new MouseEvent("mouseover", { bubbles: true })); });
    expect(q("[role=dialog]")).toBeNull();
    act(() => (trigger().querySelector("[dir=auto]") as HTMLElement).click());
    expect(onToggle).not.toHaveBeenCalled();
    expect(trigger().getAttribute("aria-expanded")).toBe("true");
    expect(document.getElementById(trigger().getAttribute("aria-controls")!)).toBe(q("[role=dialog]"));
    expect(q("[role=dialog] h2")?.textContent).toBe("Pepper threads");
  });

  it("lists only this bot's threads vertically, pinned first, with the open thread selected", () => {
    const other = { ...pepper([task("other", "A different bot's plan", 9)], "other"), id: "salt", name: "Salt" };
    render(pepper(THREADS, "launch"), [other]);
    open();
    expect(q("[role=listbox]")?.getAttribute("aria-orientation")).toBe("vertical");
    expect(chips().map((chip) => chip.textContent)).toEqual(["Launch plan", "Weekly sales", "Berlin trip"]);
    expect(chips()[0].getAttribute("aria-selected")).toBe("true");
    expect(chips()[1].querySelector('[aria-label="Working"]')).not.toBeNull();
    expect(chips()[0].querySelector('[aria-label="Pinned"]')).not.toBeNull();
  });

  it("switches to a picked thread and folds back", () => {
    render(pepper(THREADS, "launch"));
    act(() => q("[data-chathead-threads]")!.click());
    act(() => chips()[2].click());
    expect(sent()).toEqual([{ type: "switchTask", botId: "pepper", threadId: "trip" }]);
    expect(q("[role=listbox]")).toBeNull();
  });

  it("moves focus down and up without switching, traps Tab, and returns focus on Escape", () => {
    render(pepper(THREADS, "sales"));
    open();
    expect(document.activeElement).toBe(chips()[1]);
    key("ArrowDown");
    expect(document.activeElement).toBe(chips()[2]);
    key("Home");
    expect(document.activeElement).toBe(chips()[0]);
    key("End");
    key("ArrowUp");
    expect(document.activeElement).toBe(chips()[1]);
    act(() => q("[data-thread-chip-new]")!.focus());
    key("Tab");
    expect(document.activeElement).toBe(q('[aria-label="Close"]'));
    key("Tab", { shiftKey: true });
    expect(document.activeElement).toBe(q("[data-thread-chip-new]"));
    key("Escape");
    expect(q("[role=dialog]")).toBeNull();
    expect(document.activeElement).toBe(trigger());
    expect(sent()).toEqual([]);
  });

  it("dismisses with Close, the backdrop or the selected thread without switching", () => {
    render(pepper(THREADS, "launch"));
    open();
    act(() => q('[role=dialog] [aria-label="Close"]')!.click());
    expect(q("[role=dialog]")).toBeNull();
    open();
    act(() => q("[role=dialog]")!.parentElement!.click());
    expect(q("[role=dialog]")).toBeNull();
    open();
    act(() => q('[role=option][aria-selected="true"]')!.click());
    expect(q("[role=dialog]")).toBeNull();
    expect(sent()).toEqual([]);
  });

  it("starts a new thread for the current bot", () => {
    render(pepper(THREADS, "launch"));
    open();
    expect(q("[data-thread-chip-new]")!.textContent).toBe("New thread");
    act(() => q("[data-thread-chip-new]")!.click());
    expect(sent()).toEqual([{ type: "newTask", botId: "pepper" }]);
    expect(q("[role=dialog]")).toBeNull();
  });

  it.each([
    { ...pepper(THREADS, "launch"), yourAccess: "view" as const },
    pepper([...THREADS, task("guest-readonly", "Shared for reading", 2)], "guest-readonly"),
  ])("lets a read-only viewer switch but not create threads", bot => {
    render(bot);
    open();
    expect(q("[data-thread-chip-new]")).toBeNull();
    act(() => q('[data-thread-chip="trip"]')!.click());
    expect(sent()).toEqual([{ type: "switchTask", botId: "pepper", threadId: "trip" }]);
  });

  it("shows a thread another bot opened, beside the main thread", () => {
    const lead = { botId: "lead", name: "Lead", at: 1 };
    render(pepper([task("sales", "Weekly sales", 5), task("brief", "Launch brief", 3, { openedBy: lead })], "sales"));
    open();
    expect(chips().map((chip) => chip.textContent)).toEqual(["Weekly sales", "Launch brief"]);
  });

  it("Ctrl+Tab outside the dialog walks the threads in the listed order, wrapping", () => {
    const helper = task("brief", "Launch brief", 4, { openedBy: { botId: "lead", name: "Lead", at: 1 } });
    const threads = [...THREADS, helper];
    render(pepper(threads, "launch"));
    act(() => q("[data-chathead-threads]")!.click());
    const order = chips().map((chip) => chip.dataset.threadChip!);
    expect(order).toEqual(["launch", "sales", "brief", "trip"]);
    act(() => q('[role=dialog] [aria-label="Close"]')!.click());
    const visited: string[] = [];
    let open = order[0]!;
    for (let step = 0; step < order.length; step += 1) {
      act(() => { document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", ctrlKey: true, bubbles: true, cancelable: true })); });
      const action = sent().at(-1) as Extract<Action, { type: "switchTask" }>;
      open = action.threadId;
      visited.push(open);
      render(pepper(threads, open));
    }
    expect(visited).toEqual([...order.slice(1), order[0]]);
  });

  it("keeps Threads and New thread available with just one thread", () => {
    render(pepper([task("sales", "Weekly sales", 5)], "sales"));
    open();
    expect(chips().map(chip => chip.textContent)).toEqual(["Weekly sales"]);
    expect(chips()[0].getAttribute("aria-selected")).toBe("true");
    expect(q("[data-thread-chip-new]")!.textContent).toBe("New thread");
  });

  it("includes the open thread before its task row arrives", () => {
    render(pepper([], "sales"));
    open();
    expect(chips().map(chip => chip.textContent)).toEqual(["Untitled chat"]);
    expect(document.activeElement).toBe(chips()[0]);
    expect(chips()[0].dataset.threadChip).toBe("sales");
  });
});
