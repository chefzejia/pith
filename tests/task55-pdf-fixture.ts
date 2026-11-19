function pdfObjects(objects: string[]): Uint8Array {
  let pdf = "%PDF-1.4\n", offsets = [0];
  objects.forEach((object, index) => { offsets.push(pdf.length); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = pdf.length; pdf += `xref\n0 ${offsets.length}\n0000000000 65535 f \n` + offsets.slice(1).map(offset => `${String(offset).padStart(10, "0")} 00000 n \n`).join("") + `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}

export function pdfFixture(firstText = "Repeated phrase", secondText = "Repeated phrase"): Uint8Array {
  const firstItems = firstText.length > 1000 ? firstText.match(/.{1,11}/g)! : [firstText];
  const first = `0.9 0.15 0.1 rg 20 20 120 70 re f ${firstItems.map(item => `BT /F1 20 Tf 30 200 Td (${item}) Tj ET`).join(" ")}`;
  const second = `0.1 0.25 0.9 rg 20 20 120 70 re f BT /F1 20 Tf 30 200 Td (${secondText}) Tj ET`;
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources << /Font << /F1 7 0 R >> >> /Contents 5 0 R >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources << /Font << /F1 7 0 R >> >> /Contents 6 0 R >>", `<< /Length ${first.length} >>\nstream\n${first}\nendstream`, `<< /Length ${second.length} >>\nstream\n${second}\nendstream`, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
  return pdfObjects(objects);
}

export function manyPagePdf(count: number, portrait = false): Uint8Array {
  if (portrait) {
    const pages = Array.from({ length: count }, (_, index) => 3 + index * 2), fontId = 3 + count * 2;
    return pdfObjects([
      "<< /Type /Catalog /Pages 2 0 R >>",
      `<< /Type /Pages /Kids [${pages.map(id => `${id} 0 R`).join(" ")}] /Count ${count} >>`,
      ...pages.flatMap((id, index) => {
        const content = `BT /F1 24 Tf 30 580 Td (Source page ${index + 1}) Tj ET`;
        return [
          `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 640] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${id + 1} 0 R >>`,
          `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
        ];
      }),
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]);
  }
  const pages = Array.from({ length: count }, (_, index) => `${index + 3} 0 R`), contentId = count + 3, fontId = count + 4;
  const content = "BT /F1 12 Tf 20 200 Td (Long book) Tj ET";
  return pdfObjects(["<< /Type /Catalog /Pages 2 0 R >>", `<< /Type /Pages /Kids [${pages.join(" ")}] /Count ${count} >>`, ...pages.map(() => `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`), `<< /Length ${content.length} >>\nstream\n${content}\nendstream`, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"]);
}
