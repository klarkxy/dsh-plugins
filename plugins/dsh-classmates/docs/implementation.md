# Implementation and acceptance

Target: one installable DSH Web plugin, on exactly 0.1.7-rc.2, providing user-defined specialist roles backed by official Agent Teams. The original design report is preserved.

## Decisions from source review

- Use the public scoped model-selection helper. The awaited `agent/created` event runs after the continuable descriptor has been added during creation setup; verify this against the installed runtime before expanding the UI.
- The official Team roster owns membership, provisioning and failed creation. Names cannot be reused within a Team, including by failed members. Never create a second lifecycle store.
- Persist the role revision in plugin configuration. The native settings form revision is a separate, process-local concurrency token, not the durable role revision.
- A binding is immutable, scoped by profile, Lead and name, and must be associated with the roster child ID before the first request. Missing or inconsistent plugin-member bindings reject activation.
- Retrying an uncertain creation must not submit the initial task again. An unresolved provisioning result is not a successful receipt.
- Defaults are disabled, unbound Researcher, Writer and Verifier definitions. Existing instances keep their snapshots after template edits or deletion.
- The host owns credentials and model transport. No new services, telemetry, orchestration engine or role permission system.

## Work sequence

1. P0: the installed official runtime, captured final requests, concurrent routes and instructions, an unchanged Lead, retry, cold recovery, and missing-binding rejection.
2. Host role, configuration and binding tools, then the configuration page built on stable host contracts.
3. Packaging, clean installation, browser workflows, direct Team messages and tasks, and independent review.
4. Real-provider checks require two available, authorized host routes. Report unavailable checks separately; do not mark them as passed, and do not publish the package implicitly.

Primary owns the shared contracts, manifests, integration and acceptance. Cursor is available for bounded host and test work; Kimi is available for the configuration page. All worker results require independent verification.
