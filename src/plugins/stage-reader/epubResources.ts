export const escapeHtml = (s: string): string => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function resolveEpubPath(base: string, href: string): string {
  const raw = decodeURIComponent(href.split("#")[0]!.split("?")[0]!);
  if (!raw || raw.startsWith("/") || raw.includes("\\") || /[\u0000-\u001f\u007f]/.test(raw) || /^[a-z][a-z\d+.-]*:/i.test(raw)) throw new Error("Invalid EPUB path");
  const parts = base ? base.split("/") : [];
  for (const part of raw.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") { if (!parts.length) throw new Error("EPUB path traversal"); parts.pop(); }
    else parts.push(part);
  }
  return parts.join("/");
}

export const directoryOf = (path: string): string => path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";

const imageTypes: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", avif: "image/avif" };
export async function imageDataUrl(path: string, read: (path: string) => Promise<Uint8Array>, svg: (bytes: Uint8Array) => Promise<Uint8Array>, reserve: (length: number) => void): Promise<string | null> {
  const extension = path.split(".").at(-1)!.toLowerCase();
  const type = extension === "svg" ? "image/svg+xml" : imageTypes[extension];
  if (!type) return null;
  const original = await read(path), bytes = extension === "svg" ? await svg(original) : original;
  const prefix = `data:${type};base64,`;
  reserve(prefix.length + Math.ceil(bytes.length / 3) * 4);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `${prefix}${btoa(binary)}`;
}

const cssProperties = new Set(["color", "background-color", "font-family", "font-size", "font-style", "font-weight", "line-height", "text-align", "text-decoration", "text-indent", "vertical-align", "white-space", "margin", "margin-top", "margin-bottom", "margin-left", "margin-right", "padding", "padding-top", "padding-bottom", "padding-left", "padding-right", "width", "height", "max-width", "max-height", "display", "border", "border-color", "border-style", "border-width", "border-collapse", "page-break-before", "page-break-after", "break-before", "break-after"]);
export function sanitizeDeclarations(css: string): string {
  return css.split(";").flatMap(declaration => {
    const colon = declaration.indexOf(":");
    if (colon < 0) return [];
    const name = declaration.slice(0, colon).trim().toLowerCase(), value = declaration.slice(colon + 1).trim();
    if (!cssProperties.has(name) || !value || !/^[\w\s#.,%()'"+\-/]*$/.test(value) || /(?:url|expression|var|attr|image|javascript|behavior)\s*\(/i.test(value)) return [];
    return [`${name}: ${value}`];
  }).join("; ");
}

export function sanitizeStylesheet(css: string, chapter: number, limit = Number.POSITIVE_INFINITY): string {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const rules: string[] = [];
  let length = 0;
  for (const match of clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = match[1]!.trim();
    if (!selectors || !/^[\w\s.#>+~,\-*]+$/.test(selectors) || selectors.split(",").some(selector => !/^[\w.#*]/.test(selector.trim()))) continue;
    const declarations = sanitizeDeclarations(match[2]!);
    if (!declarations) continue;
    const root = `.pith-epub-chapter-${chapter}`;
    const scopedSelectors: string[] = [];
    let selectorLength = 0;
    for (const selector of selectors.split(",")) {
      const value = selector.trim();
      const body = /^(?:html(?:\s*>\s*|\s+))?body(?=$|[\s.#>+~])/.exec(value);
      const rest = body ? value.slice(body[0].length) : "";
      if (body && /^(?:[.#][\w-]+)*\s*[+~]/.test(rest)) continue;
      const scopedSelector = body ? `${root}${rest}` : `${root} ${value}`;
      selectorLength += scopedSelector.length + (scopedSelectors.length ? 2 : 0);
      if (selectorLength > limit - length) throw new Error("EPUB output budget exceeded");
      scopedSelectors.push(scopedSelector);
    }
    if (!scopedSelectors.length) continue;
    length += selectorLength + declarations.length + 5 + (rules.length ? 1 : 0);
    if (length > limit) throw new Error("EPUB output budget exceeded");
    const scoped = scopedSelectors.join(", ");
    rules.push(`${scoped} { ${declarations} }`);
  }
  return rules.join("\n");
}
