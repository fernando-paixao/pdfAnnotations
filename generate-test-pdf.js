// Generates a minimal, valid multi-page PDF with selectable text for testing.
const fs = require('fs');

function esc(s) { return s.replace(/([()\\])/g, '\\$1'); }

function contentStream(lines) {
  let s = 'BT\n/F1 16 Tf\n72 720 Td\n22 TL\n';
  lines.forEach((line, i) => {
    if (i === 0) s += '(' + esc(line) + ') Tj\n';
    else s += 'T*\n(' + esc(line) + ') Tj\n';
  });
  s += 'ET';
  return s;
}

const pages = [
  ['PDF Annotations — Page One', 'This is the first page of the sample document.', 'Try selecting this sentence to highlight it.', 'You can also add an optional note to each highlight.', 'Highlights are saved locally in your browser.'],
  ['Page Two', 'Here is some more selectable text on the second page.', 'The quick brown fox jumps over the lazy dog.', 'Annotations persist when you reopen the same PDF file.', 'Lorem ipsum dolor sit amet, consectetur adipiscing elit.'],
  ['Page Three', 'Final page of the sample document.', 'Zoom in and out using the toolbar buttons.', 'Export your annotations to JSON for backup.'],
];

const objects = [];
objects.push('<< /Type /Catalog /Pages 2 0 R >>');           // 1
objects.push('<< /Type /Pages /Kids [3 0 R 5 0 R 7 0 R] /Count 3 >>'); // 2
// page objects: 3,5,7 ; content: 4,6,8 ; font: 9
const fontObj = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';

const pageRefs = [3, 5, 7];
const contentRefs = [4, 6, 8];
pages.forEach((lines, i) => {
  const pageObj = '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ' +
    '/Resources << /Font << /F1 9 0 R >> >> /Contents ' + contentRefs[i] + ' 0 R >>';
  objects.push(pageObj); // page
  objects.push('<< /Length ' + contentStream(lines).length + ' >>\nstream\n' + contentStream(lines) + '\nendstream'); // content
});
objects.push(fontObj); // 9

// Assemble with xref
let pdf = '%PDF-1.4\n';
const offsets = [];
objects.forEach((obj, i) => {
  offsets.push(pdf.length);
  pdf += (i + 1) + ' 0 obj\n' + obj + '\nendobj\n';
});
const xrefStart = pdf.length;
pdf += 'xref\n0 ' + (objects.length + 1) + '\n';
pdf += '0000000000 65535 f \n';
offsets.forEach((off) => {
  pdf += String(off).padStart(10, '0') + ' 00000 n \n';
});
pdf += 'trailer\n<< /Size ' + (objects.length + 1) + ' /Root 1 0 R >>\nstartxref\n' + xrefStart + '\n%%EOF';

fs.writeFileSync('test.pdf', Buffer.from(pdf, 'binary'));
console.log('Wrote test.pdf (' + pdf.length + ' bytes)');
