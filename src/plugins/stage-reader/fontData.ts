import { LXGW_WENKAI_LICENSE, LXGW_WENKAI_WOFF2 } from "./lxgwWenKaiData.ts";

export const READER_SERIF_STACK = '"Garden LXGW WenKai", "LXGW WenKai", "Songti SC", "Noto Serif CJK SC", "Source Han Serif SC", "Iowan Old Style", Georgia, serif';
export const READER_SANS_STACK = '"Avenir Next", "PingFang SC", "Helvetica Neue", sans-serif';

export function installReaderFont(doc: Document): void {
  if (!doc.head || doc.head.querySelector('style[data-pith-reader-font]')) return;
  const style = doc.createElement("style");
  style.setAttribute("data-pith-reader-font", "");
  style.textContent = `/* ${LXGW_WENKAI_LICENSE} */\n@font-face { font-family: "Garden LXGW WenKai"; src: url(data:font/woff2;base64,${LXGW_WENKAI_WOFF2}) format("woff2"); font-style: normal; font-weight: 400; font-display: swap; }`;
  doc.head.appendChild(style);
}
