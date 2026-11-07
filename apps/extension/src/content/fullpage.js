/**
 * ARGUS full-page capture runtime (classic content script).
 *
 * Loaded before content/overlay.js in manifest.json and injected by the
 * toolbar fallback. It owns scroll-target detection, scrolling, fixed-element
 * suppression and stitch geometry so the overlay only orchestrates capturing.
 *
 * The important fix over the previous version: many applications (including
 * YouTube Studio) scroll an inner container rather than <html>. Scrolling
 * `window` in that case captured the same viewport repeatedly. This runtime
 * finds the real scroller, scrolls it, crops each frame to its visible box and
 * stitches only that content. It also avoids hiding fixed layout wrappers that
 * contain the scroller, which previously blanked the page after the first
 * frame.
 */
(() => {
  const MAX_FULL_PAGE_FRAMES = 40;
  const MIN_SCROLL_RANGE = 4;
  const MIN_SCROLLER_SIZE = 120;

  function delay(ms) {
    return new Promise((resolve) => {
      window.setTimeout(resolve, ms);
    });
  }

  function nextFrames() {
    return new Promise((resolve) => {
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(resolve);
      });
    });
  }

  function isScrollableElement(element) {
    if (!element || typeof element.getBoundingClientRect !== "function") {
      return false;
    }

    const style = window.getComputedStyle(element);
    if (!/(auto|scroll|overlay)/i.test(style.overflowY || "")) {
      return false;
    }
    if (
      element.clientHeight < MIN_SCROLLER_SIZE ||
      element.clientWidth < MIN_SCROLLER_SIZE
    ) {
      return false;
    }

    const range = element.scrollHeight - element.clientHeight;
    if (range <= MIN_SCROLL_RANGE) {
      return false;
    }

    const rect = element.getBoundingClientRect();
    return (
      rect.width >= MIN_SCROLLER_SIZE && rect.height >= MIN_SCROLLER_SIZE
    );
  }

  /**
   * Return the element the page actually scrolls.
   *
   * The document wins when it has a real scroll range. Otherwise prefer the
   * largest visible inner scroller, which is the main content area on app
   * shells with fixed chrome.
   */
  function findScrollTarget() {
    const documentElement = document.documentElement;
    const scrollingElement =
      document.scrollingElement || documentElement || document.body;
    const documentRange = Math.max(
      0,
      (scrollingElement?.scrollHeight ?? 0) -
        (scrollingElement?.clientHeight ?? 0),
    );

    if (documentRange > MIN_SCROLL_RANGE) {
      return { element: scrollingElement, source: "document" };
    }

    let best = null;
    for (const element of document.querySelectorAll("body *")) {
      if (element.closest?.("#argus-overlay")) {
        continue;
      }
      if (!isScrollableElement(element)) {
        continue;
      }

      const rect = element.getBoundingClientRect();
      const visibleWidth = Math.max(
        0,
        Math.min(rect.right, window.innerWidth) - Math.max(rect.left, 0),
      );
      const visibleHeight = Math.max(
        0,
        Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0),
      );
      if (
        visibleWidth < MIN_SCROLLER_SIZE ||
        visibleHeight < MIN_SCROLLER_SIZE
      ) {
        continue;
      }

      const area = visibleWidth * visibleHeight;
      const range = element.scrollHeight - element.clientHeight;

      if (
        !best ||
        area > best.area ||
        (area === best.area && range > best.range)
      ) {
        best = { element, area, range };
      }
    }

    return best
      ? { element: best.element, source: "element" }
      : { element: scrollingElement, source: "document" };
  }

  let hiddenElements = [];

  function restoreHiddenElements() {
    for (const element of hiddenElements) {
      const previous = element.getAttribute("data-argus-prev-visibility");
      const priority =
        element.getAttribute("data-argus-prev-priority") ?? "";
      if (previous) {
        element.style.setProperty("visibility", previous, priority);
      } else {
        element.style.removeProperty("visibility");
      }
      element.removeAttribute("data-argus-prev-visibility");
      element.removeAttribute("data-argus-prev-priority");
    }
    hiddenElements = [];
  }

  function prepareFullPageCapture() {
    restoreHiddenElements();

    const target = findScrollTarget();
    const isDocument = target.source === "document";
    const element = target.element;

    let rect;
    if (isDocument) {
      rect = {
        x: 0,
        y: 0,
        width: window.innerWidth,
        height: window.innerHeight,
      };
    } else {
      const box = element.getBoundingClientRect();
      const left = Math.max(0, box.x + (element.clientLeft ?? 0));
      const top = Math.max(0, box.y + (element.clientTop ?? 0));
      const right = Math.min(
        window.innerWidth,
        box.x + (element.clientLeft ?? 0) + element.clientWidth,
      );
      const bottom = Math.min(
        window.innerHeight,
        box.y + (element.clientTop ?? 0) + element.clientHeight,
      );
      rect = {
        x: left,
        y: top,
        width: Math.max(1, right - left),
        height: Math.max(1, bottom - top),
      };
    }

    const totalHeight = isDocument
      ? Math.max(
          document.documentElement?.scrollHeight ?? 0,
          document.body?.scrollHeight ?? 0,
          window.innerHeight,
        )
      : Math.max(element.scrollHeight, element.clientHeight);

    return {
      target: element,
      source: target.source,
      totalHeight,
      viewportWidth: isDocument ? window.innerWidth : element.clientWidth,
      viewportHeight: isDocument ? window.innerHeight : element.clientHeight,
      scrollX: window.scrollX,
      scrollY: isDocument ? window.scrollY : element.scrollTop,
      dpr: window.devicePixelRatio,
      rect,
      originalScrollBehavior: isDocument
        ? document.documentElement?.style?.scrollBehavior ?? ""
        : element.style?.scrollBehavior ?? "",
    };
  }

  function currentScroll(metrics) {
    return metrics.source === "document"
      ? window.scrollY
      : metrics.target.scrollTop;
  }

  async function waitForScroll(metrics, target) {
    for (let attempt = 0; attempt < 12; attempt += 1) {
      await nextFrames();
      if (Math.abs(currentScroll(metrics) - target) <= 1) {
        return;
      }
      await delay(40);
    }
  }

  async function scrollToPosition(metrics, y) {
    if (metrics.source === "document") {
      if (document.documentElement?.style) {
        document.documentElement.style.scrollBehavior = "auto";
      }
      window.scrollTo(0, y);
    } else {
      if (metrics.target?.style) {
        metrics.target.style.scrollBehavior = "auto";
      }
      metrics.target.scrollTop = y;
    }

    await waitForScroll(metrics, y);
    return currentScroll(metrics);
  }

  function hideFixedElements(metrics) {
    restoreHiddenElements();

    // For an inner scroller only hide fixed/sticky descendants of that
    // scroller. The app shell outside the scroller is excluded by cropping each
    // frame to the scroller box; hiding it could blank the content.
    const scope =
      metrics.source === "document" ? document.body : metrics.target;
    if (!scope) {
      return 0;
    }

    for (const element of scope.querySelectorAll("*")) {
      if (element.closest?.("#argus-overlay")) {
        continue;
      }
      if (metrics.source === "element" && element === metrics.target) {
        continue;
      }
      if (
        metrics.source === "element" &&
        element.contains?.(metrics.target)
      ) {
        continue;
      }

      const position = window.getComputedStyle(element).position;
      if (position !== "fixed" && position !== "sticky") {
        continue;
      }

      element.setAttribute(
        "data-argus-prev-visibility",
        element.style.getPropertyValue("visibility"),
      );
      element.setAttribute(
        "data-argus-prev-priority",
        element.style.getPropertyPriority("visibility"),
      );
      element.style.setProperty("visibility", "hidden", "important");
      hiddenElements.push(element);
    }

    return hiddenElements.length;
  }

  function restoreFullPageCapture(metrics) {
    restoreHiddenElements();

    if (metrics.source === "document") {
      window.scrollTo(metrics.scrollX, metrics.scrollY);
      if (document.documentElement?.style) {
        document.documentElement.style.scrollBehavior =
          metrics.originalScrollBehavior;
      }
    } else {
      metrics.target.scrollTop = metrics.scrollY;
      if (metrics.target?.style) {
        metrics.target.style.scrollBehavior = metrics.originalScrollBehavior;
      }
    }
  }

  function fullPageFrameCount(
    totalHeight,
    viewportHeight,
    maxFrames = MAX_FULL_PAGE_FRAMES,
  ) {
    const frameCount = Math.max(
      1,
      Math.ceil(totalHeight / Math.max(1, viewportHeight)),
    );

    return {
      frameCount,
      exceedsLimit: frameCount > maxFrames,
      maxFrames,
    };
  }

  /**
   * Geometry for stitching. The captured image is the whole viewport, so the
   * image scale derives from window.innerWidth/innerHeight. For an inner
   * scroller each frame is cropped to the scroller's client box and the output
   * is only as wide as that content area.
   */
  function computeStitchLayout(metrics, naturalWidth, naturalHeight) {
    const imageScaleX =
      naturalWidth / Math.max(1, window.innerWidth);
    const imageScaleY =
      naturalHeight / Math.max(1, window.innerHeight);

    const width = Math.max(
      1,
      Math.round(metrics.viewportWidth * imageScaleX),
    );
    const height = Math.max(
      1,
      Math.round(metrics.totalHeight * imageScaleY),
    );

    return {
      imageScaleX,
      imageScaleY,
      width,
      height,
      sourceX: Math.round(metrics.rect.x * imageScaleX),
      sourceY: Math.round(metrics.rect.y * imageScaleY),
      sourceWidth: Math.max(
        1,
        Math.round(metrics.rect.width * imageScaleX),
      ),
      sourceHeight: Math.max(
        1,
        Math.round(metrics.rect.height * imageScaleY),
      ),
    };
  }

  window.__ARGUS_FULLPAGE__ = {
    MAX_FULL_PAGE_FRAMES,
    computeStitchLayout,
    findScrollTarget,
    fullPageFrameCount,
    hideFixedElements,
    prepareFullPageCapture,
    restoreFullPageCapture,
    restoreHiddenElements,
    scrollToPosition,
  };
})();
