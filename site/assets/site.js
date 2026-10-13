// Progressive enhancement only: copy buttons, the catalog filter and the
// category pills. Pages work without it.
(() => {
  const zh = document.documentElement.lang.startsWith("zh");
  const live = document.createElement("div");
  live.className = "sr-only";
  live.setAttribute("aria-live", "polite");
  document.body.append(live);

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      const area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.append(area);
      area.select();
      const ok = document.execCommand("copy");
      area.remove();
      return ok;
    }
  }

  function bindCopy(button, getText) {
    const label = button.textContent;
    const done = button.dataset.done || (zh ? "已复制" : "Copied");
    let timer;
    button.addEventListener("click", async () => {
      const ok = await copyText(getText());
      button.textContent = ok ? done : label;
      button.classList.toggle("done", ok);
      live.textContent = ok ? done : zh ? "复制失败，请手动选择文本" : "Copy failed; select the text manually";
      clearTimeout(timer);
      timer = setTimeout(() => {
        button.textContent = label;
        button.classList.remove("done");
      }, 1800);
    });
  }

  for (const button of document.querySelectorAll("button.copy[data-copy]")) bindCopy(button, () => button.dataset.copy);

  // Copy buttons for README code blocks.
  for (const pre of document.querySelectorAll(".readme pre")) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "copy";
    button.textContent = zh ? "复制" : "Copy";
    pre.append(button);
    bindCopy(button, () => pre.querySelector("code")?.textContent ?? "");
  }

  // Catalog: text filter + category pills work together.
  const filter = document.querySelector(".filter");
  const input = document.getElementById("filter");
  if (!filter || !input) return;
  filter.hidden = false;
  const rows = [...document.querySelectorAll(".row[data-search]")];
  const shelves = [...document.querySelectorAll(".shelf")];
  const pills = [...document.querySelectorAll(".catnav a[data-category]")];
  const count = filter.querySelector(".count");
  const empty = document.querySelector(".empty");
  let category = "";

  function apply() {
    const words = input.value.toLowerCase().split(/\s+/).filter(Boolean);
    let shown = 0;
    for (const row of rows) {
      const match = (!category || row.dataset.category === category) && words.every((w) => row.dataset.search.includes(w));
      row.hidden = !match;
      if (match) shown++;
    }
    for (const shelf of shelves) shelf.hidden = !shelf.querySelector(".row:not([hidden])");
    for (const pill of pills) pill.setAttribute("aria-current", String(pill.dataset.category === category));
    count.textContent = shown === 1 ? count.dataset.single : count.dataset.template.replace("{n}", String(shown));
    empty.hidden = shown > 0;
  }

  input.addEventListener("input", apply);
  input.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && input.value) {
      input.value = "";
      apply();
    }
  });

  for (const pill of pills) {
    pill.addEventListener("click", (event) => {
      event.preventDefault();
      const next = pill.dataset.category;
      category = category === next ? "" : next;
      apply();
      if (category) document.getElementById(`cat-${category}`)?.scrollIntoView({ block: "start" });
    });
  }

  // "/" focuses the filter, like most dev-tool sites.
  document.addEventListener("keydown", (event) => {
    if (event.key !== "/" || event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
    event.preventDefault();
    input.focus();
  });
})();
