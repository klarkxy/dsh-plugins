# Fusion → Classmates local migration

This utility is file-to-file. It never scans `.dsh`, never opens credential stores, never edits native plugin settings, and never changes sessions. Local apply/cutover belongs to primary.

Build first so `dist/migrate-fusion.js` exists (`npm run build` in this package). The CLI is plain Node ≥ 24 JavaScript; do not use `--experimental-strip-types`.

## 中文

1. 从现有 Fusion 存储导出 JSON。实际 `dsh-storage-domain` 信封为 `{ unit: { name: "dsh_fusion", version: 1|2 }, tables: { state: { state } } }`。也接受根级 `name` 信封、`tables.state.records.state`，或原始 `{ version, revision, pairs }` / `{ state: { pairs } }`。
2. 可选：从原生插件设置导出当前 Classmates `{ roles, modelProfiles, protectedModels }`。
3. 在 `plugins/dsh-classmates` 构建后运行：

```powershell
npm run build
node dist/migrate-fusion.js --fusion fusion-store.json --output classmates-merged.json --classmates classmates-export.json --archive fusion-archive
```

源码目录也可用 `node scripts/migrate-fusion.mjs`（同样要求已构建）。安装包内路径为 `node node_modules/@klarkxy/dsh-classmates/dist/migrate-fusion.js`。

4. 校验失败（非法形状、候选 SHA-256 不符、任务仍处于 `dispatching`/`working`/`review`/`decision`、`cleanup` 为 pending/failed、`adoption` 为 pending/conflict、`application` 为 pending、未放弃的 `application` conflict、模型预设冲突、输出路径会覆盖输入或已有不同内容的目标）时不写任何输出文件。写作任务在 `accepted` 且 `adoption:'pending'`、尚无 `application` 时仍未收束。`adoption:'dismissed'` 且历史 `application.state:'conflict'` 已收束（Fusion dismiss 只改 adoption，冲突记录原样进归档）。请先在 Fusion 内把未收束任务收束，不要让本工具重放、取消或代为采用。
5. `--archive` 为目录时写入 `source.json`（原始字节）、`archive.html`（离线可读）和 `report.json`。HTML 文件旁会另存 `.source.json`。这些路径与 `--output`、输入文件必须互不相同（含 Windows 大小写、符号链接 realpath、已有硬链接）。已存在的目标仅当字节已完全相同才视为幂等，否则拒绝，以免毁掉先前归档。目的文件检查遇到权限或 I/O 错误时，所有输出均停止；只有 `ENOENT` 视为不存在。
6. 审查 `--output` 中新增的**停用**模型预设（`fusion-<hash16>`）。重复运行同一份 Fusion 与已合并结果会复用相同 id，不会复制。已收束任务的 `adoption`/`cleanup`/`application` 状态会写入可读归档。
7. 应用（primary/用户，任选其一，先审查）：
   - 创造模式：`classmates_read`，再用 `classmates_models_batch` 按 revision 0 upsert 新增预设（保持停用，按需启用）。
   - 或把审查后的 `{ roles, modelProfiles, protectedModels }` 写回原生 Classmates 插件设置。不要写入凭据文件。
8. 在角色编辑器选择跟随会话、绑定模型预设或指定模型。绑定预设是执行默认值，预设缺失或停用时派发报错，不自动回退。旧 `recommendedModelProfileId` 在没有固定模型时迁移为绑定；已有固定模型优先，旧建议只保留为迁移提示。指定模型未填强度时继承会话强度，模型预设未填强度时使用模型默认值。
9. Fusion 原存储字节、原生会话、输入文件均保持不变。

预检完成后，新目的文件使用独占创建（`wx`）。若其他写入者在预检与提交之间创建目的文件，本工具以 `DESTINATION_CONFLICT` / `EEXIST` 明确失败，不覆盖或删除该文件。目录归档按 `source.json`、`archive.html`、`report.json`、`--output` 顺序逐个写入；HTML 归档先写 HTML、再写 `.source.json`，最后写 `--output`。写入阶段的竞态或 I/O 失败可能留下较早完成的文件，也可能留下本次失败写入的部分内容。本工具不把多个文件视为事务，也不自动回滚删除。请检查保留文件再重试；已存在且字节完全相同的文件仍会跳过。

`follow` / `off` 选择会被跳过；只提取 pair.route 与 `fixed` 选择中的精确 `provider`/`model`/`reasoningEffort`。不发明路由映射，不编造价格。

## English

1. Export existing Fusion storage JSON. The actual `dsh-storage-domain` envelope is `{ unit: { name: "dsh_fusion", version: 1|2 }, tables: { state: { state } } }`. A root `name` envelope, `tables.state.records.state`, or a raw `{ version, revision, pairs }` / `{ state: { pairs } }` document is also accepted.
2. Optionally export the current Classmates `{ roles, modelProfiles, protectedModels }` from native plugin settings.
3. After building this package:

```sh
npm run build
node dist/migrate-fusion.js --fusion fusion-store.json --output classmates-merged.json --classmates classmates-export.json --archive fusion-archive
```

A source checkout can use `node scripts/migrate-fusion.mjs` (also requires the build). After install: `node node_modules/@klarkxy/dsh-classmates/dist/migrate-fusion.js`.

4. On validation failure (shape, candidate SHA-256, active `dispatching`/`working`/`review`/`decision`, cleanup pending/failed, adoption pending/conflict, application pending, application conflict unless adoption is dismissed, profile conflict, or a destination that would overwrite an input or a different existing file) nothing is written. An accepted writing task with `adoption:'pending'` and no `application` is still unsettled. Dismissed writing with a historical `application.state:'conflict'` is settled (Fusion dismiss changes only adoption; the archive keeps both values). Settle remaining work in Fusion first; this tool will not replay, cancel, or adopt.
5. A directory `--archive` keeps exact original bytes as `source.json`, plus offline `archive.html` and `report.json`. An `.html` archive also writes a sibling `.source.json`. Those paths, `--output`, and every input must be distinct (Windows case, symlink realpath, and existing hardlink identity included). An existing destination is kept only when its bytes already match; otherwise the CLI refuses so it cannot destroy an earlier archive. Permission or I/O failures while checking destinations stop all writes; only `ENOENT` counts as absent.
6. Review the generated **disabled** model profiles (`fusion-<hash16>`). Repeating the same Fusion bytes against the merged config reuses those ids. Settled `adoption` / `cleanup` / `application` values are copied into the readable archive.
7. Apply after review (primary/user):
   - Creator: `classmates_read`, then `classmates_models_batch` upsert each added profile at revision 0 (they stay disabled until you enable them).
   - Or replace the classmates namespace value `{ roles, modelProfiles, protectedModels }` in native plugin settings with the `--output` JSON. Do not paste into credential files.
8. Choose a role model source in the editor: inherit the conversation, bind a model preset, or specify a model. A bound preset is an execution default; missing or disabled presets reject dispatch without fallback. Legacy `recommendedModelProfileId` migrates to a binding when no fixed model exists. A legacy fixed model takes precedence and retains the old recommendation only as a migration note. Unset effort on a specific model inherits conversation effort; unset profile effort uses the model default.
9. Original Fusion store bytes, native sessions, and the input files stay unchanged.

After pre-flight, new destination files use exclusive creation (`wx`). If another writer creates a destination before commit, the utility fails visibly with `DESTINATION_CONFLICT` / `EEXIST` and neither overwrites nor deletes that file. Directory archives write `source.json`, `archive.html`, `report.json`, then `--output`; HTML archives write the HTML, its `.source.json` sibling, then `--output`. A race or I/O failure during writes can leave earlier completed files and possibly a partially written current file. This is not a multi-file transaction and performs no automatic deletion rollback. Inspect retained files before retrying; already-existing identical files still skip writing.

`follow` and `off` selections are skipped. Only exact fixed routes from pairs/settings/selections are copied. No invented route mapping and no fabricated prices.
