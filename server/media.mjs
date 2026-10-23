import fs from 'node:fs';
import path from 'node:path';

const UPLOAD_TTL_MS = 24 * 60 * 60 * 1000;

function mediaError(status, message) { return Object.assign(new Error(message), { status }); }

export function parseMediaPath(url) {
  if (typeof url !== 'string' || url.length > 250 || !/^\/(vehicles|uploads)\/[A-Za-z0-9][A-Za-z0-9_./-]*\.(?:jpg|jpeg|png|webp)$/.test(url)) throw mediaError(400, '图片须为本站的 JPG、PNG 或 WebP 文件');
  const parts = url.slice(1).split('/');
  if (parts.some(part => !part || part === '.' || part === '..') || (parts[0] === 'uploads' && parts.length !== 2)) throw mediaError(400, '图片路径不正确');
  if (!parts.slice(1, -1).every(part => /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(part)) || !/^[A-Za-z0-9][A-Za-z0-9_-]*\.(?:jpg|jpeg|png|webp)$/.test(parts.at(-1))) throw mediaError(400, '图片文件名或目录名不正确');
  return { namespace: parts[0], parts: parts.slice(1) };
}

export function createMediaStore({ db, publicDir, uploadDir }) {
  const roots = { vehicles: path.resolve(publicDir, 'vehicles'), uploads: path.resolve(uploadDir) };
  db.exec(`CREATE TABLE IF NOT EXISTS pending_uploads (url TEXT PRIMARY KEY, owner TEXT NOT NULL, created_at INTEGER NOT NULL, discarded INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS media_gc (url TEXT PRIMARY KEY);`);
  if (!db.prepare('PRAGMA table_info(pending_uploads)').all().some(column => column.name === 'discarded')) db.exec('ALTER TABLE pending_uploads ADD COLUMN discarded INTEGER NOT NULL DEFAULT 0');

  // Check every component, including the configured root. Never traverse a symlink/junction.
  function resolve(url, required = false) {
    const { namespace, parts } = parseMediaPath(url);
    const root = roots[namespace];
    const target = path.resolve(root, ...parts);
    const relative = path.relative(root, target);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw mediaError(400, '图片路径越界');
    const absoluteParts = path.parse(root);
    let current = absoluteParts.root;
    const rootSegments = root.slice(absoluteParts.root.length).split(path.sep).filter(Boolean);
    const segments = [...rootSegments, ...parts];
    for (let i = 0; i < segments.length; i++) {
      const parent = current;
      current = path.join(current, segments[i]);
      let stat;
      try { stat = fs.lstatSync(current); }
      catch (error) {
        if (error.code === 'ENOENT' || error.code === 'ENOTDIR') {
          if (required) throw mediaError(400, '图片文件不存在，请重新上传');
          return { path: target, exists: false };
        }
        throw error;
      }
      // URLs are exact database keys, including on case-insensitive filesystems.
      // Require the stored filename spelling without changing legitimate capitals.
      if (i >= rootSegments.length && !fs.readdirSync(parent).includes(segments[i])) throw mediaError(400, '图片路径大小写与文件名不一致');
      if (stat.isSymbolicLink()) throw mediaError(400, '图片路径不能包含符号链接');
      if (i < segments.length - 1 && !stat.isDirectory()) throw mediaError(400, '图片目录不正确');
      if (i === segments.length - 1 && !stat.isFile()) throw mediaError(400, '图片路径必须指向文件');
    }
    return { path: target, exists: true };
  }
  function references() {
    const refs = new Set();
    for (const row of db.prepare('SELECT document FROM vehicles').all()) {
      const vehicle = JSON.parse(row.document);
      for (const url of vehicle.images ?? []) refs.add(url);
    }
    const settings = JSON.parse(db.prepare('SELECT document FROM settings WHERE id=1').get().document);
    if (settings.logoUrl) refs.add(settings.logoUrl);
    return refs;
  }
  function validate(urls, owner) {
    for (const url of new Set(urls.filter(Boolean))) {
      resolve(url, true);
      const pending = db.prepare('SELECT owner,discarded FROM pending_uploads WHERE url=?').get(url);
      if (pending && pending.owner !== owner) throw mediaError(403, '此图片属于其他登录会话的未保存草稿');
      if (pending?.discarded) throw mediaError(409, '此图片已丢弃，请重新上传');
    }
  }
  function adopt(urls, owner) {
    for (const url of new Set(urls.filter(Boolean))) {
      db.prepare('DELETE FROM pending_uploads WHERE url=? AND owner=?').run(url, owner ?? '');
      db.prepare('DELETE FROM media_gc WHERE url=?').run(url);
    }
  }
  function remove(url) {
    const file = resolve(url);
    if (file.exists) fs.unlinkSync(file.path);
    db.prepare('DELETE FROM pending_uploads WHERE url=?').run(url);
    db.prepare('DELETE FROM media_gc WHERE url=?').run(url);
  }
  function sweepQueued() {
    const refs = references();
    const deleted = [], pending = [];
    for (const { url } of db.prepare('SELECT url FROM media_gc').all()) {
      if (refs.has(url)) { db.prepare('DELETE FROM media_gc WHERE url=?').run(url); continue; }
      const draft = db.prepare('SELECT created_at,discarded FROM pending_uploads WHERE url=?').get(url);
      if (draft && !draft.discarded && draft.created_at > Date.now() - UPLOAD_TTL_MS) { pending.push(url); continue; }
      try { remove(url); deleted.push(url); }
      catch (error) { console.warn(`图片暂未清理：${url} (${error.code ?? error.message})`); pending.push(url); }
    }
    return { deleted, pending };
  }
  function queue(urls) {
    for (const url of new Set(urls.filter(Boolean))) db.prepare('INSERT OR IGNORE INTO media_gc(url) VALUES(?)').run(url);
  }
  function discard(urls, owner) {
    if (!Array.isArray(urls) || urls.length > 100) throw mediaError(400, '请提供不超过 100 个临时上传地址');
    for (const url of urls) if (parseMediaPath(url).namespace !== 'uploads') throw mediaError(400, '只能丢弃临时上传文件');
    const refs = references();
    const discarded = [], pending = [];
    for (const url of new Set(urls)) {
      const draft = db.prepare('SELECT owner FROM pending_uploads WHERE url=?').get(url);
      if (!draft || draft.owner !== owner || refs.has(url)) continue;
      db.prepare('UPDATE pending_uploads SET discarded=1 WHERE url=? AND owner=?').run(url, owner);
      try { remove(url); discarded.push(url); }
      catch (error) {
        db.prepare('INSERT OR IGNORE INTO media_gc(url) VALUES(?)').run(url);
        pending.push(url);
        console.warn(`临时图片暂未清理：${url} (${error.code ?? error.message})`);
      }
    }
    return { discarded, pending };
  }
  function cleanupExpired() {
    const refs = references();
    const cutoff = Date.now() - UPLOAD_TTL_MS;
    // Older releases did not track drafts. Reclaim only regular, unreferenced
    // uploaded images whose filesystem age is past the same 24-hour grace.
    resolve('/uploads/media-safety-check.png');
    for (const entry of fs.readdirSync(roots.uploads, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const url = `/uploads/${entry.name}`;
      try { parseMediaPath(url); } catch { continue; }
      if (refs.has(url) || db.prepare('SELECT url FROM pending_uploads WHERE url=?').get(url)) continue;
      const file = resolve(url, true);
      if (fs.lstatSync(file.path).mtimeMs <= cutoff) db.prepare('INSERT OR IGNORE INTO media_gc(url) VALUES(?)').run(url);
    }
    for (const { url } of db.prepare('SELECT url FROM pending_uploads WHERE created_at<=? OR discarded=1').all(cutoff)) {
      if (refs.has(url)) db.prepare('DELETE FROM pending_uploads WHERE url=?').run(url);
      else db.prepare('INSERT OR IGNORE INTO media_gc(url) VALUES(?)').run(url);
    }
    return sweepQueued();
  }
  function trackUpload(url, owner) {
    resolve(url, true);
    db.prepare('INSERT INTO pending_uploads(url,owner,created_at) VALUES(?,?,?)').run(url, owner, Date.now());
  }
  return { resolve, validate, adopt, queue, sweepQueued, discard, cleanupExpired, trackUpload };
}
