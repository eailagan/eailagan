'use strict';

const byId = id => document.getElementById(id);
const form = byId('idea-form');
const editor = byId('editor');
const filter = byId('person-filter');
const sessionFallback = new Map();
const preference = {
  get(key) { try { return localStorage.getItem('giftbook.' + key) ?? sessionFallback.get(key); } catch { return sessionFallback.get(key); } },
  set(key, value) { sessionFallback.set(key, value); try { localStorage.setItem('giftbook.' + key, value); } catch {} }
};
const randomKey = () => Array.from(crypto.getRandomValues(new Uint8Array(24)), n => n.toString(16).padStart(2, '0')).join('');
const roomPattern = /^[a-f0-9]{48}$/;
const sharedRoom = location.hash.slice(1);
const previousRoom = preference.get('catalog');
const room = roomPattern.test(sharedRoom) ? sharedRoom : roomPattern.test(previousRoom || '') ? previousRoom : randomKey();
preference.set('catalog', room);
history.replaceState(null, '', location.pathname + location.search + '#' + room);
window.addEventListener('hashchange', () => { if (location.hash.slice(1) !== room) location.reload(); });

const shared = Boolean(window.GIFTBOOK_API_ORIGIN);
const api = (window.GIFTBOOK_API_ORIGIN || location.origin) + '/api/' + room + '/ideas';
const state = {ideas: [], view: preference.get('view') === 'list' ? 'list' : 'grid', loading: true, error: false};
let requestNumber = 0;
let draft, selected, photoWork = 0, photoPending = false, saving = false, toastTimer;
const editStorage = id => 'edit.' + room + '.' + id;
const money = cents => '$' + (cents / 100).toLocaleString(undefined, {minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2});
const personKey = name => name.normalize('NFC').trim().toLowerCase();
const shareLink = () => location.href.split('#')[0] + '#' + room;

function toast(message) {
  byId('toast').textContent = message;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { byId('toast').textContent = ''; }, 2600);
}

function icon(id) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(ns, 'use');
  use.setAttribute('href', '#' + id);
  svg.append(use);
  return svg;
}

function make(tag, cls, text) {
  const element = document.createElement(tag);
  if (cls) element.className = cls;
  if (text !== undefined) element.textContent = text;
  return element;
}

function makeCard(idea) {
  const button = make('button', 'idea');
  const visual = make('span', 'idea-visual');
  if (idea.photo) {
    const photo = make('img');
    photo.alt = '';
    photo.loading = 'lazy';
    photo.src = idea.photo;
    visual.append(photo);
  } else { visual.append(icon('gift')); }
  const info = make('span', 'idea-info');
  info.append(make('span', 'person-name', idea.person), make('span', 'idea-title', idea.title));
  if (idea.price !== null) info.append(make('span', 'idea-price', money(idea.price)));
  button.append(visual, info);
  button.addEventListener('click', () => showDetail(idea));
  return button;
}

function render() {
  const names = new Map();
  for (const idea of state.ideas) names.set(personKey(idea.person), idea.person);
  const chosen = filter.value;
  const options = [...names.entries()].sort((a,b) => a[1].localeCompare(b[1]));
  filter.replaceChildren(new Option('Everyone', ''), ...options.map(([k,v]) => new Option(v,k)));
  filter.value = names.has(chosen) ? chosen : '';
  byId('known-people').replaceChildren(...options.map(([,name]) => new Option(name)));
  const ideas = filter.value ? state.ideas.filter(x => personKey(x.person) === filter.value) : state.ideas;
  const list = byId('ideas');
  list.classList.toggle('list', state.view === 'list');
  list.replaceChildren(...ideas.map(makeCard));
  byId('view-grid').setAttribute('aria-pressed', state.view === 'grid');
  byId('view-list').setAttribute('aria-pressed', state.view === 'list');
  byId('count').textContent = state.loading && !state.ideas.length ? '…' : state.error && !state.ideas.length ? '—' : String(ideas.length);
  byId('empty').hidden = ideas.length > 0 || state.error;
  byId('empty-title').textContent = state.loading ? 'Loading gift ideas…' : 'No gift ideas yet';
  byId('empty-action').hidden = state.loading || state.error;
}

async function request(url, options) {
  if (!shared) return deviceCatalog.request(room, url, options);
  const response = await fetch(url, {cache:'no-store', credentials:'omit', ...options});
  if (!response.ok) {
    const problem = await response.json().catch(() => ({}));
    throw new Error(problem.error || 'The catalog could not be reached. Please try again.');
  }
  return response.status === 204 ? null : response.json();
}

async function refresh() {
  const number = ++requestNumber;
  try {
    let cursor = null;
    const ideas = [];
    do {
      const url = new URL(api);
      if (cursor) url.searchParams.set('cursor', cursor);
      const page = await request(url);
      if (number !== requestNumber) return;
      if (!Array.isArray(page.ideas)) throw new Error('The shared catalog is unavailable.');
      ideas.push(...page.ideas);
      cursor = page.cursor;
    } while (cursor);
    state.ideas = ideas.sort((a,b) => b.created.localeCompare(a.created) || a.id.localeCompare(b.id));
    state.error = false;
    byId('error').hidden = true;
  } catch {
    if (number !== requestNumber) return;
    state.error = true;
    byId('error').firstElementChild.textContent = 'Couldn’t load the shared catalog.';
    byId('error').hidden = false;
  } finally {
    if (number === requestNumber) { state.loading = false; render(); }
  }
}

function showDetail(idea) {
  selected = idea;
  byId('detail-person').textContent = idea.person;
  byId('detail-title').textContent = idea.title;
  byId('detail-price').textContent = idea.price === null ? '' : money(idea.price);
  byId('detail-notes').textContent = idea.notes;
  const photo = byId('detail-image');
  photo.hidden = !idea.photo;
  if (idea.photo) photo.src = idea.photo; else photo.removeAttribute('src');
  const product = byId('detail-link');
  product.hidden = !idea.url;
  if (idea.url) product.href = idea.url; else product.removeAttribute('href');
  byId('edit').hidden = !preference.get(editStorage(idea.id));
  byId('detail').showModal();
}

function setPhoto(value) {
  draft.photo = value;
  const preview = byId('photo-preview');
  preview.hidden = !value;
  if (value) preview.src = value; else preview.removeAttribute('src');
  byId('photo-label').textContent = value ? 'Change photo' : 'Add photo';
  byId('remove-photo').hidden = !value;
}

function formError(message = '') {
  byId('form-error').textContent = message;
  byId('form-error').hidden = !message;
}

function openEditor(idea = null) {
  const id = idea?.id || crypto.randomUUID();
  const key = idea ? preference.get(editStorage(id)) : randomKey();
  if (!key) return;
  draft = {id, key, editing: !!idea, photo: ''};
  form.reset();
  form.elements.person.value = idea?.person ?? preference.get('name.' + room) ?? '';
  form.elements.title.value = idea?.title ?? '';
  form.elements.url.value = idea?.url ?? '';
  form.elements.notes.value = idea?.notes ?? '';
  form.elements.price.value = idea?.price == null ? '' : String(idea.price / 100);
  byId('editor-title').textContent = idea ? 'Edit gift idea' : 'Add gift idea';
  byId('remove').hidden = !idea;
  byId('save').textContent = 'Save idea';
  byId('save').disabled = false;
  photoWork++;
  photoPending = false;
  setPhoto(idea?.photo || '');
  formError();
  editor.showModal();
  (form.elements.person.value ? form.elements.title : form.elements.person).focus();
}

async function convertPhoto(file) {
  if (file.size > 30 * 1024 * 1024) throw new Error('Choose a photo under 30 MB.');
  const uri = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = uri;
    await img.decode();
    let side = Math.min(900, Math.max(img.naturalWidth,img.naturalHeight));
    const canvas = document.createElement('canvas');
    while (side >= 1) {
      const scale = side / Math.max(img.naturalWidth,img.naturalHeight);
      canvas.width = Math.max(1,Math.round(img.naturalWidth * scale));
      canvas.height = Math.max(1,Math.round(img.naturalHeight * scale));
      const context = canvas.getContext('2d');
      context.fillStyle = '#fff';
      context.fillRect(0,0,canvas.width,canvas.height);
      context.drawImage(img,0,0,canvas.width,canvas.height);
      const result = canvas.toDataURL('image/jpeg',.79);
      if (result.length <= 196608) return result;
      if (side <= 96) break;
      side = Math.floor(side * .72);
    }
    throw new Error('Choose a smaller photo.');
  } finally { URL.revokeObjectURL(uri); }
}

byId('photo-file').addEventListener('change', async event => {
  const file = event.target.files[0];
  if (!file) return;
  const number = ++photoWork;
  photoPending = true;
  byId('save').disabled = true;
  formError();
  try {
    const photo = await convertPhoto(file);
    if (number === photoWork) setPhoto(photo);
  } catch {
    if (number === photoWork) formError('Choose a JPG, PNG, or WebP photo under 30 MB.');
  } finally {
    if (number === photoWork) {
      photoPending = false;
      byId('save').disabled = false;
    }
  }
});
byId('remove-photo').addEventListener('click', () => {
  ++photoWork; photoPending = false; byId('save').disabled = false;
  setPhoto(''); byId('photo-file').value = '';
});
function setBusy(value) {
  saving = value;
  for (const control of form.querySelectorAll('button,input,textarea')) control.disabled = value;
  byId('save').textContent = value ? 'Saving…' : 'Save idea';
}
editor.addEventListener('cancel', e => { if (saving) e.preventDefault(); });
form.addEventListener('submit', async event => {
  event.preventDefault();
  if (photoPending || saving) return;
  const read = name => form.elements[name].value.trim();
  const data = {person:read('person'),title:read('title'),notes:read('notes'),price:read('price') === '' ? null : Math.round(Number(read('price')) * 100),url:read('url'),photo:draft.photo};
  if (!data.person || !data.title) { formError('Enter a name and a gift idea.'); return; }
  formError(); setBusy(true);
  try {
    await request(api + '/' + draft.id, {method:'PUT',headers:{'Content-Type':'application/json','X-Edit-Key':draft.key},body:JSON.stringify(data)});
    preference.set(editStorage(draft.id), draft.key);
    preference.set('name.' + room, data.person);
    filter.value = '';
    editor.close();
    toast(draft.editing ? 'Gift idea updated' : 'Gift idea added');
    await refresh();
  } catch (e) { formError(e.message === 'Failed to fetch' ? 'Couldn’t save. Check your connection and try again.' : e.message); }
  finally { setBusy(false); }
});
byId('edit').addEventListener('click', () => { byId('detail').close(); openEditor(selected); });
byId('remove').addEventListener('click', () => {
  byId('delete-name').textContent = form.elements.title.value;
  byId('delete-dialog').showModal(); byId('delete-cancel').focus();
});
byId('delete-cancel').addEventListener('click', () => byId('delete-dialog').close());
byId('delete-confirm').addEventListener('click', async () => {
  byId('delete-dialog').close(); setBusy(true); formError();
  try {
    await request(api + '/' + draft.id, {method:'DELETE',headers:{'X-Edit-Key':draft.key}});
    editor.close(); toast('Gift idea deleted'); await refresh();
  } catch { formError('Couldn’t delete the idea. Please try again.'); }
  finally { setBusy(false); }
});
for (const el of document.querySelectorAll('[data-close]')) el.addEventListener('click', () => el.closest('dialog').close());
for (const id of ['add','empty-action']) byId(id).addEventListener('click', () => openEditor());
filter.addEventListener('change', render);
for (const view of ['grid','list']) byId('view-' + view).addEventListener('click', () => { state.view = view; preference.set('view',view); render(); });
byId('share-btn').addEventListener('click', () => {
  byId('share-url').value = shareLink();
  byId('share-dialog').querySelector('p').textContent = shared ? 'Anyone with this link can view and add gift ideas.' : 'Shared storage is pending. This link opens Giftbook, but ideas are currently saved on each device.';
  byId('copy-link').textContent = 'Copy link';
  byId('share-dialog').showModal();
});
byId('copy-link').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(shareLink());
    byId('share-dialog').close(); toast('Family link copied');
  } catch {
    byId('share-url').focus(); byId('share-url').select();
    byId('copy-link').textContent = 'Select and copy the link';
  }
});
byId('retry').addEventListener('click', refresh);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh(); });
setInterval(() => { if (!document.hidden && !document.querySelector('dialog[open]')) refresh(); }, 60000);
byId('season').textContent = String(new Date().getFullYear());
async function updateStorageNote() {
  const note = byId('storage-note');
  const sync = byId('sync-device');
  if (!shared) {
    note.firstElementChild.textContent = 'Shared storage is pending. Ideas save on this device.';
    note.hidden = false;
    return;
  }
  const drafts = await deviceCatalog.list(room).catch(() => []);
  note.hidden = !drafts.length;
  sync.hidden = !drafts.length;
  note.firstElementChild.textContent = drafts.length + (drafts.length === 1 ? ' idea is saved only on this device.' : ' ideas are saved only on this device.');
}
byId('sync-device').addEventListener('click', async () => {
  const sync = byId('sync-device');
  sync.disabled = true;
  try {
    for (const idea of await deviceCatalog.list(room)) {
      const key = preference.get(editStorage(idea.id)) || randomKey();
      preference.set(editStorage(idea.id),key);
      await request(api + '/' + idea.id, {method:'PUT',headers:{'Content-Type':'application/json','X-Edit-Key':key}, body:JSON.stringify(idea)});
      await deviceCatalog.remove(room, idea.id);
    }
    await refresh();
    toast('Ideas shared with the family');
  } catch { toast('Couldn’t share all ideas. Try again.'); }
  finally { sync.disabled = false; await updateStorageNote(); }
});
updateStorageNote();
render();
refresh();
