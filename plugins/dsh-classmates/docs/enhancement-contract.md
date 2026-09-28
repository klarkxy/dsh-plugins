# Official Team enhancement implementation contract

Accepted 2026-09-25. This is an implementation specification, not acceptance evidence.

Outcome: users recognize each running teammate, its actual model and task directly in the official Team experience, and manage reusable roles through a dedicated conversation preset. Ordinary leads continue to execute work.

## Fixed boundaries

- DSH Web 0.1.7-rc.2, Node 24. Reuse official Team roster, task board, mailbox, status and navigation. No new coordinator or lifecycle store.
- Same `conversation.session.header.actions` slot and `agent-team` entry id, priority -10 (native defaults to 0). Official shadowing preserves fallback and disposal. Do not disable native UI, edit node_modules, scrape DOM, or register a second Teams panel.
- Display frozen Classmates role name plus stable member name; same-role instances remain distinguishable. Native members and Lead remain visible.
- Display latest recorded request model/effort from official data as last used, configured binding only as configured before any request. Missing metadata is unknown, never guessed from Lead. Idle is not task completion.
- Preserve official task CAS semantics, ownership, blockers, write-scope warnings, history navigation, accessibility and responsive theme.
- Manager preset id `classmates-manager`, user label `角色配置助手`. Uses host-selected/default model. No credentials or separate model settings. Role-management tools are exclusive to this preset; ordinary Lead and teammates cannot use them. Do not let manager spawn a team while editing settings.
- `RoleConfig` remains the role source. Whole batch validates before one settings CAS mutation. Reject duplicate targeted ids, stale role/settings revisions and invalid model/effort; no partial save. Reuse the existing single-role form as advanced editing. Existing bindings survive role edits/deletion.
- Explicit reversible edits need no extra approval ritual. Broad ambiguous setup can show a proposed group for adoption. Respect configured model directory; do not invent prices, capabilities or quality rankings.

## Shared contracts and ownership

Canonical types in src/contracts.ts are owned by primary. `RoleChange`, `TeamIdentity`, `TeamDetails`, `MANAGER_PRESET_ID` are added there.

Cursor owns src/config.ts, src/controller.ts, src/rpc.ts, new src/manager.ts and src/team-info.ts, and corresponding new/updated tests except shared runtime helpers. Controller keeps `(ctx, roles)` compatibility and accepts optional third BindingStore. Public methods: load/save/remove remain; `batch(changes: RoleChange[], expected: number): Promise<ClassmatesState>` and `team(leadId: string): Promise<TeamDetails>`. RPC namespace classmates exposes batch/team (remove remains wire deleteRole). Team read is profile-local read-only, derive authoritative members from official logs/projection, join bindings by exact child id, read last request from official data without waking agents. Return only display metadata, not full prompts/logs/credentials. Isolate per-member read failures; no fake label.

Manager exports Cordis plugin name/inject/apply for package subpath `@klarkxy/dsh-classmates/manager`. Mount it only inside official preset. Register schema-validated read and batch-edit tools and clear role-configuration instructions. Check caller belongs to exact preset and is not a subagent. Use existing classmatesController methods; no filesystem/shell editing of profile. Primary declares bundle preset, package exports and host integration.

Kimi owns src/client.tsx and src/ui/**. Read-only official UI sources under node_modules may guide a locally adapted component, retain MIT notices. Client `classmates.team(leadId)` returns TeamDetails; `ClassmatesClient.team` and `openManager` optional additions preserve old tests. Prefer official observed projection updates, refresh metadata on panel open/roster change and bounded refresh while panel visible if needed; prevent stale session responses and stop on close/unmount. Primary owns any package dependencies/build adaptations. Native slots can shadow by same id with lower priority. Use actual slot props types and native stores/navigation rather than invented props. Empty settings should lead with conversational assistant, retain role list and advanced edit form.

Primary owns all other paths, manifests, contracts, integration and acceptance. There is currently no .git repository; preserve a scoped file-hash baseline for review instead. No publication, global changes, credential reads or outbound messages.

## Acceptance

Runtime: batch all-or-nothing, conflicts, invalid model, manager-only tools, no manager team spawn, zero-role manager boot, cold metadata, old binding after deletion, actual vs configured route.
Browser: one Team entry, readable role/model/task, Lead/native members, same-role duplicates, current-chat identity, keyboard Escape/focus, narrow layout/dark theme, manager entry/new conversation, advanced editing and unload restores native registration. Package: clean profile installation with original roles preserved. Mock/local versus live model evidence must be stated separately.
