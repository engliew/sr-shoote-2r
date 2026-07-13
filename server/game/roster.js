'use strict';

const fs = require('fs');
const path = require('path');

const ROSTER_PATH = path.join(__dirname, '..', '..', 'data', 'roster.json');

let cache = null;

function loadRoster() {
  if (cache) return cache;
  try {
    const raw = fs.readFileSync(ROSTER_PATH, 'utf8');
    const list = JSON.parse(raw);
    cache = Array.isArray(list) ? list : [];
  } catch (err) {
    console.warn('Failed to load roster.json, using fallback:', err.message);
    cache = [
      { id: 'guest1', name: 'Guest', points: 25, face: '' },
      { id: 'guest2', name: 'VIP', points: 75, face: '' },
    ];
  }
  return cache;
}

function saveRoster(list) {
  const cleaned = (list || []).map((p) => ({
    id: String(p.id || slugify(p.name)),
    name: String(p.name || 'Target').slice(0, 32),
    points: Math.max(1, Math.min(9999, Number(p.points) || 10)),
    face: String(p.face || ''),
  }));
  fs.writeFileSync(ROSTER_PATH, JSON.stringify(cleaned, null, 2) + '\n', 'utf8');
  cache = cleaned;
  return cache;
}

function slugify(name) {
  return (
    String(name || 'target')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 24) || 'target'
  ) + `_${Date.now().toString(36).slice(-4)}`;
}

function pickRandomPerson() {
  const roster = loadRoster();
  if (!roster.length) {
    return { id: 'unknown', name: '???', points: 10, face: '' };
  }
  return roster[Math.floor(Math.random() * roster.length)];
}

function listTargets() {
  return loadRoster()
    .map((p) => ({
      id: p.id,
      name: p.name,
      points: p.points,
      face: p.face || '',
    }))
    .sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));
}

const FACES_DIR = path.join(__dirname, '..', '..', 'public', 'assets', 'faces');

function safeFaceFilename(name, originalName) {
  const base =
    String(name || 'target')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 24) || 'target';
  const ext = path.extname(originalName || '').toLowerCase() === '.png' ? '.png' : '.png';
  // unique so re-uploads don't collide
  return `${base}_${Date.now().toString(36).slice(-5)}${ext}`;
}

/**
 * Save a PNG from base64 data URL or raw base64 into public/assets/faces/
 * Returns the stored filename (relative, e.g. alice_ab12c.png)
 */
function saveFacePng(name, faceBase64, originalName) {
  if (!faceBase64 || typeof faceBase64 !== 'string') return '';
  let b64 = faceBase64.trim();
  // data:image/png;base64,....
  const m = b64.match(/^data:image\/png;base64,(.+)$/i);
  if (m) b64 = m[1];
  else if (b64.startsWith('data:')) {
    throw new Error('Only PNG images are allowed');
  }
  const buf = Buffer.from(b64, 'base64');
  // PNG magic: 89 50 4E 47
  if (buf.length < 8 || buf[0] !== 0x89 || buf[1] !== 0x50 || buf[2] !== 0x4e || buf[3] !== 0x47) {
    throw new Error('File is not a valid PNG');
  }
  if (buf.length > 4 * 1024 * 1024) {
    throw new Error('PNG must be under 4MB');
  }
  if (!fs.existsSync(FACES_DIR)) fs.mkdirSync(FACES_DIR, { recursive: true });
  const filename = safeFaceFilename(name, originalName || 'face.png');
  fs.writeFileSync(path.join(FACES_DIR, filename), buf);
  return filename;
}

function addTarget({ name, points, face, faceBase64, faceOriginalName }) {
  const roster = [...loadRoster()];
  let faceFile = String(face || '').trim();
  if (faceBase64) {
    faceFile = saveFacePng(name, faceBase64, faceOriginalName);
  }
  // only allow simple face filenames (no paths)
  faceFile = faceFile.replace(/[^a-zA-Z0-9._-]/g, '');
  if (faceFile && !faceFile.toLowerCase().endsWith('.png')) {
    faceFile = `${faceFile}.png`;
  }
  const entry = {
    id: slugify(name),
    name: String(name || '').trim().slice(0, 32) || 'Target',
    points: Math.max(1, Math.min(9999, Number(points) || 10)),
    face: faceFile,
  };
  roster.push(entry);
  saveRoster(roster);
  return entry;
}

function removeTarget(id) {
  const roster = loadRoster();
  const victim = roster.find((p) => p.id === id);
  const next = roster.filter((p) => p.id !== id);
  if (next.length === roster.length) return false;
  saveRoster(next);
  // best-effort remove face file if unused
  if (victim && victim.face) {
    const stillUsed = next.some((p) => p.face === victim.face);
    if (!stillUsed) {
      const fp = path.join(FACES_DIR, path.basename(victim.face));
      try {
        if (fs.existsSync(fp)) fs.unlinkSync(fp);
      } catch (_) {
        /* ignore */
      }
    }
  }
  return true;
}

function reloadRoster() {
  cache = null;
  return loadRoster();
}

module.exports = {
  loadRoster,
  pickRandomPerson,
  reloadRoster,
  listTargets,
  addTarget,
  removeTarget,
  saveRoster,
  saveFacePng,
  FACES_DIR,
};
