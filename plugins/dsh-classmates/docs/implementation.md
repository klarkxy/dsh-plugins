# Implementation and acceptance

Target: one installable DSH Web plugin, on exactly 0.1.7-rc.2, with user-defined specialist roles backed by official Agent Teams. The original design report is preserved.

## Decisions from source review

- Use the public scoped model-selection helper. Awaited `agent/created` runs after the continuable descriptor has been added in creation setup; verify this against the installed runtime before expanding the UI.
- Official Team roster owns membership, provisioning and failed creation. Names cannot be reused within a Team, including failed members. Never create a second lifecycle store.
- Persist role revision in plugin configuration. The native settings form revision is a separate, process-local concurrency token, not the durable role revision.
- A binding is immutable and profile/Lead/name scoped, and must be associated with the roster child ID before the first request. Missing or inconsistent plugin-member bindings reject activation.
- Retrying an uncertain creation must not submit the initial task again. An unresolved provisioning result is not a successful receipt.
- Defaults are disabled, unbound Researcher, Writer and Verifier definitions. Existing instances keep their snapshots after template edits/deletion.
- Host owns credentials and model transport. No new services, telemetry, orchestration engine or role permission system.

## Work sequence

1. P0: installed official runtime, captured final requests, concurrent routes and instructions, unchanged Lead, retry, cold recovery, missing binding rejection.
2. Host role/configuration/binding tools, then the configuration page using stable host contracts.
3. Package, clean installation, browser workflows, direct Team messages/tasks, and independent review.
4. Real-provider checks require two available authorized host routes. Report unavailable checks separately; do not mark them passed or publish the package implicitly.

Primary owns shared contracts, manifests, integration and acceptance. Cursor is available for bounded host/test work; Kimi for the configuration page. All worker results require independent verification.
