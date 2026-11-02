type Scalar = string | number | boolean | null;
export type FrontmatterValue = Scalar | Scalar[] | Record<string, Scalar>[];
export type Frontmatter = Record<string, FrontmatterValue>;

function scalar(text: string): Scalar {
  const value = text.trim();
  if (value.startsWith('"')) {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== "string") throw new Error("Invalid quoted scalar");
    return parsed;
  }
  if (value.startsWith("'")) {
    if (!value.endsWith("'") || value.length < 2) throw new Error("Invalid quoted scalar");
    return value.slice(1, -1).replace(/''/g, "'");
  }
  if (value === "null" || value === "~") return null;
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) return Number(value);
  if (!value || /^(?:[\[\]{}]|[&*!|>@`])/.test(value)) throw new Error("Unsupported YAML scalar");
  return value.replace(/\s+#.*$/, "");
}

function pair(line: string): [string, string] {
  const match = /^([A-Za-z][\w-]*):(?:\s+(.*)|\s*)$/.exec(line);
  if (!match || !match[1]) throw new Error(`Invalid frontmatter line: ${line}`);
  return [match[1], match[2] ?? ""];
}

function inlineList(value: string): Scalar[] {
  if (!value.endsWith("]")) throw new Error("Invalid inline list");
  const input = value.slice(1, -1);
  const items: Scalar[] = [];
  let start = 0;
  let quote = "";
  for (let i = 0; i < input.length; i++) {
    const char = input[i]!;
    if (quote === '"' && char === "\\") { i++; continue; }
    if (quote === "'" && char === "'" && input[i + 1] === "'") { i++; continue; }
    if (quote && char === quote) quote = "";
    else if (!quote && (char === '"' || char === "'")) quote = char;
    else if (!quote && char === ",") { items.push(scalar(input.slice(start, i))); start = i + 1; }
  }
  if (quote) throw new Error("Invalid inline list");
  if (input.slice(start).trim()) items.push(scalar(input.slice(start)));
  else if (items.length) throw new Error("Invalid inline list");
  return items;
}

export function parseFrontmatter(markdown: string): { attributes: Frontmatter; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(markdown);
  if (!match || match[1] === undefined) throw new Error("Missing frontmatter");
  const lines = match[1].split(/\r?\n/);
  const attributes: Frontmatter = {};
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const [key, value] = pair(line);
    if (Object.hasOwn(attributes, key)) throw new Error(`Duplicate field: ${key}`);
    if (value === "[]") { attributes[key] = []; continue; }
    if (value.startsWith("[")) {
      attributes[key] = inlineList(value);
      continue;
    }
    if (value) { attributes[key] = scalar(value); continue; }
    const items: Scalar[] | Record<string, Scalar>[] = [];
    while (i + 1 < lines.length && /^  - /.test(lines[i + 1]!)) {
      const item = lines[++i]!.slice(4);
      if (/^[A-Za-z][\w-]*:/.test(item)) {
        const object: Record<string, Scalar> = {};
        const [itemKey, itemValue] = pair(item);
        object[itemKey] = scalar(itemValue);
        while (i + 1 < lines.length && /^    [A-Za-z]/.test(lines[i + 1]!)) {
          const [field, fieldValue] = pair(lines[++i]!.slice(4));
          if (Object.hasOwn(object, field)) throw new Error(`Duplicate field: ${field}`);
          object[field] = scalar(fieldValue);
        }
        (items as Record<string, Scalar>[]).push(object);
      } else {
        (items as Scalar[]).push(scalar(item));
      }
    }
    attributes[key] = items;
  }
  return { attributes, body: markdown.slice(match[0].length) };
}

function formatScalar(value: Scalar): string {
  return typeof value === "string" ? JSON.stringify(value) : String(value);
}

export function stringifyFrontmatter(attributes: Frontmatter, body = ""): string {
  const lines = ["---"];
  for (const [key, value] of Object.entries(attributes)) {
    if (!Array.isArray(value)) { lines.push(`${key}: ${formatScalar(value)}`); continue; }
    if (!value.length) { lines.push(`${key}: []`); continue; }
    lines.push(`${key}:`);
    for (const item of value) {
      if (item !== null && typeof item === "object") {
        const fields = Object.entries(item);
        fields.forEach(([field, fieldValue], index) => lines.push(`${index ? "    " : "  - "}${field}: ${formatScalar(fieldValue)}`));
      } else lines.push(`  - ${formatScalar(item)}`);
    }
  }
  return `${lines.join("\n")}\n---\n${body}`;
}
