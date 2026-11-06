/**
 * Injected into the page with chrome.scripting.executeScript({ func }).
 * Must remain self-contained: Chrome serializes this function and runs it in
 * the page, so it cannot reference module-scope variables.
 */
export function createSnipOverlay() {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.setAttribute("data-argus-snip", "true");
    overlay.style.cssText = [
      "position:fixed",
      "inset:0",
      "z-index:2147483647",
      "cursor:crosshair",
      "background:transparent",
      "user-select:none",
    ].join(";");

    const selection = document.createElement("div");
    selection.style.cssText = [
      "position:absolute",
      "border:2px solid #22d3ee",
      "background:transparent",
      "box-shadow:0 0 0 9999px rgba(2,6,23,0.3)",
      "display:none",
      "pointer-events:none",
    ].join(";");

    const hint = document.createElement("div");
    hint.textContent = "Drag to capture · Esc to cancel";
    hint.style.cssText = [
      "position:absolute",
      "top:16px",
      "left:50%",
      "transform:translateX(-50%)",
      "padding:8px 12px",
      "border-radius:8px",
      "background:#020617",
      "color:#e2e8f0",
      "font:12px ui-sans-serif,system-ui,sans-serif",
      "border:1px solid #334155",
      "pointer-events:none",
    ].join(";");

    overlay.append(selection, hint);
    document.documentElement.appendChild(overlay);

    let startX = 0;
    let startY = 0;
    let dragging = false;

    const cleanup = () => {
      overlay.remove();
      window.removeEventListener("pointermove", onPointerMove, true);
      window.removeEventListener("pointerup", onPointerUp, true);
      window.removeEventListener("keydown", onKeyDown, true);
    };

    const finish = (rect) => {
      cleanup();
      requestAnimationFrame(() => {
        requestAnimationFrame(() => resolve(rect));
      });
    };

    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        finish(null);
      }
    };

    const onPointerDown = (event) => {
      if (event.button !== 0) {
        return;
      }
      dragging = true;
      startX = event.clientX;
      startY = event.clientY;
      selection.style.display = "block";
      selection.style.left = `${startX}px`;
      selection.style.top = `${startY}px`;
      selection.style.width = "0px";
      selection.style.height = "0px";
    };

    const onPointerMove = (event) => {
      if (!dragging) {
        return;
      }
      const left = Math.min(startX, event.clientX);
      const top = Math.min(startY, event.clientY);
      const width = Math.abs(event.clientX - startX);
      const height = Math.abs(event.clientY - startY);
      selection.style.left = `${left}px`;
      selection.style.top = `${top}px`;
      selection.style.width = `${width}px`;
      selection.style.height = `${height}px`;
    };

    const onPointerUp = (event) => {
      if (!dragging) {
        return;
      }
      dragging = false;

      const left = Math.max(0, Math.min(startX, event.clientX));
      const top = Math.max(0, Math.min(startY, event.clientY));
      const right = Math.min(
        window.innerWidth,
        Math.max(startX, event.clientX),
      );
      const bottom = Math.min(
        window.innerHeight,
        Math.max(startY, event.clientY),
      );
      const width = right - left;
      const height = bottom - top;

      if (width < 1 || height < 1) {
        finish(null);
        return;
      }

      finish({
        x: left,
        y: top,
        width,
        height,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        dpr: window.devicePixelRatio,
      });
    };

    overlay.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove, true);
    window.addEventListener("pointerup", onPointerUp, true);
    window.addEventListener("keydown", onKeyDown, true);
  });
}
