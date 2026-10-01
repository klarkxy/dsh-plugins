# @klarkxy/dsh-git-commit

Commit workspace changes to git without leaving the chat. Every conversation
thread gets a **Commit** action in its header: click it, check the branch, the
file count and the model that will be used, then confirm to commit every
uncommitted path in the repository that contains the session's working
directory.

[简体中文](docs/README.zh-CN.md)

## Install

Requires Node.js ≥22. If your DSH distribution does not bundle this plugin,
install it and enable its `git-commit` entry through the host plugin
configuration.

```sh
npm install @klarkxy/dsh-git-commit
```

## How it works

A model splits the change set into a small number of coherent commits with
proper messages, then the groups are applied in order as path-scoped commits.
The model route comes from this plugin's own settings row: configure the
**Commit planning model** there in advance to pin a dedicated model; when
nothing is configured, the request follows the live session model and then the
host default chat model. If the model call fails or returns an invalid plan,
the run is **rejected** and nothing is staged or committed — a commit the model
never planned is not one you asked for. The plugin page can opt back into the
old behavior with **Commit even without a model plan**, which merges every
change into a single commit with a plugin-written message.

## Plugin page settings

`Settings → Plugins → Git Commit` holds the rows this plugin needs.
**Commit planning model** is optional: a saved route is used for the planning
call as an explicit model, an empty selection follows the live session model
and then the host default chat model, and the conversation header panel reports
which of the two is in effect. Only that call is affected; a saved route selects
a model, but it is not evidence of connectivity. **Commit even without a model
plan** is off by default and only changes what happens when planning produces
nothing.

## Usage

1. Open a conversation whose workspace sits inside a git repository.
2. Click **Commit** in the thread header (top right).
3. Confirm in the popover, then wait for the run to finish.
4. The panel lists every commit it created (hash + message).

The button is disabled while the session is running. The host checks again
before committing, and stops the run if the workspace changes during planning.

## Notes

- Each selected file is committed from its current worktree content. Pre-staged
  changes that belong to another group stay staged until that group is
  committed.
- Untracked files are included: small text files get a content preview for the
  model, while binaries are listed by path only.
- Commits never push. Pushing stays a manual decision.

## License

SEE LICENSE IN LICENSE
