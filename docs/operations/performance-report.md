# Capture-to-ticket performance report

- **Generated:** 2026-11-06T18:17:27.849Z
- **Target:** 30 seconds from capture to a pending issue on the board
- **Harness:** `apps/web/scripts/perf-capture-to-ticket.mjs`

## Environment

| Item | Value |
| --- | --- |
| Host OS | win32 10.0.26120 |
| CPU | Intel(R) Core(TM) i7-10870H CPU @ 2.20GHz |
| RAM | 32 GB |
| Node | v24.11.1 |
| Network | Loopback (127.0.0.1). Production adds Cloudflare Tunnel latency, so treat these as a lower bound. |
| Database | PostgreSQL 12 |
| Runs | 5 representative + 3 worst-case |

## Representative payloads

| Scenario | Image | Audio | Runs |
| --- | --- | --- | --- |
| Representative | 1440x900 (25664 B) | 15s WAV (661544 B) | 5 |
| Worst case | 1440x4000 (113753 B) | 180s WAV (7938044 B) | 3 |

## Stage timings (milliseconds)

| Stage | Budget | Representative median | Worst-case median | Worst-case max | Status |
| --- | ---: | ---: | ---: | ---: | --- |
| capture | 1500 | 72.4 | 266.2 | 361.8 | ok |
| cdn_upload | 5000 | 5.9 | 4.9 | 5.7 | ok |
| draft_create | 2000 | 647.1 | 643.6 | 659.9 | ok |
| annotation | 1500 | 122.5 | 269.9 | 497.7 | ok |
| annotated_upload | 5000 | 14.3 | 8.3 | 13.2 | ok |
| audio_upload | 8000 | 17.2 | 93.2 | 129.9 | ok |
| finalize | 2000 | 711.7 | 718.1 | 785.1 | ok |
| board_visibility | 3000 | 975.4 | 942.6 | 1166.6 | ok |

## Totals

| Scenario | Median | Max | Budget | Result |
| --- | ---: | ---: | ---: | --- |
| Representative | 2567.4 | 4165.7 | 30000 | PASS |
| Worst case | 3025.8 | 3312.6 | 30000 | PASS |

## Recommendations

No stage exceeded its budget. Keep the harness in the release gate and re-run on the Mini PC before rollout.

## Notes

- The capture stage measures PNG generation/encoding on the harness host. The
  real extension adds `captureVisibleTab` and browser paint time, which should
  be spot-checked in the manual extension checklist.
- The annotation stage measures export preparation, not human drawing time.
- Audio uploads use the canvas proxy path and a multi-minute WAV payload for
  the worst case.
