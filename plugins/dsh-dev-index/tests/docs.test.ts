import { describe, expect, it, vi } from "vitest";
import { CACHE_TTL_MS, DOCS_INDEX, DOCS_ROOT, DocsClient, MAX_BYTES, docUrl, parseIndex } from "../src/docs.js";
import { docsTools } from "../src/docs-tools.js";

const index = [
  "# DeepSeek Harness",
  "- [开发插件](/deepseek-harness/develop/plugin.md): 基础",
  "- [Plugin lifecycle](/deepseek-harness/en/develop/plugin.md): Development",
  "- [Storage](/deepseek-harness/en/reference/storage.md): Persistence",
].join("\n");
const pageText = "# Plugin\n\nUse ctx.tools.register to register a tool.\n";
const response = (text: string) => new Response(text, { headers: { "content-type": "text/plain; charset=utf-8" } });
const signal = () => new AbortController().signal;
function fixture() {
  let now = 1_000_000;
  let catalog = index;
  let body = pageText;
  let failure = false;
  const fetcher = vi.fn<typeof fetch>(async (url, init) => {
    expect(init?.redirect).toBe("error");
    expect(init?.credentials).toBe("omit");
    expect(init).not.toHaveProperty("dispatcher");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    if (failure) return new Response("unavailable", { status: 503 });
    return response(String(url) === DOCS_INDEX ? catalog : body);
  });
  const client = new DocsClient({ fetcher, now: () => now });
  return { client, fetcher, advance: () => { now += CACHE_TTL_MS + 1; }, setCatalog: (s: string) => { catalog = s; }, setBody: (s: string) => { body = s; }, fail: () => { failure = true; } };
}

describe("official docs", () => {
  it("parses bilingual entries, ignores external and non-Markdown targets", () => {
    expect(parseIndex(index)).toHaveLength(3);
    expect(parseIndex(index)[1]).toMatchObject({ id: "en/develop/plugin.md", language: "en", url: DOCS_ROOT + "en/develop/plugin.md" });
    expect(parseIndex(index + "\n- [evil](https://evil.example/doc.md): no\n- [query](/deepseek-harness/doc.md?secret=x): no\n- [html](/deepseek-harness/doc.html): no")).toHaveLength(3);
    expect(() => parseIndex("<html>not the catalog</html>")).toThrow(/no usable/);
  });
  it.each(["../secret.md", "https://evil.example/x.md", "//evil.example/x.md", "a.md?x=1", "a.md#x", "%2e%2e/x.md", "a\\x.md", "a/./b.md"])("rejects non-document ID %s", id => {
    expect(() => docUrl(id)).toThrow(/Invalid/);
  });
  it("searches Chinese and English directory fields with explicit scope and bounded results", async () => {
    const { client } = fixture();
    const zh = await client.search({ query: "插件", language: "zh" }, signal());
    expect(zh.results.map(r => r.id)).toEqual(["develop/plugin.md"]);
    const en = await client.search({ query: "plugin", language: "en", limit: 1 }, signal());
    expect(en.results[0].title).toBe("Plugin lifecycle");
    expect(en.searchScope).toBe("directory");
    const empty = await client.search({ query: "unfindable" }, signal());
    expect(empty.results).toEqual([]);
    expect(empty.note).toContain("not full text");
    await expect(client.search({ query: " " }, signal())).rejects.toThrow(/query/);
    await expect(client.search({ query: "plugin", limit: 21 }, signal())).rejects.toThrow(/limit/);
  });
  it("expires and refreshes online data without silently returning stale content", async () => {
    const f = fixture();
    expect((await f.client.search({ query: "plugin" }, signal())).cached).toBe(false);
    expect((await f.client.search({ query: "plugin" }, signal())).cached).toBe(true);
    expect(f.fetcher).toHaveBeenCalledTimes(1);
    f.setCatalog(index.replace("Plugin lifecycle", "Plugin updated"));
    f.advance();
    expect((await f.client.search({ query: "updated" }, signal())).results[0].title).toBe("Plugin updated");
    f.fail(); f.advance();
    await expect(f.client.search({ query: "plugin" }, signal())).rejects.toThrow(/503/);
  });
  it("does not cache a malformed index and allows an explicit refresh", async () => {
    const f = fixture();
    await f.client.search({ query: "plugin" }, signal());
    f.setCatalog("broken");
    await expect(f.client.search({ query: "plugin", refresh: true }, signal())).rejects.toThrow(/no usable/);
    f.setCatalog(index.replace("Plugin lifecycle", "Plugin changed"));
    expect((await f.client.search({ query: "changed", refresh: true }, signal())).results[0].title).toBe("Plugin changed");
  });
  it("only fetches catalog members and returns source and revision with lossless continuation", async () => {
    const f = fixture();
    await expect(f.client.read({ id: "missing.md" }, signal())).rejects.toThrow(/not in/);
    expect(f.fetcher).toHaveBeenCalledTimes(1);
    const first = await f.client.read({ id: "develop/plugin.md", length: 10 }, signal());
    expect(first.url).toBe(DOCS_ROOT + "develop/plugin.md");
    expect(first.nextOffset).toBe(10);
    await expect(f.client.read({ id: first.id, offset: 10 }, signal())).rejects.toThrow(/revision/);
    const rest = await f.client.read({ id: first.id, offset: 10, revision: first.revision }, signal());
    expect(first.content + rest.content).toBe(pageText);
    expect(rest.nextOffset).toBeNull();
    f.setBody("Changed source"); f.advance();
    await expect(f.client.read({ id: first.id, offset: 10, revision: first.revision }, signal())).rejects.toThrow(/changed/);
  });
  it("rejects removed IDs even when a body is still cached", async () => {
    const f = fixture();
    await f.client.read({ id: "develop/plugin.md" }, signal());
    f.setCatalog("- [Storage](/deepseek-harness/en/reference/storage.md): Persistence");
    f.advance();
    await expect(f.client.read({ id: "develop/plugin.md" }, signal())).rejects.toThrow(/not in/);
  });
  it("rejects HTML and oversized streamed bodies", async () => {
    const html = new DocsClient({ fetcher: vi.fn(async () => new Response("<html>", { headers: { "content-type": "text/html" } })) });
    await expect(html.search({ query: "plugin" }, signal())).rejects.toThrow(/Expected official/);
    const large = new DocsClient({ fetcher: vi.fn(async () => response("x".repeat(MAX_BYTES + 1))) });
    await expect(large.search({ query: "plugin" }, signal())).rejects.toThrow(/2 MiB/);
  });
  it("forwards caller cancellation and aborts pending work on disposal", async () => {
    const fetcher: typeof fetch = (_url, init) => new Promise((_resolve, reject) => {
      init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason), { once: true });
    });
    const caller = new AbortController();
    const client = new DocsClient({ fetcher });
    const call = client.search({ query: "plugin" }, caller.signal);
    const rejected = expect(call).rejects.toMatchObject({ name: "AbortError" });
    caller.abort(); await rejected;
    const call2 = client.search({ query: "plugin" }, signal());
    const rejected2 = expect(call2).rejects.toMatchObject({ name: "AbortError" });
    await client.dispose(); await rejected2;
    await expect(client.search({ query: "plugin" }, signal())).rejects.toMatchObject({ name: "AbortError" });
  });
  it("defines real DSH tools with validated arguments and reference-only rendering", async () => {
    const f = fixture();
    const [search, read] = docsTools(f.client);
    const exec = { signal: signal() } as Parameters<typeof search.execute>[1];
    const result = await search.execute({ query: "plugin" }, exec);
    expect(search.output.render({}, result as never)[0]).toMatchObject({ type: "text", text: expect.stringContaining("untrusted reference data") });
    await expect(search.execute({ query: 123 }, exec)).rejects.toThrow();
    const doc = await read.execute({ id: "develop/plugin.md" }, exec);
    expect(doc).toMatchObject({ content: pageText, nextOffset: null });
  });
});
