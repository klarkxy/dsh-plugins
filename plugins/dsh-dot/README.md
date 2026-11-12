# Dorothy (dot)

<!-- release-state-note -->

[简体中文](docs/README.zh-CN.md)

Dorothy, dot for short, is an always-on coordinator for DeepSeek Harness. Talk to her in her own panel, and she opens workspaces, starts sessions, follows their progress, settles their approvals and questions on your behalf, and reports back. You stay in one chat instead of watching every session.

Her chat is warm, relaxed and a little goofy, with an occasional orange catchphrase. When work is underway she keeps tasks moving and reports cleanly. You can rewrite her persona and what she calls you in her settings.

## Install

```sh
dsh plugin --profile web add @klarkxy/dsh-dot
dsh plugin --profile web add @klarkxy/dsh-deep-view
```

Replace `web` with your profile name and restart it if DSH asks. Deep View draws the choice, confirmation and chart cards in Dorothy's chat; without it she asks in plain text.

## Use

Click **Dorothy** in the sidebar list with **Plugins** and **Automations**. Her whale turns pink while her panel is open. The panel is her whole chat: her conversation lives there and stays out of your workspaces' session lists.

Tell Dorothy what you need, for example:

```text
Create a workspace at D:\work\site and start a task there: fix the broken links on the docs page, then tell me what changed.
```

Dorothy then:

- creates or reuses workspaces and opens one session per task, with a self-contained first instruction. By default task sessions keep the host's permissions while Dorothy settles routine approvals silently; setting **Permission approvals** to **Allow all** runs new tasks with full access;
- picks the agent preset by the task: DSH's default preset for ordinary work, `ptc` for mechanical work that is mostly running steps by script, and `cordis` for writing or changing DSH plugins, presets and settings. A `cordis` task can change DSH itself, so it keeps its approval prompts and every one of them is yours to decide;
- runs work that belongs to none of your projects, such as research or looking after DSH itself, in a workspace of her own. It is called **Dorothy** in the sidebar and lives in the `dot` folder of the DSH home; you can open sessions there too;
- looks small things up herself: she searches the web, reads a web page, reads the official DSH documentation and finds DSH plugins. Research that needs many pages still goes to a task session;
- steers or stops sessions when you ask, including sessions you opened yourself, and starts tracking an existing session on request;
- archives the sessions she started herself once their work is done. She cannot archive a session you opened, even when she follows it; archive those yourself in the session list;
- reports approvals, questions, failures and finished turns of tasks she started promptly, merging updates that arrive close together into one message. Finished turns of sessions she only watches wait for her next wake-up or your next message; running and idle changes stay on the board;
- handles the approval prompts and model questions of every session, including the ones you opened yourself. Routine ones and requests already answered in their own session are settled silently without cluttering her chat; when a request deletes data outside the project, publishes or pushes, spends money, touches credentials, or changes direction or scope, she asks you in her chat with a card and passes your answer back.

In the panel, **Tasks** in the header opens the board: requests waiting on you, every tracked task with its status and latest note, and the reminders Dorothy has set. Click a task row to open that session. Type at the bottom; Enter sends and Shift+Enter starts a new line. While Dorothy works, a new message reaches her at her next step, and **Stop** ends her current turn.

You can ask Dorothy to do something later or regularly, for example "check in half an hour whether that task has finished" or "sum up progress at nine every weekday morning". She sets herself a reminder: once (some minutes from now, or at a date and time), every so many minutes, every day at a fixed time, or on chosen days of the week. When it is due the reminder wakes her, she does what she wrote down for it, and tells you what is worth knowing. Reminders belong to Dorothy and not to one segment of the conversation: they still come due after the conversation moves to a new segment, they survive a DSH restart, and one that was missed while DSH was not running is delivered once at the next start. Times follow the local time of the computer DSH runs on, and she can hold up to 50. **Reminders** in the board shows each one with how it repeats and when it is next due; click **Remove** to delete it, or ask her to change or remove it.

The conversation with Dorothy can go on indefinitely. When a turn ends with more than 70% of the usable window in use, she moves the conversation to a new segment: a short conversation is carried over word for word, and a longer one becomes a handoff note she writes for herself, plus the last few exchanges word for word and the task ledger at that moment. The panel still shows one continuous chat, with a divider where the segment changed and the latest six segments above it. Changing her model or persona, or coming back after more than two hours to a conversation that is already long, also starts a new segment before your next message is delivered. She stays in the segment while she is working; if a card is still open when the conversation moves to a new segment, the card stays active and your reply reaches her in the new segment.

You can also click **Start new segment** directly from **Context** in the gear drawer when she is idle. The button does not send Dorothy a message; it uses the same handoff and keeps her tasks, reminders, notes, open cards and searchable history. Dorothy can choose a new segment herself with her own tool, which takes effect when her turn ends.

A new segment does not lose what was said before. Dorothy can search earlier conversation and read it back word for word: every segment of her chat with you, and the sessions of the tasks she started or watches. When you refer to something she no longer has in front of her, she looks it up before she asks you to repeat it. The search is literal and wants all your words in one message, so the words that were actually used find it best.

Dorothy also keeps notes of her own, for what she should know in every conversation: who you are, how you like to work, what you corrected her on. She adds a note when such a thing comes up and removes one that is outdated; you can also tell her "remember that…" or "stop keeping…". The notes are carried in when a segment starts, so a note she has just written appears in her prompt from the next segment on, and in the current one she knows it from the conversation itself. What merely happened and the details of tasks are not kept in the notes; she looks those up in the record.

**Trajectory** in the gear drawer shows Dorothy's current segment: her session turn by turn and step by step, like DSH's own trajectory view. Each turn shows its steps, tool calls, duration and tokens; each step shows the model, time to first token, duration and tokens with the cached share. Inside a step you see your messages, session updates, her thinking, her replies, tool calls with their arguments and results, and compactions, in order; click a row to expand it. The newest turn opens by default. Search finds text across messages, tool names, arguments and results, and runtime-context snapshots stay hidden until you tick **Show runtime snapshots**. Very long records show their beginning, and the view keeps the latest 30 turns.

### Settings

The gear in the panel's header opens a drawer with Settings, Persona, Context and Trajectory; click its close button or press Esc to close it. Option switches save at once; custom rules save automatically when you leave the field.

| Setting | Effect |
| --- | --- |
| Dorothy's model | The model shared across chatting, dispatching tasks and screening approvals. **Follow the default model** (default) tracks the host's default model. |
| Scope | **All sessions** (default), or **Tracked tasks only** (only the tasks she started or watches). |
| Permission approvals | **Dorothy** (default: approves routine work and asks about risky ones); **You** (relays every approval to you); **Deny all** (rejects every approval prompt); or **Allow all** (runs new tasks with full access and allows approval prompts automatically). |
| Model questions | **Answer when clear** (default: answers what the goal settles and asks when direction or scope changes); **Always ask me**; or **Leave to session** (leaves them to the native question card). |
| Custom rules | Preferences in plain language, such as which pushes are fine or which deletions always need you. Applied first whenever Dorothy handles approvals or questions. |
| Allowed task models | **Unrestricted** (default), **Allow selected**, or **Exclude selected**, with provider-grouped filtering. Applies only to the tasks she starts, not to her own model. A task runs on the host's default model unless she names one; when the default is not allowed she picks a model that is, and a model outside the list is refused. |

The **Persona** page (**Persona & memory**) holds how Dorothy addresses you, her everyday tone and her long-term memory. **How she addresses you** defaults to 你 (you); type a name, nickname or title and press Enter or leave the field to save it. **Voice & personality** shows her default character text; edit it in any language and click **Save changes**, or **Discard** unsaved edits. Both fields have **Restore default**. Changes apply from your next message, when the conversation continues in a new segment, and her reports, task results and approval decisions stay objective whatever the persona says.

**Long-term memory** on the same page is her notes, and you can edit them: a line that starts with "- " is one note, the whole text holds up to 4,000 characters, and **Save memory** applies it. **Revert last save** puts the notes back to what they were before their latest save, whether you or she made it; one step is kept. After you edit the notes, the conversation moves to a new segment before your next message is delivered, so she continues with the new notes. The notes are the file `memory.md` in her workspace; the page shows its full path, and you can edit it in any editor.

The **Context** page in the same drawer shows the context usage of Dorothy's current segment and refreshes while open: how much of her model's window is in use (starting with an estimate of her preloaded instructions and handoff before her first reply in the segment), the rollover line, the fallback compaction line (90% of the window, less when output and headroom need the room; it only matters when a single turn fills the window), how many times this segment has compacted, and **Total usage** accumulated across segments with the cache hit rate and a **Clear** button to reset counting at any time. **Prompt breakdown** divides the prompt into system prompt, tool definitions, user messages, injected content, skill injections, assistant messages and tool results. Expand a category and then an item to read its text or formatted JSON; very long entries show their beginning. Occupancy reads the same token metering the chat ring uses.

Dorothy can read her settings and propose changes to them. Every setting is unlocked by default; click the lock icon beside any field label to lock it, which only restricts Dorothy and never your own edits. For an unlocked field she submits a proposed value and reason, which waits under **Proposed changes** in Settings until you **Approve and apply** or **Decline** it. Approval applies it only if you have not changed that field since; otherwise the proposal stays for review instead of overwriting your newer choice. Locks and `homeDir` are yours alone. Pending proposals survive a restart. She can also propose replacing her notes; locking notes makes her ordinary note additions and removals require the same approval.

The plugin list keeps one setting, `homeDir`: the folder of Dorothy's own workspace, which also holds her own session. Empty uses a `dot` folder in the DSH home.

## Limits

- Dorothy works through other sessions: her preset carries conversation, context compaction, her own tools (reminders included) and a few lookup tools, and file and shell work happens in task sessions.
- Dorothy installs and enables the [DSH Docs](https://klarkxy.github.io/dsh-plugins/plugins/dev-index/) plugin along with herself, for documentation and plugin lookups. It gets no row of its own under **Installed plugins**; to open its browser in the Plugins page, install that plugin separately as well, which does not load it twice.
- Her web search and page reading are DSH's own tools. Search needs a search service set up in the DSH settings first; until then she can only read addresses you give her.
- She reads at most the first 24,000 characters of a web page.
- She can archive only the sessions she started herself.
- She can look up only her own conversation and the sessions on her task board; other sessions are out of her reach. The search is literal and knows no synonyms; it covers the conversation text by default, and tool calls and results only when she asks for them. One search covers the latest 120 sessions at most.
- Her notes hold up to 4,000 characters, and one note up to 400; once they are full she has to remove or merge old notes before she can add one.
- The notes file sits in her workspace, so a task session that runs in that workspace can read and change it too.
- Her reminders are managed in the board only; they do not appear among DSH's **Automations**.
- Her panel shows text, tool activity and Deep View cards. Attachments and slash commands belong to ordinary sessions. Her model is chosen in her settings.
- Setting **Permission approvals** to **Allow all** runs new task sessions with full access so their commands can change anything they reach.
- A task on the `cordis` preset never runs with full access: unless **Permission approvals** is set to **Deny all**, its approvals always come to you. Its questions still follow **Model questions**.
- Dorothy chooses a task's preset from what the task is, and you can name one yourself. The preset has to be in this DSH's preset list; `ptc` and `cordis` come with DSH.
- An answer given on the session's own card counts as well; the first answer wins.
- Waiting requests and notices waiting or held for delivery live in memory, like the host's own pending approvals: restarting DSH clears them.
- Approvals, questions, errors and finished turns of tasks she started wake Dorothy for one model turn. Held updates join the next wake-up or your next message, and a full held queue is sent as one message. Every due reminder wakes her; reminders due at the same moment arrive as one message.

## License

[Apache License 2.0](LICENSE)
