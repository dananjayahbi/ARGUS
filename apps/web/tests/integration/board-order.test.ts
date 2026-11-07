import { randomUUID } from "node:crypto";

import type { QueryResultRow } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { POST as createIssue } from "@/app/api/issues/route";
import { PATCH as moveIssue } from "@/app/api/issues/[id]/position/route";
import { PATCH as changeStatus } from "@/app/api/issues/[id]/status/route";
import { signSessionJwt } from "@/lib/auth-session";
import { closePool, query } from "@/lib/db";
import { ensureSeedUsers } from "@/lib/users";

interface UserRecord extends QueryResultRow {
  id: string;
  email: string;
  role: "qa" | "developer";
}

interface IssueRow extends QueryResultRow {
  id: string;
  title: string;
  status: string;
  board_order: number;
}

const SESSION_IDS: string[] = [];
let projectId = "";
let cookie = "";

function jsonRequest(url: string, method: string, body: unknown): Request {
  return new Request(url, {
    method,
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function createPendingIssue(title: string): Promise<IssueRow> {
  const response = await createIssue(
    jsonRequest("http://localhost:3000/api/issues", "POST", {
      project_key: "ARG",
      title,
      priority: 50,
      status: "pending",
      report_type: "text_only",
    }),
  );
  expect(response.status).toBe(201);
  const body = await response.json();
  return body.issue as IssueRow;
}

function positionRequest(body: unknown, issueId: string) {
  return jsonRequest(
    `http://localhost:3000/api/issues/${issueId}/position`,
    "PATCH",
    body,
  );
}

beforeAll(async () => {
  await ensureSeedUsers();

  const userResult = await query<UserRecord>(
    "SELECT id, email, role FROM users WHERE role = 'developer' LIMIT 1",
  );
  const user = userResult.rows[0];

  const projectResult = await query<{ id: string } & QueryResultRow>(
    "SELECT id FROM projects WHERE key = 'ARG' LIMIT 1",
  );
  projectId = projectResult.rows[0].id;

  const sessionId = randomUUID();
  SESSION_IDS.push(sessionId);
  await query(
    `INSERT INTO sessions (id, user_id, expires_at)
     VALUES ($1, $2, now() + interval '1 hour')`,
    [sessionId, user.id],
  );
  cookie = `argus_session=${await signSessionJwt({
    sid: sessionId,
    sub: user.id,
    email: user.email,
    role: user.role,
  })}`;
});

beforeEach(async () => {
  await query(
    `TRUNCATE TABLE notifications,
                    issue_comment_attachments,
                    issue_comments,
                    issue_supplementary_assets,
                    issue_reconsider_notes,
                    issues
     RESTART IDENTITY CASCADE`,
  );
});

afterAll(async () => {
  await query(
    `TRUNCATE TABLE notifications,
                    issue_comment_attachments,
                    issue_comments,
                    issue_supplementary_assets,
                    issue_reconsider_notes,
                    issues
     RESTART IDENTITY CASCADE`,
  );
  await query("DELETE FROM sessions WHERE id = ANY($1::uuid[])", [
    SESSION_IDS,
  ]);
  await closePool();
});

async function pendingOrder(): Promise<string[]> {
  const result = await query<{ id: string } & QueryResultRow>(
    `SELECT id
       FROM issues
      WHERE project_id = $1
        AND status = 'pending'
      ORDER BY board_order ASC, issue_number ASC`,
    [projectId],
  );
  return result.rows.map((row) => row.id);
}

describe("board ordering (integration)", () => {
  it("appends new issues and persists a manual reorder", async () => {
    const first = await createPendingIssue("First");
    const second = await createPendingIssue("Second");
    const third = await createPendingIssue("Third");

    expect(first.board_order).toBeLessThan(second.board_order);
    expect(second.board_order).toBeLessThan(third.board_order);
    expect(await pendingOrder()).toEqual([first.id, second.id, third.id]);

    const response = await moveIssue(
      positionRequest(
        {
          status: "pending",
          previous_issue_id: null,
          next_issue_id: first.id,
        },
        third.id,
      ),
      { params: Promise.resolve({ id: third.id }) },
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.issue.board_order).toBeLessThan(first.board_order);
    expect(await pendingOrder()).toEqual([third.id, first.id, second.id]);
  }, 20_000);

  it("places an issue between two neighbours", async () => {
    const first = await createPendingIssue("First");
    const second = await createPendingIssue("Second");
    const third = await createPendingIssue("Third");

    const response = await moveIssue(
      positionRequest(
        {
          status: "pending",
          previous_issue_id: first.id,
          next_issue_id: second.id,
        },
        third.id,
      ),
      { params: Promise.resolve({ id: third.id }) },
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.issue.board_order).toBeGreaterThan(first.board_order);
    expect(body.issue.board_order).toBeLessThan(second.board_order);
    expect(await pendingOrder()).toEqual([first.id, third.id, second.id]);
  }, 20_000);

  it("appends to the end when a status change has no neighbours", async () => {
    const pending = await createPendingIssue("Pending");
    const working = await createPendingIssue("Working");

    const statusResponse = await changeStatus(
      jsonRequest(
        `http://localhost:3000/api/issues/${working.id}/status`,
        "PATCH",
        { status: "working" },
      ),
      { params: Promise.resolve({ id: working.id }) },
    );
    const statusBody = await statusResponse.json();

    const response = await moveIssue(
      positionRequest(
        { status: "working", previous_issue_id: null, next_issue_id: null },
        pending.id,
      ),
      { params: Promise.resolve({ id: pending.id }) },
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.issue.status).toBe("working");
    expect(body.issue.board_order).toBeGreaterThan(
      statusBody.issue.board_order,
    );

    const workingOrder = await query<{ id: string } & QueryResultRow>(
      `SELECT id
         FROM issues
        WHERE project_id = $1
          AND status = 'working'
        ORDER BY board_order ASC, issue_number ASC`,
      [projectId],
    );
    expect(workingOrder.rows.map((row) => row.id)).toEqual([
      working.id,
      pending.id,
    ]);
  }, 20_000);
});
