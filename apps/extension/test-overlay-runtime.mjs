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
  window.screen = context.screen;
  window.innerWidth = 1280;
  window.innerHeight = 800;
  window.devicePixelRatio = 1;
  window.setTimeout = setTimeout;
  window.requestAnimationFrame = context.requestAnimationFrame;
  window.addEventListener = () => {};
  window.removeEventListener = () => {};

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

// 5. After a successful screenshot report the overlay clears itself and is
// ready for the next issue (no stale captures, steps or dispatch message).
{
  const settings = {
    appBaseUrl: "http://app.test",
    cdnBaseUrl: "http://cdn.test",
    workspaceToken: "workspace",
    cdnToken: "cdn",
    projectId: "11111111-1111-4111-8111-111111111111",
  };
  const staged = [
    {
      dataUrl: "data:image/png;base64,AAAA",
      pageUrl: "https://a.test",
      pageTitle: "A",
      mode: "area",
      capturedAt: "2026-11-07T10:00:00.000Z",
    },
  ];
  const chrome = {
    runtime: {
      id: "abcdefghijklmnop",
      sendMessage: async (message) =>
        message.type === "ARGUS_DISPATCH"
          ? {
              ok: true,
              step: 2,
              editorUrl: "http://app.test/canvas/x",
              captureCount: 1,
            }
          : { ok: true },
      onMessage: { addListener() {}, removeListener() {} },
    },
    storage: {
      local: { get: async () => ({ "argus.settings.v1": settings }) },
      session: {
        get: async () => ({ "argus.stagedCaptures": staged }),
        set: async () => {},
      },
    },
  };

  const environment = createEnvironment({ chrome });
  await flush();
  environment.query("#argus-popup").hidden = true;
  environment.window.__ARGUS_OVERLAY__.toggle();
  await flush();

  assert.equal(environment.query("#argus-staged-count").textContent, "1");
  environment.query("#argus-create-staged").click();
  await flush();
  await flush();

  assert.equal(environment.query("#argus-staged-count").textContent, "0");
  assert.match(
    environment.query("#argus-status").textContent,
    /Ready for the next report/i,
  );
  assert.equal(environment.query("#argus-dispatch").hidden, true);
  assert.equal(environment.query("#argus-dispatch").textContent, "");
  assert.equal(environment.query("#argus-steps").hidden, true);
  assert.equal(environment.query("#argus-add-more").disabled, false);
}

// 6. Text-only reports clear the form and status the same way.
{
  const settings = {
    appBaseUrl: "http://app.test",
    cdnBaseUrl: "http://cdn.test",
    workspaceToken: "workspace",
    cdnToken: "cdn",
    projectId: "11111111-1111-4111-8111-111111111111",
  };
  const chrome = {
    runtime: {
      id: "abcdefghijklmnop",
      sendMessage: async () => ({
        ok: true,
        issueId: "issue",
        redirectUrl: "http://app.test/projects/ARG?issue=issue",
      }),
      onMessage: { addListener() {}, removeListener() {} },
    },
    storage: {
      local: { get: async () => ({ "argus.settings.v1": settings }) },
      session: { get: async () => ({}), set: async () => {} },
    },
  };

  const environment = createEnvironment({ chrome });
  await flush();
  environment.query("#argus-popup").hidden = true;
  environment.window.__ARGUS_OVERLAY__.toggle();
  await flush();

  environment.query("#argus-text").click();
  const title = environment.query("#argus-text-title");
  title.value = "Text-only bug";
  environment.query("#argus-text-submit").click();
  await flush();
  await flush();

  assert.equal(title.value, "");
  assert.equal(environment.query("#argus-text-form").hidden, true);
  assert.equal(environment.query("#argus-text-status").textContent, "");
  assert.match(
    environment.query("#argus-status").textContent,
    /Ready for the next report/i,
  );
}

// 7. Quick submit sends the staged captures and title/description/priority,
// then clears the popup without opening the canvas editor.
{
  const settings = {
    appBaseUrl: "http://app.test",
    cdnBaseUrl: "http://cdn.test",
    workspaceToken: "workspace",
    cdnToken: "cdn",
    projectId: "11111111-1111-4111-8111-111111111111",
  };
  const staged = [
    {
      dataUrl: "data:image/png;base64,AAAA",
      pageUrl: "https://a.test",
      pageTitle: "A",
      mode: "area",
      capturedAt: "2026-11-07T10:00:00.000Z",
    },
  ];
  const sent = [];
  const chrome = {
    runtime: {
      id: "abcdefghijklmnop",
      sendMessage: async (message) => {
        sent.push(message);
        return message.type === "ARGUS_QUICK_SUBMIT"
          ? {
              ok: true,
              issueId: "issue",
              redirectUrl: "http://app.test/projects/ARG?issue=issue",
            }
          : { ok: true };
      },
      onMessage: { addListener() {}, removeListener() {} },
    },
    storage: {
      local: { get: async () => ({ "argus.settings.v1": settings }) },
      session: {
        get: async () => ({ "argus.stagedCaptures": staged }),
        set: async () => {},
      },
    },
  };

  const environment = createEnvironment({ chrome });
  await flush();
  environment.query("#argus-popup").hidden = true;
  environment.window.__ARGUS_OVERLAY__.toggle();
  await flush();

  environment.query("#argus-quick").click();
  environment.query("#argus-quick-title").value = "Quick bug";
  environment.query("#argus-quick-description").value = "Details";
  environment.query("#argus-quick-priority").value = "40";
  environment.query("#argus-quick-submit").click();
  await flush();
  await flush();

  const quickMessage = sent.find(
    (message) => message.type === "ARGUS_QUICK_SUBMIT",
  );
  assert.ok(quickMessage);
  assert.equal(quickMessage.title, "Quick bug");
  assert.equal(quickMessage.description, "Details");
  assert.equal(quickMessage.priority, 40);
  assert.equal(quickMessage.captures.length, 1);

  assert.equal(environment.query("#argus-quick-form").hidden, true);
  assert.equal(environment.query("#argus-quick-title").value, "");
  assert.equal(environment.query("#argus-quick-status").textContent, "");
  assert.equal(environment.query("#argus-staged-count").textContent, "0");
  assert.match(
    environment.query("#argus-status").textContent,
    /submitted to Pending/i,
  );
}

console.log("Overlay runtime-guard regression tests passed.");
