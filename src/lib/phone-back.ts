/** What is on a phone's screen that the back button can step back from, nearest first. */
export interface PhoneBackPlace {
  /** The automations calendar, which covers the list and the menu button. */
  calendar: boolean;
  drawerOpen: boolean;
  panelOpen: boolean;
  threadDetail: boolean;
  /** A file or app preview covers the chat or thread detail. */
  preview: boolean;
  /** The apps page is open; it stays open under the list unless back closes it. */
  appsPage: boolean;
  /** Steps the bot list keeps: the open list, and a screen reached from it. */
  drawerSteps: number;
}

export type PhoneBackStep = "calendar" | "drawer" | "preview" | "thread-detail" | "panels" | "apps-page";

export function phoneBackSteps(place: PhoneBackPlace): number {
  const panels = place.threadDetail ? 1 + Number(place.preview) + Number(place.panelOpen) : Number(place.panelOpen || place.preview);
  return Number(place.calendar) + panels + place.drawerSteps;
}

/**
 * One back press: the calendar goes back to the automations list, then the open list closes, then the side panels;
 * the apps page reached from the list closes as the list comes back.
 */
export function phoneBackStep(place: PhoneBackPlace): PhoneBackStep {
  if (place.calendar) return "calendar";
  if (place.drawerOpen) return "drawer";
  if (place.threadDetail) return place.preview ? "preview" : "thread-detail";
  if (place.panelOpen || place.preview) return "panels";
  return place.appsPage && place.drawerSteps > 0 ? "apps-page" : "drawer";
}
