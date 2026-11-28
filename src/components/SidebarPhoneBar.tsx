import { AppWindow, Globe, LayoutGrid, Puzzle, Search, X } from "lucide-react";

import { useCloudFilesReady } from "@/lib/cloud-files";
import { t } from "@/lib/i18n";
import { useFeature } from "@/lib/use-feature";
import { useAdvancedMode } from "@/lib/interface-mode";
import { useWebPanels } from "@/lib/web-panel-preferences";
import { useStore } from "@/state/store";

import { CloudRoomCard } from "./CloudRoomCard";
import { CloudUsageCard } from "./CloudUsageMeter";
import { useAutomationsNeedYou } from "./SidebarFooterNav";
import { SidebarPopoverMenu, type SidebarMenuItem } from "./SidebarPopoverMenu";
import { toolMenuItems } from "./SidebarProfileMenu";
import { UpdateIndicator } from "./UpdateIndicator";

/** The phone's bottom bar: a round button for the tools that are rows in the desktop sidebar, and a search pill. */
export function SidebarPhoneBar({ query, onQuery }: { query: string; onQuery: (query: string) => void }) {
  const { state, dispatch } = useStore();
  const automationsNeedYou = useAutomationsNeedYou();
  const filesReady = useCloudFilesReady();
  const skillBurger = useFeature("skillBurger");
  const advanced = useAdvancedMode();
  const panels = useWebPanels();
  const items: SidebarMenuItem[] = [
    ...toolMenuItems({
      activeView: state.activeView, automationsNeedYou,
      onAutomations: () => dispatch({ type: "showRoutines", view: "list" }),
      onTeamMap: () => dispatch({ type: "showTeamMap" }),
      onFiles: filesReady ? () => dispatch({ type: "showFiles" }) : undefined,
      onPublishedApps: () => dispatch({ type: "showPublishedApps" }),
      onSkillBurgers: skillBurger ? () => dispatch({ type: "showSkillBurgers" }) : undefined,
      onTeamFiles: state.config?.team ? () => dispatch({ type: "showTeamFiles" }) : undefined,
    }),
    {
      key: "apps",
      label: t("sidebar.nav.apps"),
      icon: <Puzzle size={18} />,
      active: state.pluginsOpen,
      onSelect: () => dispatch({ type: "togglePlugins", open: true }),
    },
    ...(advanced ? panels.map((panel) => ({
      key: `web-panel-${panel.id}`, label: panel.name,
      icon: panel.page ? <AppWindow size={16} /> : <Globe size={16} />,
      active: state.activeView === "web-panel" && state.webPanelId === panel.id,
      onSelect: () => dispatch({ type: "showWebPanel", id: panel.id }),
    })) : []),
  ];
  return (
    <div data-sidebar-phone-bar className="px-3 pb-3 pt-1">
      <CloudRoomCard />
      <CloudUsageCard />
      <div className="flex items-center gap-2 not-first:mt-2">
        <SidebarPopoverMenu
          items={items}
          ariaLabel={t("sidebar.tools")}
          triggerClassName="shrink-0 rounded-full"
          triggerTitle={t("sidebar.tools")}
          renderTrigger={({ open }) => (
            <span className={`relative flex size-11 items-center justify-center rounded-full border border-hairline text-ink ${open ? "bg-raised" : "bg-card"}`}>
              <LayoutGrid size={19} aria-hidden="true" />
              {automationsNeedYou && <span aria-hidden className="absolute right-1 top-1 size-2.5 rounded-full bg-danger ring-2 ring-app" />}
            </span>
          )}
        />
        <div className="flex h-11 min-w-0 flex-1 items-center gap-2 rounded-full border border-hairline bg-card pl-3.5 pr-1.5 text-ink-secondary focus-within:border-focus">
          <Search size={17} aria-hidden="true" className="shrink-0" />
          <input
            value={query}
            onChange={(event) => onQuery(event.target.value)}
            onKeyDown={(event) => event.key === "Escape" && onQuery("")}
            placeholder={t("sidebar.search")}
            aria-label={t("sidebar.searchAria")}
            enterKeyHint="search"
            className="min-w-0 flex-1 bg-transparent text-[15px] text-ink placeholder:text-ink-secondary focus:outline-none"
          />
          {query !== "" && (
            <button
              type="button"
              onClick={() => onQuery("")}
              aria-label={t("sidebar.searchClose")}
              className="flex size-7 shrink-0 items-center justify-center rounded-full text-ink-secondary hover:bg-raised hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
            >
              <X size={15} aria-hidden="true" />
            </button>
          )}
          <UpdateIndicator />
        </div>
      </div>
    </div>
  );
}
