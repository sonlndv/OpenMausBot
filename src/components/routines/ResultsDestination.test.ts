// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Bot } from "@/state/store";
import { RESULTS_JUST_ME, RESULTS_NEW_THREAD } from "../../../shared/routines";
import { ResultsDestination, resultsOfPlace, RoutineAudience, type RoutinePlace } from "./ResultsDestination";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const bot = {
  id: "pepper", mainThreadId: "main", projects: [{ id: "management", name: "OMB management" }],
  tasks: [
    { threadId: "main", title: "Everyday chat" },
    { threadId: "health", title: "Fleet health", projectId: "management" },
    { threadId: "health-loose", title: "Fleet health" },
    { threadId: "execution", title: "Internal run", routineRunId: "run-1" },
  ],
} as Bot;

let root: Root | null = null;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = null;
  document.body.innerHTML = "";
});

type Props = Parameters<typeof ResultsDestination>[0];
async function mount(props: Props) {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  const render = (next: Props) => act(async () => root!.render(createElement(ResultsDestination, next)));
  await render(props);
  return { host, render };
}

const buttonByText = (host: HTMLElement, text: string) =>
  [...host.querySelectorAll("button")].find((button) => button.textContent!.includes(text));
const click = (element: Element | undefined) => act(async () => (element as HTMLElement).click());
const key = (element: Element, init: KeyboardEventInit) =>
  act(async () => element.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init })));
const options = (host: HTMLElement) => [...host.querySelectorAll<HTMLButtonElement>("[data-destination-option]")];

describe("the destination row", () => {
  it("names the default chat and shows a real thread with its folder, full text reachable", async () => {
    const { host, render } = await mount({ bot, value: null, onChange: vi.fn() });
    expect(host.textContent).toContain("Post future results to");
    expect(host.textContent).toContain("Default chat · Everyday chat");
    expect(buttonByText(host, "Change")).toBeDefined();
    await render({ bot, value: "health", onChange: vi.fn() });
    const current = host.querySelector("[title]")!;
    expect(current.textContent).toBe("Fleet health · OMB management");
    expect(current.getAttribute("title")).toBe("Fleet health · OMB management");
  });

  it("shows the new-thread sentinel as a thread that will be created on save", async () => {
    const { host } = await mount({ bot, value: RESULTS_NEW_THREAD, onChange: vi.fn() });
    expect(host.textContent).toContain("New results thread (created when you save)");
  });

  it("shows a missing pinned thread honestly as a warning, never as the default", async () => {
    const { host } = await mount({ bot, value: "deleted-or-foreign", onChange: vi.fn() });
    const current = host.querySelector("[title]")!;
    expect(current.textContent).toBe("A thread that no longer exists");
    expect(current.className).toContain("text-warning");
    expect(host.textContent).not.toContain("Default chat");
  });
});

describe("the destination picker", () => {
  it("offers exactly three intentions, naming the default, and only browsing reveals the list", async () => {
    const onChange = vi.fn();
    const { host } = await mount({ bot, value: null, onChange });
    await click(buttonByText(host, "Change"));
    expect(options(host).map((option) => option.textContent)).toEqual([
      "Use default chatDefault chat · Everyday chat",
      "Choose an existing thread…",
      "Create a dedicated results thread",
    ]);
    expect(host.querySelector("input")).toBeNull();
    expect(document.activeElement).toBe(options(host)[0]);
    await click(buttonByText(host, "Use default chat"));
    expect(onChange).toHaveBeenCalledWith(null);
    expect(options(host)).toHaveLength(0);
  });

  it("lists the bot's threads without run threads, folders telling duplicate titles apart, and search filters", async () => {
    const onChange = vi.fn();
    const { host } = await mount({ bot, value: null, onChange });
    await click(buttonByText(host, "Change"));
    await click(buttonByText(host, "Choose an existing thread…"));
    expect(host.textContent).not.toContain("Internal run");
    const rows = options(host).slice(2, -1).map((option) => option.textContent);
    expect(rows).toEqual(["Everyday chatNo folder", "Fleet healthOMB management", "Fleet healthNo folder"]);
    const search = host.querySelector("input")!;
    expect(search.getAttribute("aria-label")).toBe("Find a thread");
    await act(async () => {
      // React tracks the value property, so a plain assignment would make it swallow the input event.
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(search, "fleet");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(host.textContent).not.toContain("Everyday chatNo folder");
    await key(search, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("health");
  });

  it("walks the options with the arrows and Enter, and Escape closes without changing the value", async () => {
    const onChange = vi.fn();
    const { host } = await mount({ bot, value: null, onChange });
    await click(buttonByText(host, "Change"));
    await key(document.activeElement!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(options(host)[1]);
    await key(document.activeElement!, { key: "End" });
    expect(document.activeElement!.textContent).toContain("Create a dedicated results thread");
    await click(document.activeElement!);
    expect(onChange).toHaveBeenCalledWith(RESULTS_NEW_THREAD);

    onChange.mockClear();
    await click(buttonByText(host, "Change"));
    await key(document.activeElement!, { key: "Escape" });
    expect(onChange).not.toHaveBeenCalled();
    expect(options(host)).toHaveLength(0);
    expect(document.activeElement).toBe(buttonByText(host, "Change"));
  });

  it("shows a missing pinned thread as a disabled current entry", async () => {
    const { host } = await mount({ bot, value: "deleted-or-foreign", onChange: vi.fn() });
    await click(buttonByText(host, "Change"));
    const unavailable = options(host)[0]!;
    expect(unavailable.textContent).toContain("Thread unavailable. Choose another.");
    expect(unavailable.disabled).toBe(true);
  });

  it("on a team offers Just me and the shared chat only, keeping an own private chat as Just me", async () => {
    const team = { ...bot, tasks: [...bot.tasks!, { threadId: "mine", title: "Bob's plans", private: true }] } as Bot;
    const onChange = vi.fn();
    const { host, render } = await mount({ bot: team, value: null, team: true, onChange });
    expect(host.textContent).toContain("Shared chat");
    await click(buttonByText(host, "Change"));
    expect(options(host).map((option) => option.textContent)).toEqual(["Just me", "Shared chat"]);
    expect(host.textContent).not.toContain("Fleet health");
    expect(host.textContent).not.toContain("Create a dedicated results thread");
    await click(buttonByText(host, "Just me"));
    expect(onChange).toHaveBeenCalledWith(RESULTS_JUST_ME);

    await render({ bot: team, value: "mine", team: true, onChange });
    expect(host.textContent).toContain("Just me");
    await click(buttonByText(host, "Change"));
    await click(options(host)[0]);
    expect(onChange).toHaveBeenLastCalledWith("mine");
    await click(buttonByText(host, "Change"));
    await click(options(host)[1]);
    expect(onChange).toHaveBeenLastCalledWith("main");
  });
});

describe("on a team's Cloud", () => {
  const quotes = { id: "quotes", threadId: "mine", mainThreadId: "main", tasks: [
    { threadId: "main", title: "Shared chat", sharedChat: true }, { threadId: "mine", title: "Salary talk", private: true }, { threadId: "run", title: "A run", routineRunId: "run-1" },
  ] } as Bot;
  const maus = { id: "maus", threadId: "inbox", defaultBot: { person: "rui@acme.test" }, tasks: [{ threadId: "inbox", title: "Inbox", private: true }] } as Bot;
  const place = (fields: Partial<RoutinePlace>, bot: Bot = quotes): RoutinePlace => ({ activeView: "chat", selectedId: bot.id, bots: [bot, maus], config: { team: { name: "Acme" } }, ...fields });
  const line = (bot: Bot, value: string | null | undefined, madeIn?: string) => renderToStaticMarkup(createElement(RoutineAudience, { team: { name: "Acme" }, bot, value, madeIn }));

  it("presets the audience of the place the form was opened from, and the person alone anywhere else", () => {
    expect(resultsOfPlace(place({}), "quotes"), "from a private chat").toBe("just-me");
    expect(resultsOfPlace(place({}, { ...quotes, threadId: "main" }), "quotes"), "from the shared chat").toBe("main");
    expect(resultsOfPlace(place({}, { ...quotes, threadId: "run" }), "quotes"), "a run's own conversation is no place to share from").toBe("just-me");
    expect(resultsOfPlace(place({ activeView: "routines" }, { ...quotes, threadId: "main" }), "quotes"), "the Automations page is no chat").toBe("just-me");
    expect(resultsOfPlace(place({ selectedId: "maus" }, { ...quotes, threadId: "main" }), "quotes"), "another bot's chat on screen").toBe("just-me");
    expect(resultsOfPlace(place({}), undefined), "no bot chosen yet").toBe("just-me");
    expect(resultsOfPlace(place({}), "maus"), "their own MausBot is theirs already").toBeNull();
    expect(resultsOfPlace(place({ config: {} }), "quotes"), "off a team").toBeUndefined();
  });

  it("says who will see the routine in the words of the label by the message box", () => {
    expect(line(quotes, "just-me")).toContain('data-routine-audience="me"');
    expect(line(quotes, "just-me")).toContain("Private · only you");
    expect(line(quotes, "mine")).toContain("Private · only you");
    expect(line(quotes, null, "mine"), "one a bot made in their private chat").toContain("Private · only you");
    expect(line(maus, null)).toContain("Private · only you");
    for (const value of ["main", null, undefined]) {
      expect(line(quotes, value)).toContain('data-routine-audience="shared"');
      expect(line(quotes, value)).toContain("Shared · everyone in Acme can see");
    }
    expect(line({ ...quotes, onlyPeopleAdded: true } as Bot, "main")).toContain("Shared · only people added and admins can see");
    expect(renderToStaticMarkup(createElement(RoutineAudience, { team: null, bot: quotes, value: null })), "nothing off a team").toBe("");
  });
});
