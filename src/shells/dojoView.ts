export function renderDojoAlignment(target: string, matched: readonly string[]): string {
  const escape = (text: string): string => text.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
  const pattern = /[\p{Script=Latin}0-9][\p{Script=Latin}\p{M}0-9]*(?:['’][\p{Script=Latin}0-9][\p{Script=Latin}\p{M}0-9]*)*/gu;
  let offset = 0, index = 0, html = "";
  for (const match of target.matchAll(pattern)) {
    html += escape(target.slice(offset, match.index));
    const token = match[0];
    if (index < matched.length && token === matched[index]) { html += escape(token); index++; }
    else html += `<mark>${escape(token)}</mark>`;
    offset = match.index + token.length;
  }
  return html + escape(target.slice(offset));
}

export function visibleDojoTarget(article: HTMLElement, reader: HTMLElement, file: string): { file: string; locator: string; quote: string } | null {
  const chapters = Array.from(article.querySelectorAll<HTMLElement>(":scope > .pith-epub-chapter"));
  const candidates = chapters.length ? chapters : [article];
  const viewport = reader.getBoundingClientRect();
  for (const chapter of candidates) {
    const blocks = Array.from(chapter.querySelectorAll<HTMLElement>('[data-prose="true"]'));
    const visible = blocks.some(block => Array.from(block.getClientRects()).some(rect => rect.right > viewport.left && rect.left < viewport.right && rect.bottom > viewport.top && rect.top < viewport.bottom));
    if (!visible || !blocks.length) continue;
    const block = blocks[0]!;
    const copy = block.cloneNode(true) as HTMLElement;
    for (const child of copy.querySelectorAll(".pith-interline-subtitle,time")) child.remove();
    const quote = (copy.textContent ?? "").trim();
    if (!quote) continue;
    const range = article.ownerDocument.createRange(); range.selectNodeContents(article); range.setEndBefore(block);
    return { file, locator: block.dataset.locator || `text:offset:${range.toString().length}`, quote };
  }
  return null;
}

export function practiceMessage(text: string, label: string, rubric: string): string {
  return `PITH_PRACTICE:${JSON.stringify({ id: "feynman", label, rubric, text })}`;
}

export function displayPracticeMessage(text: string): string {
  if (!text.startsWith("PITH_PRACTICE:")) return text;
  try {
    const value: unknown = JSON.parse(text.slice("PITH_PRACTICE:".length));
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const record = value as Record<string, unknown>;
      if (record.id === "feynman" && typeof record.text === "string") return record.text;
    }
  } catch { return text; }
  return text;
}
