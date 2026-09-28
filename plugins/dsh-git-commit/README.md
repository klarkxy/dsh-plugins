# @klarkxy/dsh-git-commit

Commit workspace changes to git without leaving the chat. Each conversation
thread gets a **Commit** action in its header: click it, review the branch,
file count and the model that will be used, then confirm to commit every
uncommitted path in the repository that contains the session's working
directory.

A model splits the change set into a small number of coherent commits with
proper messages, then the groups are applied in order as path-scoped commits.
The model route comes from
[@klarkxy/dsh-ai-services](https://klarkxy.github.io/dsh-plugins/plugins/ai-services/):
configure the **Git 提交** (`git-commit.plan`) purpose there in advance to pin
a dedicated model; when nothing is configured, the request inherits the normal
model tier and finally the default chat model. If the model call fails or
returns an invalid plan, the changes land in one fallback commit instead.

## Usage

1. Open a conversation whose workspace is inside a git repository.
2. Click **Commit** in the thread header (top right).
3. Confirm in the popover and wait for the run.
4. The panel lists every commit created (hash + message).

The button is disabled while the session is running. The host checks again
before committing and stops if the workspace changes during planning.

## Notes

- Each selected file is committed from its current worktree content. Pre-staged
  changes in other groups stay staged until their group is committed.
- Untracked files are included; small text files get a content preview for the
  model, binaries are listed by path only.
- Commits never push; pushing stays a manual decision.

## License

SEE LICENSE IN LICENSE
