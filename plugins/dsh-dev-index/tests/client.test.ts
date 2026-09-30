import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("../client.js", import.meta.url), "utf8");

function loadBrowser(active: string) {
  let definition: { id: string; factory: (require: (id: string) => unknown) => unknown } | undefined;
  runInNewContext(source, {
    window: { __ModuleLoader__: { load(value: typeof definition) { definition = value; } } },
  });
  expect(definition?.id).toBe("@klarkxy/dsh-dev-index");
  const React = {
    createElement: (type: unknown, props: Record<string, unknown> | null, ...children: unknown[]) => ({
      type, props: { ...props, children },
    }),
    useState: (initial: unknown) => [typeof initial === "function" ? (initial as () => unknown)() : initial, () => {}],
    useEffect: () => {},
  };
  const client = definition!.factory((id: string) => {
    /* The host resolves its own modules by id: React here, and the shared
     * control primitives as a named placeholder the test never renders. */
    if (id === "react") return React;
    if (id === "@deepseek-ai/dsh-client-ui-primitives") return { Button: () => null, SegmentedTabs: () => null };
    throw new Error(`unexpected host module: ${id}`);
  }) as {
    inject: string[];
    apply: (ctx: unknown) => void;
  };
  let component: (() => unknown) | undefined;
  let options: Record<string, unknown> | undefined;
  client.apply({
    locale: { getSnapshot: () => ({ active }), subscribe: () => () => {} },
    slots: {
      inject: (name: string, register: () => unknown) => {
        expect(name).toBe("plugins.bundle.config");
        register();
      },
      register: (input: Record<string, unknown>, view: () => unknown) => {
        options = input;
        component = view;
      },
    },
  });
  expect(client.inject).toEqual(["slots", "locale"]);
  expect(options).toEqual({ name: "plugins.bundle.config", key: "@klarkxy/dsh-dev-index" });
  const wrapper = component!() as { type: (props: unknown) => unknown; props: unknown };
  return wrapper.type(wrapper.props);
}

function descendants(node: unknown): Array<{ type: unknown; props: Record<string, unknown> }> {
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as { type: unknown; props: Record<string, unknown> };
  return [element, ...((element.props.children as unknown[]) ?? []).flatMap(descendants)];
}

describe("Plugins page documentation browser", () => {
  it.each([
    ["zh-CN", "https://deepseek-harness.github.io/deepseek-harness/"],
    ["en", "https://deepseek-harness.github.io/deepseek-harness/en/"],
  ])("opens the live Pages site for %s", (locale, url) => {
    const elements = descendants(loadBrowser(locale));
    const frame = elements.find(element => element.type === "iframe");
    expect(frame?.props.src).toBe(url);
    expect(frame?.props.sandbox).toBe("allow-same-origin allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox");
    expect(elements.find(element => element.type === "a")?.props.href).toBe(url);
  });

  it("offers the language as focusable tabs and hides the fallback banner while loading", () => {
    const elements = descendants(loadBrowser("en"));
    const tabs = elements.find(element => Array.isArray(element.props.items));
    expect(tabs?.props.value).toBe("en");
    expect((tabs?.props.items as Array<{ value: string }>).map(item => item.value)).toEqual(["zh", "en"]);
    expect(elements.some(element => element.props.disabled === true)).toBe(false);
    expect(elements.some(element => element.props.className === "dsh-ui-banner")).toBe(false);
    expect(elements.find(element => element.props.role === "status")?.props.children).toEqual(["Loading documentation…"]);
  });

  it("does not hard-code page spacing or stack two viewport heights", () => {
    expect(source).not.toMatch(/margin-top:\s*20px/);
    expect(source).not.toMatch(/min-height:\s*420px/);
    expect(source).toMatch(/LOAD_TIMEOUT_MS/);
  });

  it("requires only host modules the package declares in dsh.client.inject", () => {
    const manifest = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as { dsh: { client: { inject: string[] } } };
    const ids = [...new Set(Array.from(source.matchAll(/require\('([^']+)'\)/g), match => match[1]))];
    expect(ids.sort()).toEqual(["@deepseek-ai/dsh-client-ui-primitives", "react"]);
    for (const id of ids) {
      // React is the one module every client half gets; the rest is what
      // decides what the host puts in its module table.
      if (id === "react") continue;
      expect(manifest.dsh.client.inject).toContain(id);
    }
  });
});
