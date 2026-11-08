# Output notes and initial session context

Select sentences or paragraphs inside one assistant response and choose **保存为笔记**.
The floating action captures the selection before focus changes. Paragraphs,
lists and table cells retain readable boundaries, and mathematical notation uses
its TeX source through the same serializer as the chat clipboard.
Selection is available in ordinary chat, native fullscreen/page reading mode and
BTW side conversations. The toolbar and note dialog mount inside the active
reading surface so browser fullscreen and keyboard focus retain access to them.
BTW excerpts retain `sourceKind: "btw"`, their conversation id and parent session;
the source label includes **BTW**. Saved excerpts survive closing the side window.
Opening the library detaches the BTW viewer and preserves its reply, draft and
resume identity. Returning to the workspace reattaches to that same conversation.
Explicitly closing or replacing the BTW window finishes its native runtime.

**已保存 · 查看笔记** opens the saved note over the source transcript. The sidebar's
**笔记** entry opens the cross-session library at `/notes`. Notes can be searched,
edited and deleted. Each retains the immutable original excerpt, source session,
message/anchor identifier, model when reported, source title and creation time.
Selected text comes from rendered output, including streamed output; provenance
records where the user selected it rather than asserting a native-transcript hash.

**用此笔记开启新会话** creates an ordinary session using the source harness/model
by default. The optional settings allow a different harness, catalog model,
reasoning effort and workspace. Current note edits are saved first. Creation
freezes the note content and opens the recipient with an **初始笔记** panel.
The first user message includes the frozen note as attributed reference material.
Saving notes and creating these sessions perform no model calls.

## Persistence and delivery

`output_notes` stores user-owned notes and immutable excerpt metadata.
`note_session_contexts` stores the independently frozen initial context. Later
edits, note deletion or source-session deletion preserve that context. Deleting
the recipient session removes its initial-context record.

Creation uses per-user request ids for HTTP retries. Note edits carry a revision
to detect concurrent edits from another device. Session creation and its frozen
note attachment are committed in one SQLite transaction.

The shared provider runtime claims pending note context alongside ordinary context
attachments in one transaction. All four harnesses receive the same reference
block followed by the current user message. Normal completion marks it delivered;
errors or interrupted submission leave an observable `uncertain` status. A later
turn uses its existing conversation context; the seed is consumed once. Context
preparation bookkeeping leaves seeds pending for the next ordinary turn.

## API and ownership

All endpoints require the normal Orbit user authentication:

- `GET /api/notes?q=...&offset=...`: search/paginate the owner's library.
- `POST /api/notes`: save a rendered selection with source ids and a request id.
- `GET/PATCH/DELETE /api/notes/:id`: read, revise or delete an owned note.
- `POST /api/notes/:id/sessions`: create an ordinary session with frozen context.
- `GET /api/notes/session-context/:sessionId`: read the owner's initial note snapshot.

The Notes module owns routes, selection persistence and session creation. The
database module owns revision checks, atomic creation and consumption. The
Providers runtime consumes the frozen snapshot through its existing context-input
boundary, with a distinct internal note identifier so receipts settle in the
correct repository.
