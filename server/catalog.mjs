const roomPattern = /^[a-f0-9]{48}$/;
const idPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const encoder = new TextEncoder();
const maxPhotoChars = 196608;

class InputError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {status, headers: {'Content-Type': 'application/json; charset=utf-8'}});
}

function field(data, key, max, required = false) {
  const value = data[key] ?? '';
  if (typeof value !== 'string' || value.trim().length > max || (required && !value.trim())) {
    throw new InputError('Check the ' + key + ' field.');
  }
  return value.trim();
}

function validate(data) {
  if (!data || typeof data !== 'object') throw new InputError('Invalid gift idea.');
  const person = field(data, 'person', 60, true);
  const title = field(data, 'title', 120, true);
  const notes = field(data, 'notes', 1000);
  const url = field(data, 'url', 2048);
  if (url) {
    let parsed;
    try { parsed = new URL(url); } catch { throw new InputError('Enter a valid product link.'); }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
      throw new InputError('Enter an http or https product link.');
    }
  }
  const price = data.price === null || data.price === undefined ? null : data.price;
  if (price !== null && (!Number.isSafeInteger(price) || price < 0 || price > 999999999)) {
    throw new InputError('Enter a valid price.');
  }
  const photo = field(data, 'photo', maxPhotoChars);
  if (photo && !/^data:image\/jpeg;base64,\/9j\/[A-Za-z0-9+/]+=*$/.test(photo)) {
    throw new InputError('Please choose a JPEG-compatible photo.');
  }
  return {person, title, notes, url, price, photo};
}

async function readBody(request) {
  if (!request.headers.get('content-type')?.startsWith('application/json')) {
    throw new InputError('Send a JSON gift idea.', 415);
  }
  const reader = request.body?.getReader();
  if (!reader) throw new InputError('A gift idea is required.');
  const chunks = [];
  let size = 0;
  for (;;) {
    const {value, done} = await reader.read();
    if (done) break;
    size += value.length;
    if (size > maxPhotoChars + 11000) {
      await reader.cancel();
      throw new InputError('This photo is too large.', 413);
    }
    chunks.push(value);
  }
  try { return JSON.parse(await new Blob(chunks).text()); }
  catch { throw new InputError('Invalid gift idea.'); }
}

async function editHash(request) {
  const key = request.headers.get('x-edit-key') || '';
  if (!roomPattern.test(key)) throw new InputError('This browser does not have the edit key.', 403);
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(key));
  return Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, '0')).join('');
}

async function handle(request, env, url) {
  const [, , room, resource, id, extra] = url.pathname.split('/');
  if (extra !== undefined || !roomPattern.test(room) || resource !== 'ideas' || (id !== undefined && !idPattern.test(id))) {
    throw new InputError('Catalog not found.', 404);
  }
  const prefix = 'catalog/' + room + '/';
  const bucket = env.BUCKET;
  if (!id && request.method === 'GET') {
    const result = await bucket.list({prefix, limit: 20, cursor: url.searchParams.get('cursor') || undefined});
    const entries = await Promise.all(result.objects.map(async object => {
      const item = await bucket.get(object.key);
      return item ? item.json() : null;
    }));
    return json({ideas: entries.filter(Boolean), cursor: result.truncated ? result.cursor : null});
  }
  if (!id || !['PUT', 'DELETE'].includes(request.method)) throw new InputError('Unsupported operation.', 405);
  const hash = await editHash(request);
  const key = prefix + id;
  const current = await bucket.head(key);
  if (current && current.customMetadata?.editHash !== hash) throw new InputError('Only the browser that added this idea can edit it.', 403);
  if (request.method === 'DELETE') {
    if (current) await bucket.delete(key);
    return new Response(null, {status: 204});
  }
  const data = validate(await readBody(request));
  const created = current?.customMetadata?.created || new Date().toISOString();
  const idea = {id, created, ...data};
  const written = await bucket.put(key, JSON.stringify(idea), {
    onlyIf: current ? {etagMatches: current.etag} : {etagDoesNotMatch: '*'},
    customMetadata: {editHash: hash, created},
    httpMetadata: {contentType: 'application/json'}
  });
  if (!written) throw new InputError('The idea changed. Refresh and try again.', 409);
  return json(idea, current ? 200 : 201);
}

export async function serveCatalog(request, env) {
  const url = new URL(request.url);
  const origin = request.headers.get('origin');
  const allowed = !origin || origin === url.origin || origin === 'https://eailagan.github.io';
  const headers = new Headers({'Cache-Control': 'no-store', 'Vary': 'Origin', 'X-Content-Type-Options': 'nosniff'});
  if (!allowed) return new Response('Origin unavailable', {status: 403, headers});
  if (origin) headers.set('Access-Control-Allow-Origin', origin);
  headers.set('Access-Control-Allow-Methods', 'GET, PUT, DELETE, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type, X-Edit-Key');
  let result;
  try {
    result = request.method === 'OPTIONS' ? new Response(null, {status: 204}) : await handle(request, env, url);
  } catch (e) {
    result = json({error: e instanceof InputError ? e.message : 'The catalog could not be reached. Please try again.'}, e instanceof InputError ? e.status : 503);
  }
  for (const [name, value] of result.headers) headers.set(name, value);
  return new Response(result.body, {status: result.status, headers});
}
