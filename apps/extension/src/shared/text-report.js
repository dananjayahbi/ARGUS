export async function submitTextReport({
  projectId,
  title,
  description,
  priority,
  environment,
  logs,
  settings,
  fetchImpl = fetch,
}) {
  if (!title || !title.trim()) {
    return { ok: false, error: "A title is required." };
  }

  if (!Number.isInteger(priority) || priority < 0 || priority > 100) {
    return {
      ok: false,
      error: "Priority must be an integer from 0 to 100.",
    };
  }

  if (!projectId) {
    return { ok: false, error: "Select a project." };
  }

  const ingestResponse = await fetchImpl(
    `${settings.appBaseUrl}/api/ingest/draft`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Workspace-Token": settings.workspaceToken,
      },
      body: JSON.stringify({
        project_id: projectId,
        report_type: "text_only",
        environment_info: environment,
        console_logs: Array.isArray(logs) ? logs : [],
      }),
    },
  );
  const ingestBody = await ingestResponse.json().catch(() => ({}));

  if (!ingestResponse.ok || !ingestBody.issue_id || !ingestBody.draft_token) {
    return {
      ok: false,
      error:
        ingestBody.error?.message ??
        ingestBody.detail ??
        `Draft creation failed (${ingestResponse.status}).`,
    };
  }

  const finalizeResponse = await fetchImpl(
    `${settings.appBaseUrl}/api/issues/${ingestBody.issue_id}/finalize?token=${encodeURIComponent(
      ingestBody.draft_token,
    )}`,
    {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: title.trim(),
        description,
        priority,
      }),
    },
  );
  const finalizeBody = await finalizeResponse.json().catch(() => ({}));

  if (!finalizeResponse.ok) {
    return {
      ok: false,
      error:
        finalizeBody.error?.message ??
        finalizeBody.detail ??
        `Finalize failed (${finalizeResponse.status}).`,
    };
  }

  return {
    ok: true,
    issueId: ingestBody.issue_id,
    redirectUrl: `${settings.appBaseUrl}${
      finalizeBody.redirect_url ?? "/dashboard"
    }?issue=${ingestBody.issue_id}`,
  };
}
