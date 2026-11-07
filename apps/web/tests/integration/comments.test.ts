import { randomUUID } from "node:crypto";

import type { QueryResultRow } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { GET as getComments, POST as postComment } from "@/app/api/issues/[id]/comments/route";
import { GET as getNotifications } from "@/app/api/notifications/route";
import { POST as markNotificationsRead } from "@/app/api/notifications/read/route";
import { signSessionJwt } from "@/lib/auth-session";
import { closePool, query } from "@/lib/db";
import { ensureSeedUsers } from "@/lib/users";

interface UserRecord extends QueryResultRow {
  id: string;
  email: string;
  role: "qa" | "developer";
}

interface IssueRecord extends QueryResultRow {
  id: string;
  project_id: string;
  title: string;
  status: string;
  report_type: string;
}

const SESSION_IDS: string[] = [];
let projectId = "";
let qaUser: UserRecord;
let devUser: UserRecord;
let qaCookie = "";
let devCookie = "";

const ISSUE_ID = "22222222-2222-4222-8222-222222222222";

function jsonRequest(
  url: string,
  cookie: string,
  body?: unknown,
): Request {
  return new Request(url, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      cookie,
      ...(body === undefined
        ? {}
        : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function commentRequest(cookie: string, body?: unknown, issueId = ISSUE_ID) {
  return jsonRequest(
    `http://localhost:3000/api/issues/${issueId}/comments`,
    cookie,
    body,
  );
}

async function createSession(user: UserRecord): Promise<string> {
  const sessionId = randomUUID();
  SESSION_IDS.push(sessionId);
  await query(
    `INSERT INTO sessions (id, user_id, expires_at)
     VALUES ($1, $2, now() + interval '1 hour')`,
    [sessionId, user.id],
  );
  return `argus_session=${await signSessionJwt({
    sid: sessionId,
    sub: user.id,
    email: user.email,
    role: user.role,
  })}`;
}

async function createIssue(): Promise<string> {
  const result = await query<IssueRecord>(
    `INSERT INTO issues
       (project_id, title, description, priority, status, report_type)
     VALUES ($1, 'Comment integration issue', 'body', 60, 'pending', 'text_only')
     RETURNING id, project_id, title, status, report_type`,
    [projectId],
  );
  return result.rows[0].id;
}

beforeAll(async () => {
  await ensureSeedUsers();

  const users = await query<UserRecord>(
    `SELECT id, email, role FROM users WHERE role = ANY($1::text[])`,
    [["qa", "developer"]],
  );
  qaUser = users.rows.find((user) => user.role === "qa")!;
  devUser = users.rows.find((user) => user.role === "developer")!;

  const project = await query<{ id: string } & QueryResultRow>(
    "SELECT id FROM projects WHERE key = 'ARG' LIMIT 1",
  );
  projectId = project.rows[0].id;

  qaCookie = await createSession(qaUser);
  devCookie = await createSession(devUser);
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

describe("comments and notifications (integration)", () => {
  it("posts a comment and notifies the other role", async () => {
    const issueId = await createIssue();
    const commentResponse = await postComment(
      commentRequest(qaCookie, {
        body: "Can you reproduce this on Chrome?",
        attachments: [
          {
            url: "https://cdn.example/files/2026/11/console.log",
            asset_type: "text/plain",
            file_name: "console.log",
            size_bytes: 128,
          },
        ],
      }, issueId),
      { params: Promise.resolve({ id: issueId }) },
    );

    expect(commentResponse.status).toBe(201);
    const commentBody = await commentResponse.json();
    expect(commentBody.comment.author_role).toBe("qa");
    expect(commentBody.comment.attachments).toHaveLength(1);

    const stored = await query<{
      body: string;
      author_role: string;
    } & QueryResultRow>(
      "SELECT body, author_role FROM issue_comments WHERE issue_id = $1",
      [issueId],
    );
    expect(stored.rows).toEqual([
      { body: "Can you reproduce this on Chrome?", author_role: "qa" },
    ]);

    const attachment = await query<{
      asset_url: string;
      file_name: string;
      size_bytes: string;
    } & QueryResultRow>(
      "SELECT asset_url, file_name, size_bytes FROM issue_comment_attachments",
    );
    expect(attachment.rows[0]).toMatchObject({
      asset_url: "https://cdn.example/files/2026/11/console.log",
      file_name: "console.log",
      size_bytes: "128",
    });

    const devNotifications = await query<{
      id: string;
      comment_id: string;
      actor_role: string;
      read_at: Date | null;
    } & QueryResultRow>(
      "SELECT id, comment_id, actor_role, read_at FROM notifications WHERE user_id = $1",
      [devUser.id],
    );
    expect(devNotifications.rows).toHaveLength(1);
    expect(devNotifications.rows[0]).toMatchObject({
      comment_id: commentBody.comment.id,
      actor_role: "qa",
      read_at: null,
    });

    const feed = await getNotifications(
      jsonRequest("http://localhost:3000/api/notifications", devCookie),
    );
    expect(feed.status).toBe(200);
    const feedBody = await feed.json();
    expect(feedBody.unread_count).toBe(1);
    expect(feedBody.notifications[0]).toMatchObject({
      issue_id: issueId,
      actor_role: "qa",
      comment_body: "Can you reproduce this on Chrome?",
    });

    const readResponse = await markNotificationsRead(
      jsonRequest(
        "http://localhost:3000/api/notifications/read",
        devCookie,
        { ids: [devNotifications.rows[0].id] },
      ),
    );
    expect(readResponse.status).toBe(200);
    await expect(readResponse.json()).resolves.toMatchObject({
      unread_count: 0,
    });
  }, 20_000);

  it("returns the conversation in chronological order with the viewer role", async () => {
    const issueId = await createIssue();

    await postComment(
      commentRequest(qaCookie, { body: "First from QA" }, issueId),
      { params: Promise.resolve({ id: issueId }) },
    );
    await postComment(
      commentRequest(devCookie, { body: "Then from developer" }, issueId),
      { params: Promise.resolve({ id: issueId }) },
    );

    const response = await getComments(
      commentRequest(qaCookie, undefined, issueId),
      { params: Promise.resolve({ id: issueId }) },
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.viewer).toEqual({
      id: qaUser.id,
      email: qaUser.email,
      role: "qa",
    });
    expect(body.comments.map((comment: { body: string }) => comment.body)).toEqual([
      "First from QA",
      "Then from developer",
    ]);
    expect(
      body.comments.map((comment: { author_role: string }) => comment.author_role),
    ).toEqual(["qa", "developer"]);

    const qaNotifications = await query<{ count: number } & QueryResultRow>(
      "SELECT count(*)::int AS count FROM notifications WHERE user_id = $1",
      [qaUser.id],
    );
    expect(qaNotifications.rows[0].count).toBe(1);
  }, 20_000);

  it("rejects unauthenticated, empty and unknown-issue comments", async () => {
    const issueId = await createIssue();

    const anonymous = await postComment(
      commentRequest("", { body: "hello" }, issueId),
      { params: Promise.resolve({ id: issueId }) },
    );
    expect(anonymous.status).toBe(401);

    const empty = await postComment(
      commentRequest(qaCookie, { body: "   " }, issueId),
      { params: Promise.resolve({ id: issueId }) },
    );
    expect(empty.status).toBe(422);

    const unknownIssue = "99999999-9999-4999-8999-999999999999";
    const missing = await postComment(
      commentRequest(qaCookie, { body: "hello" }, unknownIssue),
      { params: Promise.resolve({ id: unknownIssue }) },
    );
    expect(missing.status).toBe(404);
  });
});
