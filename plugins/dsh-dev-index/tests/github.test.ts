import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";
import { CliProcessError, runCli } from "@klarkxy/dsh-plugin-kit/cli-process";

import { findGh, parseGhVersion, probeGh, belowFloor } from "../src/gh.js";
import { GitHubClient, cleanPath, cleanRef, parseRepo } from "../src/github.js";
import { githubFetchTool } from "../src/github-tools.js";

const reply = (body: unknown, init?: { status?: number; headers?: Record<string, string> }) =>
  new Response(JSON.stringify(body), { status: init?.status ?? 200, headers: { "content-type": "application/json", ...init?.headers } });

const ghProbe = { executable: { command: "gh", displayPath: "gh" }, version: "2.65.0" };
const ghOk = (data: unknown) => ({ stdout: JSON.stringify(data), stderr: "", exitCode: 0 });
const sha = "a".repeat(40);

const repoFixture = {
  full_name: "sample/dsh-foo", description: "A plugin", homepage: "https://example.com",
  topics: ["dsh-plugin"], license: { spdx_id: "MIT" }, stargazers_count: 7,
  pushed_at: "2026-02-01", archived: false, disabled: false, default_branch: "main",
};
const commitFixture = { sha, commit: { committer: { date: "2026-02-02" } } };
const pkgFixture = {
  name: "@sample/dsh-foo", version: "1.2.3", description: "A plugin",
  engines: { dsh: ">=0.2.0" }, dsh: { bundle: { patch: "./cordis.patch.yml" } },
  dependencies: { helper: "^1.0.0" }, scripts: { prepare: "node scripts/prepare.mjs" }, license: "MIT",
};
const manifestFixture = { id: "@sample/dsh-foo", engines: { dsh: ">=0.2.0" }, contributes: { tools: ["dsh_foo"] } };
const contentsReply = (value: unknown) => ({ type: "file", encoding: "base64", content: Buffer.from(JSON.stringify(value)).toString("base64") });

const searchBody = {
  total_count: 2,
  items: [
    { full_name: "sample/dsh-memory", description: "Memory plugin", html_url: "https://github.com/sample/dsh-memory", topics: ["dsh-plugin"], homepage: "https://example.com", license: { spdx_id: "MIT" }, stargazers_count: 5, pushed_at: "2026-01-01", archived: false, default_branch: "main" },
    { full_name: "sample/unrelated", description: "Something else", topics: [] },
  ],
};

const noNetwork = {
  fetcher: (() => { throw new Error("unexpected network"); }) as typeof fetch,
  run: (() => { throw new Error("unexpected spawn"); }) as never,
};

describe("GitHub input validation", () => {
  it("accepts owner/repo, github.com URLs and github: specs", () => {
    expect(parseRepo("deepseek-ai/deepseek-harness")).toEqual({ owner: "deepseek-ai", name: "deepseek-harness" });
    expect(parseRepo("https://github.com/klarkxy/dsh-plugins")).toEqual({ owner: "klarkxy", name: "dsh-plugins" });
    expect(parseRepo("github:klarkxy/dsh-plugins")).toEqual({ owner: "klarkxy", name: "dsh-plugins" });
    expect(parseRepo("https://github.com/klarkxy/dsh-plugins.git")).toEqual({ owner: "klarkxy", name: "dsh-plugins" });
  });

  it("rejects foreign hosts, extra segments and traversal", () => {
    for (const bad of ["https://evil.example.com/a/b", "a/b/c", "..", "a/..", "", "https://github.com/a/b/tree/main", "a b/c"]) {
      expect(() => parseRepo(bad)).toThrow();
    }
  });

  it("cleans monorepo paths and refs", () => {
    expect(cleanPath(undefined)).toBe("");
    expect(cleanPath("/plugins/dsh-dev-index/")).toBe("plugins/dsh-dev-index");
    for (const bad of ["../etc", "a//b", "a/./b", "a\\b", "a b"]) expect(() => cleanPath(bad)).toThrow(/Invalid path/);
    expect(cleanRef(undefined)).toBeUndefined();
    expect(cleanRef("feature/x")).toBe("feature/x");
    for (const bad of ["", ".", "..", "a..b", "-x", "/main", "main/", "a b", "a@{b}", "v1."]) {
      expect(() => cleanRef(bad)).toThrow(/Invalid ref/);
    }
  });

  it("validates fetchPlugin input before any transport call", async () => {
    const client = new GitHubClient({ ...noNetwork, discover: async () => { throw new Error("unexpected probe"); } });
    await expect(client.fetchPlugin({ repo: "a/b/c" })).rejects.toThrow(/owner\/repo/);
    await expect(client.fetchPlugin({ repo: "a/b", path: "../x" })).rejects.toThrow(/Invalid path/);
    await expect(client.fetchPlugin({ repo: "a/b", ref: "a b" })).rejects.toThrow(/Invalid ref/);
    await expect(client.fetchPlugin({ repo: "a/b", extra: 1 } as never)).rejects.toThrow(/Invalid/);
    await expect(client.searchRepos({ query: "  " })).rejects.toThrow(/blank/);
    await expect(client.searchRepos({ query: "x", limit: 0 })).rejects.toThrow(/integer/);
  });
});

describe("gh CLI discovery", () => {
  it("parses gh versions and enforces the floor", () => {
    expect(parseGhVersion("gh version 2.65.0 (2026-01-01)")).toEqual([2, 65, 0]);
    expect(parseGhVersion("not gh")).toBeNull();
    expect(belowFloor([1, 9, 9])).toBe(true);
    expect(belowFloor([2, 0, 0])).toBe(false);
    expect(belowFloor([2, 65, 0])).toBe(false);
  });

  it("finds gh executables in PATH-style directories", async () => {
    const root = await mkdtemp(join(tmpdir(), "dsh-gh-bin-"));
    try {
      const empty = join(root, "empty");
      const bin = join(root, "bin");
      await mkdir(empty);
      await mkdir(bin);
      const file = process.platform === "win32" ? "gh.exe" : "gh";
      await writeFile(join(bin, file), "");
      expect(await findGh({ pathDirs: [empty] })).toBeNull();
      expect((await findGh({ pathDirs: [empty, bin] }))?.displayPath).toBe(join(bin, file));
      vi.stubEnv("GH_TOKEN", "fixture-gh-token");
      vi.stubEnv("DSH_PRIVATE_TEST", "private");
      try {
        const found = await findGh({ pathDirs: [bin] });
        expect(found?.env?.GH_TOKEN).toBe("fixture-gh-token");
        expect(found?.env).not.toHaveProperty("DSH_PRIVATE_TEST");
      } finally { vi.unstubAllEnvs(); }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("probes version and auth status by exit code", async () => {
    const root = await mkdtemp(join(tmpdir(), "dsh-gh-probe-"));
    try {
      await writeFile(join(root, process.platform === "win32" ? "gh.exe" : "gh"), "");
      const calls: string[][] = [];
      const run = (async (_exe: unknown, args: string[]) => {
        calls.push(args);
        if (args[0] === "--version") return { stdout: "gh version 2.65.0 (2026-01-01)", stderr: "", exitCode: 0 };
        return { stdout: "github.com logged in", stderr: "", exitCode: 0 };
      }) as never;
      const probe = await probeGh({ pathDirs: [root], run }, new AbortController().signal);
      expect(probe?.version).toBe("2.65.0");
      expect(calls).toEqual([["--version"], ["auth", "status", "--hostname", "github.com"]]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("returns null when gh is missing, stale or signed out", async () => {
    const root = await mkdtemp(join(tmpdir(), "dsh-gh-none-"));
    try {
      const signal = new AbortController().signal;
      expect(await probeGh({ pathDirs: [root] }, signal)).toBeNull();
      await writeFile(join(root, process.platform === "win32" ? "gh.exe" : "gh"), "");
      const stale = (async () => ({ stdout: "gh version 1.9.0", stderr: "", exitCode: 0 })) as never;
      expect(await probeGh({ pathDirs: [root], run: stale }, signal)).toBeNull();
      const signedOut = (async (_e: unknown, args: string[]) => args[0] === "--version"
        ? { stdout: "gh version 2.65.0", stderr: "", exitCode: 0 }
        : { stdout: "", stderr: "not logged in", exitCode: 1 }) as never;
      expect(await probeGh({ pathDirs: [root], run: signedOut }, signal)).toBeNull();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("GitHub repository search", () => {
  it("searches through gh with sanitized queries and DSH marker filtering", async () => {
    const calls: string[][] = [];
    const client = new GitHubClient({
      discover: async () => ghProbe,
      run: (async (_exe: unknown, args: string[]) => {
        calls.push(args);
        expect(args[0]).toBe("api");
        const url = new URL(`https://api.github.com/${args[1]}`);
        expect(url.pathname).toBe("/search/repositories");
        const q = url.searchParams.get("q") ?? "";
        expect(q).toContain("memory topic foo dsh in:name,description,topics");
        expect(q).not.toContain("topic:foo");
        expect(url.searchParams.get("per_page")).toBe("100");
        expect(url.searchParams.get("page")).toBe("1");
        return ghOk(searchBody);
      }) as never,
      fetcher: noNetwork.fetcher,
    });
    const result = await client.searchRepos({ query: "memory topic:foo", limit: 20 });
    expect(result.transport).toBe("gh");
    expect(result.results.map(item => item.name)).toEqual(["sample/dsh-memory"]);
    expect(result.results[0]).toMatchObject({ license: "MIT", stars: 5, archived: false, verification: "candidate-only" });
    expect(result.total).toBe(2);
    expect(result.nextOffset).toBeNull();
    expect(calls).toHaveLength(1);
  });

  it("paginates by raw candidates inside 100-result pages", async () => {
    const items = Array.from({ length: 100 }, (_value, index) => ({
      full_name: `sample/dsh-${index}`, description: "dsh plugin", topics: ["dsh-plugin"],
    }));
    const client = new GitHubClient({
      discover: async () => ghProbe,
      run: (async (_exe: unknown, args: string[]) => {
        const url = new URL(`https://api.github.com/${args[1]}`);
        expect(url.searchParams.get("page")).toBe("2");
        return ghOk({ total_count: 250, items });
      }) as never,
    });
    const result = await client.searchRepos({ query: "x", offset: 150, limit: 20 });
    expect(result.results[0].name).toBe("sample/dsh-50");
    expect(result.results).toHaveLength(20);
    expect(result.nextOffset).toBe(170);
  });

  it("falls back to anonymous REST without gh and constrains the request", async () => {
    const client = new GitHubClient({
      discover: async () => null,
      fetcher: (async (url: string | URL | Request, options?: RequestInit) => {
        expect(String(url)).toContain("https://api.github.com/search/repositories?q=");
        expect(options?.redirect).toBe("manual");
        expect(options?.credentials).toBe("omit");
        expect(options?.headers).toEqual({
          accept: "application/vnd.github+json",
          "user-agent": "dsh-dev-index",
          "x-github-api-version": "2022-11-28",
        });
        return reply(searchBody);
      }) as typeof fetch,
      run: noNetwork.run,
    });
    const result = await client.searchRepos({ query: "memory" });
    expect(result.transport).toBe("anonymous");
    expect(result.results).toHaveLength(1);
  });

  it("probes gh once per client lifetime", async () => {
    const discover = vi.fn(async () => ghProbe);
    const client = new GitHubClient({
      discover,
      run: (async () => ghOk({ total_count: 0, items: [] })) as never,
    });
    await client.searchRepos({ query: "a" });
    await client.searchRepos({ query: "b" });
    expect(discover).toHaveBeenCalledTimes(1);
  });

  it("re-probes after a negative result so a later gh login is discovered", async () => {
    // First probe finds no gh (anonymous); after "logging in", the next request
    // must re-probe instead of reusing the cached null forever.
    let authenticated = false;
    const discover = vi.fn(async () => (authenticated ? ghProbe : null));
    const run = vi.fn(async () => ghOk({ total_count: 0, items: [] }));
    const fetcher = vi.fn(async () => reply({ total_count: 0, items: [] }));
    const client = new GitHubClient({ discover, run: run as never, fetcher: fetcher as never });

    expect((await client.searchRepos({ query: "a" })).transport).toBe("anonymous");
    expect(discover).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledTimes(1);

    // The user installs / logs into gh between requests.
    authenticated = true;
    expect((await client.searchRepos({ query: "b" })).transport).toBe("gh");
    expect(discover).toHaveBeenCalledTimes(2); // null was not cached
    expect(fetcher).toHaveBeenCalledTimes(1); // no extra anonymous fallback
  });

  it("rejects a cancelled caller promptly while a peer probe keeps running", async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let discoverCalls = 0;
    let discoveryAborted = false;
    const discover = vi.fn(async (signal: AbortSignal) => {
      discoverCalls += 1;
      signal.addEventListener("abort", () => { discoveryAborted = true; }, { once: true });
      await gate;
      return ghProbe;
    });
    const run = vi.fn(async () => ghOk({ total_count: 0, items: [] }));
    const client = new GitHubClient({ discover, run: run as never });

    // Peer keeps the shared probe alive.
    const peer = client.searchRepos({ query: "peer" });
    const caller = new AbortController();
    const cancelled = client.searchRepos({ query: "cancelled" }, caller.signal);
    const rejected = expect(cancelled).rejects.toThrow();
    caller.abort();
    // Rejects on its own signal, without waiting for the probe gate to open.
    await rejected;
    expect(discoveryAborted).toBe(false); // peer still waiting

    release();
    expect((await peer).transport).toBe("gh");
    expect(discoverCalls).toBe(1); // the cancelled caller joined the same probe
  });

  it("aborts the shared probe once every consumer cancels", async () => {
    let discoveryAborted = false;
    const discover = vi.fn(async (signal: AbortSignal) => {
      signal.addEventListener("abort", () => { discoveryAborted = true; }, { once: true });
      await new Promise<void>(resolve => { signal.addEventListener("abort", () => resolve(), { once: true }); });
      return ghProbe;
    });
    const client = new GitHubClient({ discover, run: noNetwork.run });
    const first = new AbortController();
    const second = new AbortController();
    const a = client.searchRepos({ query: "a" }, first.signal);
    const b = client.searchRepos({ query: "b" }, second.signal);
    const rejectedA = expect(a).rejects.toThrow();
    const rejectedB = expect(b).rejects.toThrow();
    // Let the shared probe start before cancelling, so this exercises teardown
    // of a live probe rather than a pre-emptive abort that never spawns one.
    await vi.waitFor(() => expect(discover).toHaveBeenCalled());
    first.abort();
    second.abort();
    await Promise.all([rejectedA, rejectedB]);
    expect(discoveryAborted).toBe(true); // no live consumers left
  });

  it("waits for the final waiter's probe cleanup and disposal before settling", async () => {
    let release!: () => void;
    let probeSignal!: AbortSignal;
    const discover = vi.fn((signal: AbortSignal) => {
      probeSignal = signal;
      return new Promise<typeof ghProbe>(resolve => { release = () => resolve(ghProbe); });
    });
    const client = new GitHubClient({ discover, ...noNetwork });
    const caller = new AbortController();
    let settled = false;
    const request = client.searchRepos({ query: "a" }, caller.signal).catch(error => error).finally(() => { settled = true; });
    await vi.waitFor(() => expect(discover).toHaveBeenCalledOnce());
    caller.abort();
    await vi.waitFor(() => expect(probeSignal.aborted).toBe(true));
    let disposed = false;
    const disposal = client.dispose().then(() => { disposed = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(disposed).toBe(false);
    release();
    await request;
    await disposal;
    expect(disposed).toBe(true);
  });

  it("does not cache a probe that resolves in the same turn its last caller cancels", async () => {
    let release!: (value: typeof ghProbe | null) => void;
    const discover = vi.fn(() => new Promise<typeof ghProbe | null>(resolve => { release = resolve; }));
    const client = new GitHubClient({ discover, fetcher: (async () => reply({ total_count: 0, items: [] })) as typeof fetch, run: noNetwork.run });
    const caller = new AbortController();
    const first = client.searchRepos({ query: "a" }, caller.signal);
    const rejected = expect(first).rejects.toThrow();
    await vi.waitFor(() => expect(discover).toHaveBeenCalledOnce());
    release(ghProbe);
    caller.abort();
    await rejected;
    const next = client.searchRepos({ query: "b" });
    await vi.waitFor(() => expect(discover).toHaveBeenCalledTimes(2));
    release(null);
    expect((await next).transport).toBe("anonymous");
    await client.dispose();
  });

  it("awaits real runCli process exit during disposal", async () => {
    let started!: () => void;
    const ready = new Promise<void>(resolve => { started = resolve; });
    let exited = false;
    const client = new GitHubClient({
      discover: async () => ghProbe,
      run: (async (_executable, _args, options) => {
        try {
          return await runCli({ command: process.execPath, displayPath: "node" },
            ["-e", "console.log('ready');setInterval(()=>{},1000)"],
            { ...options, onLine: () => started() });
        } finally { exited = true; }
      }) as typeof runCli,
      fetcher: noNetwork.fetcher,
    });
    const request = client.searchRepos({ query: "a" });
    const rejected = expect(request).rejects.toThrow();
    await ready;
    await client.dispose();
    expect(exited).toBe(true);
    await rejected;
  });

  it("does not spawn discovery for an already-aborted caller", async () => {
    const discover = vi.fn(async () => ghProbe);
    const client = new GitHubClient({ discover, run: noNetwork.run, fetcher: noNetwork.fetcher });
    const caller = new AbortController();
    caller.abort();
    await expect(client.searchRepos({ query: "a" }, caller.signal)).rejects.toThrow();
    await expect(client.searchCode({ query: "a" }, caller.signal)).rejects.toThrow();
    expect(discover).not.toHaveBeenCalled();
  });

  it("aborts an in-flight probe on dispose and re-probes after cancellation", async () => {
    const probes: AbortSignal[] = [];
    // Each probe stays pending until aborted, except the last one which the test
    // lets resolve so a completed discovery is observed.
    const discover = vi.fn(async (signal: AbortSignal): Promise<typeof ghProbe | null> => {
      probes.push(signal);
      if (probes.length >= 3) return ghProbe; // final re-probe completes
      return new Promise<typeof ghProbe | null>((resolve) => {
        signal.addEventListener("abort", () => resolve(null), { once: true });
      });
    });
    const client = new GitHubClient({ discover, run: noNetwork.run });

    // Dispose cancels the shared probe so discovery does not dangle.
    const pending = client.searchRepos({ query: "a" });
    const rejected = expect(pending).rejects.toThrow();
    await vi.waitFor(() => expect(probes).toHaveLength(1));
    client.dispose();
    await rejected;
    expect(probes[0].aborted).toBe(true);

    // A client cancelled (not disposed) re-probes on the next request.
    const second = new GitHubClient({ discover, run: (async () => ghOk({ total_count: 0, items: [] })) as never });
    const caller = new AbortController();
    const first = second.searchRepos({ query: "a" }, caller.signal);
    const firstRejected = expect(first).rejects.toThrow();
    await vi.waitFor(() => expect(probes).toHaveLength(2));
    caller.abort();
    await firstRejected;
    expect(probes[1].aborted).toBe(true); // sole consumer left, probe cancelled
    expect((await second.searchRepos({ query: "b" })).transport).toBe("gh");
    expect(probes[2].aborted).toBe(false); // fresh probe ran to completion
  });

  it("does not let an abandoned probe's late result publish a positive cache", async () => {
    // Probe 1 is abandoned (its only waiter cancels) but ignores the abort and
    // resolves late with an authenticated gh. A newer probe reports no gh. The
    // stale probe must not publish into confirmedProbe.
    let resolveStale!: (value: typeof ghProbe) => void;
    const staleGate = new Promise<typeof ghProbe>(resolve => { resolveStale = resolve; });
    let probes = 0;
    const discover = vi.fn(async () => {
      probes += 1;
      return probes === 1 ? staleGate : null; // probe 1 late-resolves, probe 2 is null
    });
    const fetcher = vi.fn(async () => reply({ total_count: 0, items: [] }));
    const client = new GitHubClient({ discover, fetcher: fetcher as never, run: noNetwork.run });

    // First request starts probe 1; cancel it so the probe is abandoned.
    const caller = new AbortController();
    const first = client.searchRepos({ query: "a" }, caller.signal);
    const firstRejected = expect(first).rejects.toThrow();
    await vi.waitFor(() => expect(probes).toBe(1));
    caller.abort();
    // Probe 1 must release its real work before its final waiter settles.
    resolveStale(ghProbe);
    await firstRejected;
    await Promise.resolve();

    // The next request must still re-probe (stale result did not cache), and the
    // fresh probe reports no gh, so the answer stays anonymous.
    expect((await client.searchRepos({ query: "b" })).transport).toBe("anonymous");
    expect(probes).toBe(2);
    // The abandoned first request never reached HTTP; only the second did.
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("adds and removes its lifetime listener so repeated probes do not accumulate", async () => {
    const emptySearch = vi.fn(async () => reply({ total_count: 0, items: [] }));
    const client = new GitHubClient({ discover: async () => null, fetcher: emptySearch as never, run: noNetwork.run });
    const lifetime = (client as unknown as { lifetime: AbortController }).lifetime.signal;
    const add = vi.spyOn(lifetime, "addEventListener");
    const remove = vi.spyOn(lifetime, "removeEventListener");

    // Several negative probes in a row: each registers and then releases one
    // lifetime listener, so registrations must stay balanced.
    for (const query of ["a", "b", "c", "d"]) {
      await client.searchRepos({ query });
    }
    const adds = add.mock.calls.filter(([type]) => type === "abort").length;
    const removes = remove.mock.calls.filter(([type]) => type === "abort").length;
    expect(adds).toBe(4);
    expect(removes).toBe(4);

    // Abandoned probes (caller cancels mid-probe) must also release the listener.
    let started!: () => void;
    const ready = new Promise<void>(resolve => { started = resolve; });
    const discover = async (signal: AbortSignal) => {
      started();
      return new Promise<typeof ghProbe | null>(resolve => {
        signal.addEventListener("abort", () => resolve(null), { once: true });
      });
    };
    const second = new GitHubClient({ discover, fetcher: emptySearch as never, run: noNetwork.run });
    const secondLifetime = (second as unknown as { lifetime: AbortController }).lifetime.signal;
    const secondAdd = vi.spyOn(secondLifetime, "addEventListener");
    const secondRemove = vi.spyOn(secondLifetime, "removeEventListener");
    const caller = new AbortController();
    const pending = second.searchRepos({ query: "x" }, caller.signal);
    const rejected = expect(pending).rejects.toThrow();
    await ready;
    caller.abort();
    await rejected;
    const secondAdds = secondAdd.mock.calls.filter(([type]) => type === "abort").length;
    const addedHandlers = secondAdd.mock.calls.filter(([type]) => type === "abort").map(([, fn]) => fn);
    const removedHandlers = secondRemove.mock.calls.filter(([type]) => type === "abort").map(([, fn]) => fn);
    // Release is idempotent (abandon + settle both remove), so removals may
    // exceed adds; what must hold is that no registered handler is left behind.
    expect(secondAdds).toBe(1);
    expect(addedHandlers.every(fn => removedHandlers.includes(fn))).toBe(true);

    second.dispose();
  });

  it("releases the lifetime listener when discovery throws synchronously and retries next request", async () => {
    let attempts = 0;
    // The first discovery throws synchronously (not a rejected promise), which
    // used to escape startProbe before catch/finally could release the listener.
    const discover = vi.fn(() => {
      attempts += 1;
      if (attempts === 1) throw new Error("discovery exploded synchronously");
      return Promise.resolve(ghProbe);
    });
    const fetcher = vi.fn(async () => reply({ total_count: 0, items: [] }));
    const run = vi.fn(async () => ghOk({ total_count: 0, items: [] }));
    const client = new GitHubClient({ discover, fetcher: fetcher as never, run: run as never });
    const lifetime = (client as unknown as { lifetime: AbortController }).lifetime.signal;
    const add = vi.spyOn(lifetime, "addEventListener");
    const remove = vi.spyOn(lifetime, "removeEventListener");

    // A synchronous discovery throw degrades to anonymous access, it does not reject.
    expect((await client.searchRepos({ query: "a" })).transport).toBe("anonymous");
    expect(attempts).toBe(1);
    expect(fetcher).toHaveBeenCalledTimes(1);

    // The failed attempt left no listener behind, and the next request retries.
    const addedHandlers = add.mock.calls.filter(([type]) => type === "abort").map(([, fn]) => fn);
    const removedHandlers = remove.mock.calls.filter(([type]) => type === "abort").map(([, fn]) => fn);
    expect(addedHandlers).toHaveLength(1);
    expect(addedHandlers.every(fn => removedHandlers.includes(fn))).toBe(true);
    expect((await client.searchRepos({ query: "b" })).transport).toBe("gh");
    expect(attempts).toBe(2);
  });

  it("falls back when gh dies mid-session and re-probes next time", async () => {
    const discover = vi.fn(async () => ghProbe);
    const fetcher = vi.fn(async () => reply({ total_count: 0, items: [] }));
    const client = new GitHubClient({
      discover,
      fetcher: fetcher as never,
      run: (async () => { throw new CliProcessError("unavailable", "Unable to start the official CLI."); }) as never,
    });
    expect((await client.searchRepos({ query: "a" })).transport).toBe("anonymous");
    expect(fetcher).toHaveBeenCalledTimes(1);
    await client.searchRepos({ query: "b" });
    expect(discover).toHaveBeenCalledTimes(2);
  });

  it("classifies gh rate limits without falling back", async () => {
    const client = new GitHubClient({
      discover: async () => ghProbe,
      run: (async () => ({ stdout: "", stderr: "gh: API rate limit exceeded for user ID 1 (HTTP 403)", exitCode: 1 })) as never,
      fetcher: noNetwork.fetcher,
    });
    await expect(client.searchRepos({ query: "a" })).rejects.toThrow(/rate limit/);
  });

  it("maps anonymous REST errors to actionable messages", async () => {
    const cases: [() => Promise<Response>, RegExp][] = [
      [async () => new Response("x", { status: 404 }), /not found \(404\)/],
      [async () => new Response("x", { status: 403, headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "2000000000" } }), /rate limit reached; it resets at 2033-05-18/],
      [async () => new Response("x", { status: 403 }), /refused the request \(HTTP 403\)/],
      [async () => new Response("x", { status: 301, headers: { location: "https://api.github.com/repos/new-owner/new-name" } }), /moved to new-owner\/new-name/],
      [async () => new Response("x", { status: 302, headers: { location: "https://evil.example.com/track" } }), /unexpected redirect/],
      [async () => new Response("<html>", { headers: { "content-type": "text/html" } }), /did not return JSON/],
      [async () => reply({ nope: true }), /Invalid GitHub search response/],
      [async () => reply({ items: [], total_count: "many" }), /Invalid GitHub search response/],
    ];
    for (const [fetcher, expected] of cases) {
      const client = new GitHubClient({ discover: async () => null, fetcher: fetcher as typeof fetch });
      await expect(client.searchRepos({ query: "a" })).rejects.toThrow(expected);
    }
  });

  it("cancels oversized anonymous responses while streaming", async () => {
    let cancelled = false;
    const body = new ReadableStream({
      pull(controller) { controller.enqueue(new Uint8Array(17 * 1024 * 1024)); },
      cancel() { cancelled = true; },
    });
    const client = new GitHubClient({
      discover: async () => null,
      fetcher: (async () => new Response(body, { headers: { "content-type": "application/json" } })) as typeof fetch,
    });
    await expect(client.searchRepos({ query: "a" })).rejects.toThrow(/16 MiB/);
    expect(cancelled).toBe(true);
  });

  it("rejects invalid gh JSON output", async () => {
    const client = new GitHubClient({
      discover: async () => ghProbe,
      run: (async () => ({ stdout: "not json", stderr: "", exitCode: 0 })) as never,
    });
    await expect(client.searchRepos({ query: "a" })).rejects.toThrow(/invalid JSON/);
  });
});

describe("GitHub code search", () => {
  const codeBody = {
    total_count: 3,
    items: [
      { name: "dsh.plugin.json", path: "plugins/dsh-foo/dsh.plugin.json", html_url: "https://github.com/sample/mono/blob/main/plugins/dsh-foo/dsh.plugin.json", repository: { full_name: "sample/mono" } },
      { name: "dsh.plugin.json", path: "dsh.plugin.json", html_url: "https://github.com/sample/solo/blob/main/dsh.plugin.json", repository: { full_name: "sample/solo" } },
      // A superstring filename must not count as a manifest.
      { name: "xdsh.plugin.json", path: "sub/xdsh.plugin.json", html_url: "https://github.com/sample/fake/blob/main/sub/xdsh.plugin.json", repository: { full_name: "sample/fake" } },
    ],
  };

  it("maps manifests to install specs via gh", async () => {
    const client = new GitHubClient({
      discover: async () => ghProbe,
      run: (async (_exe: unknown, args: string[]) => {
        const url = new URL(`https://api.github.com/${args[1]}`);
        expect(url.pathname).toBe("/search/code");
        const q = url.searchParams.get("q") ?? "";
        expect(q).toContain("memory");
        expect(q).toContain("filename:dsh.plugin.json");
        return ghOk(codeBody);
      }) as never,
    });
    const result = await client.searchCode({ query: "memory" });
    expect(result.transport).toBe("gh");
    expect(result.results).toEqual([
      {
        repository: "sample/mono", manifestPath: "plugins/dsh-foo/dsh.plugin.json",
        url: "https://github.com/sample/mono/blob/main/plugins/dsh-foo/dsh.plugin.json",
        installSpec: "github:sample/mono#path:/plugins/dsh-foo",
        hint: "Resolve a pinned commit with dsh_github_fetch before installing.",
        verification: "candidate-only",
      },
      {
        repository: "sample/solo", manifestPath: "dsh.plugin.json",
        url: "https://github.com/sample/solo/blob/main/dsh.plugin.json",
        installSpec: "github:sample/solo",
        hint: "Resolve a pinned commit with dsh_github_fetch before installing.",
        verification: "candidate-only",
      },
    ]);
  });

  it("refuses code search without an authenticated gh", async () => {
    const client = new GitHubClient({ discover: async () => null, fetcher: noNetwork.fetcher });
    await expect(client.searchCode({ query: "memory" })).rejects.toThrow(/gh auth login/);
  });

  it("invalidates the cached probe when gh loses its login, so the next call re-probes", async () => {
    const discover = vi.fn(async () => ghProbe);
    const client = new GitHubClient({
      discover,
      run: (async () => ({ stdout: "", stderr: "gh: Requires authentication (HTTP 401)", exitCode: 1 })) as never,
      fetcher: (async () => reply({ total_count: 0, items: [] })) as typeof fetch,
    });
    await expect(client.searchCode({ query: "memory" })).rejects.toThrow(/not authenticated/);
    // The failed probe was discarded: the next call detects gh again instead of reusing it.
    await client.searchRepos({ query: "memory" });
    expect(discover).toHaveBeenCalledTimes(2);
  });
});

describe("GitHub plugin fetch", () => {
  const chain = (calls: string[], overrides: Record<string, unknown> = {}) => async (_exe: unknown, args: string[]) => {
    const path = args[1];
    calls.push(path);
    const routes: Record<string, unknown> = {
      "repos/sample/dsh-foo": repoFixture,
      [`repos/sample/dsh-foo/commits/main`]: commitFixture,
      [`repos/sample/dsh-foo/contents/package.json?ref=${sha}`]: contentsReply(pkgFixture),
      [`repos/sample/dsh-foo/contents/dsh.plugin.json?ref=${sha}`]: contentsReply(manifestFixture),
      ...overrides,
    };
    if (Object.hasOwn(routes, path)) return ghOk(routes[path]);
    throw new Error(`unexpected path ${path}`);
  };

  it("fetches metadata, resolves the default branch and reads manifests at that commit", async () => {
    const calls: string[] = [];
    const client = new GitHubClient({
      discover: async () => ghProbe,
      run: chain(calls) as never,
      fetcher: noNetwork.fetcher,
    });
    const result = await client.fetchPlugin({ repo: "https://github.com/sample/dsh-foo" });
    expect(calls.slice(0, 2)).toEqual(["repos/sample/dsh-foo", "repos/sample/dsh-foo/commits/main"]);
    expect(new Set(calls.slice(2))).toEqual(new Set([
      `repos/sample/dsh-foo/contents/package.json?ref=${sha}`,
      `repos/sample/dsh-foo/contents/dsh.plugin.json?ref=${sha}`,
    ]));
    expect(result.transport).toBe("gh");
    expect(result.repository).toMatchObject({ fullName: "sample/dsh-foo", renamedFrom: null, license: "MIT", archived: false });
    expect(result.resolved).toEqual({ requestedRef: null, ref: "main", sha, committedAt: "2026-02-02" });
    expect(result.package).toMatchObject({ name: "@sample/dsh-foo", bundleDeclared: true, hasPrepareScript: true });
    expect(result.package?.engines.dsh).toBe(">=0.2.0");
    expect(result.pluginManifest).toEqual({ id: "@sample/dsh-foo", engines: { dsh: ">=0.2.0" }, tools: ["dsh_foo"] });
    expect(result.install).toMatchObject({
      pinned: `github:sample/dsh-foo#${sha}`,
      latest: "github:sample/dsh-foo",
      requiresBuildAllowance: true,
    });
    expect(result.install.note).toContain("allowBuilds");
  });

  it("reads a monorepo subdirectory at a requested ref and builds the combined spec", async () => {
    const client = new GitHubClient({
      discover: async () => ghProbe,
      run: (async (_exe: unknown, args: string[]) => {
        const path = args[1];
        if (path === "repos/sample/mono") return ghOk({ ...repoFixture, full_name: "sample/mono" });
        if (path === "repos/sample/mono/commits/feature/x") return ghOk(commitFixture);
        if (path === `repos/sample/mono/contents/plugins/dsh-foo/package.json?ref=${sha}`) return ghOk(contentsReply(pkgFixture));
        if (path === `repos/sample/mono/contents/plugins/dsh-foo/dsh.plugin.json?ref=${sha}`) return ghOk(contentsReply(manifestFixture));
        throw new Error(`unexpected path ${path}`);
      }) as never,
    });
    const result = await client.fetchPlugin({ repo: "sample/mono", path: "/plugins/dsh-foo/", ref: "feature/x" });
    expect(result.resolved.requestedRef).toBe("feature/x");
    expect(result.install.pinned).toBe(`github:sample/mono#${sha}&path:/plugins/dsh-foo`);
    expect(result.install.latest).toBe("github:sample/mono#path:/plugins/dsh-foo");
  });

  it("reports absent manifests without failing", async () => {
    const client = new GitHubClient({
      discover: async () => ghProbe,
      run: (async (_exe: unknown, args: string[]) => {
        const path = args[1];
        if (path === "repos/sample/dsh-foo") return ghOk(repoFixture);
        if (path === "repos/sample/dsh-foo/commits/main") return ghOk(commitFixture);
        if (path.includes("/contents/")) return { stdout: "", stderr: "gh: Not Found (HTTP 404)", exitCode: 1 };
        throw new Error(`unexpected path ${path}`);
      }) as never,
    });
    const result = await client.fetchPlugin({ repo: "sample/dsh-foo" });
    expect(result.package).toBeNull();
    expect(result.pluginManifest).toBeNull();
    expect(result.install.requiresBuildAllowance).toBeNull();
  });

  it("adopts a repository rename followed by gh and reports it", async () => {
    const client = new GitHubClient({
      discover: async () => ghProbe,
      run: (async (_exe: unknown, args: string[]) => {
        const path = args[1];
        if (path === "repos/sample/old") return ghOk({ ...repoFixture, full_name: "sample/new" });
        if (path === "repos/sample/new/commits/main") return ghOk(commitFixture);
        if (path === `repos/sample/new/contents/package.json?ref=${sha}`) return ghOk(contentsReply(pkgFixture));
        if (path === `repos/sample/new/contents/dsh.plugin.json?ref=${sha}`) return ghOk(contentsReply(manifestFixture));
        throw new Error(`unexpected path ${path}`);
      }) as never,
    });
    const result = await client.fetchPlugin({ repo: "sample/old" });
    expect(result.repository.fullName).toBe("sample/new");
    expect(result.repository.renamedFrom).toBe("sample/old");
    expect(result.install.pinned).toBe(`github:sample/new#${sha}`);
  });

  it("rejects directory-shaped, oversized and default-branch-less responses", async () => {
    const routes: Record<string, unknown> = {
      "repos/sample/dsh-foo": repoFixture,
      [`repos/sample/dsh-foo/commits/main`]: commitFixture,
    };
    const client = new GitHubClient({
      discover: async () => ghProbe,
      run: (async (_exe: unknown, args: string[]) => {
        const path = args[1];
        if (Object.hasOwn(routes, path)) return ghOk(routes[path]);
        if (path.includes("/contents/")) return ghOk([{ type: "dir", name: "package.json" }]);
        throw new Error(`unexpected path ${path}`);
      }) as never,
    });
    await expect(client.fetchPlugin({ repo: "sample/dsh-foo" })).rejects.toThrow(/is a directory/);

    const noBranch = new GitHubClient({
      discover: async () => ghProbe,
      run: (async (_exe: unknown, args: string[]) => {
        if (args[1] === "repos/sample/dsh-foo") return ghOk({ ...repoFixture, default_branch: null });
        throw new Error(`unexpected path ${args[1]}`);
      }) as never,
    });
    await expect(noBranch.fetchPlugin({ repo: "sample/dsh-foo" })).rejects.toThrow(/no default branch/);

    const oversized = new GitHubClient({
      discover: async () => ghProbe,
      run: (async (_exe: unknown, args: string[]) => {
        const path = args[1];
        if (Object.hasOwn(routes, path)) return ghOk(routes[path]);
        if (path.includes("contents/package.json")) return ghOk({ type: "file", encoding: "none", content: "" });
        if (path.includes("contents/dsh.plugin.json")) return ghOk(contentsReply(manifestFixture));
        throw new Error(`unexpected path ${path}`);
      }) as never,
    });
    await expect(oversized.fetchPlugin({ repo: "sample/dsh-foo" })).rejects.toThrow(/1 MB inline/);
  });

  it("rejects an invalid commit identity", async () => {
    const client = new GitHubClient({
      discover: async () => ghProbe,
      run: (async (_exe: unknown, args: string[]) => {
        if (args[1] === "repos/sample/dsh-foo") return ghOk(repoFixture);
        if (args[1] === "repos/sample/dsh-foo/commits/main") return ghOk({ sha: "not-a-sha" });
        throw new Error(`unexpected path ${args[1]}`);
      }) as never,
    });
    await expect(client.fetchPlugin({ repo: "sample/dsh-foo" })).rejects.toThrow(/did not resolve/);
  });

  it("honours caller cancellation and disposal", async () => {
    for (const stop of ["caller", "dispose"]) {
      let started!: () => void;
      const ready = new Promise<void>(resolve => { started = resolve; });
      const client = new GitHubClient({
        discover: async () => ghProbe,
        run: ((_e: unknown, _a: string[], options: { signal: AbortSignal }) => new Promise((_resolve, reject) => {
          options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true });
          started();
        })) as never,
      });
      const caller = new AbortController();
      const pending = client.fetchPlugin({ repo: "sample/dsh-foo" }, caller.signal);
      const rejected = expect(pending).rejects.toThrow();
      await ready;
      if (stop === "caller") caller.abort(); else client.dispose();
      await rejected;
      client.dispose();
      await expect(client.searchRepos({ query: "x" })).rejects.toThrow();
    }
  });
});

describe("dsh_github_fetch tool", () => {
  it("exposes the tool contract and stops serving after disposal", async () => {
    const client = new GitHubClient({
      discover: async () => ghProbe,
      run: ((_e: unknown, _a: string[], options: { signal: AbortSignal }) => new Promise((_resolve, reject) => {
        options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true });
      })) as never,
    });
    const tool = githubFetchTool(client);
    expect(tool.name).toBe("dsh_github_fetch");
    expect(tool.description).toContain("official plugin manager");
    const pending = tool.execute({ repo: "sample/dsh-foo" } as never, { signal: new AbortController().signal } as never);
    void pending.catch(() => undefined);
    client.dispose();
    await expect(pending).rejects.toThrow();
  });
});
