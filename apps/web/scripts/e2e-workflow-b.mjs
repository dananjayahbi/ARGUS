#!/usr/bin/env node
/**
 * Workflow B end-to-end gate:
 * pending -> working -> reconsider (developer note + attachment) -> QA reply ->
 * working, with the mandatory-note rejection path and the chronological audit
 * trail. Uses the real CDN, web server, database and dashboard session.
 */
import assert from "node:assert/strict";

import { Client } from "pg";

import {
  assertWebBuild,
  cleanupStorage,
  dropDatabase,
  e2eConfig,
  login,
  makePng,
  provisionDatabase,
  startAppServices,
  stopService,
} from "./e2e-harness.mjs";

const logs = { web: "", cdn: "" };

async function main() {
  assertWebBuild();
  const config = e2eConfig();
  const sourceUrl = process.env.DATABASE_URL;
  if (!sourceUrl) {
    throw new Error("DATABASE_URL is required");
  }

  const provisioned = await provisionDatabase(sourceUrl, "argus_e2e_b");
  let services;
  const summary = {};

  try {
    services = await startAppServices({
      databaseUrl: provisioned.databaseUrl,
      config,
      logs,
    });
    const { webBase } = services;

    const db = new Client({ connectionString: provisioned.databaseUrl });
    await db.connect();
    const project = await db.query(
      "INSERT INTO projects (name, key) VALUES ('Reconsider Project', 'RCN') RETURNING id",
    );
    const projectId = project.rows[0].id;
    await db.end();

    // 1. Create a real pending issue through ingest + finalize.
    const ingest = await fetch(`${webBase}/api/ingest/draft`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Workspace-Token": config.workspaceToken,
      },
      body: JSON.stringify({
        project_id: projectId,
        report_type: "text_only",
        environment_info: { url: "https://target.example/reconsider" },
        console_logs: [],
      }),
    });
    assert.equal(ingest.status, 201);
    const draft = await ingest.json();
    const issueId = draft.issue_id;
    summary.issue_id = issueId;

    const finalize = await fetch(
      `${webBase}/api/issues/${issueId}/finalize?token=${encodeURIComponent(draft.draft_token)}`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: "Workflow B: reconsider loop",
          description: "Created by the reconsider E2E gate.",
          priority: 60,
        }),
      },
    );
    assert.equal(finalize.status, 200);

    // 2. Log in as both actors.
    const qa = await login(webBase, config.qaEmail, config.qaPassword);
    const developer = await login(
      webBase,
      config.developerEmail,
      config.developerPassword,
    );
    assert.equal(qa.response.status, 200);
    assert.equal(developer.response.status, 200);
    assert.ok(qa.cookie && developer.cookie);

    // 3. Pending -> working through the status API.
    const toWorking = await fetch(`${webBase}/api/issues/${issueId}/status`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        cookie: qa.cookie,
      },
      body: JSON.stringify({ status: "working" }),
    });
    assert.equal(toWorking.status, 200);

    // 4. Rejection path: no note and a direct status transition both fail.
    const emptyNote = await fetch(
      `${webBase}/api/issues/${issueId}/reconsider`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: developer.cookie,
        },
        body: JSON.stringify({ author_role: "developer", note: "   " }),
      },
    );
    assert.equal(emptyNote.status, 422);
    summary.empty_note_status = emptyNote.status;

    const directReconsider = await fetch(
      `${webBase}/api/issues/${issueId}/status`,
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          cookie: qa.cookie,
        },
        body: JSON.stringify({ status: "reconsider" }),
      },
    );
    assert.equal(directReconsider.status, 422);
    summary.direct_reconsider_status = directReconsider.status;

    // 5. Upload the developer attachment through the dashboard-session proxy.
    const attachmentBytes = makePng(32, 32, (x, y) =>
      Math.abs(x - y) < 2 ? [244, 63, 94, 255] : [15, 23, 42, 255],
    );
    const form = new FormData();
    form.append("category", "reconsider");
    form.append(
      "file",
      new Blob([attachmentBytes], { type: "image/png" }),
      "reconsider-evidence.png",
    );
    const attachmentUpload = await fetch(
      `${webBase}/api/uploads?issueId=${issueId}`,
      {
        method: "POST",
        headers: { cookie: developer.cookie },
        body: form,
      },
    );
    assert.equal(attachmentUpload.status, 201);
    const attachment = await attachmentUpload.json();
    assert.match(attachment.url, /\/reconsider\//);

    const attachmentFetch = await fetch(attachment.url);
    assert.equal(attachmentFetch.status, 200);
    const attachmentBody = Buffer.from(await attachmentFetch.arrayBuffer());
    assert.equal(attachmentBody.length, attachmentBytes.length);
    summary.attachment_url = attachment.url;

    // 6. Working -> reconsider with a mandatory developer note and attachment.
    const reconsider = await fetch(
      `${webBase}/api/issues/${issueId}/reconsider`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: developer.cookie,
        },
        body: JSON.stringify({
          author_role: "developer",
          note: "Cannot reproduce on the staging build. See the attached capture.",
          attachment_urls: [attachment.url],
        }),
      },
    );
    assert.equal(reconsider.status, 201);
    const reconsiderBody = await reconsider.json();
    assert.equal(reconsiderBody.current_status, "reconsider");
    summary.reconsider_status = reconsiderBody.current_status;

    // 7. The card must be flagged as needing QA on the board.
    const board = await fetch(`${webBase}/projects/RCN`, {
      headers: { cookie: qa.cookie },
    });
    const boardHtml = await board.text();
    assert.equal(board.status, 200);
    assert.match(boardHtml, /Workflow B: reconsider loop/);
    assert.match(boardHtml, /Needs QA/);
    summary.card_flagged = true;

    // 8. QA reply returns the issue to working.
    const reply = await fetch(`${webBase}/api/issues/${issueId}/reconsider`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: qa.cookie,
      },
      body: JSON.stringify({
        author_role: "qa",
        note: "Added staging logs and reproduction steps.",
      }),
    });
    assert.equal(reply.status, 201);
    const replyBody = await reply.json();
    assert.equal(replyBody.current_status, "working");
    summary.qa_reply_status = replyBody.current_status;

    // 9. Audit trail: two notes, developer then QA, attachment preserved.
    const notesResponse = await fetch(
      `${webBase}/api/issues/${issueId}/notes`,
      { headers: { cookie: qa.cookie } },
    );
    assert.equal(notesResponse.status, 200);
    const notesBody = await notesResponse.json();
    assert.equal(notesBody.notes.length, 2);
    assert.equal(notesBody.notes[0].author_role, "developer");
    assert.equal(notesBody.notes[1].author_role, "qa");
    assert.match(notesBody.notes[0].note, /Cannot reproduce/);
    assert.match(notesBody.notes[1].note, /staging logs/);
    assert.deepEqual(notesBody.notes[0].attachment_urls, [attachment.url]);
    assert.ok(
      Date.parse(notesBody.notes[0].created_at) <=
        Date.parse(notesBody.notes[1].created_at),
    );

    const check = new Client({ connectionString: provisioned.databaseUrl });
    await check.connect();
    const row = await check.query(
      "SELECT status FROM issues WHERE id = $1",
      [issueId],
    );
    const noteRows = await check.query(
      "SELECT author_role, attachment_urls FROM issue_reconsider_notes WHERE issue_id = $1 ORDER BY created_at",
      [issueId],
    );
    await check.end();

    assert.equal(row.rows[0].status, "working");
    assert.deepEqual(
      noteRows.rows.map((note) => note.author_role),
      ["developer", "qa"],
    );
    assert.deepEqual(noteRows.rows[0].attachment_urls, [attachment.url]);
    summary.audit_entries = noteRows.rows.length;

    console.log(JSON.stringify({ status: "ok", ...summary }, null, 2));
  } catch (error) {
    console.error("E2E Workflow B failed");
    console.error(error);
    console.error("--- web log tail ---");
    console.error(logs.web.slice(-4000));
    console.error("--- cdn log tail ---");
    console.error(logs.cdn.slice(-4000));
    process.exitCode = 1;
  } finally {
    if (services) {
      await stopService(services.web);
      await stopService(services.cdn);
      await cleanupStorage(services.storageRoot);
    }
    await dropDatabase(provisioned.adminUrl, provisioned.dbName);
  }
}

await main();
