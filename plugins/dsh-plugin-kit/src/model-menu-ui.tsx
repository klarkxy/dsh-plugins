/**
 * Compatibility re-export. The ModelMenu popover — the standard editor of a
 * model-route field — lives in `@klarkxy/dsh-model-route/ui` next to the
 * contract it edits. This entry keeps existing plugin-kit consumers working;
 * new code should import from `@klarkxy/dsh-model-route/ui` directly.
 */
export * from '@klarkxy/dsh-model-route/ui'
