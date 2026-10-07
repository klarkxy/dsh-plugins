# @klarkxy/dsh-model-route

Model-route field contract for DeepSeek Harness (DSH) plugins.

Feature plugins each keep their own "which model should I use" setting. This
package is the tiny, stable contract they share so a hub plugin can find and
edit those fields from one page — without the feature plugins depending on the
hub, and without the hub depending on them.

## What is inside

- **`ModelRoute`** — the value shape every feature already uses:
  `{ provider, model, reasoningEffort? }`. Empty provider/model means "follow
  the host default model". Plus `defaultModelRoute`, `normalizeModelRoute`,
  `modelRouteOverride`, `sameModelRoute`, and the `modelRouteKey` pair.
- **`MODEL_ROUTE_MARKER` (`x-model-route`)** — an opt-in schema marker.
  A feature plugin attaches it to its model-route config field; hubs then
  detect the field precisely, including its `purpose` / `label` metadata.
- **`detectModelFields(schema, options?)`** — finds model-route fields in a
  projected settings schema (e.g. the `schema` half of a host
  `SettingsDescriptor`). Marker hits win; the bare ModelRoute object shape
  (`provider` + `model` string properties) is recognized with no marker at
  all, so uninstrumented third-party plugins still work. Branches, nested
  objects, array items and local `$ref`s are walked. Native Schemastery
  `{ uid, refs }` projections from `SettingsForms.describe()` are supported,
  including markers under `meta`. Live arrays produce one field per numeric
  index with that item's value; empty arrays or schema-only item templates
  use `[]` and `editable: false`. `arrayItem: true` tells editors to clear a
  direct array route by setting an empty route, because native unset removes
  the entire element.
- **Catalog helpers** — `parseModelMenuChoices`, `modelMenuEffortOptions`,
  `knownModelFromChoices` for the host session model catalog.
- **`@klarkxy/dsh-model-route/zod`** — optional zod binding:
  `modelRouteZod(meta?)` and `withModelRouteMarker(schema, meta?)`.
- **`@klarkxy/dsh-model-route/schemastery`** — optional schemastery binding:
  `modelRouteSchemastery(meta?)` (custom-key marker) and
  `modelRouteRoleSchemastery(meta?)` (official `.role('model-route', meta)`
  channel, for projectors that drop unknown meta keys).

- **`@klarkxy/dsh-model-route/ui`** — the controlled `ModelMenu` editor.
  A plain button anchor opens on click, Enter, Space, ArrowDown or ArrowUp.
  Existing handlers are retained; prevented events and disabled buttons do
  not open. Selection and Escape restore focus to the trigger.

The core entry is dependency-free and browser-safe. `/ui` uses React and the
host-injected UI primitives; `/zod` and `/schemastery` are optional bindings.

## Usage

Declare a marked field (schemastery):

```ts
import Schema from '@deepseek-ai/schemastery'
import { modelRouteSchemastery } from '@klarkxy/dsh-model-route/schemastery'

export const Config = Schema.object({
  summaryModel: modelRouteSchemastery({ purpose: 'summary', label: '总结模型' }).volatile(),
})
```

`SettingsForms.describe()` exposes only volatile fields. Mark the field
itself volatile so unrelated ordinary configuration stays outside the form.

Or with zod:

```ts
import { z } from 'zod'
import { modelRouteZod } from '@klarkxy/dsh-model-route/zod'

const Config = z.object({
  summaryModel: modelRouteZod({ purpose: 'summary', label: '总结模型' }),
})
```

Detect fields in a projected settings schema:

```ts
import { detectModelFields } from '@klarkxy/dsh-model-route'

const fields = detectModelFields(descriptor.schema, {
  value: descriptor.value,
  knownModel: knownModelFromChoices(choices),
})
// → [{ path: ['summaryModel'], via: 'marker', marker: { purpose: 'summary', ... }, current, known }]
```

## License

SEE LICENSE IN LICENSE
