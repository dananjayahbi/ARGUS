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

async function prepareCapture(list, readSnapshot) {
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

  return {
    primary,
    snapshot,
    environment,
    logs: Array.isArray(snapshot?.console_logs) ? snapshot.console_logs : [],
  };
}

async function uploadCaptures(list, settings, fetchImpl) {
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
        error: `Raw upload failed for screenshot ${index + 1} of ${list.length}: ${
          uploadBody.detail ?? uploadResponse.status
        }. No draft was created.`,
      };
    }

    uploads.push(uploadBody);
  }

  return { ok: true, uploads };
}

async function createDraft({
  list,
  primary,
  environment,
  logs,
  uploads,
  settings,
  fetchImpl,
}) {
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
    const reason = String(
      ingestBody.error?.message ??
        ingestBody.detail ??
        `HTTP ${ingestResponse.status}`,
    ).replace(/[.\s]+$/, "");
    const details = Array.isArray(ingestBody.error?.details)
      ? ingestBody.error.details
          .map((item) =>
            item?.path
              ? `${item.path}: ${item.message ?? "invalid"}`
              : item?.message,
          )
          .filter(Boolean)
          .join("; ")
      : "";

    return {
      ok: false,
      error: `Draft creation failed: ${reason}${
        details ? ` (${details})` : ""
      }. The raw ${list.length > 1 ? "images were" : "image was"} uploaded to ${
        uploads[0].url
      } but ${list.length > 1 ? "are" : "is"} orphaned; retry will upload ${
        list.length > 1 ? "them" : "it"
      } again.`,
    };
  }

  return {
    ok: true,
    issueId: ingestBody.issue_id,
    draftToken: ingestBody.draft_token,
    editorUrl: ingestBody.editor_url,
  };
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

  const { primary, environment, logs } = await prepareCapture(
    list,
    readSnapshot,
  );

  onStep?.(0);

  const uploaded = await uploadCaptures(list, settings, fetchImpl);
  if (!uploaded.ok) {
    return { ok: false, step: 0, error: uploaded.error };
  }

  environment.captured_pages = buildCapturedPages(list, uploaded.uploads);

  onStep?.(1);

  const draft = await createDraft({
    list,
    primary,
    environment,
    logs,
    uploads: uploaded.uploads,
    settings,
    fetchImpl,
  });

  if (!draft.ok) {
    return {
      ok: false,
      step: 1,
      uploadUrl: uploaded.uploads[0].url,
      error: draft.error,
    };
  }

  onStep?.(2);
  await createTab(draft.editorUrl);

  return {
    ok: true,
    step: 2,
    editorUrl: draft.editorUrl,
    uploadUrl: uploaded.uploads[0].url,
    uploadUrls: uploaded.uploads.map((upload) => upload.url),
    captureCount: list.length,
  };
}

/**
 * Upload the captures and finalize the draft in one go, without opening the
 * canvas editor. The operator supplies the title, description and priority in
 * the extension popup; the issue lands directly in Pending.
 */
export async function quickSubmitCapture({
  capture,
  captures,
  settings,
  fetchImpl = fetch,
  readSnapshot,
  title,
  description,
  priority,
  onStep,
}) {
  const cleanTitle = typeof title === "string" ? title.trim() : "";
  if (!cleanTitle) {
    return { ok: false, step: 0, error: "A title is required." };
  }
  if (!Number.isInteger(priority) || priority < 0 || priority > 100) {
    return {
      ok: false,
      step: 0,
      error: "Priority must be an integer from 0 to 100.",
    };
  }

  const list = captureList(capture, captures);
  if (list.length === 0) {
    return { ok: false, step: 0, error: "Capture a screenshot first." };
  }

  const { primary, environment, logs } = await prepareCapture(
    list,
    readSnapshot,
  );

  onStep?.(0);

  const uploaded = await uploadCaptures(list, settings, fetchImpl);
  if (!uploaded.ok) {
    return { ok: false, step: 0, error: uploaded.error };
  }

  environment.captured_pages = buildCapturedPages(list, uploaded.uploads);

  onStep?.(1);

  const draft = await createDraft({
    list,
    primary,
    environment,
    logs,
    uploads: uploaded.uploads,
    settings,
    fetchImpl,
  });

  if (!draft.ok) {
    return {
      ok: false,
      step: 1,
      uploadUrl: uploaded.uploads[0].url,
      error: draft.error,
    };
  }

  onStep?.(2);

  const finalizeResponse = await fetchImpl(
    `${settings.appBaseUrl}/api/issues/${draft.issueId}/finalize?token=${encodeURIComponent(
      draft.draftToken,
    )}`,
    {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: cleanTitle,
        description,
        priority,
      }),
    },
  );
  const finalizeBody = await finalizeResponse.json().catch(() => ({}));

  if (!finalizeResponse.ok) {
    const reason = String(
      finalizeBody.error?.message ??
        finalizeBody.detail ??
        `HTTP ${finalizeResponse.status}`,
    ).replace(/[.\s]+$/, "");
    return {
      ok: false,
      step: 2,
      issueId: draft.issueId,
      editorUrl: draft.editorUrl,
      uploadUrl: uploaded.uploads[0].url,
      error: `Quick submit failed: ${reason}. The draft was created and stays in Draft.`,
    };
  }

  onStep?.(3);

  return {
    ok: true,
    step: 3,
    issueId: draft.issueId,
    redirectUrl: `${settings.appBaseUrl}${finalizeBody.redirect_url ?? "/dashboard"}?issue=${draft.issueId}`,
    uploadUrl: uploaded.uploads[0].url,
    uploadUrls: uploaded.uploads.map((upload) => upload.url),
    captureCount: list.length,
  };
}
