const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
const filePath = path.join(dataDir, 'store.json');

function load() {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    return {};
  }
}

const state = load();
let saveTimeout = null;

function saveNow() {
  fs.writeFileSync(filePath, JSON.stringify(state, null, 2));
}

// Kısa aralıklı ard arda yazmaları tek dosya yazma işlemine indiriyoruz (performans)
function save() {
  if (saveTimeout) return;
  saveTimeout = setTimeout(() => {
    saveNow();
    saveTimeout = null;
  }, 50);
}

class Collection {
  constructor(name) {
    this.name = name;
    if (!state[name]) state[name] = [];
    if (!state._nextId) state._nextId = {};
    if (!state._nextId[name]) state._nextId[name] = 1;
  }

  insert(fields) {
    const id = state._nextId[this.name]++;
    const row = { id, ...fields };
    state[this.name].push(row);
    save();
    return row;
  }

  get(id) {
    return state[this.name].find(r => r.id === Number(id));
  }

  all(filterFn) {
    const rows = filterFn ? state[this.name].filter(filterFn) : [...state[this.name]];
    return rows;
  }

  find(filterFn) {
    return state[this.name].find(filterFn);
  }

  update(id, patch) {
    const row = this.get(id);
    if (!row) return null;
    Object.assign(row, patch);
    save();
    return row;
  }
}

module.exports = {
  tracks: new Collection('tracks'),
  tasks: new Collection('tasks'),
  wordProgress: new Collection('wordProgress'),
  journalEntries: new Collection('journalEntries'),
  saveNow,
};
