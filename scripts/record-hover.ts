// Records what the text reader makes of each hover screenshot's tooltip, for the parser tests:
//   npm run record-hover
// Every image in tests/fixtures/img/appraisal that shows a tooltip goes through the appraisal's own find, crop
// and enlarge steps; the reader's lines are written to tests/fixtures/ocr/hover-<name>.lines.json.
import { readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { prepareHover } from '../src/appraisal/hover';
import { FIXTURES, loadPng } from '../tests/helpers/image';
import { nodeOcr, pixelsAdapter } from '../tests/helpers/pipeline';

const ocr = await nodeOcr();
for (const file of readdirSync(join(FIXTURES, 'img', 'appraisal')).filter((n) => n.endsWith('.png') && !n.startsWith('none-'))) {
  const crop = prepareHover(pixelsAdapter, loadPng(`appraisal/${file}`));
  if (!crop) { console.log(`${file}: no tooltip found`); continue; }
  const lines = await ocr.recognize(crop.image);
  const name = file.replace(/\.png$/, '');
  writeFileSync(join(FIXTURES, 'ocr', `hover-${name}.lines.json`), JSON.stringify(lines, null, 1) + '\n');
  console.log(`${name}\n${lines.map((l) => `  ${Math.round(l.confidence).toString().padStart(3)} ${l.text.trim()}`).join('\n')}`);
}
await ocr.terminate();
