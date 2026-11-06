export async function dispatchCapture({
  capture,
  settings,
  fetchImpl = fetch,
  createTab,
  readSnapshot,
  onStep,
}) {
  if (!capture) {
    return { ok: false, step: 0, error: "Capture a screenshot first." };
  }

  const snapshot =
    capture.snapshot ??
    (readSnapshot
      ? await readSnapshot(capture.tabId).catch(() => null)
      : null);

  const environment = snapshot?.environment_info ?? {
    url: capture.pageUrl ?? "",
    title: "",
    viewport: capture.viewport,
    screen: { width: 0, height: 0 },
    device_pixel_ratio: capture.devicePixelRatio,
    user_agent: "",
    os: "Unknown",
  };
  const logs = Array.isArray(snapshot?.console_logs)
    ? snapshot.console_logs
    : [];

  onStep?.(0);

  const blob = await (await fetchImpl(capture.dataUrl)).blob();
  const form = new FormData();
  form.append("category", "raw");
  form.append(
    "file",
    blob,
    `argus-${capture.mode === "full_page" ? "full-page" : "area"}-${Date.now()}.png`,
  );

  const uploadResponse = await fetchImpl(`${settings.cdnBaseUrl}/api/upload`, {
    method: "POST",
    headers: { "X-CDN-Auth-Token": settings.cdnToken },
    body: form,
  });
  const uploadBody = await uploadResponse.json().catch(() => ({}));

  if (!uploadResponse.ok || !uploadBody.url) {
    return {
      ok: false,
      step: 0,
      error: `Raw upload failed: ${
        uploadBody.detail ?? uploadResponse.status
      }. No draft was created.`,
    };
  }

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
          capture.mode === "full_page" ? "full_page" : "screenshot",
        raw_image_url: uploadBody.url,
        environment_info: environment,
        console_logs: logs,
      }),
    },
  );
  const ingestBody = await ingestResponse.json().catch(() => ({}));

  if (!ingestResponse.ok || !ingestBody.editor_url) {
    return {
      ok: false,
      step: 1,
      uploadUrl: uploadBody.url,
      error: `Draft creation failed: ${
        ingestBody.error?.message ??
        ingestBody.detail ??
        ingestResponse.status
      }. The raw image was uploaded to ${
        uploadBody.url
      } but is orphaned; retry will upload it again.`,
    };
  }

  onStep?.(2);
  await createTab(ingestBody.editor_url);

  return {
    ok: true,
    step: 2,
    editorUrl: ingestBody.editor_url,
    uploadUrl: uploadBody.url,
  };
}
