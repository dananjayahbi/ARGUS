# ARGUS — QA Bug Tracking & Capture Ecosystem: System Architecture Plan

> **Project codename:** ARGUS · **Project key:** `ARG`
> Named for Argus Panoptes, the hundred-eyed giant of Greek myth: the ecosystem
> that sees and records everything at the moment a defect appears — screen,
> console, network, and environment — before any of it is lost.

---

## 1. Executive Summary & System Goals

**ARGUS** is a streamlined, low-friction quality assurance reporting ecosystem designed for an engineering lead and a dedicated QA engineer. It eliminates repetitive bug-logging overhead by combining:
1. A **Manifest V3 Browser Extension** providing full-page and marquee area screen captures, zero-click system metadata harvesting, and automated console/network error dumps.
2. A **Private Edge CDN** hosted on an on-premise Mini PC VPS exposed via Cloudflare Tunnels for raw images, annotated layers, and unmetered audio notes.
3. A **Next.js Web Application** featuring an unauthenticated, tokenized **Canvas Annotation Editor** for instant bug drafting, alongside an authenticated **Project & Kanban Dashboard** featuring a bidirectional "Reconsider" feedback loop.
4. A **PostgreSQL Relational Database** serving as the centralized operational datastore.

The primary operational objective is reducing the time elapsed between finding a bug and producing an actionable, context-rich ticket to under 30 seconds, while guaranteeing zero public write access to storage and zero dashboard credential barriers during capture.

---

## 2. High-Level System Architecture & Network Topology

### 2.1 Component Interaction Diagram

```
+-----------------------------------------------------------------------------------+
| CLIENT BROWSER RUNTIME                                                            |
|                                                                                   |
|  [Target Webpage Being Tested]                                                    |
|         │                                                                         |
|         ├─ (Injected Content Script: Console/Network Traps & Metadata Scraper)     |
|         │                                                                         |
|  [Chrome Extension Side Panel (Manifest V3)]                                      |
|         │                                                                         |
|         ├─ Area Snipping Tool (Crosshair Marquee)                                 |
|         ├─ Full-Page Stitcher Engine                                              |
|         └─ Text-Only Quick Modal                                                  |
+---------┬───────────────────────────────────────┬────────────────────────────────-+
          │                                       │
          │ 1. Raw Binary Upload                  │ 2. Create Draft Issue
          │    (X-CDN-Auth-Token)                 │    (X-Workspace-Token)
          ▼                                       ▼
+-----------------------------+         +-------------------------------------------+
| MINI PC (Home VPS)          |         | VERCEL / CLOUD INFRASTRUCTURE             |
|                             |         |                                           |
| [Cloudflare Tunnel]         |         | [Next.js Web Application]                 |
|         │                   |         |  ├── Public Route: /canvas/[draftId]      |
|         ▼                   |         |  │     (Ephemeral JWT Validation)         |
| [Python CDN Service]        |         |  └── Protected Route: /dashboard/*        |
|  ├── File System Storage    |         |        (Session / Cookie Auth)            |
|  │    ├── /raw/             |         +---------------------┬---------------------+
|  │    ├── /annotated/       |                               │
|  │    ├── /audio/           |                               │ Read / Write
|  │    └── /reconsider/      |                               ▼
|  └── Token Verification     |         +-------------------------------------------+
+-----------------------------+         | CLOUD DATABASE                            |
                                        |                                           |
                                        | [PostgreSQL Datastore]                    |
                                        |  (Projects, Issues, Reconsider Notes,     |
                                        |   Attachment Registries)                  |
                                        +-------------------------------------------+
```

### 2.2 Security & Authentication Topology
The architecture uses a three-tier security model to decouple reporting velocity from administrative dashboard security:

* **Tier 1: CDN Ingestion Security (`X-CDN-Auth-Token`)**
  * The Python CDN service accepts POST requests only if accompanied by a secure, shared CDN access key.
  * The Cloudflare Tunnel routes traffic directly to the Python daemon. Direct IP access is firewalled.
* **Tier 2: Headless Ingestion Authentication (`X-Workspace-Token`)**
  * The browser extension stores a persistent Workspace Ingestion Secret configured once during installation.
  * When initiating a draft, the extension authenticates against the Next.js API using this header. The server creates a record in `draft` status and returns an ephemeral draft access token (HMAC-SHA256 signed, 30-minute expiration).
* **Tier 3: Web Dashboard Session Authentication**
  * Access to project management, Kanban views, issue deletion, and reconsider workflows requires user authentication (Email/Password or OAuth).
  * The canvas route (`/canvas/[draftId]`) allows single-issue editing only if supplied with the matching, unexpired ephemeral draft token, allowing the QA engineer to annotate and finalize reports without logging into the management dashboard.

---

## 3. Detailed Component Specifications

### 3.1 Browser Extension (Manifest V3)

The extension lives in the browser's persistent side panel (`chrome.sidePanel`), preventing CSS injection conflicts and avoiding site Content Security Policy (CSP) interference.

#### A. Capture Engines
1. **Area Snip Tool**:
   * Injects a lightweight overlay canvas on the active tab with a crosshair cursor.
   * Mouse down, drag, and mouse up captures client coordinates.
   * Coordinates are multiplied by `window.devicePixelRatio` to maintain high-resolution fidelity on Retina and 4K displays.
   * Crops the captured visible tab segment to the exact pixel rectangle.
2. **Full-Page Screenshot Engine**:
   * Calculates total document scroll height and current viewport height.
   * Dynamically injects a CSS class to temporarily hide elements with `position: fixed` and `position: sticky` across intermediate frames to eliminate duplicate header/footer visual artifacts.
   * Iterates through the page vertically via programmatic scrolling, capturing visible frames with `chrome.tabs.captureVisibleTab`.
   * Stitches the intermediate frame buffers into an offscreen canvas.
   * Restores original page scroll position and sticky/fixed styles immediately upon capture completion.
3. **Text-Only Bug Reporting**:
   * Opens an embedded interface directly inside the side panel with fields for title, markdown description, priority rating, and project assignment.
   * Completely bypasses canvas initialization.

#### B. Automated Metadata Scraping (Zero-Click Context)
Every visual or text report automatically captures a snapshot of the runtime environment:
* Current page URL and document title.
* Viewport dimensions (`window.innerWidth` $\times$ `window.innerHeight`).
* Monitor screen resolution (`window.screen.width` $\times$ `window.screen.height`).
* Device Pixel Ratio (DPR).
* Operating System identifier, Browser Name, and Browser Engine Version.
* Timestamp in ISO-8601 UTC.

#### C. Console & Network Error Harvester
* A content script running in an isolated execution world hooks into `window.console.error`, `window.console.warn`, and unhandled promise rejections (`window.addEventListener("unhandledrejection")`).
* Hooks into `window.fetch` and `XMLHttpRequest` prototype open/send methods to monitor outgoing requests.
* Maintains a rolling in-memory buffer of the most recent 50 network calls and console errors, filtering specifically for HTTP statuses $\ge 400$ and runtime JavaScript errors.
* Packages this telemetry into the draft creation payload.

#### D. Preview & Dispatch Modal
* Displays the captured image in a lightweight preview modal inside the extension side panel.
* Primary actions: **"Use this screenshot"** and **"Take another one"**.
* Clicking "Use this screenshot":
  1. Uploads the uncompressed image blob to the Python CDN under the `/raw/` directory.
  2. Submits the CDN URL, project identifier, telemetry metadata, and console logs to the Next.js API.
  3. Receives the `draftId` and `ephemeralToken`.
  4. Automatically opens a new browser tab navigating to the Next.js Canvas Editor: `https://[app-domain]/canvas/[draftId]?token=[ephemeralToken]`.

---

### 3.2 Asset Storage Daemon (Python CDN on Mini PC)

The Python service runs locally on the Mini PC, backed by local SSD storage and exposed globally via an encrypted Cloudflare Tunnel.

#### A. Responsibilities & Operational Boundaries
* Provides stateless binary storage for four asset classes:
  1. Raw unedited screenshots (`/raw/`)
  2. Flattened annotated screenshots (`/annotated/`)
  3. Reconsider attachment files and images (`/reconsider/`)
  4. Voice memo audio recordings (`/audio/`)
* Enforces file size limitations (e.g., maximum 50 MB for images, maximum 200 MB for unmetered audio files).
* Strips executable extensions; limits storage exclusively to valid MIME types: `image/png`, `image/jpeg`, `image/webp`, `audio/webm`, `audio/mp4`, `audio/wav`, `audio/ogg`.
* Serves stored files via secure HTTPS URLs through Cloudflare's edge caching layer.
* Implements directory sharding based on the current year and month (`/YYYY/MM/`) to prevent single-directory inode exhaustion on the host filesystem.

---

### 3.3 Next.js Application: Canvas Annotation & Bug Configurator

The canvas editor is a split-screen workspace located at `/canvas/[draftId]`.

```
+-------------------------------------------------------------+------------------------------------+
| LEFT PANE: INTERACTIVE CANVAS VIEWPORT                     | RIGHT PANE: BUG CONFIGURATION      |
|                                                             |                                    |
| [Tool Ribbon: Select | Pen | Text | Rect | Arrow | Badge | Blur] | [Project Display / Switcher]       |
|                                                             |                                    |
| +---------------------------------------------------------+ | Title: [Input Field              ] |
| |                                                         | |                                    |
| |                                                         | | Priority: (0% - 100% Slider)       |
| |             IMAGE WORKSPACE                             | | [======|=========================] |
| |             (Zoom / Pan / Annotate)                     | | Level: Medium (35%)                |
| |                                                         | |                                    |
| |                                                         | | Description: (Markdown Editor)   |
| |                                                         | | [                                ] |
| |                                                         | | [                                ] |
| |                                                         | |                                    |
| |                                                         | | Voice Note: (No limit)           |
| |                                                         | | [ ● Record ] [ > Play ] [ Trash ]|
| |                                                         | |                                    |
| |                                                         | | System Context & Console Logs    |
| |                                                         | | [ > View 4 Harvested Errors    ] |
| +---------------------------------------------------------+ |                                    |
|                                                             | [ SUBMIT BUG REPORT BUTTON       ] |
+-------------------------------------------------------------+------------------------------------+
```

#### A. Interactive Canvas Engine
* **Coordinate Mapping & Viewport Control**:
  * Mouse wheel scroll provides zoom-to-pointer capability.
  * Spacebar-hold engages panning mode, transforming the cursor to a drag-hand.
* **Annotation Suite**:
  * **Freehand Pen**: Adjustable stroke color, width, and smoothing.
  * **Text Box Tool**: Creates a text element with a high-contrast background fill to ensure text is legible over visually busy interfaces.
  * **Arrow Tool**: Draws direct, high-visibility pointer arrows with bounded tip geometry.
  * **Numbered Badge Stamp**: Click-to-place numbered circular badges (1, 2, 3...) that auto-increment with every stamp placed on the canvas, enabling QA to show sequential steps to reproduce.
  * **PII Redaction Blur Tool**: Drag-to-create marquee that applies a non-reversible pixelation or heavy Gaussian filter to obscure passwords, API tokens, user emails, or sensitive production data.
  * **Direct Clipboard Paste Engine**: Global paste listener (`Ctrl+V` / `Cmd+V`) that accepts image blobs from the OS clipboard, offering options to replace the background image or append as supplementary reference assets.
* **Dual Output Generation on Submission**:
  1. Exports the interactive vector scene graph as structured JSON to enable future re-editing.
  2. Renders the canvas to an uncompressed PNG binary, uploads it to the Python CDN `/annotated/` directory, and binds the generated URL to the issue.

#### B. Right-Side Configuration Panel
* **Title & Description**: Title input with autofocus; description text area supporting markdown formatting.
* **Continuous Priority Slider**: Range from 0% to 100%, dynamically mapped to semantic operational tiers:
  * `0% – 25%`: Low / Cosmetic
  * `26% – 50%`: Medium / Functional Flaw
  * `51% – 75%`: High / Flow Blocked
  * `76% – 100%`: Critical / System Blocker / Data Loss
* **Unmetered Voice Recording Studio**:
  * Utilizes the browser `MediaRecorder` API recording to WebM/Opus or MP4 audio.
  * Operates without artificial time constraints.
  * Includes an interactive waveform/timer, pause, playback preview, and discard/re-record capability.
  * Uploads audio directly to the Python CDN upon report submission.
* **Diagnostics Drawer**: Collapsible preview of auto-harvested system context, screen specs, and captured console/network errors.

---

### 3.4 Next.js Application: Project & Kanban Management Dashboard

The management view (`/dashboard` and `/projects/[projectKey]`) is secured behind standard user authentication.

#### A. Project Navigation & State Persistence
* Global project dropdown in the top navigation bar.
* Active project selection is automatically persisted in the browser's `localStorage`.
* When returning to `/dashboard`, the application automatically reads the local storage key and redirects directly to the most recently viewed project board.

#### B. Kanban Board Column Structure
The board contains five sequential status columns:
1. **Draft**: Issues initiated via extension or API that are currently incomplete or undergoing active canvas annotation.
2. **Pending**: Complete issues formally submitted by the QA engineer, awaiting engineering review.
3. **Working**: Issues currently being diagnosed, patched, or actively addressed by the developer.
4. **Reconsider**: Issues requiring clarification, reproduction assistance, or dispute resolution.
5. **Completed**: Resolved issues verified and closed.

#### C. The "Reconsider" Bidirectional Loop
Moving an issue into the **Reconsider** column triggers a mandatory modal prompt:
* **Developer Note**: Markdown-supported field explaining why the issue is blocked, unreproducible, or contested.
* **Attachment Uploader**: Capability to paste or attach screenshots, log files, or terminal traces to substantiate the reconsideration request.
* **Status Updates**:
  * The issue card displays a high-visibility badge denoting pending action needed from QA.
  * When the QA engineer responds with clarifications or supplementary recordings, the card transitions back to **Working** or **Pending**, maintaining a chronological audit trail of all notes and attachments.

---

## 4. Relational Database Schema & Data Dictionary

The operational datastore is PostgreSQL. All tables are structured using strong typing, relational foreign key constraints, and performance indexes.

### 4.1 Schema Definitions

#### Table: `projects`
Stores high-level workspace project entities.
| Column | Data Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `id` | UUID | PRIMARY KEY, DEFAULT gen_random_uuid() | Unique project identifier |
| `name` | VARCHAR(100) | NOT NULL | Human-readable project name |
| `key` | VARCHAR(10) | NOT NULL, UNIQUE | Monospace ticker prefix (e.g., `APP`, `CORE`) |
| `description` | TEXT | NULLABLE | Detailed project scope or description |
| `created_at` | TIMESTAMPTZ | NOT NULL, DEFAULT CURRENT_TIMESTAMP | Record creation timestamp |
| `updated_at` | TIMESTAMPTZ | NOT NULL, DEFAULT CURRENT_TIMESTAMP | Last record update timestamp |

#### Table: `issues`
Core entity tracking every bug, task, or UI inconsistency logged.
| Column | Data Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `id` | UUID | PRIMARY KEY, DEFAULT gen_random_uuid() | Unique issue identifier |
| `project_id` | UUID | NOT NULL, REFERENCES `projects(id)` ON DELETE CASCADE | Associated project |
| `issue_number` | BIGSERIAL | NOT NULL | Project-scoped sequential issue number |
| `title` | VARCHAR(255) | NOT NULL | Concise headline of the reported bug |
| `description` | TEXT | NULLABLE | Full markdown bug report text |
| `priority` | SMALLINT | NOT NULL, CHECK (priority BETWEEN 0 AND 100) | Numerical priority percentage |
| `status` | VARCHAR(20) | NOT NULL, DEFAULT 'draft' | Enum: `draft`, `pending`, `working`, `reconsider`, `completed` |
| `report_type` | VARCHAR(20) | NOT NULL, DEFAULT 'screenshot' | Enum: `screenshot`, `full_page`, `text_only` |
| `raw_image_url` | TEXT | NULLABLE | CDN link to unedited original capture |
| `annotated_image_url`| TEXT | NULLABLE | CDN link to flattened visual annotation |
| `canvas_state` | JSONB | NULLABLE | Full vector object graph for canvas rehydration |
| `audio_note_url` | TEXT | NULLABLE | CDN link to unmetered voice recording |
| `environment_info` | JSONB | NULLABLE | Captured URL, OS, DPR, screen & viewport dimensions |
| `console_logs` | JSONB | NULLABLE | Serialized array of runtime errors & network failures |
| `ephemeral_token` | VARCHAR(255) | NULLABLE | Token validating direct access to `/canvas/[id]` |
| `token_expires_at` | TIMESTAMPTZ | NULLABLE | Expiration deadline for draft canvas access |
| `created_at` | TIMESTAMPTZ | NOT NULL, DEFAULT CURRENT_TIMESTAMP | Record creation timestamp |
| `updated_at` | TIMESTAMPTZ | NOT NULL, DEFAULT CURRENT_TIMESTAMP | Last record update timestamp |

#### Table: `issue_reconsider_notes`
Maintains conversational feedback and review history when cards are placed in Reconsider status.
| Column | Data Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `id` | UUID | PRIMARY KEY, DEFAULT gen_random_uuid() | Unique note identifier |
| `issue_id` | UUID | NOT NULL, REFERENCES `issues(id)` ON DELETE CASCADE | Target issue identifier |
| `author_role` | VARCHAR(20) | NOT NULL | Enum: `developer`, `qa` |
| `note` | TEXT | NOT NULL | Markdown text explanation of clarification/issue |
| `attachment_urls` | TEXT[] | NULLABLE | Array of CDN links to supporting files/screenshots |
| `created_at` | TIMESTAMPTZ | NOT NULL, DEFAULT CURRENT_TIMESTAMP | Record creation timestamp |

#### Table: `issue_supplementary_assets`
Stores secondary images attached via direct clipboard paste (`Ctrl+V`) during review.
| Column | Data Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `id` | UUID | PRIMARY KEY, DEFAULT gen_random_uuid() | Unique asset identifier |
| `issue_id` | UUID | NOT NULL, REFERENCES `issues(id)` ON DELETE CASCADE | Target issue identifier |
| `asset_url` | TEXT | NOT NULL | CDN storage link |
| `asset_type` | VARCHAR(50) | NOT NULL | MIME classification (e.g., `image/png`) |
| `created_at` | TIMESTAMPTZ | NOT NULL, DEFAULT CURRENT_TIMESTAMP | Record creation timestamp |

### 4.2 Database Indexes
* `CREATE UNIQUE INDEX idx_project_issue_number ON issues(project_id, issue_number);`
* `CREATE INDEX idx_issues_status ON issues(status);`
* `CREATE INDEX idx_issues_project_status ON issues(project_id, status);`
* `CREATE INDEX idx_reconsider_issue ON issue_reconsider_notes(issue_id);`

---

## 5. API Contracts & Service Interfaces

### 5.1 Python CDN Service API

#### Endpoint: `POST /api/upload`
Uploads a binary asset to the Mini PC filesystem.
* **Authentication**: Header `X-CDN-Auth-Token: [STATIC_CDN_SECRET]`
* **Content-Type**: `multipart/form-data`
* **Form Parameters**:
  * `file`: Binary file stream
  * `category`: String (`raw`, `annotated`, `reconsider`, `audio`)
* **Response Contract (201 Created)**:
  * `success`: Boolean (`true`)
  * `url`: String (Full CDN URL: `https://cdn.[domain]/[category]/[YYYY]/[MM]/[uuid]_[filename]`)
  * `file_size_bytes`: Integer
* **Response Contract (401 Unauthorized)**:
  * `detail`: String (`Invalid or missing storage authorization credentials.`)

---

### 5.2 Next.js Internal & Ingestion API

#### Endpoint: `POST /api/ingest/draft`
Called by the browser extension to create an issue in `draft` status.
* **Authentication**: Header `X-Workspace-Token: [STATIC_WORKSPACE_SECRET]`
* **Request Payload**:
  * `project_id`: UUID
  * `report_type`: String (`screenshot`, `full_page`, `text_only`)
  * `raw_image_url`: String (URL returned from CDN, nullable for text-only)
  * `environment_info`: Object
    * `url`: String
    * `title`: String
    * `viewport`: Object (`width`: Integer, `height`: Integer)
    * `screen`: Object (`width`: Integer, `height`: Integer)
    * `device_pixel_ratio`: Number
    * `user_agent`: String
    * `os`: String
  * `console_logs`: Array of Objects
    * `type`: String (`error`, `warn`, `network_failure`)
    * `message`: String
    * `stack_or_detail`: String (Nullable)
    * `timestamp`: String (ISO-8601)
* **Response Contract (201 Created)**:
  * `issue_id`: UUID
  * `draft_token`: String (Signed Ephemeral JWT, 30-minute validity)
  * `editor_url`: String (Full URL for tab creation: `https://[app-domain]/canvas/[issue_id]?token=[draft_token]`)

#### Endpoint: `PUT /api/issues/[id]/finalize`
Submits the finalized report from the canvas editor.
* **Authentication**: Query Param or Bearer Header `token: [DRAFT_TOKEN]` OR Active Dashboard User Session.
* **Request Payload**:
  * `title`: String
  * `description`: String (Markdown)
  * `priority`: Integer (0–100)
  * `annotated_image_url`: String (Nullable)
  * `canvas_state`: Object (Fabric.js / Konva JSON representation, nullable)
  * `audio_note_url`: String (Nullable)
* **Response Contract (200 OK)**:
  * `success`: Boolean (`true`)
  * `status`: String (`pending`)
  * `redirect_url`: String (`/projects/[project_key]`)

#### Endpoint: `POST /api/issues/[id]/reconsider`
Transitions an issue to `reconsider` status with developer notes, or submits QA's rebuttal.
* **Authentication**: Active Dashboard User Session.
* **Request Payload**:
  * `author_role`: String (`developer` or `qa`)
  * `note`: String (Markdown)
  * `attachment_urls`: Array of Strings (Optional)
* **Response Contract (201 Created)**:
  * `note_id`: UUID
  * `current_status`: String (`reconsider` if sent by developer; `working` or `pending` if responded by QA)

---

## 6. End-to-End Operational Workflows

### 6.1 Workflow A: Screen Capture to Submitted Issue
```
[QA Engineer on Client Webpage]
       │
       ▼
1. Clicks Extension Icon -> Opens Chrome Side Panel.
2. Selects "Normal Screenshot" (Marquee Snip) or "Full Page Screenshot".
       │
       ├─ If Normal Screenshot: Overlays crosshair -> Drags area -> Crops visible tab.
       └─ If Full Page: Cycles scroll -> Hides sticky CSS -> Captures frames -> Stitches.
       │
3. Extension automatically captures:
       ├─ Current URL, Screen Resolution, Viewport Dimensions, OS, User Agent.
       └─ Console errors & failed network calls from buffer.
       │
4. Shows Preview Modal: "Use this screenshot" or "Take another one".
       │
       ▼ (Clicks "Use this screenshot")
5. Extension POSTs raw binary to Python CDN (/api/upload).
       │ Returns raw CDN URL.
       ▼
6. Extension POSTs metadata + raw URL to Next.js API (/api/ingest/draft).
       │ Returns issue ID + short-lived Ephemeral Token.
       ▼
7. Extension opens new browser tab: https://[app-domain]/canvas/[id]?token=[token].
       │
       ▼
8. QA Annotates on Canvas:
       ├─ Spacebar + Drag to pan; Mouse wheel to zoom.
       ├─ Adds Number Badges (1, 2, 3), Arrows, Pen strokes, or Text Boxes.
       ├─ Drags Blur Tool over PII (passwords, sensitive data).
       ├─ Pastes supplementary image from clipboard (optional).
       ├─ Adjusts Priority Slider (0% - 100%).
       ├─ Records continuous voice note via microphone (optional).
       └─ Fills in Title & Markdown Description.
       │
       ▼
9. QA clicks "Submit Bug Report":
       ├─ Client-side flattens canvas to PNG and uploads to Python CDN (/annotated/).
       ├─ Client-side uploads recorded audio blob to Python CDN (/audio/).
       └─ Next.js PUTs final data to database -> Marks status as "pending".
       │
       ▼
10. UI displays success state with a direct deep-link to the issue on the Kanban board.
```

### 6.2 Workflow B: Reconsideration Loop
```
[Developer on Kanban Dashboard]
       │
       ▼
1. Developer inspects card in "Pending" or "Working" status.
2. Cannot reproduce the bug or requires additional API logs.
3. Drags card from "Working" to "Reconsider" column.
       │
       ▼
4. Application opens modal requiring an explanatory note.
5. Developer types explanation and optionally attaches a diagnostic image.
6. Card transitions to "Reconsider" status.
       │
       ▼
[QA Engineer's View]
7. QA opens Kanban board -> Observes card flagged in the "Reconsider" column.
8. Clicks card -> Reviews developer's notes, original annotations, and audio note.
9. Appends clarification reply and/or new reproduction screenshots.
10. Clicks "Resubmit to Developer" -> Card moves back to "Working".
```

---

## 7. Implementation Roadmap & Guardrails for AI Agents

AI agents building **ARGUS** (project key `ARG`) must execute development strictly according to the following phased roadmap. Use the codename in commit prefixes, issue titles, package names, and the default seed `projects` row (`name = 'ARGUS'`, `key = 'ARG'`).

### Phase 1: Python CDN Daemon (Mini PC VPS)
* **Objective**: Create the headless file ingestion service.
* **Prerequisites**: Ensure destination directory tree exists (`storage/raw`, `storage/annotated`, `storage/audio`, `storage/reconsider`).
* **Validation Criteria**: Must verify valid `X-CDN-Auth-Token` header, validate MIME types, save files to date-sharded paths, and return absolute CDN URLs.

### Phase 2: PostgreSQL Database Provisioning
* **Objective**: Initialize relational structure against the target database connection.
* **Execution**: Create tables (`projects`, `issues`, `issue_reconsider_notes`, `issue_supplementary_assets`), define foreign key constraints, establish status enums, and build performance indexes.

### Phase 3: Next.js Foundation & Ingestion Engine
* **Objective**: Build the Next.js API routes and session/token validation layer.
* **Execution**:
  * Configure database client connectivity.
  * Implement `POST /api/ingest/draft` using static workspace token authentication.
  * Generate and verify signed ephemeral JWT draft tokens.
  * Implement `PUT /api/issues/[id]/finalize` to transition issues from draft to pending.

### Phase 4: Canvas Annotation & Configurator UI
* **Objective**: Implement `/canvas/[draftId]` using the ephemeral token.
* **Execution**:
  * Build canvas view using interactive 2D canvas libraries (e.g., Fabric.js or React-Konva).
  * Implement Pan (Spacebar + Drag), Zoom (Wheel to cursor), Freehand Pen, Text Boxes with solid backgrounds, Arrows, Auto-incrementing Number Badges, and Marquee Blur/Pixelate filter.
  * Implement clipboard paste listener (`window.addEventListener('paste')`) to accept external screenshots.
  * Implement microphone recorder interface using `MediaRecorder` API with no duration limitations.
  * Implement continuous priority slider with dynamic visual level markers.

### Phase 5: Browser Extension (Manifest V3)
* **Objective**: Build the Chrome Extension side panel and capture engines.
* **Execution**:
  * Configure `manifest.json` with permissions: `sidePanel`, `activeTab`, `scripting`, `storage`.
  * Build Area Snip engine with high-DPI scaling (`window.devicePixelRatio`).
  * Build Full-Page Stitcher with dynamic sticky/fixed element suppression.
  * Build content script for metadata extraction and rolling error/network interceptors.
  * Build Side Panel UI with preview confirmation modal.

### Phase 6: Kanban Dashboard & Project Management
* **Objective**: Build the protected dashboard at `/dashboard` and `/projects/[key]`.
* **Execution**:
  * Build project selector with automatic `localStorage` synchronization.
  * Build Kanban board with five columns: `Draft`, `Pending`, `Working`, `Reconsider`, `Completed`.
  * Implement drag-and-drop column transitions.
  * Implement the Reconsideration Modal capturing notes and file attachments.
  * Implement comprehensive issue detail modal displaying raw vs. annotated image comparison toggles, interactive vector canvas view, audio player, environment metadata, and formatted console log dumps.