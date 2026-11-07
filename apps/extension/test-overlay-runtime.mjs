// Regression coverage for Bug #1: an overlay left in a tab after the extension
// was reloaded/updated lost its extension APIs. Reading
// `chrome.runtime.onMessage` then threw
// "Cannot read properties of undefined (reading 'onMessage')" as an uncaught
// error on every page (reported on studio.youtube.com).
//
// The overlay must initialise and stay usable (with a reconnect hint) when the
// extension context is gone, and must not touch chrome.* without a guard.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(
  new URL("./src/content/overlay.js", import.meta.url),
  "utf8",
);

function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

function createElement() {
  const element = {
    id: "",
    className: "",
    textContent: "",
    innerHTML: "",
    value: "50",
    hidden: false,
    disabled: false,
    type: "",
    title: "",
    alt: "",
    src: "",
    style: {
      display: "",
      cssText: "",
      setProperty() {},
      getPropertyValue() {
        return "";
      },
      getPropertyPriority() {
        return "";
      },
      removeProperty() {},
    },
    dataset: {},
    children: [],
    handlers: {},
    append(...nodes) {
      element.children.push(...nodes);
    },
    appendChild(node) {
      element.children.push(node);
      return node;
    },
    replaceChildren() {
      element.children = [];
    },
    remove() {},
    addEventListener(type, handler) {
      element.handlers[type] = handler;
    },
    removeEventListener(type) {
      delete element.handlers[type];
    },
    setAttribute() {},
    removeAttribute() {},
    getAttribute() {
      return null;
    },
    focus() {},
    click() {
      element.handlers.click?.();
    },
  };
  return element;
}

function createEnvironment({ chrome } = {}) {
  const elements = new Map();
  const create = () => createElement();
  const query = (selector) => {
    if (!elements.has(selector)) {
      elements.set(selector, createElement());
    }
    return elements.get(selector);
  };

  const documentElement = createElement();
  documentElement.querySelector = query;
  documentElement.querySelectorAll = () => [];

  const document = {
    documentElement,
    body: createElement(),
    title: "Test page",
    createElement: () => {
      const element = createElement();
      element.querySelector = query;
      element.querySelectorAll = () => [];
      return element;
    },
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
    removeEventListener() {},
  };

  const window = {};
  const context = {
    window,
    document,
    location: { protocol: "https:", href: "https://studio.youtube.com/" },
    navigator: { userAgent: "test", platform: "test" },
    screen: { width: 1280, height: 800 },
    console,
    requestAnimationFrame: (callback) => callback(),
    setTimeout,
    Image: class {},
    getComputedStyle: () => ({ position: "static" }),
  };
  if (chrome !== undefined) {
    context.chrome = chrome;
  }
  window.document = document;
  window.location = context.location;

  const sandbox = vm.createContext(context);
  vm.runInContext(source, sandbox, { filename: "content/overlay.js" });

  return { window, elements, query };
}

function assertOverlayInstalled(environment) {
  const overlay = environment.window.__ARGUS_OVERLAY__;
  assert.equal(typeof overlay?.toggle, "function");
  assert.equal(typeof overlay?.close, "function");
  assert.equal(typeof overlay?.destroy, "function");
  return overlay;
}

// 1. The extension was reloaded/disabled: `chrome` is entirely gone.
{
  const environment = createEnvironment();
  const overlay = assertOverlayInstalled(environment);
  environment.query("#argus-popup").hidden = true;

  await overlay.toggle();
  await flush();

  const status = environment.query("#argus-status");
  assert.match(status.textContent, /Refresh this page/i);
  assert.equal(environment.query("#argus-area").disabled, true);
  assert.equal(environment.query("#argus-harvest").disabled, true);

  // Harvesting routes through send() and must return the reconnect hint
  // instead of throwing on the missing runtime.
  environment.query("#argus-harvest").click();
  await flush();
  assert.match(
    environment.query("#argus-diagnostics").textContent,
    /Refresh this page/i,
  );

  overlay.destroy();
  assert.equal(environment.window.__ARGUS_OVERLAY__, undefined);
}

// 2. `chrome` exists but the runtime object is already torn down.
{
  const environment = createEnvironment({ chrome: { storage: {} } });
  const overlay = assertOverlayInstalled(environment);
  environment.query("#argus-popup").hidden = true;
  await overlay.toggle();
  await flush();
  assert.match(environment.query("#argus-status").textContent, /Refresh/i);
  overlay.destroy();
}

// 3. `chrome.runtime` exists but has no onMessage (older/partial teardown).
{
  const environment = createEnvironment({ chrome: { runtime: {} } });
  assertOverlayInstalled(environment);
}

// 4. Healthy context: listeners are registered once and removed on destroy.
{
  const calls = { added: 0, removed: 0, sent: 0 };
  const chrome = {
    runtime: {
      id: "abcdefghijklmnop",
      sendMessage: async () => {
        calls.sent += 1;
        return { ok: true };
      },
      onMessage: {
        addListener() {
          calls.added += 1;
        },
        removeListener() {
          calls.removed += 1;
        },
      },
    },
    storage: {
      local: { get: async () => ({}) },
      session: { get: async () => ({}), set: async () => {} },
    },
  };

  const environment = createEnvironment({ chrome });
  const overlay = assertOverlayInstalled(environment);
  await flush();
  assert.equal(calls.added, 1);

  overlay.destroy();
  assert.equal(calls.removed, 1);
}

console.log("Overlay runtime-guard regression tests passed.");
