// @vitest-environment happy-dom
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot, Task } from "@/state/store";
import { setThreadsUnfolded } from "@/lib/thread-fold-preferences";
import { SidebarThreadLabels } from "./SidebarThreadLabels";

const now = Date.now();
const task = (threadId: string, title: string, hoursAgo: number, extra: Partial<Task> = {}): Task =>
  ({ threadId, title, createdAt: now - hoursAgo * 3_600_000, updatedAt: now - hoursAgo * 3_600_000, ...extra });
const research = (extra: Partial<Bot> = {}): Bot => ({
  id: "research", threadId: "pricing", name: "Research", title: "", description: "", notifications: true, color: "green",
  unread: false, modelSelection: { instanceId: "fake", model: "fake" }, messages: [],
  tasks: [task("pricing", "Competitor pricing", 1), task("home", "A long title for the conversation this bot always comes back to", 2), task("deck", "Board deck", 3)],
  ...extra,
});

let host: HTMLDivElement;
let root: Root;
const render = (bot: Bot) => flushSync(() => root.render(createElement(SidebarThreadLabels, { bot, selected: true, rowThreadId: bot.threadId, pendingQueued: {}, dispatch: vi.fn() })));
const marked = () => [...host.querySelectorAll("[data-main-thread-mark]")].map((mark) => mark.closest("[data-thread-label]")?.getAttribute("data-thread-label"));

beforeEach(() => {
  localStorage.clear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  flushSync(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe.each(["browser", "desktop"])("%s Simple thread labels", (surface) => {
  it("lists a designated conversation in recent order without marking it", () => {
    if (surface === "desktop") {
      vi.stubGlobal("ogb", {});
      setThreadsUnfolded("research", true);
    }
    render(research({ mainThreadId: "home" }));
    expect(host.querySelector('[data-thread-label="home"]')?.textContent).toContain("A long title");
    expect([...host.querySelectorAll("[data-thread-label]")].map((row) => row.getAttribute("data-thread-label"))).toEqual(["pricing", "home", "deck"]);
    expect(marked()).toEqual([]);
  });
});
