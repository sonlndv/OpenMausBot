import { MAIN_PANE, type PaneLayout } from "./pane-layout";
import { createContext } from "react";
import { coarsePointerNow } from "@/lib/use-media-query";

export const WorkspaceChatContext = createContext<string | null>(null);
export const TiledPaneTitle = createContext<string | null>(null);
export const FocusedWorkspaceThread = createContext<string | null>(null);

export const WorkspaceLayoutContext = createContext<PaneLayout>(MAIN_PANE);

export function focusChatPane(pane: HTMLElement): void {
  const editor = !coarsePointerNow() && pane.querySelector<HTMLElement>('[data-tour="composer"] textarea:not(:disabled)');
  (editor || pane).focus({ preventScroll: true });
}
