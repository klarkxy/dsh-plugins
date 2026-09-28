# Acceptance record

Verified on 2026-09-28 with Windows, Node.js 24.16.0 and official DSH 0.1.7-rc.2.
This record describes the current plugin-only implementation.

## Scope

Blueprint shares exact package identities and ordered bundles. It has one Import /
Export menu. There is no settings document, settings RPC mode, field selection,
sharing-policy schema, Settings/Loader service dependency or settings mutation.
The validator accepts only the current blueprint schema; no migration or legacy
compatibility path is maintained. Reusable defaults belong in native composition
plugins and remain subject to the host's configuration-layer rules.

Import is additive: the entire existing active sequence remains unchanged, and
only requested inactive bundles are appended in blueprint preference order.
Different incoming order alone is not a conflict. Import never disables bundles.

Codes use only `DSHBP2:<payload>` with raw DEFLATE and Base64url. There is no
encoding selector or JSON import/download. Export returns only the code. Blueprint
metadata contains a name and optional description, without its own revision number.

## Completed checks

- All 97 package tests pass. Coverage includes strict code/JSON parsing, exact
  package identity, ordered export, additive prefix preservation, repeated-import
  idempotence, activation without reinstall, protocol vectors, package conflicts, bounded one-use plans,
  stale-state rejection, cancellation, partial failure, native installation calls,
  authenticated RPC, Creator guidance, discovery tools and client registration.
- Regression tests cover 1 MiB malformed interior whitespace and preserve outer
  ASCII whitespace / raw byte limits. A 64 KB case that previously took about 2.9 s
  now rejects in 0.19 ms; a 1 MiB case rejects in 0.52 ms in isolated Node 24.
- Request abort and engine disposal are checked at the initial snapshot, native
  inspection and final snapshot boundaries. Late replies cannot save plans/results.
  Actual HTTP disconnect and plugin unload tests abort the native inspect signal.
- Adapter tests run with Settings, Loader, pluginPackages, credential and storage
  accessors that throw if read. Catalog, export and preview still work. Settings
  operation requests, disable operations and non-blueprint input fail without mutation.
- The package syntax build passes. A real npm tarball was extracted and loaded by
  an isolated official host. PROTOCOL.md, the JSON example and its single code vector are packed;
  the retired settings-scope document is not packaged.
- Browser interaction with that packed plugin verified export/copy and import of
  a different preference order without any mutation, then a blueprint requesting
  an already installed inactive bundle. Exactly one enable operation appended it;
  existing order, dependencies and the user patch were preserved on readback.
- The packed page exports only a share code with no blueprint revision or JSON
  download. A malformed 64 KB code is rejected through the actual isolated host.
- Reimport, an install-only request for active bundles, and the shipped single-format
  empty-document code produced no-op previews. Desktop and 390px screenshots
  were inspected; mobile content did not overflow, Escape restored menu focus,
  and there were no browser exceptions.
- Independent read-only review found the engine/native adapter and protocol
  consistent with the accepted additive rule before the single-format simplification.
  A fresh independent review of the current fixes found no surviving bypass or
  regression, reran all 97 tests, and checked non-ASCII whitespace rejection.
  The parent also verified the packed browser flow.

Local evidence: `.scratch/blueprint-fix/`
(tarball, browser report and screenshots). These are not shipped assets.

## Host and verification boundaries

Stock rc.2 has no `plugins.list.actions` slot. The browser run used an isolated
copy of its official client with the equivalent four-file host integration patch;
the plugin's own configuration page remains available without that slot. This is
not an upstream host release or an update of the user's installed application.

The installed package fixtures exercise native activation/order handling; a fresh
public npm network installation and a packaged desktop titlebar were not tested.
No production profile, credential store, publication or deployment was touched.

The prior full workspace check passed release checks, site tests, editor-build
checks and typechecking, then failed in the unrelated dsh-safe-auto suite on
Windows path expectations and file-symlink permissions. This removal was verified
with the current package suite/build and packaging; it does not claim a green full
workspace check.
