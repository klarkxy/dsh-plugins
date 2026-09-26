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
    expect(id).toBe("react");
    return React;
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
    ["zh-CN", "https://klarkxy.github.io/dsh-plugins/zh/index.html"],
    ["en", "https://klarkxy.github.io/dsh-plugins/index.html"],
  ])("opens the live Pages site for %s", (locale, url) => {
    const elements = descendants(loadBrowser(locale));
    const frame = elements.find(element => element.type === "iframe");
    expect(frame?.props.src).toBe(url);
    expect(frame?.props.sandbox).toBe("allow-same-origin allow-popups allow-popups-to-escape-sandbox");
    expect(elements.find(element => element.type === "a")?.props.href).toBe(url);
  });
});
