import {mkdir, readFile, writeFile, copyFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const out = path.join(root, 'dist');
const api = await readFile(path.join(root, 'server/catalog.mjs'), 'utf8');
const entry = `
export default {
  fetch(request, env) {
    if (new URL(request.url).pathname.startsWith('/api/')) return serveCatalog(request, env);
    return new Response('Not found', {status:404});
  }
};
`;
await mkdir(path.join(out, 'server'), {recursive:true});
await mkdir(path.join(out, '.openai'), {recursive:true});
await writeFile(path.join(out, 'server/index.js'), api + entry);
await copyFile(path.join(root, '.openai/hosting.json'), path.join(out, '.openai/hosting.json'));
