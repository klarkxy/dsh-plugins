import type { Context } from "@deepseek-ai/cordis";
import type { GenerateOptions, StreamChunk } from "@deepseek-ai/dsh-llm";
import type { SessionTitleProvider, SessionTitleProviderRequest } from "@deepseek-ai/dsh-session-title";
import { afterEach, describe, expect, it, vi } from "vitest";

import { apply, generateCurrentTitle, resolveConfig, type Config } from "../src/index.js";

const baseConfig: Config = {
  maxRecentMessages: 8,
  locale: "auto",
  targetWords: 5,
  targetCjkCharacters: 10,
  maxInputBytes: 4096,
  maxOutputTokens: 64,
  timeoutMs: 60000,
};

function streamText(text: string, reason: StreamChunk & { type: "finish" } = { type: "finish", reason: { kind: "stop" } }): AsyncIterable<StreamChunk> {
  return (async function* () {
    yield { type: "block-start", index: 0, blockType: "text" } as StreamChunk;
    yield { type: "text-delta", index: 0, text } as StreamChunk;
    yield reason;
  })();
}

function request(overrides: Partial<SessionTitleProviderRequest> = {}): SessionTitleProviderRequest {
  return {
    session: { id: "session-test", append: vi.fn() } as never,
    messages: [
      { seq: 1 as never, text: "旧任务已经完成" },
      { seq: 2 as never, text: "现在修复登录回调失败" },
    ],
    route: { provider: "test-provider", model: "test-model" },
    signal: new AbortController().signal,
    ...overrides,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("provider", () => {
  it("registers one all-prompts provider", () => {
    const register = vi.fn();
    apply({ sessionTitle: { register } } as unknown as Context, baseConfig);
    const provider = register.mock.calls[0]?.[0] as SessionTitleProvider;
    expect(register).toHaveBeenCalledTimes(1);
    expect(provider.automatic).toBe("all-prompts");
  });

  it("uses the current route, session-title purpose, and official request event", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 3, 12));
    let options: GenerateOptions | undefined;
    const ctx = {
      llm: {
        stream(input: GenerateOptions) {
          options = input;
          return streamText('{"type":"fix","summary":"登录回调失败"}');
        },
      },
    } as unknown as Context;
    const input = request();
    const result = await generateCurrentTitle(ctx, resolveConfig(baseConfig), input);

    expect(result.title).toBe("0903 | 修复 | 登录回调失败");
    expect(result.messageSeqs).toEqual([1, 2]);
    expect(options).toMatchObject({
      provider: "test-provider",
      model: "test-model",
      purpose: "session-title",
      maxTokens: 64,
    });
    expect(input.session.append).toHaveBeenCalledWith(
      "session/title-llm-request",
      expect.objectContaining({ messageSeqs: [1, 2] }),
    );
  });

  it("uses an explicit provider/model pair", async () => {
    let options: GenerateOptions | undefined;
    const config = resolveConfig({ ...baseConfig, provider: "cheap", model: "flash" });
    const ctx = {
      llm: {
        stream(input: GenerateOptions) {
          options = input;
          return streamText('{"type":"optimize","summary":"模型路由"}');
        },
      },
    } as unknown as Context;
    await generateCurrentTitle(ctx, config, request());
    expect(options).toMatchObject({ provider: "cheap", model: "flash" });
  });

  it("rejects missing routes and malformed model output", async () => {
    const ctx = {
      llm: { stream: () => streamText("not-json") },
    } as unknown as Context;
    await expect(
      generateCurrentTitle(ctx, resolveConfig(baseConfig), request({ route: undefined })),
    ).rejects.toThrow(/no logged request route/);
    await expect(generateCurrentTitle(ctx, resolveConfig(baseConfig), request())).rejects.toThrow(
      /invalid JSON/,
    );
  });

  it("rejects non-stop finishes", async () => {
    const ctx = {
      llm: {
        stream: () =>
          streamText('{"type":"discuss","summary":"需求"}', {
            type: "finish",
            reason: { kind: "max-tokens" },
          }),
      },
    } as unknown as Context;
    await expect(generateCurrentTitle(ctx, resolveConfig(baseConfig), request())).rejects.toThrow(
      /maxOutputTokens/,
    );
  });

  it("requires provider and model together", () => {
    expect(() => resolveConfig({ ...baseConfig, provider: "cheap" })).toThrow(/supplied together/);
  });

  it("uses the DSH locale preference for the type label", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 3, 12));
    const ctx = {
      settings: { get: () => ({ preference: "en-US" }) },
      llm: { stream: () => streamText('{"type":"fix","summary":"login callback"}') },
    } as unknown as Context;

    const result = await generateCurrentTitle(ctx, resolveConfig(baseConfig), request());

    expect(result.title).toBe("0903 | Fix | login callback");
  });
});
