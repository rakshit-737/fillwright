/**
 * Writes a minimal but genuinely valid PDF containing selectable text.
 *
 * Used by the import reproduction: the PDF path is the one a real user takes,
 * and it behaves differently from plain text because pdf.js takes ownership of
 * the byte buffer it is handed.
 */
import { writeFileSync } from 'node:fs';

const LINES = [
  'ADITI RAMACHANDRAN',
  'Bengaluru, Karnataka, India | +91 98450 12345 | aditi.ramachandran@example.com',
  'linkedin.com/in/aditi-ramachandran | github.com/aditir',
  'EDUCATION',
  'Vellore Institute of Technology',
  'B.Tech in Computer Science and Engineering  Aug 2022 - May 2026',
  'CGPA: 8.94/10',
  'EXPERIENCE',
  'Software Engineering Intern',
  'Zeta Payments Pvt Ltd',
  'TECHNICAL SKILLS',
  'Languages: Go, Python, TypeScript',
];

export function buildPdf() {
  const escape = (text) => text.replace(/([\\()])/g, '\\$1');

  let content = 'BT\n/F1 11 Tf\n1 0 0 1 50 760 Tm\n14 TL\n';
  for (const line of LINES) content += `(${escape(line)}) Tj\nT*\n`;
  content += 'ET';

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ' +
      '/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];

  let pdf = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((body, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });

  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;

  return Buffer.from(pdf, 'latin1');
}

if (process.argv[2]) {
  writeFileSync(process.argv[2], buildPdf());
  console.log('wrote ' + process.argv[2]);
}
