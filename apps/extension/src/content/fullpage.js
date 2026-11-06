export const MAX_FULL_PAGE_FRAMES = 40;

/**
 * Injected before a full-page capture. Cleans up any stale state and returns
 * the page metrics; it deliberately does not hide fixed/sticky elements yet,
 * so the first frame can show them once at the top.
 */
export function prepareFullPageCapture() {
  document
    .querySelectorAll(".argus-hide-fixed")
    .forEach((element) => element.classList.remove("argus-hide-fixed"));
  document.getElementById("argus-fullpage-style")?.remove();

  return {
    totalHeight: Math.max(
      document.documentElement.scrollHeight,
      document.body?.scrollHeight ?? 0,
      window.innerHeight,
    ),
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    scrollX: window.scrollX,
    scrollY: window.scrollY,
    dpr: window.devicePixelRatio,
  };
}

/** Hide fixed/sticky elements for the intermediate frames. */
export function hideFixedElements() {
  const className = "argus-hide-fixed";
  let style = document.getElementById("argus-fullpage-style");

  if (!style) {
    style = document.createElement("style");
    style.id = "argus-fullpage-style";
    style.textContent = `.${className} { visibility: hidden !important; }`;
    document.documentElement.appendChild(style);
  }

  let count = 0;
  for (const element of document.querySelectorAll("body *")) {
    const position = getComputedStyle(element).position;
    if (position === "fixed" || position === "sticky") {
      element.classList.add(className);
      count += 1;
    }
  }

  return count;
}

/** Scroll and wait two frames so the next capture sees the settled page. */
export function scrollToPosition(y) {
  window.scrollTo(0, y);

  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        resolve({ scrollX: window.scrollX, scrollY: window.scrollY });
      });
    });
  });
}

/** Restore the original scroll position and remove every injected style. */
export function restoreFullPageCapture(scroll) {
  document
    .querySelectorAll(".argus-hide-fixed")
    .forEach((element) => element.classList.remove("argus-hide-fixed"));
  document.getElementById("argus-fullpage-style")?.remove();

  if (
    scroll &&
    Number.isFinite(scroll.x) &&
    Number.isFinite(scroll.y)
  ) {
    window.scrollTo(scroll.x, scroll.y);
  }
}
