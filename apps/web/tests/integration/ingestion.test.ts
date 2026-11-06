import type { QueryResultRow } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { PUT as finalizeIssue } from "@/app/api/issues/[id]/finalize/route";
import { POST as ingestDraft } from "@/app/api/ingest/draft/route";
import { closePool, query } from "@/lib/db";
import { signDraftToken } from "@/lib/draft-token";

const WORKSPACE_TOKEN = process.env.WORKSPACE_TOKEN as string;

interface IssueRecord extends QueryResultRow {
  status: string;
  report_type: string;
  raw_image_url: string | null;
  environment_info: { url?: string } | null;
  console_logs: Array<{ type: string }> | null;
  ephemeral_token: string | null;
  token_expires_at: Date | null;
  title: string;
  description: string | null;
  priority: number;
  annotated_image_url: string | null;
  canvas_state: { version?: string; objects?: Array<{ type: string }> } | null;
  audio_note_url: string | null;
}

const baseDraft = {
  project_id: "",
  report_type: "screenshot",
  raw_image_url: "http://127.0.0.1:8080/raw/2026/11/contract.png",
  environment_info: {
    url: "https://target.example",
    viewport: { width: 1280, height: 720 },
  },
  console_logs: [
    {
      type: "error",
      message: "boom",
      timestamp: "2026-11-06T00:00:00.000Z",
    },
  ],
};

const finalPayload = {
  title: "Contract test issue",
  description: "Markdown **description**",
  priority: 64,
  annotated_image_url: "http://127.0.0.1:8080/annotated/2026/11/contract.png",
  canvas_state: { version: "1", objects: [{ type: "badge", text: "1" }] },
  audio_note_url: "http://127.0.0.1:8080/audio/2026/11/contract.webm",
};

function ingestRequest(body: unknown, token: string | null = WORKSPACE_TOKEN) {
  return new Request("http://localhost:3000/api/ingest/draft", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { "x-workspace-token": token } : {}),
    },
    body: JSON.stringify(body),
  });
}

function finalizeRequest(issueId: string, token: string, body: unknown) {
  return new Request(
    `http://localhost:3000/api/issues/${issueId}/finalize?token=${encodeURIComponent(token)}`,
    {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

async function createDraft(overrides: Record<string, unknown> = {}) {
  const response = await ingestDraft(
    ingestRequest({ ...baseDraft, ...overrides }),
  );
  const body = (await response.json()) as {
    issue_id: string;
    draft_token: string;
    editor_url: string;
  };
  return { response, body };
}

async function fetchIssue(issueId: string): Promise<IssueRecord> {
  const result = await query<IssueRecord>(
    "SELECT * FROM issues WHERE id = $1",
    [issueId],
  );
  return result.rows[0];
}

async function issueCount(): Promise<number> {
  const result = await query<{ count: number } & QueryResultRow>(
    "SELECT count(*)::int AS count FROM issues",
  );
  return result.rows[0].count;
}

beforeAll(async () => {
  const result = await query<{ id: string } & QueryResultRow>(
    "SELECT id FROM projects WHERE key = 'ARG' LIMIT 1",
  );
  baseDraft.project_id = result.rows[0].id;
});

beforeEach(async () => {
  await query(
    `TRUNCATE TABLE issue_supplementary_assets,
                    issue_reconsider_notes,
                    issues
     RESTART IDENTITY CASCADE`,
  );
});

afterAll(async () => {
  await query(
    `TRUNCATE TABLE issue_supplementary_assets,
                    issue_reconsider_notes,
                    issues
     RESTART IDENTITY CASCADE`,
  );
  await closePool();
});

describe("POST /api/ingest/draft (integration)", () => {
  it("creates a draft and persists JSONB telemetry", async () => {
    const { response, body } = await createDraft();

    expect(response.status).toBe(201);
    expect(body.issue_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(body.draft_token.split(".")).toHaveLength(3);
    expect(body.editor_url).toContain(`/canvas/${body.issue_id}?token=`);

    const issue = await fetchIssue(body.issue_id);
    expect(issue.status).toBe("draft");
    expect(issue.report_type).toBe("screenshot");
    expect(issue.raw_image_url).toBe(baseDraft.raw_image_url);
    expect(issue.environment_info?.url).toBe("https://target.example");
    expect(issue.console_logs?.[0]?.type).toBe("error");
    expect(issue.ephemeral_token).toBe(body.draft_token);
    expect(issue.token_expires_at?.getTime()).toBeGreaterThan(Date.now());
  });

  it("rejects missing and wrong workspace tokens without creating rows", async () => {
    const missing = await ingestDraft(ingestRequest(baseDraft, null));
    const wrong = await ingestDraft(ingestRequest(baseDraft, "wrong-token"));

    expect(missing.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(await issueCount()).toBe(0);
  });

  it("rejects an invalid report_type", async () => {
    const response = await ingestDraft(
      ingestRequest({ ...baseDraft, report_type: "video" }),
    );

    expect(response.status).toBe(422);
    expect(await issueCount()).toBe(0);
  });

  it("rejects an unknown project", async () => {
    const response = await ingestDraft(
      ingestRequest({
        ...baseDraft,
        project_id: "99999999-9999-4999-8999-999999999999",
      }),
    );

    expect(response.status).toBe(404);
    expect(await issueCount()).toBe(0);
  });

  it("accepts text_only without a raw image", async () => {
    const { response, body } = await createDraft({
      report_type: "text_only",
      raw_image_url: undefined,
    });

    expect(response.status).toBe(201);
    const issue = await fetchIssue(body.issue_id);
    expect(issue.report_type).toBe("text_only");
    expect(issue.raw_image_url).toBeNull();
  });
});

describe("PUT /api/issues/[id]/finalize (integration)", () => {
  it("finalizes a draft and persists the submitted fields", async () => {
    const { body } = await createDraft();

    const response = await finalizeIssue(
      finalizeRequest(body.issue_id, body.draft_token, finalPayload),
      { params: Promise.resolve({ id: body.issue_id }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      success: true,
      status: "pending",
      redirect_url: "/projects/ARG",
    });

    const issue = await fetchIssue(body.issue_id);
    expect(issue.status).toBe("pending");
    expect(issue.title).toBe(finalPayload.title);
    expect(issue.description).toBe(finalPayload.description);
    expect(issue.priority).toBe(finalPayload.priority);
    expect(issue.annotated_image_url).toBe(finalPayload.annotated_image_url);
    expect(issue.canvas_state).toEqual(finalPayload.canvas_state);
    expect(issue.audio_note_url).toBe(finalPayload.audio_note_url);
    expect(issue.ephemeral_token).toBeNull();
    expect(issue.token_expires_at).toBeNull();
  });

  it("persists supplementary assets with the finalized issue", async () => {
    const { body } = await createDraft();

    const response = await finalizeIssue(
      finalizeRequest(body.issue_id, body.draft_token, {
        ...finalPayload,
        supplementary_assets: [
          {
            url: "https://cdn.example/reconsider/a.png",
            asset_type: "image/png",
          },
          {
            url: "https://cdn.example/reconsider/b.webm",
            asset_type: "audio/webm",
          },
        ],
      }),
      { params: Promise.resolve({ id: body.issue_id }) },
    );

    expect(response.status).toBe(200);

    const assets = await query<
      { asset_url: string; asset_type: string } & QueryResultRow
    >(
      `SELECT asset_url, asset_type
         FROM issue_supplementary_assets
        WHERE issue_id = $1
        ORDER BY asset_url`,
      [body.issue_id],
    );

    expect(assets.rows).toEqual([
      {
        asset_url: "https://cdn.example/reconsider/a.png",
        asset_type: "image/png",
      },
      {
        asset_url: "https://cdn.example/reconsider/b.webm",
        asset_type: "audio/webm",
      },
    ]);
  });

  it("rejects an expired token and leaves the issue unchanged", async () => {
    const { body } = await createDraft();
    const expired = signDraftToken(body.issue_id, {
      now: new Date(Date.now() - 31 * 60 * 1000),
    }).token;

    const response = await finalizeIssue(
      finalizeRequest(body.issue_id, expired, finalPayload),
      { params: Promise.resolve({ id: body.issue_id }) },
    );

    expect(response.status).toBe(401);
    expect((await fetchIssue(body.issue_id)).status).toBe("draft");
  });

  it("rejects priority 101 and leaves the issue unchanged", async () => {
    const { body } = await createDraft();

    const response = await finalizeIssue(
      finalizeRequest(body.issue_id, body.draft_token, {
        ...finalPayload,
        priority: 101,
      }),
      { params: Promise.resolve({ id: body.issue_id }) },
    );

    expect(response.status).toBe(422);
    expect((await fetchIssue(body.issue_id)).status).toBe("draft");
  });

  it("rejects a missing title", async () => {
    const { body } = await createDraft();

    const response = await finalizeIssue(
      finalizeRequest(body.issue_id, body.draft_token, {
        ...finalPayload,
        title: "   ",
      }),
      { params: Promise.resolve({ id: body.issue_id }) },
    );

    expect(response.status).toBe(422);
  });

  it("rejects a double finalize", async () => {
    const { body } = await createDraft();

    const first = await finalizeIssue(
      finalizeRequest(body.issue_id, body.draft_token, finalPayload),
      { params: Promise.resolve({ id: body.issue_id }) },
    );
    const second = await finalizeIssue(
      finalizeRequest(body.issue_id, body.draft_token, finalPayload),
      { params: Promise.resolve({ id: body.issue_id }) },
    );

    expect(first.status).toBe(200);
    expect(second.status).toBe(409);
    expect((await fetchIssue(body.issue_id)).status).toBe("pending");
  });

  it("rejects a token issued for another issue", async () => {
    const first = await createDraft();
    const second = await createDraft();

    const response = await finalizeIssue(
      finalizeRequest(
        second.body.issue_id,
        first.body.draft_token,
        finalPayload,
      ),
      { params: Promise.resolve({ id: second.body.issue_id }) },
    );

    expect(response.status).toBe(401);
    expect((await fetchIssue(second.body.issue_id)).status).toBe("draft");
  });
});
