import { describe, expect, it } from "vitest";

import { PluginRegistry } from "../src/registry.js";
import { registryTools } from "../src/registry-tools.js";

const reply = (body: unknown) => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
const name = "@sample/dsh-example";
const manifest = (version: string, patch: string | undefined = "./cordis.patch.yml") => ({
  name, version, dsh: { bundle: { patch } }, engines: { dsh: ">=0.1.7-0 <0.2.0" }, dependencies: { helper: "^1.0.0" },
});
const metadata = () => ({
  name, "dist-tags": { latest: "1.0.0", next: "2.0.0-beta.1" },
  versions: {
    "1.0.0": manifest("1.0.0"),
    "2.0.0-beta.1": manifest("2.0.0-beta.1"),
    "0.9.0": { ...manifest("0.9.0", undefined), dsh: {}, deprecated: "Use 1.0.0" },
  },
  time: { "0.9.0": "2026-01-01", "1.0.0": "2026-02-01", "2.0.0-beta.1": "2026-03-01" },
});

describe("plugin registry", () => {
  it("search is paginated registry discovery and does not assert bundle compatibility", async () => {
    const client = new PluginRegistry({
      fetcher: (async (url: string | URL | Request, options?: RequestInit) => {
        const parsed = new URL(String(url));
        expect(parsed.origin).toBe("https://registry.npmjs.org");
        expect(parsed.searchParams.get("text")).toBe("memory keywords:dsh-plugin");
        expect(parsed.searchParams.get("from")).toBe("2");
        expect(options?.redirect).toBe("error");
        expect(options?.credentials).toBe("omit");
        expect(options?.headers).toEqual({ accept: "application/json" });
        return reply({ total: 4, objects: [{ package: { name, version: "1.0.0", description: "A candidate", links: { homepage: "javascript:bad" } } }] });
      }) as typeof fetch,
    });
    const result = await client.search({ query: "memory", source: "npm", offset: 2, limit: 1 });
    expect(result.nextOffset).toBe(3);
    const hit = result.results[0] as { verification: string; homepage: string | null };
    expect(hit.verification).toBe("candidate-only");
    expect(hit.homepage).toBeNull();
  });

  it("versions resolves tags to exact identities and returns selected-version contracts", async () => {
    const client = new PluginRegistry({
      fetcher: (async (url: string | URL | Request) => {
        expect(String(url)).toBe("https://registry.npmjs.org/%40sample%2Fdsh-example");
        return reply(metadata());
      }) as typeof fetch,
    });
    const latest = await client.versions({ package: name, limit: 1 });
    expect(latest.selected.version).toBe("1.0.0");
    expect(latest.selected.bundleDeclared).toBe(true);
    expect(latest.selected.engines.dsh).toBe(">=0.1.7-0 <0.2.0");
    expect(latest.selected.dependencies).toEqual({ helper: "^1.0.0" });
    expect(latest.versions[0].version).toBe("2.0.0-beta.1");
    expect(latest.nextOffset).toBe(1);
    const next = await client.versions({ package: name, version: "next", offset: latest.nextOffset ?? undefined, limit: 1 });
    expect(next.selected.version).toBe("2.0.0-beta.1");
    expect(next.versions[0].version).toBe("1.0.0");
    const old = await client.versions({ package: name, version: "0.9.0", offset: 2 });
    expect(old.selected.bundleDeclared).toBe(false);
    expect(old.selected.deprecated).toBe("Use 1.0.0");
    expect(old.nextOffset).toBeNull();
    await expect(client.versions({ package: name, version: "missing" })).rejects.toThrow(/not published/);
    await expect(client.versions({ package: name, version: "9.0.0" })).rejects.toThrow(/not published/);
  });

  it("invalid names, ranges and pagination fail before network access", async () => {
    const client = new PluginRegistry({
      fetcher: (() => { throw new Error("unexpected network"); }) as typeof fetch,
    });
    for (const bad of ["https://evil.invalid", "../file", "@scope/name@latest", "example?url=evil", "a\\b"]) {
      await expect(client.versions({ package: bad })).rejects.toThrow(/exact npm package name/);
    }
    for (const version of ["^1.0.0", "*", "../latest", ""]) {
      await expect(client.versions({ package: name, version })).rejects.toThrow(/version|Invalid/);
    }
    await expect(client.versions({ package: name, version: null as never })).rejects.toThrow(/version|Invalid/);
    for (const args of [
      { query: "  " },
      { query: "x", limit: 0 },
      { query: "x", offset: -1 },
      { query: "x", url: "https://evil.invalid" } as never,
    ]) {
      await expect(client.search(args)).rejects.toThrow(/blank|integer|Invalid/);
    }
  });

  it("registry errors and malformed identities never become an empty success", async () => {
    const cases: [() => Promise<Response>, RegExp][] = [
      [async () => new Response("not found", { status: 404 }), /HTTP 404/],
      [async () => new Response("<html>", { headers: { "content-type": "text/html" } }), /did not return JSON/],
      [async () => reply({ ...metadata(), name: "other" }), /Invalid npm package/],
      [async () => { const data = metadata(); (data.versions["1.0.0"] as Record<string, unknown>).name = "other"; return reply(data); }, /identity/],
      [async () => { throw new Error("offline"); }, /offline/],
    ];
    for (const [fetcher, expected] of cases) {
      await expect(new PluginRegistry({ fetcher: fetcher as typeof fetch }).versions({ package: name })).rejects.toThrow(expected);
    }
    await expect(new PluginRegistry({ fetcher: (async () => reply({ total: 0 })) as typeof fetch }).search({ query: "x", source: "npm" }))
      .rejects.toThrow(/Invalid npm search/);
  });

  it("oversized bodies are cancelled with and without content-length", async () => {
    for (const declared of [true, false]) {
      let cancelled = false;
      const body = new ReadableStream({
        pull(controller) { controller.enqueue(new Uint8Array(17 * 1024 * 1024)); },
        cancel() { cancelled = true; },
      });
      const headers: Record<string, string> = { "content-type": "application/json", ...(declared ? { "content-length": String(17 * 1024 * 1024) } : {}) };
      await expect(new PluginRegistry({ fetcher: (async () => new Response(body, { headers })) as typeof fetch }).versions({ package: name }))
        .rejects.toThrow(/16 MiB/);
      expect(cancelled).toBe(true);
    }
  });

  it("caller cancellation and plugin disposal abort registry requests", async () => {
    for (const stop of ["caller", "dispose"]) {
      let started!: () => void;
      const ready = new Promise<void>(resolve => { started = resolve; });
      const client = new PluginRegistry({
        fetcher: ((_url: string, options?: RequestInit) => new Promise<Response>((_resolve, reject) => {
          options?.signal?.addEventListener("abort", () => reject(options.signal?.reason), { once: true });
          started();
        })) as typeof fetch,
      });
      const caller = new AbortController();
      const pending = client.versions({ package: name }, caller.signal);
      const rejected = expect(pending).rejects.toThrow();
      await ready;
      if (stop === "caller") caller.abort(); else client.dispose();
      await rejected;
      client.dispose();
      await expect(client.search({ query: "x" })).rejects.toThrow();
    }
  });

  it("catalog searches Chinese and English, prioritizes exact names and reports its scope", async () => {
    const plugins = [
      { package: "@sample/dsh-memory", version: "1.0.0", title: { zh: "长期记忆", en: "Memory" }, summary: { zh: "跨会话记忆" } },
      { package: "@sample/dsh-theme", version: "1.0.0", title: { zh: "主题", en: "Theme" } },
    ];
    const client = new PluginRegistry({
      fetcher: (async (url: string | URL | Request) => {
        expect(String(url)).toBe("https://klarkxy.github.io/dsh-plugins/plugins.json");
        return reply({ generatedAt: "2026-09-27", plugins });
      }) as typeof fetch,
    });
    for (const query of ["记忆", "memory"]) {
      const result = await client.search({ query });
      expect(result.total).toBe(1);
      expect(result.results[0].name).toBe(plugins[0].package);
      expect(result.searchScope).toMatch(/not all npm/);
      expect((result as { catalogGeneratedAt: string | null }).catalogGeneratedAt).toBe("2026-09-27");
    }
    const exact = await client.search({ query: "@sample/dsh-theme", limit: 1 });
    expect(exact.results[0].name).toBe(plugins[1].package);
    expect(exact.nextOffset).toBe(1);
    expect((await client.search({ query: "no-such-capability" })).total).toBe(0);
    await expect(client.search({ query: "x", source: "other" })).rejects.toThrow(/catalog or npm/);
  });

  it("filtered npm pages advance by raw candidates even when none are DSH packages", async () => {
    const client = new PluginRegistry({
      fetcher: (async () => reply({
        total: 3,
        objects: [
          { package: { name: "unrelated", version: "1.0.0", keywords: ["memory"] } },
          { package: { name: "also-unrelated", version: "1.0.0" } },
        ],
      })) as typeof fetch,
    });
    const result = await client.search({ query: "memory", source: "npm", limit: 2 });
    expect(result.results).toEqual([]);
    expect(result.nextOffset).toBe(2);
  });

  it("an aborted response arriving after disposal is cancelled before being read", async () => {
    let finish!: (response: Response) => void;
    let start!: () => void;
    let cancelled = false;
    const ready = new Promise<void>(resolve => { start = resolve; });
    const client = new PluginRegistry({
      fetcher: (() => new Promise<Response>(resolve => { finish = resolve; start(); })) as typeof fetch,
    });
    const pending = client.versions({ package: name });
    const rejected = expect(pending).rejects.toThrow();
    await ready;
    client.dispose();
    finish(new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers: { "content-type": "application/json" } }));
    await rejected;
    expect(cancelled).toBe(true);
  });
});

describe("plugin registry tools", () => {
  it("expose the renamed pair, forward cancellation, and stop serving after disposal", async () => {
    const calls: unknown[][] = [];
    const client = new PluginRegistry({
      fetcher: ((_url: string, options?: RequestInit) => new Promise<Response>((_resolve, reject) => {
        options?.signal?.addEventListener("abort", () => reject(options.signal?.reason), { once: true });
      })) as typeof fetch,
    });
    const tools = registryTools(client);
    expect(tools.map(tool => tool.name)).toEqual(["dsh_plugins_search", "dsh_plugins_fetch"]);
    expect(tools[0].description).toContain("official plugin manager");
    expect(tools[1].description).toContain("github:owner/repo#commit");
    const signal = new AbortController().signal;
    const searchPending = tools[0].execute({ query: "x" } as never, { signal } as never);
    const fetchPending = tools[1].execute({ package: name } as never, { signal } as never);
    void searchPending.catch(() => undefined);
    void fetchPending.catch(() => undefined);
    client.dispose();
    await expect(searchPending).rejects.toThrow();
    await expect(fetchPending).rejects.toThrow();
    expect(calls).toEqual([]);
  });
});
