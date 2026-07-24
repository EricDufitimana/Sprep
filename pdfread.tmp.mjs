import { readFileSync } from 'node:fs';
const { default: pdfParse } = await import('pdf-parse');
for (const f of process.argv.slice(2)) {
  const data = await pdfParse(readFileSync(f));
  console.log(`\n########## ${f.split('/').slice(-1)[0]}  (pages: ${data.numpages}, chars: ${data.text.length})`);
  console.log(data.text.slice(0, 2500));
}
