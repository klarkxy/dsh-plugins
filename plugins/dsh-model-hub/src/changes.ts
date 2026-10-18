import type { Context } from '@deepseek-ai/cordis'
import { modelSettingsChangesIdentity } from '@klarkxy/dsh-plugin-kit/contracts'
import { createModelSettingsChanges } from '@klarkxy/dsh-plugin-kit/model-settings-changes'

/** Model Hub forwards every settings namespace; feature plugins filter their own. */
export function registerHubModelSettingsChanges(ctx: Context): void {
  createModelSettingsChanges(ctx, modelSettingsChangesIdentity('@klarkxy/dsh-model-hub'))
}
