// Derived from deepseek-ai/deepseek-harness (MIT) tag dsh-v0.1.7-rc.2
// packages/core/agent-loop/tests/mock-adapter.ts — trimmed to local request capture.

import type {
  GenerateOptions,
  LlmModelReasoningInfo,
  LlmResolvedModelInfo,
  StreamChunk,
} from '@deepseek-ai/dsh-llm';
import { LlmAdapter } from '@deepseek-ai/dsh-llm';

export function textResponse(text: string): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    ...Array.from(text, (char): StreamChunk => ({ type: 'text-delta', index: 0, text: char })),
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'usage', usage: { inputTokens: 10, outputTokens: text.length } },
    { type: 'finish', reason: { kind: 'stop' } },
  ];
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Local capture adapter: records final GenerateOptions and never calls a network model. */
export class CaptureAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = [];
  /** When true, stream records the request then waits until {@link release} . */
  hold = false;
  /** Remaining streams that should fail after capture, for same-step `agent/request-error` retry. */
  failRemaining = 0;
  private waiting: Deferred<void> | undefined;

  constructor(
    private readonly reasoning: LlmModelReasoningInfo,
    private readonly allowedModels: ReadonlySet<string>,
  ) {
    super();
  }

  release(): void {
    this.waiting?.resolve();
    this.waiting = undefined;
  }

  override resolveModel(
    provider: string,
    model: string,
  ): Promise<LlmResolvedModelInfo> {
    if (!this.allowedModels.has(model)) {
      return Promise.reject(new Error(`unknown model ${provider}/${model}`));
    }
    return Promise.resolve({
      provider,
      id: model,
      name: model,
      reasoning: this.reasoning,
    });
  }

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options);
    if (this.failRemaining > 0) {
      this.failRemaining -= 1;
      throw new Error('transient adapter failure');
    }
    if (this.hold) {
      this.waiting = deferred();
      await new Promise<void>((resolve, reject) => {
        const finish = (fn: () => void): void => {
          options.signal?.removeEventListener('abort', onAbort);
          fn();
        };
        const onAbort = (): void => { finish(() => { reject(new Error('aborted')); }); };
        if (options.signal?.aborted) {
          onAbort();
          return;
        }
        options.signal?.addEventListener('abort', onAbort, { once: true });
        this.waiting?.promise.then(() => { finish(resolve); }, (error: unknown) => {
          finish(() => { reject(error); });
        });
      });
    }
    for (const chunk of textResponse('captured')) {
      if (options.signal?.aborted) throw new Error('aborted');
      yield chunk;
    }
  }
}
