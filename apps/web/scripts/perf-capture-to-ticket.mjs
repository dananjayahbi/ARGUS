#!/usr/bin/env node
/**
 * Capture-to-ticket performance gate.
 *
 * Measures the real service boundaries with representative payloads and writes
 * docs/operations/performance-report.md. Human drawing/thinking time is not
 * included; the annotation stage measures export preparation only.
 */
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";

import { Client } from "pg";

import {
  appDir,
  assertWebBuild,
  cleanupStorage,
  dropDatabase,
  e2eConfig,
  login,
  makePng,
  provisionDatabase,
  startAppServices,
  stopService,
  uploadAsset,
} from "./e2e-harness.mjs";

const logs = { web: "", cdn: "" };

const STAGES = [
  ["capture", 1500],
  ["cdn_upload", 5000],
  ["draft_create", 2000],
  ["annotation", 1500],
  ["annotated_upload", 5000],
  ["audio_upload", 8000],
  ["finalize", 2000],
  ["board_visibility", 3000],
];
const TOTAL_BUDGET_MS = 30000;

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function round(value) {
  return Math.round(value * 10) / 10;
}

function makeWav(seconds, sampleRate = 22050) {
  const samples = seconds * sampleRate;
  const dataSize = samples * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(dataSize, 40);
  return buffer;
}

async function timed(fn) {
  const started = performance.now();
  const value = await fn();
  return { value, ms: performance.now() - started };
}

async function proxyUpload(webBase, issueId, token, category, bytes, filename, type) {
  const form = new FormData();
  form.append("category", category);
  form.append("file", new Blob([bytes], { type }), filename);
  const response = await fetch(
    `${webBase}/api/uploads?issueId=${issueId}&token=${encodeURIComponent(token)}`,
    { method: "POST", body: form },
  );
  const body = await response.json().catch(() => ({}));
  assert.equal(response.status, 201);
  assert.ok(body.url);
  return body.url;
}

async function runScenario({
  webBase,
  cdnBase,
  config,
  projectId,
  projectKey,
  cookie,
  imageWidth,
  imageHeight,
  audioSeconds,
  title,
}) {
  const stageTimes = {};
  const totalStarted = performance.now();

  const capture = await timed(async () => {
    const bytes = makePng(imageWidth, imageHeight, (x, y) => {
      if ((Math.floor(x / 120) + Math.floor(y / 120)) % 2 === 0) {
        return [15, 23, 42, 255];
      }
      return [30, 41, 59, 255];
    });
    assert.ok(bytes.length > 0);
    return bytes;
  });
  stageTimes.capture = capture.ms;

  const raw = await timed(() =>
    uploadAsset(cdnBase, config.cdnAuthToken, "raw", capture.value, `${title}-raw.png`),
  );
  stageTimes.cdn_upload = raw.ms;
  assert.equal(raw.value.response.status, 201);

  const draft = await timed(async () => {
    const response = await fetch(`${webBase}/api/ingest/draft`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Workspace-Token": config.workspaceToken,
      },
      body: JSON.stringify({
        project_id: projectId,
        report_type: "full_page",
        raw_image_url: raw.value.body.url,
        environment_info: {
          url: "https://target.example/perf",
          viewport: { width: imageWidth, height: imageHeight },
        },
        console_logs: [
          {
            type: "error",
            message: "perf harness error",
            timestamp: "2026-11-06T00:00:00.000Z",
          },
        ],
      }),
    });
    assert.equal(response.status, 201);
    return response.json();
  });
  stageTimes.draft_create = draft.ms;
  const issueId = draft.value.issue_id;

  const annotation = await timed(async () => {
    const annotated = makePng(imageWidth, imageHeight, (x, y) => {
      if (Math.abs(x - y) < 6) {
        return [244, 63, 94, 255];
      }
      return [15, 23, 42, 255];
    });
    const canvasState = {
      version: 1,
      width: imageWidth,
      height: imageHeight,
      background: raw.value.body.url,
      nodes: [
        {
          id: "perf-pen",
          type: "pen",
          x: 0,
          y: 0,
          points: [20, 20, 200, 200, 400, 300],
          stroke: "#f43f5e",
          strokeWidth: 4,
        },
      ],
    };
    return { annotated, canvasState };
  });
  stageTimes.annotation = annotation.ms;

  const annotatedUpload = await timed(() =>
    proxyUpload(
      webBase,
      issueId,
      draft.value.draft_token,
      "annotated",
      annotation.value.annotated,
      `${title}-annotated.png`,
      "image/png",
    ),
  );
  stageTimes.annotated_upload = annotatedUpload.ms;

  const audioBytes = makeWav(audioSeconds);
  const audioUpload = await timed(() =>
    proxyUpload(
      webBase,
      issueId,
      draft.value.draft_token,
      "audio",
      audioBytes,
      `${title}-voice.wav`,
      "audio/wav",
    ),
  );
  stageTimes.audio_upload = audioUpload.ms;

  const finalize = await timed(async () => {
    const response = await fetch(
      `${webBase}/api/issues/${issueId}/finalize?token=${encodeURIComponent(draft.value.draft_token)}`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: `Perf ${title}`,
          description: "Capture-to-ticket performance run.",
          priority: 75,
          annotated_image_url: annotatedUpload.value,
          audio_note_url: audioUpload.value,
          canvas_state: annotation.value.canvasState,
        }),
      },
    );
    assert.equal(response.status, 200);
    return response.json();
  });
  stageTimes.finalize = finalize.ms;

  const board = await timed(async () => {
    const response = await fetch(`${webBase}/projects/${projectKey}`, {
      headers: { cookie },
    });
    const html = await response.text();
    assert.equal(response.status, 200);
    assert.match(html, new RegExp(`Perf ${title}`));
    return html.length;
  });
  stageTimes.board_visibility = board.ms;

  const total = performance.now() - totalStarted;

  return {
    title,
    image: `${imageWidth}x${imageHeight}`,
    imageBytes: capture.value.length,
    audioSeconds,
    audioBytes: audioBytes.length,
    stages: Object.fromEntries(
      Object.entries(stageTimes).map(([key, value]) => [key, round(value)]),
    ),
    total_ms: round(total),
    issue_id: issueId,
  };
}

function markdownReport({ happy, worst, environment }) {
  const rows = [];
  for (const [stage, budget] of STAGES) {
    const happyValues = happy.map((run) => run.stages[stage]);
    const worstValues = worst.map((run) => run.stages[stage]);
    const happyMedian = median(happyValues);
    const worstMedian = median(worstValues);
    const worstMax = Math.max(...worstValues);
    const status = worstMax > budget ? "OVER BUDGET" : "ok";
    rows.push(
      `| ${stage} | ${budget} | ${round(happyMedian)} | ${round(worstMedian)} | ${round(worstMax)} | ${status} |`,
    );
  }

  const happyTotals = happy.map((run) => run.total_ms);
  const worstTotals = worst.map((run) => run.total_ms);
  const overBudget = STAGES.filter(([stage, budget]) =>
    [...happy, ...worst].some((run) => run.stages[stage] > budget),
  );

  const recommendations =
    overBudget.length === 0
      ? "No stage exceeded its budget. Keep the harness in the release gate and re-run on the Mini PC before rollout."
      : overBudget
          .map(
            ([stage, budget]) =>
              `- **${stage}** exceeded its ${budget} ms budget. Re-run on the Mini PC, inspect CDN/storage latency, and consider pre-compressing images or streaming the audio upload.`,
          )
          .join("\n");

  return `# Capture-to-ticket performance report

- **Generated:** ${new Date().toISOString()}
- **Target:** 30 seconds from capture to a pending issue on the board
- **Harness:** \`apps/web/scripts/perf-capture-to-ticket.mjs\`

## Environment

| Item | Value |
| --- | --- |
| Host OS | ${environment.platform} |
| CPU | ${environment.cpu} |
| RAM | ${environment.memoryGb} GB |
| Node | ${environment.node} |
| Network | Loopback (127.0.0.1). Production adds Cloudflare Tunnel latency, so treat these as a lower bound. |
| Database | PostgreSQL ${environment.postgres} |
| Runs | ${happy.length} representative + ${worst.length} worst-case |

## Representative payloads

| Scenario | Image | Audio | Runs |
| --- | --- | --- | --- |
| Representative | ${happy[0].image} (${happy[0].imageBytes} B) | ${happy[0].audioSeconds}s WAV (${happy[0].audioBytes} B) | ${happy.length} |
| Worst case | ${worst[0].image} (${worst[0].imageBytes} B) | ${worst[0].audioSeconds}s WAV (${worst[0].audioBytes} B) | ${worst.length} |

## Stage timings (milliseconds)

| Stage | Budget | Representative median | Worst-case median | Worst-case max | Status |
| --- | ---: | ---: | ---: | ---: | --- |
${rows.join("\n")}

## Totals

| Scenario | Median | Max | Budget | Result |
| --- | ---: | ---: | ---: | --- |
| Representative | ${round(median(happyTotals))} | ${round(Math.max(...happyTotals))} | ${TOTAL_BUDGET_MS} | ${median(happyTotals) <= TOTAL_BUDGET_MS ? "PASS" : "FAIL"} |
| Worst case | ${round(median(worstTotals))} | ${round(Math.max(...worstTotals))} | ${TOTAL_BUDGET_MS} | ${median(worstTotals) <= TOTAL_BUDGET_MS ? "PASS" : "FAIL"} |

## Recommendations

${recommendations}

## Notes

- The capture stage measures PNG generation/encoding on the harness host. The
  real extension adds \`captureVisibleTab\` and browser paint time, which should
  be spot-checked in the manual extension checklist.
- The annotation stage measures export preparation, not human drawing time.
- Audio uploads use the canvas proxy path and a multi-minute WAV payload for
  the worst case.
`;
}

async function main() {
  assertWebBuild();
  const config = e2eConfig();
  const sourceUrl = process.env.DATABASE_URL;
  if (!sourceUrl) {
    throw new Error("DATABASE_URL is required");
  }

  const provisioned = await provisionDatabase(sourceUrl, "argus_perf");
  let services;
  const results = { happy: [], worst: [] };

  try {
    services = await startAppServices({
      databaseUrl: provisioned.databaseUrl,
      config,
      logs,
    });
    const { webBase, cdnBase } = services;

    const db = new Client({ connectionString: provisioned.databaseUrl });
    await db.connect();
    const happyProject = await db.query(
      "INSERT INTO projects (name, key) VALUES ('Perf Representative', 'PERFH') RETURNING id",
    );
    const worstProject = await db.query(
      "INSERT INTO projects (name, key) VALUES ('Perf Worst Case', 'PERFW') RETURNING id",
    );
    await db.end();

    const qa = await login(webBase, config.qaEmail, config.qaPassword);
    assert.equal(qa.response.status, 200);
    assert.ok(qa.cookie);

    for (let index = 0; index < 5; index += 1) {
      results.happy.push(
        await runScenario({
          webBase,
          cdnBase,
          config,
          projectId: happyProject.rows[0].id,
          projectKey: "PERFH",
          cookie: qa.cookie,
          imageWidth: 1440,
          imageHeight: 900,
          audioSeconds: 15,
          title: `representative-${index + 1}`,
        }),
      );
    }

    for (let index = 0; index < 3; index += 1) {
      results.worst.push(
        await runScenario({
          webBase,
          cdnBase,
          config,
          projectId: worstProject.rows[0].id,
          projectKey: "PERFW",
          cookie: qa.cookie,
          imageWidth: 1440,
          imageHeight: 4000,
          audioSeconds: 180,
          title: `worst-case-${index + 1}`,
        }),
      );
    }

    const environment = {
      platform: `${os.platform()} ${os.release()}`,
      cpu: os.cpus()[0]?.model ?? "unknown",
      memoryGb: Math.round(os.totalmem() / 1024 / 1024 / 1024),
      node: process.version,
      postgres: "12",
    };

    const reportPath = path.join(
      appDir,
      "../../docs/operations/performance-report.md",
    );
    await writeFile(
      reportPath,
      markdownReport({ ...results, environment }),
    );

    console.log(
      JSON.stringify(
        {
          status: "ok",
          report: reportPath,
          happy_median_ms: round(
            median(results.happy.map((run) => run.total_ms)),
          ),
          happy_max_ms: round(
            Math.max(...results.happy.map((run) => run.total_ms)),
          ),
          worst_median_ms: round(
            median(results.worst.map((run) => run.total_ms)),
          ),
          worst_max_ms: round(
            Math.max(...results.worst.map((run) => run.total_ms)),
          ),
          runs: {
            happy: results.happy.length,
            worst: results.worst.length,
          },
        },
        null,
        2,
      ),
    );
  } catch (error) {
    console.error("Performance harness failed");
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
