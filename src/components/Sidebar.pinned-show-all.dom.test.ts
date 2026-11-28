// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initialState, type Bot } from "@/state/store";
import { forgetSidebarShowAllForTests, SIDEBAR_SHOW_ALL_KEY } from "@/lib/sidebar-preferences";

vi.mock("./DesktopCapabilities", () => ({ useDesktopCapabilities: () => ({}) }));
vi.mock("@/lib/interface-mode", async (original) => ({ ...await original<typeof import("@/lib/interface-mode")>(), useAdvancedMode: () => true }));

const { BotThreadList, botRowProps } = await import("./Sidebar");
const { SidebarBotActivity } = await import("./SidebarBotActivity");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Nine loose threads: the short list keeps six, so the oldest are hidden until "Show all".
const loose = Array.from({ length: 9 }, (_, index) => ({ threadId: `loose-${index}`, title: `Loose chat ${index}`, createdAt: 100 + index }));
const filed = [
  { threadId: "filed-pinned", title: "Filed pinned", createdAt: 1_000, projectId: "folder", pinned: true },
  { threadId: "filed-plain", title: "Filed plain", createdAt: 1_001, projectId: "folder" },
];
const bot: Bot = {
  id: "maus", threadId: "loose-8", name: "Maus", title: "", description: "", notifications: true,
  color: "green", unread: false, messages: [], modelSelection: { instanceId: "fake", model: "test" },
  projects: [{ id: "folder", name: "Taxes" }],
  tasks: [...loose, ...filed],
};

let host: HTMLElement;
let root: Root;
const mount = async (owner = bot) => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root.render(createElement(BotThreadList, { ...botRowProps(initialState, vi.fn(), owner, { density: "comfortable", query: "", onMenu: vi.fn() }), selected: true }));
  });
};
const unmount = async () => {
  await act(async () => { root.unmount(); });
  host.remove();
};
const button = (label: string) => [...host.querySelectorAll("button")]
  .find((element) => element.textContent?.trim() === label || element.getAttribute("aria-label") === label);
const click = async (label: string) => {
  const target = button(label);
  expect(target, label).toBeTruthy();
  await act(async () => { target!.click(); });
};
const saved = () => JSON.parse(localStorage.getItem(SIDEBAR_SHOW_ALL_KEY) ?? "[]");

beforeEach(() => {
  localStorage.clear();
  forgetSidebarShowAllForTests();
});
afterEach(() => { document.body.innerHTML = ""; });

describe("a bot's Show all threads", () => {
  it("stays on after the list unmounts (bot collapsed or app reloaded) until Show fewer", async () => {
    await mount();
    expect(host.textContent).not.toContain("Loose chat 0");
    await click("Show all 11 threads");
    expect(host.textContent).toContain("Loose chat 0");
    await unmount();

    forgetSidebarShowAllForTests(); // read it back from storage, as a reload would
    expect(saved()).toEqual(["maus"]);
    await mount();
    expect(host.textContent).toContain("Loose chat 0");
    expect(button("Show all 11 threads")).toBeUndefined();

    await click("Show fewer threads");
    expect(host.textContent).not.toContain("Loose chat 0");
    expect(button("Show all 11 threads")).toBeTruthy();
    expect(saved()).toEqual([]);
    await unmount();
  });

  it("reads a change another window saved while no list was showing", async () => {
    await mount();
    await click("Show all 11 threads");
    await unmount();

    localStorage.setItem(SIDEBAR_SHOW_ALL_KEY, "[]"); // another window picked Show fewer meanwhile
    await mount();
    expect(host.textContent).not.toContain("Loose chat 0");
    expect(button("Show all 11 threads")).toBeTruthy();
    await unmount();
  });
});

describe("a bot's main thread", () => {
  const rows = () => [...host.querySelectorAll("[data-sidebar-thread-row]")].map((row) => row.getAttribute("data-sidebar-thread-row"));

  it("uses the same recent limit and show-all order for a designated thread", async () => {
    await mount({ ...bot, mainThreadId: "loose-0" });
    expect(rows()).not.toContain("loose-0");
    await click("Show all 11 threads");
    expect(rows()).toEqual(["filed-pinned", "filed-plain", ...loose.map((task) => task.threadId).reverse()]);
    expect(host.querySelector("[data-main-thread-mark]")).toBeNull();
    await unmount();
  });

  it("leaves the thread in its folder below pinned threads", async () => {
    await mount({ ...bot, mainThreadId: "filed-plain" });
    expect(rows().slice(0, 2)).toEqual(["filed-pinned", "filed-plain"]);
    expect(rows().filter((id) => id === "filed-plain")).toHaveLength(1);
    await click("Collapse Taxes threads");
    expect(rows()).not.toContain("filed-plain");
    expect(rows()[0]).toBe("filed-pinned");
    await unmount();
  });

  it("ranks folders using their pinned threads even when one is designated main", async () => {
    const folders = () => [...host.querySelectorAll("[data-sidebar-folder-row]")].map((row) => row.getAttribute("data-sidebar-folder-row"));
    await mount({ ...bot, mainThreadId: "later-pinned",
      projects: [...bot.projects!, { id: "later", name: "Later" }],
      tasks: [...bot.tasks!, { threadId: "later-pinned", title: "Later pinned", createdAt: 2_000, projectId: "later", pinned: true }],
    });
    expect(folders()).toEqual(["later", "folder"]);
    await unmount();
  });

  it("hides the badge on a collapsed web bot too", () => {
    const html = renderToStaticMarkup(createElement(SidebarBotActivity, {
      bot: { ...bot, mainThreadId: "filed-pinned" }, rowThreadId: bot.threadId, density: "comfortable", pendingQueued: {}, dispatch: vi.fn(),
    }));
    expect(html).toContain("Filed pinned");
    expect(html).not.toContain("data-main-thread-mark");
  });
});

describe("a collapsed folder", () => {
  it("keeps showing its pinned threads and hides the rest", async () => {
    await mount();
    expect(host.textContent).toContain("Filed plain");
    await click("Collapse Taxes threads");
    expect(host.textContent).toContain("Filed pinned");
    expect(host.textContent).not.toContain("Filed plain");
    await unmount();
  });
});

describe("a collapsed bot's pinned thread", () => {
  it("is marked pinned, not unread, when nothing is going on in it", () => {
    const html = renderToStaticMarkup(createElement(SidebarBotActivity, {
      bot, rowThreadId: bot.threadId, density: "comfortable", pendingQueued: {}, dispatch: vi.fn(),
    }));
    expect(html).toContain('aria-label="Maus: Filed pinned · Pinned"');
    expect(html).not.toContain("Unread");
  });
});
