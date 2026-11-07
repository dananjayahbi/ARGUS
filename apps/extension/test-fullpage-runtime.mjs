// Regression coverage for Issue #10: full-page capture must scroll the real
// page scroller. App shells such as YouTube Studio scroll an inner container,
// so scrolling window captured the same viewport repeatedly and produced a
// normal screenshot instead of a stitched full page.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(
  new URL("./src/content/fullpage.js", import.meta.url),
  "utf8",
);

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function createStyle(overrides = {}) {
  return {
    scrollBehavior: "",
    setProperty() {},
    removeProperty() {},
    getPropertyValue() {
      return "";
    },
    getPropertyPriority() {
      return "";
    },
    ...overrides,
  };
}

function createElement({
  overflowY = "visible",
  position = "static",
  width = 1280,
  height = 800,
  scrollHeight = 800,
  scrollTop = 0,
  x = 0,
  y = 0,
  children = [],
} = {}) {
  const element = {
    clientWidth: width,
    clientHeight: height,
    clientLeft: 0,
    clientTop: 0,
    scrollWidth: width,
    scrollHeight,
    scrollTop,
    overflowY,
    position,
    style: createStyle(),
    attributes: new Map(),
    hidden: false,
    closest() {
      return null;
    },
    contains() {
      return false;
    },
    getBoundingClientRect() {
      return { x, y, width, height, top: y, left: x, right: x + width, bottom: y + height };
    },
    querySelectorAll() {
      return children;
    },
    setAttribute(name, value) {
      element.attributes.set(name, value);
    },
    getAttribute(name) {
      return element.attributes.get(name) ?? null;
    },
    removeAttribute(name) {
      element.attributes.delete(name);
    },
  };
  element.style.setProperty = (name, value) => {
    element.hidden = name === "visibility" && value === "hidden";
  };
  element.style.removeProperty = (name) => {
    if (name === "visibility") {
      element.hidden = false;
    }
  };
  return element;
}

function createEnvironment({ documentScrollHeight = 800, scrollers = [] } = {}) {
  const documentElement = createElement({
    scrollHeight: documentScrollHeight,
    height: 800,
  });
  const body = createElement({ scrollHeight: documentScrollHeight });
  body.querySelectorAll = () => scrollers;

  const document = {
    documentElement,
    body,
    scrollingElement: documentElement,
    querySelectorAll(selector) {
      return selector === "body *" ? scrollers : [];
    },
  };

  const window = {
    innerWidth: 1280,
    innerHeight: 800,
    scrollX: 0,
    scrollY: 0,
    devicePixelRatio: 1,
    setTimeout: (callback) => setImmediate(callback),
    requestAnimationFrame: (callback) => setImmediate(callback),
    scrollTo(x, y) {
      window.scrollX = x;
      window.scrollY = y;
    },
    getComputedStyle(element) {
      return {
        overflowY: element.overflowY ?? "visible",
        position: element.position ?? "static",
      };
    },
  };

  const context = vm.createContext({ window, document, console });
  vm.runInContext(source, context, { filename: "content/fullpage.js" });
  return { window, document, runtime: window.__ARGUS_FULLPAGE__ };
}

// 1. Document scrolling still uses the viewport and the document height.
{
  const { runtime } = createEnvironment({ documentScrollHeight: 2400 });
  assert.equal(typeof runtime?.prepareFullPageCapture, "function");

  const metrics = runtime.prepareFullPageCapture();
  assert.equal(metrics.source, "document");
  assert.equal(metrics.totalHeight, 2400);
  assert.equal(metrics.viewportWidth, 1280);
  assert.equal(metrics.viewportHeight, 800);
  assert.deepEqual(plain(metrics.rect), {
    x: 0,
    y: 0,
    width: 1280,
    height: 800,
  });

  assert.deepEqual(plain(runtime.fullPageFrameCount(2400, 800)), {
    frameCount: 3,
    exceedsLimit: false,
    maxFrames: 40,
  });

  assert.deepEqual(plain(runtime.computeStitchLayout(metrics, 1920, 1200)), {
    imageScaleX: 1.5,
    imageScaleY: 1.5,
    width: 1920,
    height: 3600,
    sourceX: 0,
    sourceY: 0,
    sourceWidth: 1920,
    sourceHeight: 1200,
  });
}

// 2. An app shell with a fixed viewport and an inner main scroller uses that
//    scroller, not window.
{
  const scroller = createElement({
    overflowY: "auto",
    width: 1000,
    height: 700,
    scrollHeight: 2800,
    x: 100,
    y: 80,
  });
  const { runtime } = createEnvironment({
    documentScrollHeight: 800,
    scrollers: [scroller],
  });

  const target = runtime.findScrollTarget();
  assert.equal(target.source, "element");
  assert.equal(target.element, scroller);

  const metrics = runtime.prepareFullPageCapture();
  assert.equal(metrics.source, "element");
  assert.equal(metrics.totalHeight, 2800);
  assert.equal(metrics.viewportWidth, 1000);
  assert.equal(metrics.viewportHeight, 700);
  assert.deepEqual(plain(metrics.rect), {
    x: 100,
    y: 80,
    width: 1000,
    height: 700,
  });

  assert.deepEqual(plain(runtime.computeStitchLayout(metrics, 1920, 1200)), {
    imageScaleX: 1.5,
    imageScaleY: 1.5,
    width: 1500,
    height: 4200,
    sourceX: 150,
    sourceY: 120,
    sourceWidth: 1500,
    sourceHeight: 1050,
  });
}

// 3. Hidden fixed/sticky elements are limited to the active scroller and
//    restored afterwards.
{
  const sticky = createElement({ position: "sticky" });
  const scroller = createElement({
    overflowY: "auto",
    width: 1000,
    height: 700,
    scrollHeight: 2800,
    children: [sticky],
  });
  const { runtime } = createEnvironment({
    documentScrollHeight: 800,
    scrollers: [scroller],
  });

  const metrics = runtime.prepareFullPageCapture();
  assert.equal(runtime.hideFixedElements(metrics), 1);
  assert.equal(sticky.hidden, true);
  runtime.restoreFullPageCapture(metrics);
  assert.equal(sticky.hidden, false);
}

// 4. Scrolling the inner scroller updates its scrollTop and the returned
//    offset used by the stitcher.
{
  const scroller = createElement({
    overflowY: "auto",
    width: 1000,
    height: 700,
    scrollHeight: 2800,
  });
  const { runtime } = createEnvironment({
    documentScrollHeight: 800,
    scrollers: [scroller],
  });

  const metrics = runtime.prepareFullPageCapture();
  const offset = await runtime.scrollToPosition(metrics, 1400);
  assert.equal(offset, 1400);
  assert.equal(scroller.scrollTop, 1400);
}

console.log("Full-page runtime regression tests passed.");
