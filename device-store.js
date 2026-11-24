'use strict';

// Device drafts stay available if the family API is connected later.
const deviceCatalog = (() => {
  let opening;
  function open() {
    if (opening) return opening;
    opening = new Promise((resolve, reject) => {
      const db = indexedDB.open('giftbook-device-ideas', 1);
      db.onupgradeneeded = () => {
        const store = db.result.createObjectStore('ideas', {keyPath: ['room','id']});
        store.createIndex('by-room', 'room');
      };
      db.onsuccess = () => resolve(db.result);
      db.onerror = () => reject(db.error);
    });
    return opening;
  }
  async function run(mode, operation) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('ideas', mode);
      const query = operation(transaction.objectStore('ideas'));
      transaction.oncomplete = () => resolve(query.result);
      transaction.onabort = transaction.onerror = () => reject(transaction.error || new Error('Device storage is unavailable.'));
    });
  }
  const list = room => run('readonly', store => store.index('by-room').getAll(room));
  const remove = (room, id) => run('readwrite', store => store.delete([room,id]));
  async function request(room, url, options = {}) {
    if (!options.method) {
      const query = new URL(url).searchParams;
      const ideas = await list(room);
      if (query.get('view') === 'people') return {people:ideas.map(idea => idea.person), cursor:null};
      const person = query.get('person');
      return {ideas:person ? ideas.filter(idea => idea.person.normalize('NFC').trim().toLowerCase() === person) : ideas, cursor:null};
    }
    const id = String(url).split('/').at(-1);
    if (options.method === 'DELETE') { await remove(room,id); return null; }
    const existing = await run('readonly', store => store.get([room,id]));
    const idea = {...JSON.parse(options.body), room, id, created: existing?.created || new Date().toISOString()};
    await run('readwrite', store => store.put(idea));
    return idea;
  }
  return {list, remove, request};
})();
