(() => {
  if (window.__ARGUS_HARVEST__) {
    return;
  }

  const MAX_ENTRIES = 50;
  const entries = [];
  let sequence = 0;

  function formatArgument(value) {
    if (value instanceof Error) {
      return `${value.name}: ${value.message}`;
    }
    if (typeof value === "string") {
      return value;
    }
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  function pushEntry(entry) {
    entries.push({
      id: ++sequence,
      timestamp: new Date().toISOString(),
      ...entry,
    });

    if (entries.length > MAX_ENTRIES) {
      entries.splice(0, entries.length - MAX_ENTRIES);
    }
  }

  function detectBrowser() {
    const userAgent = navigator.userAgent;
    const edge = userAgent.match(/Edg\/([\d.]+)/);
    if (edge) {
      return { name: "Edge", version: edge[1], engine: "Blink" };
    }
    const chrome = userAgent.match(/Chrome\/([\d.]+)/);
    if (chrome) {
      return { name: "Chrome", version: chrome[1], engine: "Blink" };
    }
    const firefox = userAgent.match(/Firefox\/([\d.]+)/);
    if (firefox) {
      return { name: "Firefox", version: firefox[1], engine: "Gecko" };
    }
    const safari = userAgent.match(/Version\/([\d.]+).*Safari/);
    if (safari) {
      return { name: "Safari", version: safari[1], engine: "WebKit" };
    }
    return { name: "Unknown", version: "unknown", engine: "Unknown" };
  }

  function detectOs() {
    if (navigator.userAgentData?.platform) {
      return navigator.userAgentData.platform;
    }

    const userAgent = navigator.userAgent;
    if (/Windows/.test(userAgent)) return "Windows";
    if (/Android/.test(userAgent)) return "Android";
    if (/iPhone|iPad|iPod/.test(userAgent)) return "iOS";
    if (/Mac OS X/.test(userAgent)) return "macOS";
    if (/Linux/.test(userAgent)) return "Linux";
    return navigator.platform || "Unknown";
  }

  function snapshot() {
    const browser = detectBrowser();

    return {
      environment_info: {
        url: window.location.href,
        title: document.title,
        viewport: {
          width: window.innerWidth,
          height: window.innerHeight,
        },
        screen: {
          width: window.screen.width,
          height: window.screen.height,
        },
        device_pixel_ratio: window.devicePixelRatio,
        user_agent: navigator.userAgent,
        os: detectOs(),
        browser,
        timestamp: new Date().toISOString(),
      },
      console_logs: entries.slice().sort((left, right) => {
        return left.timestamp.localeCompare(right.timestamp);
      }),
    };
  }

  const originalError = console.error.bind(console);
  console.error = (...args) => {
    const error = args.find((value) => value instanceof Error);
    pushEntry({
      type: "error",
      message: args.map(formatArgument).join(" "),
      stack_or_detail: error?.stack ?? null,
    });
    originalError(...args);
  };

  const originalWarn = console.warn.bind(console);
  console.warn = (...args) => {
    pushEntry({
      type: "warn",
      message: args.map(formatArgument).join(" "),
      stack_or_detail: null,
    });
    originalWarn(...args);
  };

  window.addEventListener("error", (event) => {
    pushEntry({
      type: "error",
      message: event.message || "Unhandled runtime error",
      stack_or_detail: event.error?.stack ?? null,
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    pushEntry({
      type: "error",
      message:
        reason instanceof Error
          ? `${reason.name}: ${reason.message}`
          : formatArgument(reason),
      stack_or_detail: reason instanceof Error ? reason.stack ?? null : null,
    });
  });

  const originalFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const request = args[0];
    const init = args[1];
    const method = (
      init?.method ??
      (request instanceof Request ? request.method : "GET")
    ).toUpperCase();
    const url =
      typeof request === "string"
        ? request
        : request instanceof Request
          ? request.url
          : String(request);

    try {
      const response = await originalFetch(...args);
      if (response.status >= 400) {
        pushEntry({
          type: "network_failure",
          message: `${method} ${url} -> ${response.status}`,
          stack_or_detail: `HTTP ${response.status} ${response.statusText}`.trim(),
        });
      }
      return response;
    } catch (error) {
      pushEntry({
        type: "network_failure",
        message: `${method} ${url} -> network error`,
        stack_or_detail: error instanceof Error ? error.message : null,
      });
      throw error;
    }
  };

  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__argusRequest = {
      method: String(method).toUpperCase(),
      url: String(url),
    };
    return originalOpen.call(this, method, url, ...rest);
  };

  XMLHttpRequest.prototype.send = function (...args) {
    this.addEventListener("loadend", () => {
      const request = this.__argusRequest;
      if (!request) {
        return;
      }
      if (this.status >= 400 || this.status === 0) {
        pushEntry({
          type: "network_failure",
          message: `${request.method} ${request.url} -> ${
            this.status || "network error"
          }`,
          stack_or_detail: this.status ? `HTTP ${this.status}` : "No response",
        });
      }
    });
    return originalSend.apply(this, args);
  };

  window.__ARGUS_HARVEST__ = {
    snapshot,
    clear() {
      entries.length = 0;
    },
  };
})();
