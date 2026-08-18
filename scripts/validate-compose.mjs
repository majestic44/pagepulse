import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';
const files = ['compose.yaml', 'compose.dev.yaml', 'compose.production.yaml'];
for (const file of files) {
  const model = parse(await readFile(new URL(`../${file}`, import.meta.url), 'utf8'));
  if (!model?.services || Object.keys(model.services).length === 0)
    throw new Error(`${file}: no services`);
  console.log(`${file}: ${Object.keys(model.services).length} services`);
}
