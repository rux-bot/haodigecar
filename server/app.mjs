import express from 'express';
import multer from 'multer';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomUUID, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMediaStore, parseMediaPath } from './media.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SESSION_MS = 12 * 60 * 60 * 1000;
const COOKIE = 'fleet_session';
const BODY_TYPES = ['面包', '平板', '厢货', '高栏'];
const AVAILABILITY = ['待确认', '有现车', '需预订'];
const DEFAULT_SETTINGS = { siteName: '浙江好滴哥物流科技有限公司', tagline: '商用车租售，一站选好车', phone: '', wechat: '', address: '', logoUrl: '' };
const VEHICLE_KEYS = new Set(['id', 'name', 'brand', 'temperature', 'bodyType', 'bodyTypes', 'published', 'availability', 'description', 'highlights', 'specs', 'images', 'sourceFiles', 'battery', 'range', 'cargoVolume', 'payload', 'dimensions']);

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function ensureDirectory(file) { fs.mkdirSync(path.dirname(file), { recursive: true }); }
function sha(value) { return createHash('sha256').update(value).digest('hex'); }
function passwordHash(password, salt = randomBytes(16).toString('hex')) {
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}
function passwordMatches(password, stored) {
  const [salt, encoded] = stored.split(':');
  const computed = scryptSync(password, salt, 64);
  const expected = Buffer.from(encoded, 'hex');
  return computed.length === expected.length && timingSafeEqual(computed, expected);
}
function cookies(header = '') {
  return Object.fromEntries(header.split(';').map(part => part.trim().split('=')).filter(part => part.length === 2));
}
function isObject(value) { return !!value && typeof value === 'object' && !Array.isArray(value); }
function text(value, label, max = 300, required = false) {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim()) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) {
    throw new HttpError(400, `${label}格式不正确${required ? '，且不能为空' : ''}`);
  }
  return value.trim();
}
function imagePath(value) {
  const result = text(value, '图片路径', 250, true);
  parseMediaPath(result);
  return result;
}
function validateVehicle(input, existing) {
  if (!isObject(input)) throw new HttpError(400, '车型数据格式不正确');
  for (const key of Object.keys(input)) if (!VEHICLE_KEYS.has(key)) throw new HttpError(400, `不支持的车型字段：${key}`);
  if (existing && input.id !== undefined && input.id !== existing.id) throw new HttpError(400, '不能修改车型编号');
  const value = { description: '', highlights: [], specs: [], images: [], sourceFiles: [], battery: '', range: '', cargoVolume: '', payload: '', dimensions: '', published: false, availability: '待确认', ...existing, ...input };
  value.id = value.id || `vehicle-${randomUUID()}`;
  if (typeof value.id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,99}$/.test(value.id)) throw new HttpError(400, '车型编号须为小写字母、数字和连字符');
  value.name = text(value.name, '车型名称', 180, true);
  value.brand = text(value.brand, '品牌', 80, true);
  if (!['常温', '冷藏'].includes(value.temperature)) throw new HttpError(400, '请选择常温或冷藏');
  if (!BODY_TYPES.includes(value.bodyType)) throw new HttpError(400, '请选择正确的车身类型');
  if (!AVAILABILITY.includes(value.availability)) throw new HttpError(400, '请选择正确的现车情况');
  if (typeof value.published !== 'boolean') throw new HttpError(400, '上架状态须为布尔值');
  value.description = text(value.description, '车型介绍', 5000);
  for (const key of ['battery', 'range', 'cargoVolume', 'payload', 'dimensions']) value[key] = text(value[key] ?? '', key, 500);
  for (const [key, max, length] of [['highlights', 30, 500], ['sourceFiles', 10, 250], ['images', 30, 250]]) {
    if (!Array.isArray(value[key]) || value[key].length > max) throw new HttpError(400, `${key}数量不正确`);
    value[key] = value[key].map(v => key === 'images' ? imagePath(v) : text(v, key, length, true));
  }
  if (!Array.isArray(value.specs) || value.specs.length > 200) throw new HttpError(400, '参数数量不正确');
  value.specs = value.specs.map(v => {
    if (!isObject(v)) throw new HttpError(400, '参数格式不正确');
    return { label: text(v.label, '参数名称', 200, true), value: text(v.value, '参数内容', 4000, true) };
  });
  if (input.bodyType !== undefined && input.bodyTypes === undefined) value.bodyTypes = [value.bodyType];
  value.bodyTypes ??= [value.bodyType];
  if (!Array.isArray(value.bodyTypes) || value.bodyTypes.length > 4 || !value.bodyTypes.every(t => BODY_TYPES.includes(t))) throw new HttpError(400, '车身类型格式不正确');
  value.bodyTypes = [...new Set([value.bodyType, ...value.bodyTypes])];
  return value;
}
function validateSettings(input, current) {
  if (!isObject(input)) throw new HttpError(400, '网站设置格式不正确');
  for (const key of Object.keys(input)) if (!Object.hasOwn(DEFAULT_SETTINGS, key)) throw new HttpError(400, `不支持的网站设置：${key}`);
  const merged = { ...DEFAULT_SETTINGS, ...current, ...input };
  for (const key of Object.keys(DEFAULT_SETTINGS)) merged[key] = text(merged[key], key, key === 'address' ? 300 : key === 'logoUrl' ? 250 : 120, key === 'siteName');
  if (merged.logoUrl && !/^\/uploads\/[A-Za-z0-9][A-Za-z0-9_-]*\.(?:jpg|jpeg|png|webp)$/.test(merged.logoUrl)) throw new HttpError(400, '公司图标须为本站上传的 JPG、PNG 或 WebP 图片');
  if (merged.phone && !/^[+\d\s()（）-]{3,40}$/.test(merged.phone)) throw new HttpError(400, '联系电话格式不正确');
  return merged;
}
function readPassword(value, label = '密码') {
  if (typeof value !== 'string' || !value.length || value.length > 512 || Buffer.byteLength(value, 'utf8') > 1024) throw new HttpError(400, `${label}格式不正确`);
  return value;
}
function strongPassword(value) {
  const password = readPassword(value, '新密码');
  const length = [...password].length;
  if (length < 12 || length > 128 || !/\p{L}/u.test(password) || !/\p{N}/u.test(password) || /[\u0000-\u001f\u007f]/.test(password)) throw new HttpError(400, '密码需为 12–128 个字符，同时包含字母和数字，可使用空格和中文');
  return password;
}
function credentials(body, requireStrongPassword = false) {
  if (!isObject(body)) throw new HttpError(400, '请填写账号和密码');
  const username = text(body.username, '账号', 64, true);
  if (!/^[A-Za-z0-9_@.\-]{3,64}$/.test(username)) throw new HttpError(400, '账号需为 3–64 位字母、数字或 _ @ . -');
  // Login must continue to accept passwords created before the stronger policy.
  const password = requireStrongPassword ? strongPassword(body.password) : readPassword(body.password);
  return { username, password };
}
function publicVehicle(vehicle) { const { sourceFiles, ...result } = vehicle; return result; }

export function createApp(options = {}) {
  const dbPath = options.dbPath ?? path.join(ROOT, 'data/catalog.sqlite');
  const seedPath = options.seedPath ?? path.join(ROOT, 'data/vehicles.json');
  const publicDir = options.publicDir ?? path.join(ROOT, 'public');
  const uploadDir = options.uploadDir ?? path.join(publicDir, 'uploads');
  const distDir = options.distDir ?? path.join(ROOT, 'dist');
  const secureCookies = options.secureCookies ?? (process.env.COOKIE_SECURE === undefined ? process.env.NODE_ENV === 'production' : process.env.COOKIE_SECURE === 'true');
  const allowSetup = options.allowSetup ?? process.env.NODE_ENV !== 'production';
  const publicOrigin = options.publicOrigin ?? process.env.PUBLIC_ORIGIN;
  const allowedOrigins = new Set(options.allowedOrigins ?? (publicOrigin ? [publicOrigin.replace(/\/$/, '')] : ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:3001', 'http://127.0.0.1:3001']));
  if (dbPath !== ':memory:') ensureDirectory(dbPath);
  fs.mkdirSync(uploadDir, { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS vehicles (id TEXT PRIMARY KEY, document TEXT NOT NULL, position INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY CHECK(id=1), document TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS admins (id INTEGER PRIMARY KEY CHECK(id=1), username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, csrf TEXT NOT NULL, expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS auth_throttle (scope TEXT NOT NULL, bucket TEXT NOT NULL, failures INTEGER NOT NULL, reset_at INTEGER NOT NULL, PRIMARY KEY(scope,bucket));
    CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
  db.prepare('INSERT OR IGNORE INTO settings(id,document) VALUES(1,?)').run(JSON.stringify(DEFAULT_SETTINGS));
  const media = createMediaStore({ db, publicDir, uploadDir });
  if (!db.prepare("SELECT value FROM metadata WHERE key='seeded'").get() && fs.existsSync(seedPath)) {
    const seed = JSON.parse(fs.readFileSync(seedPath, 'utf8').replace(/^\uFEFF/, ''));
    if (!Array.isArray(seed)) throw new Error('车型种子文件必须是 JSON 数组');
    db.exec('BEGIN');
    try {
      const insert = db.prepare('INSERT OR IGNORE INTO vehicles(id,document,position) VALUES(?,?,?)');
      seed.forEach((v, index) => { const value = validateVehicle(v); media.validate(value.images); insert.run(value.id, JSON.stringify(value), index); });
      db.prepare("INSERT INTO metadata(key,value) VALUES('seeded','1')").run();
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); db.close(); throw error; }
  }
  const getSettings = () => ({ ...DEFAULT_SETTINGS, ...JSON.parse(db.prepare('SELECT document FROM settings WHERE id=1').get().document) });
  const getVehicles = () => db.prepare('SELECT document FROM vehicles ORDER BY position,id').all().map(r => JSON.parse(r.document));
  const getVehicle = id => { const row = db.prepare('SELECT document FROM vehicles WHERE id=?').get(id); return row ? JSON.parse(row.document) : undefined; };
  const hasAdmin = () => !!db.prepare('SELECT id FROM admins LIMIT 1').get();
  function transaction(callback) {
    db.exec('BEGIN IMMEDIATE');
    try { const result = callback(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  media.cleanupExpired();
  const mediaSweep = setInterval(() => {
    try { media.cleanupExpired(); } catch (error) { console.warn('临时图片回收失败：', error.message); }
  }, 15 * 60 * 1000);
  mediaSweep.unref();
  const app = express();
  app.disable('x-powered-by');
  app.locals.db = db;
  app.locals.closeDatabase = () => { clearInterval(mediaSweep); db.close(); };
  app.use((req, res, next) => {
    res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin', 'X-Frame-Options': 'DENY' });
    if (process.env.NODE_ENV === 'production') res.set('Content-Security-Policy', "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
    next();
  });
  app.use(express.json({ limit: '256kb' }));
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    const rawToken = cookies(req.headers.cookie)[COOKIE];
    if (rawToken && /^[a-f0-9]{64}$/.test(rawToken)) {
      const session = db.prepare('SELECT csrf,expires_at FROM sessions WHERE token_hash=?').get(sha(rawToken));
      if (session && session.expires_at > Date.now()) { req.session = session; req.sessionToken = rawToken; }
    }
    next();
  });
  const enforceOrigin = (req, _res, next) => {
    const origin = req.get('origin');
    if (!origin || !allowedOrigins.has(origin)) return next(new HttpError(403, '请求来源不受信任，请从网站页面操作'));
    next();
  };
  const requireAdmin = (req, _res, next) => req.session ? next() : next(new HttpError(401, '请先登录管理后台'));
  const requireCsrf = (req, _res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    enforceOrigin(req, _res, error => {
      if (error) return next(error);
      const token = req.get('x-csrf-token');
      if (!req.session || typeof token !== 'string' || !/^[a-f0-9]{48}$/.test(token) || !timingSafeEqual(Buffer.from(token), Buffer.from(req.session.csrf))) return next(new HttpError(403, '安全校验失效，请刷新页面后重试'));
      next();
    });
  };
  const startSession = (req, res) => {
    if (req.sessionToken) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(sha(req.sessionToken));
    db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(Date.now());
    const raw = randomBytes(32).toString('hex');
    const csrfToken = randomBytes(24).toString('hex');
    db.prepare('INSERT INTO sessions(token_hash,csrf,expires_at) VALUES(?,?,?)').run(sha(raw), csrfToken, Date.now() + SESSION_MS);
    res.cookie(COOKIE, raw, { httpOnly: true, secure: secureCookies, sameSite: 'strict', path: '/', maxAge: SESSION_MS });
    return { authenticated: true, setupRequired: false, csrfToken };
  };
  const throttleWindow = 15 * 60 * 1000;
  const checkThrottle = (res, scope, bucket, limit) => {
    const entry = db.prepare('SELECT failures,reset_at FROM auth_throttle WHERE scope=? AND bucket=?').get(scope, bucket);
    if (entry && entry.reset_at > Date.now() && entry.failures >= limit) {
      res.set('Retry-After', String(Math.max(1, Math.ceil((entry.reset_at - Date.now()) / 1000))));
      throw new HttpError(429, '尝试次数过多，请 15 分钟后重试');
    }
  };
  const recordFailure = (scope, bucket) => {
    const now = Date.now();
    db.prepare('DELETE FROM auth_throttle WHERE reset_at<=?').run(now);
    db.prepare('INSERT INTO auth_throttle(scope,bucket,failures,reset_at) VALUES(?,?,1,?) ON CONFLICT(scope,bucket) DO UPDATE SET failures=auth_throttle.failures+1').run(scope, bucket, now + throttleWindow);
  };
  const loginBucket = req => sha(`${req.socket.remoteAddress}|${typeof req.body?.username === 'string' ? req.body.username.trim().toLowerCase().slice(0, 64) : ''}`);
  const clearSessionCookie = res => res.clearCookie(COOKIE, { path: '/', httpOnly: true, sameSite: 'strict', secure: secureCookies });

  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.get('/api/catalog', (_req, res) => res.json({ vehicles: getVehicles().filter(v => v.published).map(publicVehicle), settings: getSettings() }));
  app.get('/api/vehicles/:id', (req, res, next) => {
    const vehicle = getVehicle(req.params.id);
    if (!vehicle?.published) return next(new HttpError(404, '该车型暂未上架'));
    res.json({ vehicle: publicVehicle(vehicle) });
  });
  app.get('/api/auth/status', (req, res) => res.json({ setupRequired: !hasAdmin(), authenticated: !!req.session, ...(req.session ? { csrfToken: req.session.csrf } : {}) }));
  app.post('/api/auth/setup', enforceOrigin, (req, res, next) => {
    if (hasAdmin()) return next(new HttpError(409, '管理员已创建，请直接登录'));
    const address = req.socket.remoteAddress;
    const localAddress = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address);
    const originHost = new URL(req.get('origin')).hostname;
    if (!allowSetup || !localAddress || !['localhost', '127.0.0.1', '[::1]'].includes(req.hostname) || !['localhost', '127.0.0.1', '[::1]'].includes(originHost)) return next(new HttpError(403, '首次创建管理员需在正式部署前，在服务器本机通过 localhost 完成'));
    const bucket = sha(req.socket.remoteAddress);
    checkThrottle(res, 'setup', bucket, 5);
    let account;
    try { account = credentials(req.body, true); }
    catch (error) { recordFailure('setup', bucket); throw error; }
    const { username, password } = account;
    db.prepare('INSERT INTO admins(id,username,password_hash) VALUES(1,?,?)').run(username, passwordHash(password));
    res.status(201).json(startSession(req, res));
  });
  app.post('/api/auth/login', enforceOrigin, (req, res, next) => {
    const bucket = loginBucket(req);
    const ipBucket = sha(req.socket.remoteAddress);
    checkThrottle(res, 'login-ip', ipBucket, 30);
    checkThrottle(res, 'login', bucket, 10);
    const recordLoginFailure = () => { recordFailure('login', bucket); recordFailure('login-ip', ipBucket); };
    let account;
    try { account = credentials(req.body); }
    catch (error) { recordLoginFailure(); throw error; }
    const { username, password } = account;
    const admin = db.prepare('SELECT username,password_hash FROM admins WHERE id=1').get();
    const dummyHash = '00000000000000000000000000000000:70a5a74b1b4f9da6ec29d1fd431fcf378eddbebd12c4682d4a0df999b0dab6462dd09b496508bde54e7390eecedbd183efbd9ae6bf381c3bb238c9e9e8bad888';
    const matches = passwordMatches(password, admin?.password_hash ?? dummyHash);
    if (!admin || username !== admin.username || !matches) { recordLoginFailure(); return next(new HttpError(401, '账号或密码不正确')); }
    res.json(startSession(req, res));
  });
  app.post('/api/auth/logout', requireAdmin, requireCsrf, (req, res) => {
    db.prepare('DELETE FROM sessions WHERE token_hash=?').run(sha(req.sessionToken));
    clearSessionCookie(res);
    res.json({ authenticated: false, setupRequired: false });
  });
  app.use('/api/admin', requireAdmin, requireCsrf);
  app.post('/api/admin/password', (req, res) => {
    // One account's password attempts are shared across its sessions and IPs.
    // This limiter never applies to catalog traffic or unrelated login buckets.
    const bucket = 'admin:1';
    checkThrottle(res, 'password', bucket, 5);
    if (!isObject(req.body)) throw new HttpError(400, '请填写当前密码和新密码');
    const currentPassword = readPassword(req.body.currentPassword, '当前密码');
    const newPassword = strongPassword(req.body.newPassword);
    const admin = db.prepare('SELECT password_hash FROM admins WHERE id=1').get();
    if (!admin) throw new HttpError(401, '请重新登录管理后台');
    if (!passwordMatches(currentPassword, admin.password_hash)) {
      recordFailure('password', bucket);
      throw new HttpError(403, '当前密码不正确');
    }
    if (currentPassword === newPassword) throw new HttpError(400, '新密码不能与当前密码相同');
    const hash = passwordHash(newPassword);
    transaction(() => {
      db.prepare('UPDATE admins SET password_hash=? WHERE id=1').run(hash);
      db.prepare('DELETE FROM sessions').run();
    });
    clearSessionCookie(res);
    res.json({ changed: true, requiresLogin: true });
  });
  app.get('/api/admin/vehicles', (_req, res) => res.json({ vehicles: getVehicles() }));
  app.post('/api/admin/vehicles', (req, res, next) => {
    const vehicle = validateVehicle(req.body);
    if (getVehicle(vehicle.id)) return next(new HttpError(409, '车型编号已存在'));
    const owner = sha(req.sessionToken);
    media.validate(vehicle.images, owner);
    const position = db.prepare('SELECT COALESCE(MAX(position),-1)+1 AS position FROM vehicles').get().position;
    transaction(() => {
      db.prepare('INSERT INTO vehicles(id,document,position) VALUES(?,?,?)').run(vehicle.id, JSON.stringify(vehicle), position);
      media.adopt(vehicle.images, owner);
    });
    res.status(201).json({ vehicle });
  });
  app.patch('/api/admin/vehicles/:id', (req, res, next) => {
    const existing = getVehicle(req.params.id);
    if (!existing) return next(new HttpError(404, '车型不存在'));
    const vehicle = validateVehicle(req.body, existing);
    const owner = sha(req.sessionToken);
    media.validate(vehicle.images, owner);
    transaction(() => {
      db.prepare('UPDATE vehicles SET document=? WHERE id=?').run(JSON.stringify(vehicle), vehicle.id);
      media.adopt(vehicle.images, owner);
      media.queue(existing.images);
    });
    res.json({ vehicle, mediaCleanup: media.sweepQueued() });
  });
  app.delete('/api/admin/vehicles/:id', (req, res, next) => {
    const existing = getVehicle(req.params.id);
    if (!existing) return next(new HttpError(404, '车型不存在'));
    transaction(() => {
      db.prepare('DELETE FROM vehicles WHERE id=?').run(existing.id);
      media.queue(existing.images);
    });
    res.json({ deleted: true, id: existing.id, mediaCleanup: media.sweepQueued() });
  });
  app.get('/api/admin/settings', (_req, res) => res.json({ settings: getSettings() }));
  app.put('/api/admin/settings', (req, res) => {
    const previous = getSettings();
    const settings = validateSettings(req.body, previous);
    const owner = sha(req.sessionToken);
    media.validate([settings.logoUrl], owner);
    transaction(() => {
      db.prepare('UPDATE settings SET document=? WHERE id=1').run(JSON.stringify(settings));
      media.adopt([settings.logoUrl], owner);
      media.queue([previous.logoUrl]);
    });
    res.json({ settings, mediaCleanup: media.sweepQueued() });
  });
  app.post('/api/admin/uploads/discard', (req, res) => {
    if (!isObject(req.body)) throw new HttpError(400, '请提供临时上传地址');
    res.json(media.discard(req.body.urls, sha(req.sessionToken)));
  });
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024, files: 1, fields: 0 } });
  app.post('/api/admin/uploads', upload.single('file'), (req, res, next) => {
    if (!req.file) return next(new HttpError(400, '请选择一张图片'));
    const bytes = req.file.buffer;
    let extension;
    if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) extension = 'png';
    else if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) extension = 'jpg';
    else if (bytes.length >= 12 && bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP') extension = 'webp';
    if (!extension) return next(new HttpError(400, '仅支持 JPG、PNG 或 WebP 图片'));
    const name = `${randomUUID()}.${extension}`;
    const url = `/uploads/${name}`;
    const target = media.resolve(url).path;
    fs.writeFileSync(target, bytes, { flag: 'wx' });
    try { media.trackUpload(url, sha(req.sessionToken)); }
    catch (error) { fs.unlinkSync(target); throw error; }
    res.status(201).json({ url });
  });
  app.use('/api', (_req, _res, next) => next(new HttpError(404, '接口不存在')));
  // Static middleware decodes URLs and Windows accepts backslash separators.
  // Reject alternate media spellings before any mount or generic static fallback.
  app.use((req, _res, next) => {
    let decoded;
    try { decoded = decodeURIComponent(req.path); }
    catch { return next(new HttpError(400, '页面路径不正确')); }
    const normalized = path.posix.normalize(decoded.replaceAll('\\', '/'));
    if (/^\/(vehicles|uploads)(\/|$)/i.test(normalized) &&
        (normalized !== req.path || !/^\/(vehicles|uploads)(\/|$)/.test(normalized))) return next(new HttpError(404, '图片不存在'));
    next();
  });
  const serveMedia = namespace => (req, res, next) => {
    if (namespace === 'vehicles' && /^\/(?:[a-z0-9-]+\/?)*$/.test(req.path) && req.path.split('/').filter(Boolean).length <= 1) return next();
    if (!['GET', 'HEAD'].includes(req.method)) return next(new HttpError(405, '不支持的图片请求方式'));
    try {
      const file = media.resolve(`/${namespace}${req.path}`, true);
      res.sendFile(file.path, { headers: { 'Cache-Control': 'public, max-age=31536000, immutable' } }, error => {
        if (error) next(new HttpError(error.status === 404 ? 404 : 500, '图片暂不可用'));
      });
    } catch (error) { next(new HttpError(error.status === 400 ? 404 : 500, '图片不存在')); }
  };
  app.use('/uploads', serveMedia('uploads'));
  app.use('/vehicles', serveMedia('vehicles'));
  // These namespaces are served only from their authoritative source directories.
  // Vite's older build may contain copied media; never fall back to those copies.
  const outsideMedia = handler => (req, res, next) => /^\/(vehicles|uploads)(\/|$)/i.test(req.path) ? next() : handler(req, res, next);
  app.use(outsideMedia(express.static(publicDir, { index: false, dotfiles: 'deny' })));
  if (fs.existsSync(path.join(distDir, 'index.html'))) {
    app.use(outsideMedia(express.static(distDir, { index: false })));
    app.get('/{*path}', (req, res, next) => {
      if (path.extname(req.path)) return next();
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }
  app.use((_req, _res, next) => next(new HttpError(404, '页面不存在')));
  app.use((error, _req, res, _next) => {
    if (error instanceof multer.MulterError) return res.status(400).json({ error: error.code === 'LIMIT_FILE_SIZE' ? '图片大小不能超过 8 MB' : '上传格式不正确，请每次选择一张图片' });
    if (error.type === 'entity.too.large') return res.status(413).json({ error: '请求内容过大' });
    if (error instanceof SyntaxError && error.status === 400 && 'body' in error) return res.status(400).json({ error: 'JSON 格式不正确' });
    if (!error.status) console.error('API error:', error);
    res.status(error.status ?? 500).json({ error: error.status ? error.message : '服务暂时不可用，请稍后重试' });
  });
  return app;
}
