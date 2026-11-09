# Context Cleaner

<!-- release-state-note -->

Context Cleaner hides the two decoration cards at the top right of the dsh-context dashboard: the plugin-info card and the promotion/recommendation card. The freed column collapses and the stats card fills the header row.

## Install

First install and enable `dsh-context` — this plugin only declutters it and does not provide the context panel itself.

From a source checkout, install the bundle directory `plugins/dsh-context-cleaner` through the DSH plugin manager (its absolute path also works) and enable the **Context Cleaner** row. Nothing else needs configuring.

## Use

No action needed. While the plugin is enabled, the plugin-info and promotion cards stay hidden in the dsh-context panel — in the context tab and the sidebar entry alike. Disabling or uninstalling the bundle removes the rule and restores the cards.

## Limits

- The hiding relies on dsh-context's rendered layout; an upstream redesign may need a matching update of this plugin.
- The plugin removes the cards visually only — dsh-context still runs its recommendation fetch in the background.
