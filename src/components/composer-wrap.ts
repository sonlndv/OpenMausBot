import { useLayoutEffect, useState, type RefObject } from "react";
import { coarsePointerNow } from "@/lib/use-media-query";

/** Simple: anything that grows the pill past its one 44px row (a second line, a reply strip) rounds its corners in. */
export function useTallPill(shellRef: RefObject<HTMLDivElement | null>, on: boolean): boolean {
  const [tall, setTall] = useState(false);
  useLayoutEffect(() => {
    const shell = shellRef.current;
    if (!on || !shell || typeof ResizeObserver === "undefined") return;
    const measure = () => setTall(shell.getBoundingClientRect().height > 44.5);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(shell);
    return () => observer.disconnect();
  }, [shellRef, on]);
  return tall;
}

/** A dock is anchored in the layout viewport. A software keyboard may shrink only the visual viewport. */
export function useComposerKeyboardInset(shellRef: RefObject<HTMLDivElement | null>): void {
  useLayoutEffect(() => {
    const viewport = window.visualViewport;
    const dock = shellRef.current?.closest<HTMLElement>(".chat-column-dock");
    if (!viewport || !dock || !coarsePointerNow()) return;
    const update = () => {
      const bottom = viewport.offsetTop + viewport.height;
      const inset = viewport.scale === 1 && bottom < document.documentElement.clientHeight
        ? Math.max(0, dock.getBoundingClientRect().bottom - bottom) : 0;
      if (inset) dock.style.setProperty("--composer-keyboard-inset", `${inset}px`);
      else dock.style.removeProperty("--composer-keyboard-inset");
    };
    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
      dock.style.removeProperty("--composer-keyboard-inset");
    };
  }, [shellRef]);
}
