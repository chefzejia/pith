import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { WorkerMessageHandler } from "pdfjs-dist/legacy/build/pdf.worker.mjs";
import type { FixedPageEntry, MaterialFileEntry, ProseBlock, RenderedDocumentView } from "../../core/index.ts";

const escape = (text: string): string => text.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
const maxSide = 4096, maxPixels = 12_000_000;

export async function renderPdf(file: MaterialFileEntry, bytes: Uint8Array): Promise<RenderedDocumentView> {
  // PDF.js uses its local in-process worker when this handler is present.
  (globalThis as typeof globalThis & { pdfjsWorker?: { WorkerMessageHandler: unknown } }).pdfjsWorker = { WorkerMessageHandler };
  const loading = getDocument({ data: Uint8Array.from(bytes), isEvalSupported: false, useWorkerFetch: false, useSystemFonts: true, disableAutoFetch: true, disableStream: true });
  try {
    const pdf = await loading.promise;
    if (pdf.numPages < 1) throw new Error("PDF has no readable pages");
    const pages: FixedPageEntry[] = [], blocks: ProseBlock[] = [], html: string[] = [];
    let imageBytes = 0;
    for (let number = 1; number <= pdf.numPages; number++) {
      const page = await pdf.getPage(number);
      try {
        const base = page.getViewport({ scale: 1 });
        const scale = Math.min(2, maxSide / Math.max(base.width, base.height), Math.sqrt(maxPixels / (base.width * base.height)));
        if (!Number.isFinite(scale) || scale <= 0) throw new Error("Invalid PDF page dimensions");
        const viewport = page.getViewport({ scale });
        let canvas: HTMLCanvasElement | undefined, image: string | undefined;
        if (typeof document !== "undefined") {
          canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.floor(viewport.width)); canvas.height = Math.max(1, Math.floor(viewport.height));
          const context = canvas.getContext("2d", { alpha: false });
          if (!context) throw new Error("PDF canvas unavailable");
          await page.render({ canvasContext: context, viewport }).promise;
          image = canvas.toDataURL("image/png");
          imageBytes += image.length;
          if (imageBytes > 96 * 1024 * 1024) throw new Error("PDF rendered images exceed size limit");
        }
        const content = await page.getTextContent();
        const spans: string[] = [], text: string[] = [];
        for (const item of content.items) {
          if (!("str" in item) || !item.str) continue;
          const [x, y] = viewport.convertToViewportPoint(item.transform[4]!, item.transform[5]!);
          const height = Math.hypot(item.transform[2]!, item.transform[3]!) * scale;
          if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(height)) continue;
          const left = x! / viewport.width * 100, top = (y! - height) / viewport.height * 100;
          const width = item.width * scale / viewport.width * 100, font = height / viewport.height * 100;
          spans.push(`<span style="position:absolute;left:${left}%;top:${top}%;width:${width}%;height:${font}%;font-size:${font}cqh;white-space:pre;transform-origin:0 0">${escape(item.str)}</span>`);
          text.push(item.str + (item.hasEOL ? "\n" : " "));
        }
        const locator = `page:${number}`, label = `第 ${number} 页`, joined = text.join("").trim();
        pages.push({ page: number, label, mimeType: image ? "image/png" : "application/pdf", text: joined });
        if (joined) blocks.push({ index: blocks.length, locator, text: joined, isProse: true });
        if (canvas && image) html.push(`<figure class="pith-fixed-page" data-locator="${locator}" data-prose="false"><div class="pith-pdf-page" style="position:relative;display:inline-block;width:min(${canvas.width}px,100%,calc((var(--pith-page-height,80vh) - 2em) * ${canvas.width / canvas.height}));container-type:size;aspect-ratio:${canvas.width}/${canvas.height}"><img alt="${label}" data-page="${number}" src="${image}" style="width:100%;height:100%;max-height:none"><div class="pith-pdf-text" data-locator="${locator}" data-prose="true" style="position:absolute;inset:0;overflow:hidden;color:transparent;text-align:left;line-height:1;user-select:text">${spans.join("")}</div></div></figure>`);
        else html.push(`<p data-locator="${locator}" data-prose="true">${escape(joined)}</p>`);
      } finally { page.cleanup(); }
    }
    return { format: "pdf", layout: "fixed-page", title: file.name, html: html.join(""), sections: pages.map(page => ({ title: page.label, level: 1, line: page.page - 1, locator: `page:${page.page}` })), pages, blocks, totalUnits: pages.length };
  } finally { await loading.destroy(); }
}
