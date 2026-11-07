# ARGUS — Your First Use

You don't need to run anything. I have already set up and started ARGUS locally
for you. Your only job is to open a browser and explore.

## What's already running for you

- **The web app** (dashboard, canvas editor, APIs) is live at
  **http://localhost:13130**
- **The CDN storage service** (stores screenshots and audio) is live
  standalone at **http://127.0.0.1:18130**
- Both use our **high, uncommon local ports** (`13130` and `18130`) so they
  never clash with the usual `3000` / `8080` dev servers. Both are
  loopback-only, so only your own laptop can reach them.
- The database is connected and verified, and the two services are
  communicating: the web app knows where the CDN is, and both share the same
  upload secret, so uploads flow correctly.
- I already proved the whole pipeline works end to end and left you a
  **welcome issue on the board** so you don't start from a blank page.

If the services ever stop, just tell me to restart them — you don't need to
deal with terminals.

## Where to go

Open your browser and go to **http://localhost:13130/login**, then sign in.

You have two accounts:

- **QA account** — email qa@argus.local, password qa-dev-password
- **Developer account** — email dev@argus.local, password dev-dev-password

You will land on the dashboard. The project switcher at the top should already
show **ARGUS (ARG)**. If it doesn't, pick it from the dropdown.

## What you'll see

### The Kanban board

Five columns: **Draft**, **Pending**, **Working**, **Reconsider**,
**Completed** — plus **+ New Issue** (top-right) and project actions
(**Edit project** / **Delete project**) next to it. The header also has
**+ New Project** so you can create another project without leaving the
page.

There is already a card in **Pending** called **"Welcome — your first ARGUS
issue"**. That card is your guided-tour playground. It contains a screenshot,
a vector annotation, and a description explaining what to try next.

### The Details view

Click **Details** on any card and you'll see:

- The **screenshot** with a **Raw / Annotated** toggle; click the image to
  open a full-viewport preview where the mouse wheel zooms, holding **Space**
  and dragging pans, and **Esc** closes it
- **Diagnostics** — the viewport size, environment details, and any console or
  network errors that were captured at the time
- **Supplementary images** — every additional attachment, each clickable for
  the same full-viewport preview
- The **voice note player**, when one was recorded
- **Captured pages** at the bottom — every URL the captures came from
- The **Reconsider audit trail** — every developer and QA note, in order

## Your first-use tour (all in the browser)

### 1. Explore the welcome card

Click **Details** on the welcome card. Toggle between **Raw** and
**Annotated** to see the difference. Scroll down to see the diagnostics and
the empty audit trail (no notes yet — you'll add them in step 4).

### 2. Create, edit and delete records

- Click **+ New Issue**, fill in a title and description, pick a priority
  and status, and submit. The card appears on the board immediately.
- **Attach images on create/edit** — the form has a drag-and-drop zone that
  also accepts choosing files from your PC (PNG, JPG or WebP up to 50 MB)
  and pasting a screenshot with Ctrl+V. The first image becomes the issue
  screenshot; extra images are stored as attachments via the CDN daemon.
- Open any card's **Details**, then use **Edit** to change its title,
  description, priority, status or screenshot, or **Delete** to permanently remove it
  (the delete button asks for confirmation first).
- Cards themselves also have **Edit** and **Delete** buttons, so you don't
  need to open Details to act. If an issue has attached images, the card
  shows up to five thumbnail icons (click one to open the issue); additional
  images collapse into a **MORE +N** badge.
- Use **+ New Project** in the header to create a project, and
  **Edit project** / **Delete project** on the board to rename or remove
  the current one. Deleting a project deletes its issues too, so the
  delete button asks for confirmation.

### 3. Move a card around

Drag the welcome card from **Pending** to **Working**, then to
**Completed**, then back. The board remembers. Try dragging straight to
**Reconsider** — you'll notice it refuses. That transition is deliberately
blocked there; it must go through the Reconsider flow with a note (step 4).

### 4. Try the Reconsider loop (the core QA workflow)

- Stay on the welcome card, now in **Working**.
- Open the **Reconsider** action and write a developer note, for example:
  "Cannot reproduce on the staging build — see the attached capture." You can
  attach a file. The note is **mandatory** — an empty note is refused.
- The card moves to **Reconsider** and shows a **"Needs QA"** flag.
- Sign out, sign back in as the QA account, open the card, and reply with a
  QA note, for example: "Added staging logs and repro steps."
- The card returns to **Working**, and the Details view now shows both notes
  as a chronological audit trail: developer first, then QA.

That full loop — developer note and attachment, flagged card, QA reply — is
the main collaborative workflow this system exists for.

### 5. Make your own canvas annotation

The other entry point is the canvas editor. When a capture is made (by the
extension, or by the programmatic ingest I used for your welcome card), you get
a tokenized link like the canvas URL for the welcome issue. Opening it shows an
**Attached images** panel on the left with every screenshot on the issue —
click one to make it the image you are annotating. The toolbar above the canvas
uses icons for select, pen, text, rectangle, arrow, numbered badge and
redaction. Draw at least one annotation, then submit. The issue becomes
**Pending** with both the annotated image and the vector scene stored.

### 6. (Optional) The Chrome extension

The extension adds a floating **A** button to every web page. Click it (or the
toolbar icon) to open the capture popup: **Area snip**, **Full page**,
**Text-only report** and **Harvest now** all work from that popup. Screenshots
go into this same pipeline: take a capture, choose **Add to issue**, repeat for
as many screenshots as you need, then choose **Use N screenshots** to upload
them all into one draft and open the canvas editor.

Load it from `apps\extension\dist` (run `npm run build` in
`apps\extension` first). Set its App URL to **http://localhost:13130** and its
CDN URL to **http://127.0.0.1:18130** — click **⚙ Settings** inside the
floating popup to open the form. If you can't remember the tokens or
project ID after a reinstall, open the **⚙ Configurations** button in the
dashboard header — it shows every extension setting for the active project
with a **Copy** button beside each value. Paste those into the extension
Settings and save.

## How the pieces talk (plain English)

- The **web app** at the 13130 address is the front door: login, dashboard,
  canvas, and the API endpoints.
- The **CDN** at the 18130 address is a standalone storage service. It holds
  every raw screenshot, annotated image, reconsider attachment, and audio
  note on disk and serves them back read-only. It works on its own — if the
  web app stops, already-stored files are still served.
- The web app forwards uploads to the CDN on your behalf using a shared
  secret you never need to handle directly. The browser never sees that
  secret; the canvas uploads go through the web app's proxy, while the
  extension can upload directly to the CDN.
- New captures start as **drafts**. Drafts are protected by a 30-minute
  tokenized link, so anyone holding the link can annotate, but they can't
  touch other issues or the dashboard without a login.

## If something looks wrong

- **Login loops back to the login page** — the password doesn't match the
  seeded account, or the session expired. Use the exact accounts listed
  above.
- **A canvas link says the draft expired** — those links live for 30 minutes.
  Re-capture to get a fresh one.
- **Reconsider is refused** — a note is required. The button won't let you
  submit an empty note, and the direct column-drag to Reconsider is blocked
  on purpose.
- **The board looks empty or the project is missing** — you're probably
  viewing a different project in the switcher. Switch to **ARGUS (ARG)**.
- **Nothing loads at the 13130 address** — a service has stopped. Tell me
  and I'll restart both services; you don't need to fix it yourself.

## What I verified for you

- The database schema is present and verified.
- Both services are listening on their high ports, loopback-only.
- The web health check reports the database reachable.
- The CDN health check reports all four storage categories ready.
- A real image was uploaded to the standalone CDN, turned into a draft via
  the ingestion API, annotated, finalized to Pending, and confirmed visible
  on the board — so the web app and CDN are genuinely communicating.

## Reference material (only if you want it)

- The detailed local operations guide lives in
  docs/operations/local-testing.md.
- The production runbook (Mini PC, Cloudflare Tunnel, Vercel) lives in
  docs/operations/runbook.md.
- The architecture source of truth is system_architecture_plan.md.

For your first session, ignore those. Just open
**http://localhost:13130/login**, sign in as QA, and click **Details** on
the welcome card.
