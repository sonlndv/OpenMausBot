export function isIosHomeScreen(): boolean {
  return "standalone" in navigator && navigator.standalone === true && navigator.maxTouchPoints > 0;
}

/** WebKit may pan and shrink just the visual viewport while the keyboard is open. */
export function fitHomeScreenViewport(root: HTMLElement): void {
  const viewport = window.visualViewport;
  if (!viewport) return;
  const fit = () => {
    if (viewport.scale === 1 && viewport.height > 0 && viewport.height < document.documentElement.clientHeight - 1) {
      root.style.setProperty("--editing-top", `${Math.max(0, viewport.offsetTop)}px`);
      root.style.setProperty("--editing-height", `${viewport.height}px`);
      root.classList.add("ios-editing-viewport");
    } else if (root.classList.contains("ios-editing-viewport")) {
      root.classList.remove("ios-editing-viewport");
      root.style.removeProperty("--editing-top");
      root.style.removeProperty("--editing-height");
    }
  };
  viewport.addEventListener("resize", fit);
  viewport.addEventListener("scroll", fit);
  window.addEventListener("resize", fit);
  window.addEventListener("pageshow", fit);
  fit();
}
