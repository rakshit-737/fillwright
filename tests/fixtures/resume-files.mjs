/**
 * Generated resume files for the extraction tests, in the style of
 * tests/e2e/make-pdf.mjs: small, genuinely valid files built from scratch so no
 * binary blob is checked in. Every person, employer and URL here is invented.
 *
 *  - buildTwoColumnPdf()     a sidebar template: full-width header, then a
 *                            narrow SKILLS column beside a wide EXPERIENCE one
 *                            whose baselines do not line up with the sidebar.
 *  - buildAnnotationLinkPdf() "LinkedIn | GitHub" as words; the URLs live only
 *                            in /Link annotations.
 *  - buildTextBoxDocx()      a contact block in a text box, stored the way Word
 *                            stores it: once in mc:Choice, again in mc:Fallback,
 *                            plus hyperlink relationships in document.xml.rels.
 *  - buildZipBomb()          a DOCX whose document.xml inflates far past the cap.
 */
import { zipSync, strToU8 } from 'fflate';

const escapePdf = (text) => text.replace(/([\\()])/g, '\\$1');

/** Assembles a one-page PDF from a content stream and optional annotations. */
function assemblePdf(content, annotations = []) {
  const annotRefs = annotations.map((_, i) => `${6 + i} 0 R`).join(' ');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ' +
      '/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R' +
      (annotations.length ? ` /Annots [${annotRefs}]` : '') +
      ' >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    ...annotations.map(
      ({ rect, uri }) =>
        `<< /Type /Annot /Subtype /Link /Rect [${rect.join(' ')}] /Border [0 0 0] ` +
        `/A << /Type /Action /S /URI /URI (${escapePdf(uri)}) >> >>`,
    ),
  ];

  let pdf = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((body, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(pdf, 'latin1'));
}

/** Text placed at absolute positions: [x, y, size, text]. */
function placed(runs) {
  let content = 'BT\n';
  for (const [x, y, size, text] of runs) {
    content += `/F1 ${size} Tf\n1 0 0 1 ${x} ${y} Tm\n(${escapePdf(text)}) Tj\n`;
  }
  return content + 'ET';
}

export function buildTwoColumnPdf() {
  const runs = [
    // Full-width header, centred across both columns.
    [200, 750, 20, 'MEERA KRISHNAN'],
    [150, 728, 10, 'meera.krishnan@example.com | +91 98765 43210 | Pune, India'],
  ];
  // Sidebar: 12 pt leading, starting at the same height as the main column.
  const sidebar = [
    'SKILLS',
    'Python',
    'Kubernetes',
    'PostgreSQL',
    'LANGUAGES',
    'English',
    'Marathi',
  ];
  sidebar.forEach((text, i) => runs.push([40, 680 - i * 12, 10, text]));
  // Main column: 17 pt leading, so its baselines drift away from the sidebar's.
  const main = [
    'EXPERIENCE',
    'Backend Engineer',
    'Northwind Analytics',
    'Jan 2022 - Present',
    'EDUCATION',
    'College of Engineering Pune',
    'B.Tech in Computer Engineering',
    '2017 - 2021',
  ];
  main.forEach((text, i) => runs.push([220, 680 - i * 17, 10, text]));
  return assemblePdf(placed(runs));
}

export function buildAnnotationLinkPdf() {
  const runs = [
    [50, 750, 18, 'ARJUN MEHTA'],
    [50, 730, 10, 'arjun.mehta@example.com | +91 91234 56789'],
    [50, 716, 10, 'LinkedIn | GitHub'],
    [50, 690, 12, 'EXPERIENCE'],
    [50, 674, 10, 'Data Engineer'],
  ];
  return assemblePdf(placed(runs), [
    { rect: [50, 714, 90, 726], uri: 'https://www.linkedin.com/in/arjun-mehta-example' },
    { rect: [98, 714, 135, 726], uri: 'https://github.com/arjunmehta-example' },
    // Not a web link: must never be surfaced.
    { rect: [0, 0, 1, 1], uri: 'javascript:alert(1)' },
  ]);
}

const W_NS =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
  'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" ' +
  'xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape" ' +
  'xmlns:v="urn:schemas-microsoft-com:vml" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

const para = (text) => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;

export function buildTextBoxDocx() {
  const box = ['Sofía Ramírez', 'sofia.ramirez@example.com', '+34 612 345 678'].map(para).join('');

  const document =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document ${W_NS}><w:body>` +
    `<w:p><w:r><mc:AlternateContent>` +
    `<mc:Choice Requires="wps"><w:drawing><wps:wsp><wps:txbx><w:txbxContent>${box}</w:txbxContent></wps:txbx></wps:wsp></w:drawing></mc:Choice>` +
    `<mc:Fallback><w:pict><v:shape><v:textbox><w:txbxContent>${box}</w:txbxContent></v:textbox></v:shape></w:pict></mc:Fallback>` +
    `</mc:AlternateContent></w:r></w:p>` +
    `<w:p><w:hyperlink r:id="rId7"><w:r><w:t>LinkedIn</w:t></w:r></w:hyperlink>` +
    `<w:r><w:t xml:space="preserve"> | </w:t></w:r>` +
    `<w:hyperlink r:id="rId8"><w:r><w:t>Portfolio</w:t></w:r></w:hyperlink></w:p>` +
    para('EXPERIENCE') +
    para('Product Designer') +
    `</w:body></w:document>`;

  const rels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
    `<Relationship Id="rId7" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://www.linkedin.com/in/sofia-ramirez-example" TargetMode="External"/>` +
    `<Relationship Id="rId8" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://sofiaramirez.example.dev/?a=1&amp;b=2" TargetMode="External"/>` +
    `<Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="file:///C:/secret.txt" TargetMode="External"/>` +
    `</Relationships>`;

  return zipSync({
    '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types/>'),
    'word/document.xml': strToU8(document),
    'word/_rels/document.xml.rels': strToU8(rels),
  });
}

/**
 * A DOCX whose document.xml inflates to `megabytes` of zeros. With
 * `lieAboutSize`, the size fields in both the local header and the central
 * directory are rewritten to claim a tiny entry, as a hostile file would.
 */
export function buildZipBomb(megabytes = 64, lieAboutSize = false) {
  const zip = zipSync({ 'word/document.xml': new Uint8Array(megabytes * 1024 * 1024) });
  if (lieAboutSize) {
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    view.setUint32(22, 1000, true); // local file header: uncompressed size
    for (let i = zip.length - 22; i >= 0; i--) {
      if (view.getUint32(i, true) === 0x02014b50) {
        view.setUint32(i + 24, 1000, true); // central directory: uncompressed size
        break;
      }
    }
  }
  return zip;
}
