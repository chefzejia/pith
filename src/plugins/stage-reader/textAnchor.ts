import type { IntrinsicLocator, TextQuoteMatch } from "../../core/index.ts";

export function matchTextAnchor(fullText: string, anchor: { readonly locator: IntrinsicLocator; readonly quote?: string; readonly prefix?: string; readonly suffix?: string }): TextQuoteMatch | null {
  const quote = anchor.quote;
  if (!quote) return null;
  const offsetMatch = /^text:offset:(\d+)$/.exec(anchor.locator);
  const preferred = offsetMatch ? Number(offsetMatch[1]) : null;
  const result = (startOffset: number): TextQuoteMatch => ({
    startOffset, endOffset: startOffset + quote.length, exact: quote,
    ...(anchor.prefix !== undefined ? { prefix: fullText.slice(Math.max(0, startOffset - anchor.prefix.length), startOffset) } : {}),
    ...(anchor.suffix !== undefined ? { suffix: fullText.slice(startOffset + quote.length, startOffset + quote.length + anchor.suffix.length) } : {}),
  });
  if (preferred !== null && Number.isSafeInteger(preferred) && fullText.slice(preferred, preferred + quote.length) === quote) return result(preferred);

  let best: { offset: number; score: number; distance: number } | null = null;
  for (let offset = fullText.indexOf(quote); offset !== -1; offset = fullText.indexOf(quote, offset + 1)) {
    let score = 0;
    const prefix = anchor.prefix ?? "";
    const suffix = anchor.suffix ?? "";
    for (let i = 1; i <= prefix.length && i <= offset && prefix[prefix.length - i] === fullText[offset - i]; i++) score++;
    for (let i = 0; i < suffix.length && suffix[i] === fullText[offset + quote.length + i]; i++) score++;
    const distance = preferred !== null && Number.isSafeInteger(preferred) ? Math.abs(offset - preferred) : offset;
    if (!best || score > best.score || (score === best.score && distance < best.distance)) best = { offset, score, distance };
  }
  return best ? result(best.offset) : null;
}
