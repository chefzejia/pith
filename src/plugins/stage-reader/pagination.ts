import type { PaginationMetrics, ReaderSectionHeading, ResponsiveLayoutDecision, StageReaderService } from "../../core/index.ts";

type ColumnMode = "auto" | "single" | "double" | "triple";

export function readerPageIndex(reader: HTMLElement): number {
  const width = Math.max(1, reader.clientWidth), total = Math.max(1, Math.ceil(reader.scrollWidth / width));
  const max = Math.max(0, reader.scrollWidth - width);
  return max > 0 && reader.scrollLeft >= max - 0.5 ? total - 1 : Math.max(0, Math.min(total - 1, Math.round(reader.scrollLeft / width)));
}

export function resolveResponsiveLayout(input: Parameters<NonNullable<StageReaderService["resolveResponsiveLayout"]>>[0]): ResponsiveLayoutDecision {
  const { width, height, guideOpen = false, guideWidthPx = 320, preferredColumns = "single", coarsePointer = false } = input;
  const aspectRatio = width / Math.max(1, height);
  const formFactor = aspectRatio < .85 || width < 600 ? "portrait-phone" : height < 480 ? "landscape-phone" : aspectRatio < 1.18 && width < 960 ? "foldable-square" : "tablet-desktop";
  const canSplitGuide = width >= 420 + guideWidthPx && aspectRatio >= .85 && height >= 480;
  const sheetMode = canSplitGuide ? "split-right" : aspectRatio < .85 || width < 600 ? "bottom-sheet" : "overlay-drawer";
  const stageWidthPx = guideOpen && canSplitGuide ? Math.max(1, width - guideWidthPx) : width;
  const readerWidth = Math.max(0, input.readerWidthPx ?? stageWidthPx);
  const fits = (columns: number) => readerWidth / columns - 2 * Math.min(48, Math.max(16, readerWidth * .05), readerWidth / (columns * 4)) >= 320;
  const maxColumns: 1 | 2 | 3 = fits(3) ? 3 : fits(2) ? 2 : 1;
  const canDoubleColumn = maxColumns >= 2;
  const requested = preferredColumns === "triple" ? 3 : preferredColumns === "double" || preferredColumns === "auto" ? 2 : 1;
  const effectiveColumns = Math.min(maxColumns, requested) as 1 | 2 | 3;
  const hitTargetPx = coarsePointer || formFactor === "portrait-phone" || formFactor === "landscape-phone" ? 44 : 34;
  return { formFactor, aspectRatio, canSplitGuide, sheetMode, stageWidthPx, canDoubleColumn, maxColumns, effectiveColumns, hitTargetPx };
}

export function computePagination(viewportWidth: number, viewportHeight: number, scrollWidth: number, mode: ColumnMode = "auto"): PaginationMetrics {
  const columns = mode === "triple" ? 3 : mode === "double" || (mode === "auto" && viewportWidth >= 900) ? 2 : 1;
  const baseInset = Math.min(48, Math.max(16, viewportWidth * 0.05), viewportWidth / (columns * 4));
  const maxColumnWidth = columns === 1 ? 820 : columns === 2 ? 680 : 580;
  const horizontalInsetPx = Math.max(baseInset, (viewportWidth / columns - maxColumnWidth) / 2);
  const verticalInsetPx = Math.min(32, Math.max(12, viewportHeight * 0.05));
  return {
    columns,
    horizontalInsetPx,
    verticalInsetPx,
    columnWidthPx: Math.max(1, viewportWidth / columns - 2 * horizontalInsetPx),
    columnGapPx: 2 * horizontalInsetPx,
    contentHeightPx: Math.max(1, viewportHeight - 2 * verticalInsetPx),
    totalScreens: Math.max(1, Math.ceil((Math.max(viewportWidth, scrollWidth) - 1) / Math.max(1, viewportWidth))),
  };
}

export function applyPaginationStyles(viewport: HTMLElement, body: HTMLElement, mode: ColumnMode = "auto", onMediaLoad?: () => void): PaginationMetrics {
  const width = viewport.clientWidth, height = viewport.clientHeight;
  const metrics = computePagination(width, height, width, mode);
  body.style.boxSizing = "border-box";
  body.style.width = `${width}px`;
  body.style.height = `${height}px`;
  body.style.padding = `${metrics.verticalInsetPx}px ${metrics.horizontalInsetPx}px`;
  body.style.columnWidth = `${metrics.columnWidthPx}px`;
  body.style.columnGap = `${metrics.columnGapPx}px`;
  body.style.columnFill = "auto";
  body.style.setProperty("--pith-page-height", `${metrics.contentHeightPx}px`);
  const win = body.ownerDocument.defaultView;
  for (const media of body.querySelectorAll<HTMLElement>("img, svg, math, figure")) {
    const style = win?.getComputedStyle(media);
    const margins = (parseFloat(style?.marginTop ?? "0") || 0) + (parseFloat(style?.marginBottom ?? "0") || 0);
    media.style.setProperty("--pith-page-media-height", `${Math.max(1, metrics.contentHeightPx - margins)}px`);
    if (media.tagName.toLowerCase() === "img" && !(media as HTMLImageElement).complete && onMediaLoad) {
      media.removeEventListener("load", onMediaLoad);
      media.addEventListener("load", onMediaLoad, { once: true });
    }
  }
  for (const figure of body.querySelectorAll<HTMLElement>("figure")) {
    if (figure.querySelector(".pith-pdf-page")) continue;
    const media = Array.from(figure.querySelectorAll<HTMLElement>("img, svg, math"));
    if (!media.length) continue;
    for (const item of media) item.style.setProperty("--pith-page-media-height", "1px");
    const figureStyle = win?.getComputedStyle(figure);
    const margins = (parseFloat(figureStyle?.marginTop ?? "0") || 0) + (parseFloat(figureStyle?.marginBottom ?? "0") || 0);
    const mediaHeight = media.reduce((sum, item) => sum + item.getBoundingClientRect().height, 0);
    const available = Math.max(1, (metrics.contentHeightPx - margins - figure.getBoundingClientRect().height + mediaHeight) / media.length);
    for (const item of media) item.style.setProperty("--pith-page-media-height", `${available}px`);
  }
  viewport.style.overflowX = "hidden";
  viewport.style.overflowY = "hidden";
  viewport.style.removeProperty("--pith-page-scroll-extent");
  const result = computePagination(width, height, viewport.scrollWidth, mode);
  viewport.style.setProperty("--pith-page-scroll-extent", `${Math.max(0, result.totalScreens * width - 1)}px`);
  return result;
}
export type ReaderPosition = { readonly node: Text; readonly offset: number; readonly locator: string; readonly block: HTMLElement; readonly textOffset: number } | { readonly node: Element; readonly locator: string; readonly block: HTMLElement };

export function captureReaderPosition(reader: HTMLElement, article: HTMLElement): ReaderPosition | null {
  const viewport = reader.getBoundingClientRect(), doc = article.ownerDocument;
  const walker = doc.createTreeWalker(article, 5), range = doc.createRange();
  let current: Node | null;
  while ((current = walker.nextNode())) {
    if (current.nodeType === 1) {
      const element = current as Element;
      if (!element.matches("img, svg, math")) continue;
      const block = element.closest<HTMLElement>("[data-locator]");
      if (!block || !article.contains(block)) continue;
      const rect = element.getBoundingClientRect();
      if (rect.right > viewport.left && rect.left < viewport.right && rect.bottom > viewport.top && rect.top < viewport.bottom) return { node: element, locator: block.dataset.locator!, block };
      continue;
    }
    const node = current as Text, parent = node.parentElement;
    const block = parent && parent.closest<HTMLElement>("[data-locator]");
    if (!block || !article.contains(block)) continue;
    for (const match of node.data.matchAll(/\S+/gu)) {
      range.setStart(node, match.index); range.setEnd(node, match.index + match[0].length);
      if (!Array.from(range.getClientRects()).some(rect => rect.right > viewport.left && rect.left < viewport.right && rect.bottom > viewport.top && rect.top < viewport.bottom)) continue;
      let offset = match.index;
      for (const character of match[0]) {
        range.setStart(node, offset); range.setEnd(node, offset + character.length);
        const charRects = Array.from(range.getClientRects());
        if (charRects.some(rect => (rect.width > 0 || rect.height > 0) && rect.right > viewport.left && rect.left < viewport.right && rect.bottom > viewport.top && rect.top < viewport.bottom)) {
          range.selectNodeContents(block); range.setEnd(node, offset);
          return { node, offset, locator: block.dataset.locator!, block, textOffset: range.toString().length };
        }
        offset += character.length;
      }
    }
  }
  return null;
}

export function restoreReaderPosition(reader: HTMLElement, article: HTMLElement, position: ReaderPosition | null, paged = true): void {
  if (!position) return;
  const block = article.contains(position.block) ? position.block : Array.from(article.querySelectorAll<HTMLElement>("[data-locator]")).find(node => node.dataset.locator === position.locator);
  if (!block) return;
  let rect: DOMRect;
  if ("textOffset" in position) {
    const walker = article.ownerDocument.createTreeWalker(block, 4);
    let remaining = position.textOffset, current: Node | null, text: Text | null = null;
    while ((current = walker.nextNode())) { const node = current as Text; if (remaining < node.length) { text = node; break; } remaining -= node.length; }
    if (!text) return;
    const range = article.ownerDocument.createRange();
    range.setStart(text, remaining); range.setEnd(text, remaining);
    const collapsedRects = Array.from(range.getClientRects()).filter(r => r.width > 0 || r.height > 0);
    if (collapsedRects.length) {
      rect = collapsedRects[0]!;
    } else {
      range.setEnd(text, Math.min(text.length, remaining + 1));
      const charRects = Array.from(range.getClientRects()).filter(r => r.width > 0 || r.height > 0);
      rect = charRects[charRects.length - 1] ?? range.getBoundingClientRect();
    }
  } else rect = (article.contains(position.node) ? position.node : block).getBoundingClientRect();
  const viewport = reader.getBoundingClientRect();
  if (!paged) { reader.scrollTo({ top: reader.scrollTop + rect.top - viewport.top, behavior: "instant" }); return; }
  const x = reader.scrollLeft + rect.left - viewport.left;
  reader.scrollTo({ left: Math.floor(Math.max(0, x) / Math.max(1, reader.clientWidth)) * reader.clientWidth, behavior: "instant" });
}

export function navigateReaderTarget(reader: HTMLElement, target: HTMLElement, paged: boolean): void {
  if (paged) {
    const position = reader.scrollLeft + target.getBoundingClientRect().left - reader.getBoundingClientRect().left;
    reader.scrollTo({ left: Math.floor(Math.max(0, position) / Math.max(1, reader.clientWidth)) * reader.clientWidth, behavior: "instant" });
  } else target.scrollIntoView({ block: "start" });
}

export function resolveEpubTarget(article: HTMLElement, value: string): HTMLElement | null {
  try {
    const target = JSON.parse(value) as { chapter?: unknown; fragment?: unknown };
    if (!target || !Number.isInteger(target.chapter) || (target.chapter as number) < 0 || typeof target.fragment !== "string") return null;
    const chapter = Array.from(article.children).find(node => node.tagName === "SECTION" && node.classList.contains("pith-epub-chapter") && node.getAttribute("data-epub-chapter") === String(target.chapter)) as HTMLElement | undefined;
    if (!chapter) return null;
    if (!target.fragment) return chapter;
    if (chapter.id === target.fragment) return chapter;
    return Array.from(chapter.querySelectorAll<HTMLElement>("[id]")).find(node => {
      const original = node.getAttribute("data-epub-fragment");
      return original === null ? node.id === target.fragment : original === target.fragment;
    }) ?? null;
  } catch { return null; }
}

export function resolveReaderLocator(article: HTMLElement, locator: string): HTMLElement | null {
  if (locator.startsWith("epub:")) return resolveEpubTarget(article, locator.slice(5));
  return Array.from(article.querySelectorAll<HTMLElement>("[data-locator]")).findLast(node => node.dataset.locator === locator) ?? null;
}

/** Character offsets disambiguate text blocks that span several pages. */
export function readingLocator(position: ReaderPosition): string {
  return "textOffset" in position && position.locator.startsWith("text:")
    ? `${position.locator};offset:${position.textOffset}` : position.locator;
}

export function restoreReadingLocator(reader: HTMLElement, article: HTMLElement, locator: string, paged: boolean): void {
  const offset = /^(text:.*);offset:(\d+)$/.exec(locator), base = offset ? offset[1]! : locator;
  const block = resolveReaderLocator(article, base);
  if (!block) return;
  if (offset) {
    const node = article.ownerDocument.createTreeWalker(block, 4).nextNode() as Text | null;
    if (node) { restoreReaderPosition(reader, article, { node, offset: 0, locator: base, block, textOffset: Number(offset[2]) }, paged); return; }
  }
  navigateReaderTarget(reader, block, paged);
}

export interface CurriculumItem { readonly fileName: string; readonly title: string; readonly status: "ready" | "planned" }

export function parseCurriculumOutline(outlineMarkdown: string, existingFiles: readonly string[]): CurriculumItem[] {
  const items: CurriculumItem[] = [], seen = new Set<string>();
  for (const line of outlineMarkdown.split(/\r?\n/)) {
    const list = /^\s*(?:[-*+]\s+|\d+[.)、]\s*)/.exec(line);
    if (!list) continue;
    const text = line.slice(list[0].length).trim();
    const link = /^\[([^\]]+)\]\(([^)]+?\.md(?:#[^\s)]*)?)(?:\s+"[^"]*")?\)(.*)$/i.exec(text);
    const bracket = /^\[([^\]/\\]+\.md)\]\s*(.*)$/i.exec(text);
    const plain = /^([^\s\[\]/\\]+\.md)(?:\s+|$)(.*)$/i.exec(text);
    const fileName = (link ? link[2]?.split("#", 1)[0]?.replace(/^\.\//, "") : bracket ? bracket[1] : plain?.[1])?.trim();
    if (!fileName || fileName === "00-课程大纲.md" || /[/\\\x00-\x1f<>:"|?*]/.test(fileName) || fileName.startsWith(".") || seen.has(fileName)) continue;
    const title = (link ? `${link[1]}${link[3]}` : bracket ? bracket[2] : plain?.[2])?.trim().replace(/^[-—:：\s]+/, "") || fileName;
    seen.add(fileName); items.push({ fileName, title, status: existingFiles.includes(fileName) ? "ready" : "planned" });
  }
  return items;
}

export function renderTocTree(container: HTMLElement, sections: readonly ReaderSectionHeading[], navigate: (locator: string) => void, toggleIcon = ""): void {
  const doc = container.ownerDocument;
  const root = doc.createElement("ul"), stack: { level: number; list: HTMLUListElement; item: HTMLLIElement | null }[] = [{ level: -Infinity, list: root, item: null }];
  const add = (entries: readonly ReaderSectionHeading[], inheritedLevel = 0): void => {
    for (const section of entries) {
      const level = Math.max(section.level, inheritedLevel);
      while (stack.length > 1 && stack[stack.length - 1]!.level >= level) stack.pop();
      const parent = stack[stack.length - 1]!;
      let list = parent.list;
      if (parent.item) {
        let child = parent.item.querySelector<HTMLUListElement>(":scope > ul");
        if (!child) { child = doc.createElement("ul"); child.hidden = true; parent.item.append(child); const toggle = parent.item.querySelector<HTMLButtonElement>(":scope > div > [data-toc-toggle]")!; toggle.hidden = false; toggle.setAttribute("aria-expanded", "false"); }
        list = child;
      }
      const item = doc.createElement("li"), row = doc.createElement("div"), toggle = doc.createElement("button"), title = doc.createElement("button");
      toggle.dataset.tocToggle = ""; toggle.innerHTML = toggleIcon; toggle.hidden = true; toggle.setAttribute("aria-label", "展开章节");
      toggle.onclick = () => { const children = item.querySelector<HTMLUListElement>(":scope > ul"); if (!children) return; children.hidden = !children.hidden; toggle.setAttribute("aria-expanded", String(!children.hidden)); };
      title.dataset.tocLocator = section.locator; title.textContent = section.title; title.onclick = () => navigate(section.locator);
      row.append(toggle, title); item.append(row); list.append(item); stack.push({ level, list, item });
      if (section.children) add(section.children, level + 1);
    }
  };
  add(sections); root.className = "pith-toc-tree"; container.append(root);
}

export function updateTocLocation(container: HTMLElement, article: HTMLElement, reader: HTMLElement, paged: boolean): void {
  const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>("[data-toc-locator]"));
  const viewport = reader.getBoundingClientRect();
  let current: HTMLButtonElement | undefined;
  for (const button of buttons) {
    button.removeAttribute("aria-current");
    const target = resolveReaderLocator(article, button.dataset.tocLocator ?? "");
    if (!target) continue;
    const rect = target.getBoundingClientRect();
    if (paged ? rect.left < viewport.left || (rect.left < viewport.right && rect.top < viewport.bottom) : rect.top < viewport.bottom) current = button;
  }
  for (const list of container.querySelectorAll<HTMLUListElement>(".pith-toc-tree ul")) list.hidden = true;
  for (const toggle of container.querySelectorAll<HTMLButtonElement>("[data-toc-toggle]")) toggle.setAttribute("aria-expanded", "false");
  if (!current) return;
  current.setAttribute("aria-current", "location");
  let list = current.closest("ul");
  while (list && list.className !== "pith-toc-tree") { list.hidden = false; const parent: HTMLElement | null = list.parentElement; const toggle = parent?.querySelector<HTMLButtonElement>(":scope > div > [data-toc-toggle]"); if (toggle) toggle.setAttribute("aria-expanded", "true"); list = parent?.closest("ul") ?? null; }
}

export function visibleToolkitTarget(article: HTMLElement, reader: HTMLElement, file: string): { file: string; locator: string; quote: string } | null {
  const chapters = Array.from(article.querySelectorAll<HTMLElement>(":scope > .pith-epub-chapter"));
  const candidates = chapters.length ? chapters : [article];
  const viewport = reader.getBoundingClientRect();
  const blocks = candidates.flatMap(chapter => Array.from(chapter.querySelectorAll<HTMLElement>('[data-prose="true"],[data-trainable="true"]'))).filter(item => !item.closest('.pith-inline-toolkit,.pith-interline-subtitle,[data-toolkit-display]') && (item.dataset.trainable === "true" || !item.closest('[data-prose="false"]')) && Array.from(item.getClientRects()).some(rect => rect.right > viewport.left && rect.left < viewport.right && rect.bottom > viewport.top && rect.top < viewport.bottom));
  const isHeading = (item: HTMLElement): boolean => /^H[1-6]$/.test(item.tagName) || item.getAttribute("role") === "heading";
  for (const block of [...blocks.filter(item => !isHeading(item)), ...blocks.filter(isHeading)]) {
    const copy = block.cloneNode(true) as HTMLElement;
    for (const child of copy.querySelectorAll('.pith-interline-subtitle,.pith-inline-toolkit,[data-toolkit-display],[data-prose="false"],time')) child.remove();
    if (block.tagName === "LI" && block.hasAttribute("data-locator")) for (const child of copy.querySelectorAll("li[data-locator]")) child.remove();
    const quote = (copy.textContent ?? "").trim();
    if (!quote) continue;
    const range = article.ownerDocument.createRange(); range.selectNodeContents(article); range.setEndBefore(block);
    return { file, locator: block.dataset.locator || `text:offset:${range.toString().length}`, quote };
  }
  return null;
}


export function proseTextNodes(block: Element): Text[] {
  const result: Text[] = [], walker = block.ownerDocument.createTreeWalker(block, 4);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const excluded = node.parentElement && node.parentElement.closest('[data-prose="false"]');
    const nestedListItem = block.tagName === "LI" && block.hasAttribute("data-locator") && node.parentElement !== null && node.parentElement.closest("li[data-locator]") !== block;
    if (!nestedListItem && (!excluded || excluded === block || !block.contains(excluded))) result.push(node as Text);
  }
  return result;
}
