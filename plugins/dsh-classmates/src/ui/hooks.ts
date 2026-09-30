import { useSyncExternalStore } from 'react';
import type { ClassmatesClient } from '../contracts.js';

/** Structural view of the host LocaleRuntime (`ctx.locale`): only the face this page reads. */
export interface LocaleSource {
  getSnapshot(): { active: string };
  subscribe(listener: () => void): () => void;
}

const noSubscribe = () => () => {};

/** Active host locale id; without a runtime (tests) the page keeps its zh copy. */
export function useLocaleId(source: LocaleSource | undefined): string {
  return useSyncExternalStore(
    source ? listener => source.subscribe(listener) : noSubscribe,
    () => source?.getSnapshot().active ?? 'zh',
    () => source?.getSnapshot().active ?? 'zh',
  );
}

/**
 * Whether "Start task" can actually run. `startTask` is always defined on the
 * live client, so its presence alone says nothing: the implementation only
 * exists while the host provides agent presets, workspaces and conversation.
 */
export function useStartTaskAvailable(client: ClassmatesClient): boolean {
  const availability = client.startTaskAvailability;
  return useSyncExternalStore(
    availability ? listener => availability.subscribe(listener) : noSubscribe,
    () => client.startTask !== undefined && (availability ? availability.getSnapshot() : true),
    () => false,
  );
}
