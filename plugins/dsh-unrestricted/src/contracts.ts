/**
 * Identity and the preset card's copy, shared by both halves.
 *
 * A preset declaration carries one name and one description, and the host
 * translates only its own four presets — user-authored copy is never
 * translated. The bundle therefore publishes the Chinese pair, and the browser
 * half swaps it for the active interface language so each language reads on its
 * own instead of as one bilingual line. The package test compares the published
 * pair against these constants.
 */

/** The package name, and the loader row this bundle installs. */
export const PLUGIN_NAME = '@klarkxy/dsh-unrestricted'

/** The preset's id, as declared in `cordis.patch.yml`; sessions record it. */
export const PRESET_ID = 'unrestricted'

/** The name the bundle publishes, phrased like the host's own mode names. */
export const PRESET_NAME_ZH = '破限模式'

/** The description the bundle publishes, warning included. */
export const PRESET_DESCRIPTION_ZH =
  '解除模型对回答内容的限制，交付完整成果；只作用于选用它的会话。⚠ 可能导致账号被封禁。'

/** The name shown when the interface is not Chinese. */
export const PRESET_NAME_EN = 'Unrestricted mode'

/** The description shown when the interface is not Chinese. */
export const PRESET_DESCRIPTION_EN =
  'Removes the limits on what the model answers and delivers complete results; '
  + 'applies only to sessions that select it. ⚠ May get your account banned.'

/** Display copy per interface language; the Chinese pair is the published one. */
export const PRESET_COPY = {
  zh: { name: PRESET_NAME_ZH, description: PRESET_DESCRIPTION_ZH },
  en: { name: PRESET_NAME_EN, description: PRESET_DESCRIPTION_EN },
} as const

/** The sentences the browser half paints in the theme's error colour, per language. */
export const WARNING_MARKS = {
  zh: '⚠ 可能导致账号被封禁。',
  en: '⚠ May get your account banned.',
} as const

/** Attribute marking a span this plugin split out of the description. */
export const WARNING_ATTRIBUTE = 'data-dsh-unrestricted-warning'
