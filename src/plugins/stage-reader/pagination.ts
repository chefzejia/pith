import type { PaginationMetrics } from "../../core/index.ts";

type ColumnMode = "auto" | "single" | "double";

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

export function applyPaginationStyles(viewport: HTMLElement, body: HTMLElement, mode: ColumnMode = "auto"): PaginationMetrics {
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
  viewport.style.overflowX = "auto";
  viewport.style.overflowY = "hidden";
  viewport.style.removeProperty("--pith-page-scroll-extent");
  const result = computePagination(width, height, viewport.scrollWidth, mode);
  viewport.style.setProperty("--pith-page-scroll-extent", `${Math.max(0, result.totalScreens * width - 1)}px`);
  return result;
}
