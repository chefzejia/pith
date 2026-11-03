import type { PaginationMetrics, ReaderSectionHeading, ResponsiveLayoutDecision, StageReaderService } from "../../core/index.ts";

type ColumnMode = "auto" | "single" | "double";

export function resolveResponsiveLayout(input: Parameters<NonNullable<StageReaderService["resolveResponsiveLayout"]>>[0]): ResponsiveLayoutDecision {
  const { width, height, guideOpen = false, guideWidthPx = 320, preferredColumns = "auto", coarsePointer = false } = input;
  const aspectRatio = width / Math.max(1, height);
  const formFactor = aspectRatio < .85 || width < 600 ? "portrait-phone" : height < 480 ? "landscape-phone" : aspectRatio < 1.18 && width < 960 ? "foldable-square" : "tablet-desktop";
  const canSplitGuide = width >= 420 + guideWidthPx && aspectRatio >= .85 && height >= 480;
  const sheetMode = canSplitGuide ? "split-right" : aspectRatio < .85 || width < 600 ? "bottom-sheet" : "overlay-drawer";
  const stageWidthPx = guideOpen && canSplitGuide ? Math.max(1, width - guideWidthPx) : width;
  const canDoubleColumn = stageWidthPx >= 936 && stageWidthPx / Math.max(1, height) >= 1.15 && height >= 520;
  const effectiveColumns = canDoubleColumn && preferredColumns !== "single" ? 2 : 1;
  const hitTargetPx = coarsePointer || formFactor === "portrait-phone" || formFactor === "landscape-phone" ? 44 : 34;
  return { formFactor, aspectRatio, canSplitGuide, sheetMode, stageWidthPx, canDoubleColumn, effectiveColumns, hitTargetPx };
}

export function computePagination(viewportWidth: number, viewportHeight: number, scrollWidth: number, mode: ColumnMode = "auto"): PaginationMetrics {
  const columns = mode === "double" || (mode === "auto" && viewportWidth >= 900) ? 2 : 1;
  const horizontalInsetPx = Math.min(48, Math.max(16, viewportWidth * 0.05), viewportWidth / (columns * 4));
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
    const media = Array.from(figure.querySelectorAll<HTMLElement>("img, svg, math"));
    if (!media.length) continue;
    for (const item of media) item.style.setProperty("--pith-page-media-height", "1px");
    const figureStyle = win?.getComputedStyle(figure);
    const margins = (parseFloat(figureStyle?.marginTop ?? "0") || 0) + (parseFloat(figureStyle?.marginBottom ?? "0") || 0);
    const mediaHeight = media.reduce((sum, item) => sum + item.getBoundingClientRect().height, 0);
    const available = Math.max(1, (metrics.contentHeightPx - margins - figure.getBoundingClientRect().height + mediaHeight) / media.length);
    for (const item of media) item.style.setProperty("--pith-page-media-height", `${available}px`);
  }
  viewport.style.overflowX = "auto";
  viewport.style.overflowY = "hidden";
  viewport.style.removeProperty("--pith-page-scroll-extent");
  const result = computePagination(width, height, viewport.scrollWidth, mode);
  viewport.style.setProperty("--pith-page-scroll-extent", `${Math.max(0, result.totalScreens * width - 1)}px`);
  return result;
}

export function renderTocTree(container: HTMLElement, sections: readonly ReaderSectionHeading[], navigate: (locator: string) => void): void {
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
      toggle.dataset.tocToggle = ""; toggle.textContent = "▸"; toggle.hidden = true; toggle.setAttribute("aria-label", "展开章节");
      toggle.onclick = () => { const children = item.querySelector<HTMLUListElement>(":scope > ul"); if (!children) return; children.hidden = !children.hidden; toggle.setAttribute("aria-expanded", String(!children.hidden)); toggle.textContent = children.hidden ? "▸" : "▾"; };
      title.dataset.tocLocator = section.locator; title.textContent = section.title; title.onclick = () => navigate(section.locator);
      row.append(toggle, title); item.append(row); list.append(item); stack.push({ level, list, item });
      if (section.children) add(section.children, level + 1);
    }
  };
  add(sections); root.className = "pith-toc-tree"; container.append(root);
}

export function updateTocLocation(container: HTMLElement, article: HTMLElement, reader: HTMLElement, paged: boolean): void {
  const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>("[data-toc-locator]"));
  const targets = Array.from(article.querySelectorAll<HTMLElement>("[data-locator]"));
  const viewport = reader.getBoundingClientRect();
  let current: HTMLButtonElement | undefined;
  for (const button of buttons) {
    button.removeAttribute("aria-current");
    const target = targets.find(node => node.dataset.locator === button.dataset.tocLocator);
    if (!target) continue;
    const rect = target.getBoundingClientRect();
    if (paged ? rect.left < viewport.left || (rect.left < viewport.right && rect.top < viewport.bottom) : rect.top < viewport.bottom) current = button;
  }
  for (const list of container.querySelectorAll<HTMLUListElement>(".pith-toc-tree ul")) list.hidden = true;
  for (const toggle of container.querySelectorAll<HTMLButtonElement>("[data-toc-toggle]")) { toggle.setAttribute("aria-expanded", "false"); toggle.textContent = "▸"; }
  if (!current) return;
  current.setAttribute("aria-current", "location");
  let list = current.closest("ul");
  while (list && list.className !== "pith-toc-tree") { list.hidden = false; const parent: HTMLElement | null = list.parentElement; const toggle = parent?.querySelector<HTMLButtonElement>(":scope > div > [data-toc-toggle]"); if (toggle) { toggle.setAttribute("aria-expanded", "true"); toggle.textContent = "▾"; } list = parent?.closest("ul") ?? null; }
}
