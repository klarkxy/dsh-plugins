/**
 * Stand-in for `@klarkxy/dsh-plugin-kit/auxiliary-model-client` in the Node
 * SSR tests. The real entry is a browser card: it imports the host
 * ui-primitives bundle and the model menu, neither of which Node can load here
 * (see client-primitives-stub.mjs and model-menu-stub.mjs). This double keeps
 * the shared contract the plugin depends on — one root-owned
 * `auxiliary-model` row inside the shared Session Management column, whose
 * root share also retains the column's page and nav icon — so the SSR
 * assertions cover the plugin's own wiring. The card's own rendering is
 * covered by the kit's tests.
 */
import { registerSessionSettingsItem } from '@klarkxy/dsh-plugin-kit/client-utils'

export function registerAuxiliaryModelSettings(ctx) {
  return registerSessionSettingsItem(ctx.root ?? ctx, { id: 'auxiliary-model', order: 55 }, () => null)
}
