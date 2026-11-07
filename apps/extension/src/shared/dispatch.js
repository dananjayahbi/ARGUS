function captureList(capture, captures) {
  if (Array.isArray(captures) && captures.length > 0) {
    return captures.filter(Boolean);
  }
  return capture ? [capture] : [];
}

function environmentFor(capture) {
  const snapshotInfo = capture?.snapshot?.environment_info;
  const source =
    snapshotInfo && typeof snapshotInfo === "object" ? snapshotInfo : {};
  return {
    ...source,
    url: source.url || capture?.pageUrl || "",
    title: source.title || capture?.pageTitle || "",
  };
}

export function buildCapturedPages(captures, uploads) {
  const pages = [];
  const seen = new Set();

  captures.forEach((capture, index) => {
    const upload = uploads[index];
    const environment = environmentFor(capture);
    const pageUrl = environment.url || upload?.url || "";
    if (!pageUrl) {
      return;
    }

    const key = upload?.url || pageUrl;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);

    pages.push({
      url: pageUrl,
      title: environment.title || null,
      captured_at: capture.capturedAt ?? new Date().toISOString(),
      asset_url: upload?.url ?? null,
      kind: index === 0 ? "primary" : "supplementary",
    });
  });

  return pages;
}

export async function dispatchCapture({
  capture,
  captures,
  settings,
  fetchImpl = fetch,
  createTab,
  readSnapshot,
  onStep,
}) {
  const list = captureList(capture, captures);

  if (list.length === 0) {
    return { ok: false, step: 0, error: "Capture a screenshot first." };
  }

  const primary = list[0];
  const snapshot =
    primary.snapshot ??
    (readSnapshot
      ? await readSnapshot(primary.tabId).catch(() => null)
      : null);

  const environment = environmentFor(primary);
  if (!environment.url) {
    environment.url = primary.pageUrl ?? "";
  }
  if (!environment.viewport) {
    environment.viewport = primary.viewport;
  }
  if (!environment.device_pixel_ratio) {
    environment.device_pixel_ratio = primary.devicePixelRatio;
  }
  if (!environment.os) {
    environment.os = "Unknown";
  }
  const logs = Array.isArray(snapshot?.console_logs)
    ? snapshot.console_logs
    : [];

  onStep?.(0);

  const uploads = [];
  for (let index = 0; index < list.length; index += 1) {
    const item = list[index];
    const blob = await (await fetchImpl(item.dataUrl)).blob();
    const form = new FormData();
    form.append("category", "raw");
    form.append(
      "file",
      blob,
      `argus-${item.mode === "full_page" ? "full-page" : "area"}-${Date.now()}-${index + 1}.png`,
    );

    const uploadResponse = await fetchImpl(
      `${settings.cdnBaseUrl}/api/upload`,
      {
        method: "POST",
        headers: { "X-CDN-Auth-Token": settings.cdnToken },
        body: form,
      },
    );
    const uploadBody = await uploadResponse.json().catch(() => ({}));

    if (!uploadResponse.ok || !uploadBody.url) {
      return {
        ok: false,
        step: 0,
        error: `Raw upload failed for screenshot ${index + 1} of ${list.length}: ${
          uploadBody.detail ?? uploadResponse.status
        }. No draft was created.`,
      };
    }

    uploads.push(uploadBody);
  }

  environment.captured_pages = buildCapturedPages(list, uploads);

  onStep?.(1);

  const ingestResponse = await fetchImpl(
    `${settings.appBaseUrl}/api/ingest/draft`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Workspace-Token": settings.workspaceToken,
      },
      body: JSON.stringify({
        project_id: settings.projectId,
        report_type:
          primary.mode === "full_page" ? "full_page" : "screenshot",
        raw_image_url: uploads[0].url,
        environment_info: environment,
        console_logs: logs,
        supplementary_assets: uploads.slice(1).map((upload) => ({
          url: upload.url,
          asset_type: "image/png",
        })),
      }),
    },
  );
  const ingestBody = await ingestResponse.json().catch(() => ({}));

  if (!ingestResponse.ok || !ingestBody.editor_url) {
    return {
      ok: false,
      step: 1,
      uploadUrl: uploads[0].url,
      error: `Draft creation failed: ${
        ingestBody.error?.message ??
        ingestBody.detail ??
        ingestResponse.status
      }. The raw ${list.length > 1 ? "images were" : "image was"} uploaded to ${
        uploads[0].url
      } but ${list.length > 1 ? "are" : "is"} orphaned; retry will upload ${
        list.length > 1 ? "them" : "it"
      } again.`,
    };
  }

  onStep?.(2);
  await createTab(ingestBody.editor_url);

  return {
    ok: true,
    step: 2,
    editorUrl: ingestBody.editor_url,
    uploadUrl: uploads[0].url,
    uploadUrls: uploads.map((upload) => upload.url),
    captureCount: list.length,
  };
}
