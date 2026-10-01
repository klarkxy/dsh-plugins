# Official Team enhancement implementation contract

Accepted 2026-09-25. This is an implementation specification, not acceptance evidence.

Outcome: users recognize every running teammate, its actual model and task directly in the official Team experience, and manage reusable roles through a dedicated conversation preset, while ordinary leads continue to execute work.

## Fixed boundaries

- DSH Web 0.1.7-rc.2, Node 24. Reuse the official Team roster, task board, mailbox, status and navigation. Do not add a new coordinator or lifecycle store.
- The same `conversation.session.header.actions` slot and `agent-team` entry id, at priority -10 (the native entry defaults to 0). Official shadowing preserves fallback and disposal. Do not disable the native UI, edit node_modules, scrape the DOM, or register a second Teams panel.
- Display the frozen Classmates role name plus a stable member name, so same-role instances stay distinguishable. Native members and the Lead remain visible.
- Display the latest recorded request model/effort from official data as last used, and a configured binding only as configured before any request. Missing metadata is unknown and is never guessed from the Lead. Idle is not task completion.
- Preserve official task CAS semantics, ownership, blockers, write-scope warnings, history navigation, accessibility and responsive theme.
- Manager preset id `classmates-manager`, user label `角色配置助手`. It uses the host-selected/default model. No credentials and no separate model settings. Role-management tools are exclusive to this preset; the ordinary Lead and teammates cannot use them. Do not let the manager spawn a team while editing settings.
- `RoleConfig` remains the role source. A whole batch is validated before one settings CAS mutation. Reject duplicate targeted ids, stale role/settings revisions and invalid model/effort; there is no partial save. Reuse the existing single-role form as advanced editing. Existing bindings survive role edits and deletion.
- Explicit reversible edits need no extra approval ritual. Broad, ambiguous setup may show a proposed group for adoption. Respect the configured model directory; do not invent prices, capabilities or quality rankings.

## Shared contracts and ownership

Canonical types live in src/contracts.ts and are owned by primary. `RoleChange`, `TeamIdentity`, `TeamDetails` and `MANAGER_PRESET_ID` are added there.

Cursor owns src/config.ts, src/controller.ts, src/rpc.ts, the new src/manager.ts and src/team-info.ts, plus the corresponding new and updated tests, except for shared runtime helpers. Controller keeps `(ctx, roles)` compatibility and accepts an optional third BindingStore. Public methods: load/save/remove remain; `batch(changes: RoleChange[], expected: number): Promise<ClassmatesState>` and `team(leadId: string): Promise<TeamDetails>` are added. The RPC namespace classmates exposes batch/team (remove remains wire deleteRole). Team read is profile-local and read-only: derive authoritative members from official logs/projection, join bindings by exact child id, and read the last request from official data without waking agents. Return only display metadata, never full prompts, logs or credentials. Isolate per-member read failures; no fake label.

Manager exports the Cordis plugin name/inject/apply for the package subpath `@klarkxy/dsh-classmates/manager`. Mount it only inside the official preset. Register schema-validated read and batch-edit tools plus clear role-configuration instructions. Check that the caller belongs to exactly that preset and is not a subagent. Use the existing classmatesController methods; no filesystem or shell editing of the profile. Primary declares the bundle preset, package exports and host integration.

Kimi owns src/client.tsx and src/ui/**. Read-only official UI sources under node_modules may guide a locally adapted component; retain MIT notices. On the client, `classmates.team(leadId)` returns TeamDetails, and the optional `ClassmatesClient.team` and `openManager` additions preserve the old tests. Prefer official observed projection updates; refresh metadata on panel open and roster change, and use a bounded refresh while the panel is visible if needed. Prevent stale session responses, and stop on close or unmount. Primary owns any package dependencies and build adaptations. Native slots can shadow by the same id with a lower priority. Use the actual slot props types and native stores/navigation rather than invented props. Empty settings should lead with the conversational assistant, while retaining the role list and the advanced edit form.

Primary owns all other paths, manifests, contracts, integration and acceptance. There is currently no .git repository, so a scoped file-hash baseline is preserved for review instead. No publication, global changes, credential reads or outbound messages.

## Acceptance

Runtime: batch all-or-nothing, conflicts, invalid model, manager-only tools, no manager team spawn, zero-role manager boot, cold metadata, old binding after deletion, and actual versus configured route.
Browser: one Team entry, readable role/model/task, Lead and native members, same-role duplicates, current-chat identity, keyboard Escape/focus, narrow layout and dark theme, manager entry and new conversation, advanced editing, and unload restoring the native registration. Package: clean profile installation with original roles preserved. Mock or local evidence must be stated separately from live model evidence.
