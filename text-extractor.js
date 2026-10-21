(() => {
  "use strict";
  const TEXT_EXTENSIONS = new Set(["txt", "md", "markdown", "html", "htm", "csv", "json", "xml"]);
  const extension = name => (String(name).includes(".") ? String(name).split(".").pop() : "").toLowerCase();
  function supports(name) { return TEXT_EXTENSIONS.has(extension(name)); }
  async function extract(file) {
    const ext = extension(file.name);
    if (ext === "pdf") return { text: "", status: "pending" };
    if (!TEXT_EXTENSIONS.has(ext)) return { text: "", status: "unsupported" };
    try {
      const source = await file.text();
      let text = source;
      if (ext === "html" || ext === "htm") {
        const parsed = new DOMParser().parseFromString(source, "text/html");
        parsed.querySelectorAll("script, style, noscript, template, svg").forEach(node => node.remove());
        text = parsed.body ? (parsed.body.innerText || parsed.body.textContent || "") : "";
      }
      text = String(text).replace(/\u0000/g, "").replace(/[ \t]+\n/g, "\n").trim();
      return { text, status: text ? "ready" : "empty" };
    } catch (error) { return { text: "", status: "error" }; }
  }
  window.PRLTextExtractor = { supports, extract };
})();