import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { createApp } from '../server/app.mjs';

const ORIGIN = 'http://localhost:5173';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9ioAAAAASUVORK5CYII=', 'base64');
const fixture = { id: 'test-van', name: '测试面包车', brand: '测试品牌', temperature: '常温', bodyType: '面包', published: true, availability: '待确认', description: '原文车型说明', images: ['/vehicles/test-van/1.jpg'], specs: [{ label: '电池容量', value: '42 kWh' }], sourceFiles: ['test.docx'] };

test('车型后台完整业务与安全边界', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vehicle-api-'));
  const seedPath = path.join(dir, 'vehicles.json');
  const dbPath = path.join(dir, 'catalog.sqlite');
  fs.writeFileSync(seedPath, JSON.stringify([fixture, { ...fixture, id: 'hidden-truck', name: '未上架冷藏车', temperature: '冷藏', bodyType: '厢货', published: false }]));
  const options = { dbPath, seedPath, publicDir: path.join(dir, 'public'), uploadDir: path.join(dir, 'uploads'), distDir: path.join(dir, 'dist'), allowedOrigins: [ORIGIN] };
  fs.mkdirSync(path.join(options.publicDir, 'vehicles/test-van'), { recursive: true });
  fs.writeFileSync(path.join(options.publicDir, fixture.images[0]), PNG);
  let app, server, base;
  let cookie = '', csrf = '', uploadedLogoUrl = '';
  async function start() {
    app = createApp(options);
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    base = `http://127.0.0.1:${server.address().port}`;
  }
  async function stop() { await new Promise(resolve => server.close(resolve)); app.locals.closeDatabase(); }
  async function request(url, { method = 'GET', body, auth = true, origin = ORIGIN, token = csrf, raw, headers = {} } = {}) {
    const response = await fetch(base + url, {
      method,
      headers: { ...(origin ? { Origin: origin } : {}), ...(auth && cookie ? { Cookie: cookie } : {}), ...(token ? { 'x-csrf-token': token } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
    });
    return { status: response.status, data: await response.json(), response };
  }
  await start();
  t.after(async () => { await stop(); fs.rmSync(dir, { recursive: true, force: true }); });

  await t.test('公开目录与详情仅返回上架车型', async () => {
    const result = await request('/api/catalog');
    assert.equal(result.status, 200);
    assert.equal(result.data.vehicles.length, 1);
    assert.equal(result.data.vehicles[0].availability, '待确认');
    assert.equal(result.data.vehicles[0].sourceFiles, undefined);
    assert.equal((await request('/api/vehicles/hidden-truck')).status, 404);
    assert.equal((await request('/api/admin/vehicles', { auth: false })).status, 401);
    assert.equal((await request('/api/auth/status')).data.setupRequired, true);
  });
  await t.test('管理员初始化拒绝无来源、外站和弱密码，只允许创建一次', async () => {
    const body = { username: 'fleet-admin', password: 'StrongPass123!' };
    assert.equal((await request('/api/auth/setup', { method: 'POST', body, origin: null })).status, 403);
    assert.equal((await request('/api/auth/setup', { method: 'POST', body, origin: 'https://evil.example' })).status, 403);
    assert.equal((await request('/api/auth/setup', { method: 'POST', body: { ...body, password: 'short' } })).status, 400);
    const created = await request('/api/auth/setup', { method: 'POST', body });
    assert.equal(created.status, 201);
    assert.equal(created.data.authenticated, true);
    csrf = created.data.csrfToken;
    cookie = created.response.headers.get('set-cookie').split(';')[0];
    assert.match(created.response.headers.get('set-cookie'), /HttpOnly/);
    assert.match(created.response.headers.get('set-cookie'), /SameSite=Strict/);
    assert.equal((await request('/api/auth/setup', { method: 'POST', body })).status, 409);
  });
  await t.test('编辑要求登录、有效来源和 CSRF，Unicode 伪造令牌被拒绝', async () => {
    const change = { method: 'PATCH', body: { published: false } };
    assert.equal((await request('/api/admin/vehicles/test-van', { ...change, auth: false })).status, 401);
    assert.equal((await request('/api/admin/vehicles/test-van', { ...change, token: '' })).status, 403);
    assert.equal((await request('/api/admin/vehicles/test-van', { ...change, token: 'é'.repeat(48) })).status, 403);
    assert.equal((await request('/api/admin/vehicles/test-van', { ...change, origin: 'https://evil.example' })).status, 403);
    const admin = await request('/api/admin/vehicles');
    assert.equal(admin.data.vehicles.length, 2);
  });
  await t.test('上下架与现车状态独立，公开目录和详情同步改变', async () => {
    assert.equal((await request('/api/admin/vehicles/test-van', { method: 'PATCH', body: { published: false } })).status, 200);
    assert.equal((await request('/api/catalog')).data.vehicles.length, 0);
    assert.equal((await request('/api/vehicles/test-van')).status, 404);
    const published = await request('/api/admin/vehicles/test-van', { method: 'PATCH', body: { published: true, availability: '需预订' } });
    assert.equal(published.data.vehicle.availability, '需预订');
    const publicResult = await request('/api/vehicles/test-van');
    assert.equal(publicResult.status, 200);
    assert.equal(publicResult.data.vehicle.availability, '需预订');
  });
  await t.test('新增车型自动编号，拒绝错误分类、图片穿越、非法数据类型', async () => {
    const { id, ...newVehicle } = fixture;
    const created = await request('/api/admin/vehicles', { method: 'POST', body: { ...newVehicle, name: '新增高栏车', bodyType: '高栏', published: false } });
    assert.equal(created.status, 201);
    assert.match(created.data.vehicle.id, /^vehicle-[a-f0-9-]+$/);
    assert.deepEqual(created.data.vehicle.bodyTypes, ['高栏']);
    for (const body of [{ temperature: '未知' }, { images: ['/vehicles/../../secret.jpg'] }, { images: ['https://other.example/image.jpg'] }, { published: 'false' }, { specs: [{ label: '空参数', value: '' }] }, { id: 'renamed' }]) {
      assert.equal((await request('/api/admin/vehicles/test-van', { method: 'PATCH', body })).status, 400);
    }
    assert.equal((await request('/api/admin/vehicles/test-van', { method: 'PATCH', raw: '{broken', headers: { 'Content-Type': 'application/json' } })).status, 400);
  });
  await t.test('网站设置持久保存并公开，未知字段与恶意电话格式被拒绝', async () => {
    const saved = await request('/api/admin/settings', { method: 'PUT', body: { siteName: '测试租售公司', phone: '13800138000', wechat: 'test-fleet', address: '测试地址' } });
    assert.equal(saved.status, 200);
    assert.equal((await request('/api/catalog')).data.settings.siteName, '测试租售公司');
    assert.equal((await request('/api/admin/settings', { method: 'PUT', body: { phone: 'javascript:alert(1)' } })).status, 400);
    assert.equal((await request('/api/admin/settings', { method: 'PUT', body: { constructor: 'bad' } })).status, 400);
  });
  await t.test('旧版网站设置缺少图标字段时兼容读取，保留已存公司资料', async () => {
    const oldSettings = JSON.parse(app.locals.db.prepare('SELECT document FROM settings WHERE id=1').get().document);
    delete oldSettings.logoUrl;
    app.locals.db.prepare('UPDATE settings SET document=? WHERE id=1').run(JSON.stringify(oldSettings));
    await stop();
    await start();
    const publicSettings = (await request('/api/catalog')).data.settings;
    assert.equal(publicSettings.logoUrl, '');
    assert.equal(publicSettings.siteName, '测试租售公司');
    assert.equal((await request('/api/admin/settings')).data.settings.logoUrl, '');
    const saved = await request('/api/admin/settings', { method: 'PUT', body: { phone: '13800138000' } });
    assert.equal(saved.status, 200);
    assert.equal(saved.data.settings.logoUrl, '');
  });
  await t.test('只接受图片签名，SVG/HTML 伪装上传失败', async () => {
    const bad = new FormData();
    bad.append('file', new Blob(['<svg onload="alert(1)"></svg>'], { type: 'image/png' }), 'fake.png');
    assert.equal((await request('/api/admin/uploads', { method: 'POST', raw: bad })).status, 400);
    const good = new FormData();
    good.append('file', new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9ioAAAAASUVORK5CYII=', 'base64')], { type: 'image/png' }), 'vehicle.png');
    const uploaded = await request('/api/admin/uploads', { method: 'POST', raw: good });
    assert.equal(uploaded.status, 201);
    assert.match(uploaded.data.url, /^\/uploads\/[a-f0-9-]+\.png$/);
    assert.equal((await fetch(base + uploaded.data.url)).status, 200);
    uploadedLogoUrl = uploaded.data.url;
  });
  await t.test('公司图标可保存、替换和移除，并同步公开网站设置', async () => {
    const save = async logoUrl => request('/api/admin/settings', { method: 'PUT', body: { logoUrl } });
    assert.equal((await save(uploadedLogoUrl)).status, 200);
    assert.equal((await request('/api/catalog')).data.settings.logoUrl, uploadedLogoUrl);
    const secondImage = new FormData();
    secondImage.append('file', new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9ioAAAAASUVORK5CYII=', 'base64')], { type: 'image/png' }), 'new-logo.png');
    const replacement = await request('/api/admin/uploads', { method: 'POST', raw: secondImage });
    assert.equal(replacement.status, 201);
    assert.notEqual(replacement.data.url, uploadedLogoUrl);
    uploadedLogoUrl = replacement.data.url;
    assert.equal((await save(uploadedLogoUrl)).status, 200);
    assert.equal((await request('/api/catalog')).data.settings.logoUrl, uploadedLogoUrl);
    assert.equal((await save('')).status, 200);
    assert.equal((await request('/api/catalog')).data.settings.logoUrl, '');
    assert.equal((await fetch(base + uploadedLogoUrl)).status, 404);
    const restoredImage = new FormData();
    restoredImage.append('file', new Blob([PNG], { type: 'image/png' }), 'restored-logo.png');
    uploadedLogoUrl = (await request('/api/admin/uploads', { method: 'POST', raw: restoredImage })).data.url;
    assert.equal((await save(uploadedLogoUrl)).status, 200);
  });
  await t.test('公司图标拒绝外域、data、脚本格式及路径穿越，失败不覆盖已存图标', async () => {
    for (const logoUrl of ['https://other.example/logo.png', '//other.example/logo.png', 'data:image/png;base64,AAAA', '/uploads/logo.svg', '/uploads/logo.html', '/uploads/logo.png.html', '/uploads/../logo.png', '/uploads/%2e%2e/logo.png', '/uploads/sub/logo.png', '/vehicles/logo.png', '/uploads/logo.png?x=1', '/uploads\\logo.png', null]) {
      assert.equal((await request('/api/admin/settings', { method: 'PUT', body: { logoUrl } })).status, 400, `invalid logo: ${logoUrl}`);
    }
    assert.equal((await request('/api/catalog')).data.settings.logoUrl, uploadedLogoUrl);
  });
  await t.test('重启服务保留车型编辑、设置、账号及会话，不重复覆盖种子数据', async () => {
    await stop();
    await start();
    const result = await request('/api/catalog');
    assert.equal(result.data.settings.siteName, '测试租售公司');
    assert.equal(result.data.settings.logoUrl, uploadedLogoUrl);
    assert.equal(result.data.vehicles[0].availability, '需预订');
    assert.equal((await request('/api/admin/vehicles')).data.vehicles.length, 3);
    assert.equal((await request('/api/auth/status')).data.setupRequired, false);
  });
  await t.test('登出撤销会话，错误密码失败，正确账号可重新登录', async () => {
    assert.equal((await request('/api/auth/logout', { method: 'POST' })).status, 200);
    assert.equal((await request('/api/admin/vehicles')).status, 401);
    const wrong = await request('/api/auth/login', { method: 'POST', body: { username: 'fleet-admin', password: 'WrongPassword12!' } });
    assert.equal(wrong.status, 401);
    const correct = await request('/api/auth/login', { method: 'POST', body: { username: 'fleet-admin', password: 'StrongPass123!' } });
    assert.equal(correct.status, 200);
    assert.equal(correct.data.authenticated, true);
    assert.notEqual(correct.data.csrfToken, csrf);
  });
});

test('关闭初始化入口时，本机请求也无法创建管理员', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vehicle-setup-'));
  const app = createApp({ dbPath: ':memory:', seedPath: path.join(dir, 'missing.json'), publicDir: dir, distDir: path.join(dir, 'dist'), allowSetup: false, allowedOrigins: [ORIGIN] });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => { await new Promise(resolve => server.close(resolve)); app.locals.closeDatabase(); fs.rmSync(dir, { recursive: true, force: true }); });
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/auth/setup`, { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'disabled-admin', password: 'StrongPassword123!' }) });
  assert.equal(response.status, 403);
});

test('车型删除与图片回收保护真实引用和独立会话草稿', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vehicle-media-'));
  const options = { dbPath: path.join(dir, 'catalog.sqlite'), seedPath: path.join(dir, 'seed.json'), publicDir: path.join(dir, 'public'), uploadDir: path.join(dir, 'uploads'), distDir: path.join(dir, 'dist'), allowedOrigins: [ORIGIN] };
  const shared = '/vehicles/a/shared.png', unique = '/vehicles/a/unique.png';
  const seed = [
    { ...fixture, id: 'vehicle-a', images: [shared, unique] },
    { ...fixture, id: 'vehicle-b', published: false, images: [shared] },
    { ...fixture, id: 'vehicle-c', images: [] },
  ];
  fs.writeFileSync(options.seedPath, JSON.stringify(seed));
  for (const url of [shared, unique]) {
    for (const root of [options.publicDir, options.distDir]) {
      fs.mkdirSync(path.dirname(path.join(root, url)), { recursive: true });
      fs.writeFileSync(path.join(root, url), PNG);
    }
  }
  fs.writeFileSync(path.join(options.distDir, 'index.html'), '<!doctype html><title>test</title>');
  let app, server, base, primary, secondary;
  const filePath = url => url.startsWith('/uploads/') ? path.join(options.uploadDir, url.slice('/uploads/'.length)) : path.join(options.publicDir, url);
  async function start() {
    app = createApp(options);
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    base = `http://127.0.0.1:${server.address().port}`;
  }
  async function stop() { await new Promise(resolve => server.close(resolve)); app.locals.closeDatabase(); }
  async function request(url, { method = 'GET', body, raw, session = primary, token = session?.csrfToken, origin = ORIGIN } = {}) {
    const response = await fetch(base + url, {
      method,
      headers: { ...(origin ? { Origin: origin } : {}), ...(session ? { Cookie: session.cookie } : {}), ...(token ? { 'x-csrf-token': token } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
    });
    const data = await response.json();
    return { status: response.status, data, response };
  }
  async function upload(session = primary) {
    const form = new FormData(); form.append('file', new Blob([PNG], { type: 'image/png' }), 'photo.png');
    const result = await request('/api/admin/uploads', { method: 'POST', raw: form, session });
    assert.equal(result.status, 201);
    return result.data.url;
  }
  const change = (id, body, opts = {}) => request(`/api/admin/vehicles/${id}`, { method: 'PATCH', body, ...opts });
  const settings = logoUrl => request('/api/admin/settings', { method: 'PUT', body: { logoUrl } });
  await start();
  t.after(async () => { await stop(); fs.rmSync(dir, { recursive: true, force: true }); });
  const loginBody = { username: 'media-admin', password: 'StrongMediaPass123!' };
  const created = await request('/api/auth/setup', { method: 'POST', body: loginBody, session: null });
  assert.equal(created.status, 201);
  primary = { cookie: created.response.headers.get('set-cookie').split(';')[0], csrfToken: created.data.csrfToken };
  const login = await request('/api/auth/login', { method: 'POST', body: loginBody, session: null });
  secondary = { cookie: login.response.headers.get('set-cookie').split(';')[0], csrfToken: login.data.csrfToken };

  await t.test('删除和丢弃上传需要管理员及 CSRF', async () => {
    assert.equal((await request('/api/admin/vehicles/vehicle-a', { method: 'DELETE', session: null })).status, 401);
    assert.equal((await request('/api/admin/vehicles/vehicle-a', { method: 'DELETE', token: '' })).status, 403);
    assert.equal((await request('/api/admin/uploads/discard', { method: 'POST', body: { urls: [] }, session: null })).status, 401);
    assert.equal((await request('/api/admin/uploads/discard', { method: 'POST', body: { urls: [] }, token: '' })).status, 403);
    assert.equal((await request('/api/admin/uploads/discard', { method: 'POST', body: { urls: [] }, origin: 'https://evil.example' })).status, 403);
  });
  await t.test('删除车型回收独有图片，保留下架车型共享图，构建残留不回退', async () => {
    const result = await request('/api/admin/vehicles/vehicle-a', { method: 'DELETE' });
    assert.equal(result.status, 200);
    assert.equal(result.data.deleted, true);
    assert.ok(result.data.mediaCleanup.deleted.includes(unique));
    assert.equal(fs.existsSync(filePath(unique)), false);
    assert.equal(fs.existsSync(path.join(options.distDir, unique)), true);
    assert.equal((await fetch(base + unique)).status, 404);
    assert.equal(fs.existsSync(filePath(shared)), true);
    assert.equal((await fetch(base + shared)).status, 200);
    assert.equal((await request('/api/vehicles/vehicle-a')).status, 404);
    assert.equal((await fetch(base + '/vehicles/vehicle-b')).status, 200);
  });
  await t.test('图片替换释放旧引用，上传保存后不再是临时草稿', async () => {
    const first = await upload();
    assert.equal((await change('vehicle-c', { images: [first] })).status, 200);
    assert.equal(app.locals.db.prepare('SELECT url FROM pending_uploads WHERE url=?').get(first), undefined);
    const second = await upload();
    const replaced = await change('vehicle-c', { images: [second] });
    assert.equal(replaced.status, 200);
    assert.ok(replaced.data.mediaCleanup.deleted.includes(first));
    assert.equal(fs.existsSync(filePath(first)), false);
    assert.equal(fs.existsSync(filePath(second)), true);
    const discardSaved = await request('/api/admin/uploads/discard', { method: 'POST', body: { urls: [second] } });
    assert.deepEqual(discardSaved.data.discarded, []);
    assert.equal(fs.existsSync(filePath(second)), true);
  });
  await t.test('编码和分隔符别名不能读取public或dist内的过期图片副本', async () => {
    for (const root of [options.publicDir, options.distDir]) {
      const stale = path.join(root, 'uploads/deleted.png');
      fs.mkdirSync(path.dirname(stale), { recursive: true });
      fs.writeFileSync(stale, PNG);
    }
    for (const url of [
      '/uploads/deleted.png', '/u%70loads/deleted.png', '/uploads%2Fdeleted.png',
      '/uploads%5Cdeleted.png', '/%2Fuploads/deleted.png', '/uploads//deleted.png',
      '/assets%2F..%2Fuploads/deleted.png', '/UPLOADS/deleted.png',
      '/%76ehicles/a/unique.png', '/vehicles%2Fa%2Funique.png', '/vehicles%5Ca%5Cunique.png',
    ]) assert.equal((await fetch(base + url)).status, 404, url);
    assert.equal((await fetch(base + '/u%70loads/deleted.png', { method: 'HEAD' })).status, 404);
    assert.equal((await fetch(base + '/vehicles/vehicle-b')).status, 200);
    assert.equal((await fetch(base + shared)).status, 200);
  });
  await t.test('公司图标与车型共享上传，移除一方时保留，最后引用移除才删除', async () => {
    const common = await upload();
    assert.equal((await settings(common)).status, 200);
    assert.equal((await change('vehicle-c', { images: [common] })).status, 200);
    assert.equal((await settings('')).status, 200);
    assert.equal(fs.existsSync(filePath(common)), true);
    assert.equal((await settings(common)).status, 200);
    assert.equal((await change('vehicle-c', { images: [] })).status, 200);
    assert.equal(fs.existsSync(filePath(common)), true);
    assert.equal((await settings('')).status, 200);
    assert.equal(fs.existsSync(filePath(common)), false);
  });
  await t.test('丢弃只删除当前会话未保存上传，不影响另一个登录草稿', async () => {
    const own = await upload(), other = await upload(secondary);
    const denied = await change('vehicle-c', { images: [other] });
    assert.equal(denied.status, 403);
    const result = await request('/api/admin/uploads/discard', { method: 'POST', body: { urls: [own, other] } });
    assert.equal(result.status, 200);
    assert.deepEqual(result.data.discarded, [own]);
    assert.equal(fs.existsSync(filePath(own)), false);
    assert.equal(fs.existsSync(filePath(other)), true);
    const otherResult = await request('/api/admin/uploads/discard', { method: 'POST', body: { urls: [other] }, session: secondary });
    assert.deepEqual(otherResult.data.discarded, [other]);
    assert.equal(fs.existsSync(filePath(other)), false);
  });
  await t.test('图片大小写别名不能绕过草稿所有权，真实大写文件名仍可保存及回收', async () => {
    const url = await upload(primary);
    const alias = url.replace(/[^/]+$/, filename => filename.slice(0, -4).toUpperCase() + '.png');
    assert.notEqual(alias, url);
    assert.equal((await change('vehicle-c', { images: [url] }, { session: secondary })).status, 403);
    assert.equal((await change('vehicle-c', { images: [alias] }, { session: secondary })).status, 400);
    assert.equal((await settings(alias)).status, 400);
    assert.equal((await fetch(base + alias)).status, 404);
    assert.ok(app.locals.db.prepare('SELECT url FROM pending_uploads WHERE url=?').get(url));
    const discarded = await request('/api/admin/uploads/discard', { method: 'POST', body: { urls: [url] } });
    assert.deepEqual(discarded.data.discarded, [url]);
    assert.equal(fs.existsSync(filePath(url)), false);

    const capitalized = '/vehicles/BrandA/PhotoA.png';
    fs.mkdirSync(path.dirname(filePath(capitalized)), { recursive: true });
    fs.writeFileSync(filePath(capitalized), PNG);
    assert.equal((await change('vehicle-c', { images: [capitalized] })).status, 200);
    assert.equal((await fetch(base + capitalized)).status, 200);
    for (const alternate of ['/vehicles/branda/PhotoA.png', '/vehicles/BrandA/photoa.png']) {
      assert.equal((await change('vehicle-c', { images: [alternate] })).status, 400);
      assert.equal((await fetch(base + alternate)).status, 404);
    }
    const removed = await change('vehicle-c', { images: [] });
    assert.ok(removed.data.mediaCleanup.deleted.includes(capitalized));
    assert.equal(fs.existsSync(filePath(capitalized)), false);
  });
  await t.test('拒绝不存在的图片和穿越路径，不接受悬空图标引用', async () => {
    assert.equal((await change('vehicle-c', { images: ['/uploads/not-existing.png'] })).status, 400);
    assert.equal((await change('vehicle-c', { images: ['/vehicles/a/.../outside.png'] })).status, 400);
    assert.equal((await settings('/uploads/not-existing.png')).status, 400);
    assert.equal((await request('/api/admin/vehicles', { method: 'POST', body: { ...fixture, id: 'missing-photo', images: ['/vehicles/missing/a.png'] } })).status, 400);
    for (const url of ['/uploads/../outside.png', '/uploads/%2e%2e/outside.png', '/vehicles/a/shared.png', 'https://evil.example/a.png']) {
      assert.equal((await request('/api/admin/uploads/discard', { method: 'POST', body: { urls: [url] } })).status, 400);
    }
  });
  await t.test('路径包含符号链接时不能引用、读取或清理链接目标', async () => {
    const outside = path.join(dir, 'outside'); fs.mkdirSync(outside);
    const outsideFile = path.join(outside, 'external.png'); fs.writeFileSync(outsideFile, PNG);
    const link = path.join(options.publicDir, 'vehicles/link');
    fs.symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
    assert.equal((await change('vehicle-c', { images: ['/vehicles/link/external.png'] })).status, 400);
    assert.equal((await fetch(base + '/vehicles/link/external.png')).status, 404);
    // A previously saved directory can be replaced outside the app. Cleanup must
    // fail safely and record retry work, never follow the substituted link.
    const altered = { ...fixture, id: 'changed-directory', images: ['/vehicles/link/external.png'] };
    app.locals.db.prepare('INSERT INTO vehicles(id,document,position) VALUES(?,?,?)').run(altered.id, JSON.stringify(altered), 99);
    const removed = await request('/api/admin/vehicles/changed-directory', { method: 'DELETE' });
    assert.equal(removed.status, 200);
    assert.ok(removed.data.mediaCleanup.pending.includes('/vehicles/link/external.png'));
    assert.equal(fs.existsSync(outsideFile), true);
    assert.ok(app.locals.db.prepare('SELECT url FROM media_gc WHERE url=?').get('/vehicles/link/external.png'));
    fs.unlinkSync(link);
  });
  await t.test('临时文件删除失败明确返回pending，记录重试且不必再等待24小时', async () => {
    const url = await upload(), target = filePath(url);
    const unlink = fs.unlinkSync;
    const mocked = t.mock.method(fs, 'unlinkSync', filename => {
      if (filename === target) throw Object.assign(new Error('simulated file lock'), { code: 'EACCES' });
      return unlink(filename);
    });
    try {
      const result = await request('/api/admin/uploads/discard', { method: 'POST', body: { urls: [url] } });
      assert.equal(result.status, 200);
      assert.deepEqual(result.data.discarded, []);
      assert.deepEqual(result.data.pending, [url]);
      assert.equal(fs.existsSync(target), true);
      assert.equal(app.locals.db.prepare('SELECT discarded FROM pending_uploads WHERE url=?').get(url).discarded, 1);
      assert.ok(app.locals.db.prepare('SELECT url FROM media_gc WHERE url=?').get(url));
      assert.equal((await change('vehicle-c', { images: [url] })).status, 409);
      assert.equal((await settings(url)).status, 409);
      assert.equal(app.locals.db.prepare('SELECT discarded FROM pending_uploads WHERE url=?').get(url).discarded, 1);
      assert.ok(app.locals.db.prepare('SELECT url FROM media_gc WHERE url=?').get(url));
    } finally { mocked.mock.restore(); }
    await stop(); await start();
    assert.equal(fs.existsSync(target), false);
    assert.equal(app.locals.db.prepare('SELECT url FROM pending_uploads WHERE url=?').get(url), undefined);
  });
  await t.test('启动回收超24小时草稿及旧版遗弃文件，保留新草稿与仍有引用的旧文件', async () => {
    const expired = await upload(primary), fresh = await upload(secondary), referenced = await upload();
    assert.equal((await settings(referenced)).status, 200);
    const oldTime = Date.now() - 25 * 60 * 60 * 1000;
    app.locals.db.prepare('UPDATE pending_uploads SET created_at=? WHERE url=?').run(oldTime, expired);
    const legacy = path.join(options.uploadDir, 'legacy-orphan.png'); fs.writeFileSync(legacy, PNG); fs.utimesSync(legacy, new Date(oldTime), new Date(oldTime));
    const recentLegacy = path.join(options.uploadDir, 'recent-orphan.png'); fs.writeFileSync(recentLegacy, PNG);
    fs.utimesSync(filePath(referenced), new Date(oldTime), new Date(oldTime));
    const staleBuildUpload = path.join(options.distDir, expired); fs.mkdirSync(path.dirname(staleBuildUpload), { recursive: true }); fs.writeFileSync(staleBuildUpload, PNG);
    await stop(); await start();
    assert.equal(fs.existsSync(filePath(expired)), false);
    assert.equal(fs.existsSync(legacy), false);
    assert.equal(fs.existsSync(filePath(fresh)), true);
    assert.equal(fs.existsSync(recentLegacy), true);
    assert.equal(fs.existsSync(filePath(referenced)), true);
    assert.equal((await fetch(base + expired)).status, 404);
    assert.equal((await request('/api/catalog')).data.settings.logoUrl, referenced);
  });
  await t.test('删除最后共享引用会清理文件，全部车型删除后重启也不重新导入', async () => {
    assert.equal((await request('/api/admin/vehicles/vehicle-b', { method: 'DELETE' })).status, 200);
    assert.equal(fs.existsSync(filePath(shared)), false);
    assert.equal((await fetch(base + shared)).status, 404);
    assert.equal((await request('/api/admin/vehicles/vehicle-c', { method: 'DELETE' })).status, 200);
    await stop(); await start();
    assert.deepEqual((await request('/api/admin/vehicles')).data.vehicles, []);
    assert.deepEqual((await request('/api/catalog')).data.vehicles, []);
    assert.equal((await request('/api/admin/vehicles/vehicle-a', { method: 'DELETE' })).status, 404);
  });
});

async function passwordTestServer(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vehicle-password-'));
  const options = { dbPath: path.join(dir, 'catalog.sqlite'), seedPath: path.join(dir, 'missing.json'), publicDir: path.join(dir, 'public'), uploadDir: path.join(dir, 'uploads'), distDir: path.join(dir, 'dist'), allowedOrigins: [ORIGIN] };
  let app, server, base;
  async function start() {
    app = createApp(options); server = app.listen(0, '127.0.0.1');
    await once(server, 'listening'); base = `http://127.0.0.1:${server.address().port}`;
  }
  async function stop() { await new Promise(resolve => server.close(resolve)); app.locals.closeDatabase(); }
  async function request(url, { method = 'GET', body, session, token = session?.csrfToken, origin = ORIGIN, headers = {} } = {}) {
    const response = await fetch(base + url, { method, headers: { ...(origin ? { Origin: origin } : {}), ...(session ? { Cookie: session.cookie } : {}), ...(token ? { 'x-csrf-token': token } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, data: await response.json(), response };
  }
  function session(result) { return { cookie: result.response.headers.get('set-cookie').split(';')[0], csrfToken: result.data.csrfToken }; }
  await start();
  t.after(async () => { await stop(); fs.rmSync(dir, { recursive: true, force: true }); });
  return { request, session, restart: async () => { await stop(); await start(); }, database: () => app.locals.db };
}

test('密码变更验证旧密码并撤销全部登录会话', async t => {
  const service = await passwordTestServer(t), { request, session } = service;
  const username = 'password-admin', oldPassword = 'OriginalPassword2026!';
  const newPassword = '好滴哥物流安全新口令2026 这是长密码';
  let primary, secondary;
  await t.test('首次创建执行强度规则，允许合理长口令', async () => {
    for (const password of ['onlyletterslong', '123456789012', 'short12', 'GoodPassword12\n']) {
      assert.equal((await request('/api/auth/setup', { method: 'POST', body: { username, password } })).status, 400);
    }
    const created = await request('/api/auth/setup', { method: 'POST', body: { username, password: oldPassword } });
    assert.equal(created.status, 201); primary = session(created);
    const loggedIn = await request('/api/auth/login', { method: 'POST', body: { username, password: oldPassword } });
    assert.equal(loggedIn.status, 200); secondary = session(loggedIn);
  });
  await t.test('改密要求有效登录、来源及CSRF，失败不改变会话', async () => {
    const body = { currentPassword: oldPassword, newPassword };
    assert.equal((await request('/api/admin/password', { method: 'POST', body })).status, 401);
    assert.equal((await request('/api/admin/password', { method: 'POST', body, session: primary, token: '' })).status, 403);
    assert.equal((await request('/api/admin/password', { method: 'POST', body, session: primary, origin: 'https://evil.example' })).status, 403);
    assert.equal((await request('/api/admin/password', { method: 'POST', body: { ...body, currentPassword: 'WrongPassword2026' }, session: primary })).status, 403);
    for (const candidate of ['onlyletterslong', '123456789012', 'tiny1', oldPassword, 'a1' + 'x'.repeat(127)]) {
      assert.equal((await request('/api/admin/password', { method: 'POST', body: { currentPassword: oldPassword, newPassword: candidate }, session: primary })).status, 400);
    }
    assert.equal((await request('/api/auth/status', { session: primary })).data.authenticated, true);
    assert.equal((await request('/api/auth/status', { session: secondary })).data.authenticated, true);
  });
  await t.test('成功后当前和其他会话全部失效，仅新密码可重新登录', async () => {
    const changed = await request('/api/admin/password', { method: 'POST', body: { currentPassword: oldPassword, newPassword }, session: primary });
    assert.equal(changed.status, 200);
    assert.deepEqual(changed.data, { changed: true, requiresLogin: true });
    assert.match(changed.response.headers.get('set-cookie'), /fleet_session=;/);
    for (const existing of [primary, secondary]) {
      assert.equal((await request('/api/auth/status', { session: existing })).data.authenticated, false);
      assert.equal((await request('/api/admin/settings', { session: existing })).status, 401);
    }
    assert.equal(service.database().prepare('SELECT COUNT(*) AS count FROM admins').get().count, 1);
    assert.equal(service.database().prepare('SELECT COUNT(*) AS count FROM sessions').get().count, 0);
    assert.equal((await request('/api/auth/login', { method: 'POST', body: { username, password: oldPassword } })).status, 401);
    const login = await request('/api/auth/login', { method: 'POST', body: { username, password: newPassword } });
    assert.equal(login.status, 200);
    await service.restart();
    assert.equal((await request('/api/auth/login', { method: 'POST', body: { username, password: newPassword } })).status, 200);
    assert.equal((await request('/api/admin/settings', { session: primary })).status, 401);
  });
});

test('登录与改密限流分别持久记录且不会被跨接口成功请求重置', async t => {
  const service = await passwordTestServer(t), { request, session } = service;
  const account = { username: 'throttle-admin', password: 'ThrottlePassword2026!' };
  const first = await request('/api/auth/setup', { method: 'POST', body: account });
  let active = session(first);
  await t.test('改密5次旧密码失败后限流，重新登录及伪造XFF无法重置', async () => {
    for (let i = 0; i < 5; i++) assert.equal((await request('/api/admin/password', { method: 'POST', body: { currentPassword: 'WrongPassword2026!', newPassword: 'BetterPassword2026!' }, session: active, headers: { 'X-Forwarded-For': `192.0.2.${i}` } })).status, 403);
    const login = await request('/api/auth/login', { method: 'POST', body: account });
    assert.equal(login.status, 200); active = session(login);
    const blocked = await request('/api/admin/password', { method: 'POST', body: { currentPassword: account.password, newPassword: 'BetterPassword2026!' }, session: active });
    assert.equal(blocked.status, 429); assert.ok(Number(blocked.response.headers.get('retry-after')) > 0);
    assert.equal((await request('/api/catalog')).status, 200);
    assert.equal((await request('/api/admin/settings', { session: active })).status, 200);
    await service.restart();
    assert.equal((await request('/api/admin/password', { method: 'POST', body: { currentPassword: account.password, newPassword: 'BetterPassword2026!' }, session: active })).status, 429);
  });
  await t.test('登录成功不会清掉此前失败次数，初始化接口也不共享计数器', async () => {
    for (let i = 0; i < 9; i++) assert.equal((await request('/api/auth/login', { method: 'POST', body: { ...account, password: 'WrongPassword2026!' } })).status, 401);
    assert.equal((await request('/api/auth/login', { method: 'POST', body: account })).status, 200);
    assert.equal((await request('/api/auth/setup', { method: 'POST', body: account })).status, 409);
    assert.equal((await request('/api/auth/login', { method: 'POST', body: { ...account, password: 'WrongPassword2026!' } })).status, 401);
    const blocked = await request('/api/auth/login', { method: 'POST', body: account, headers: { 'X-Forwarded-For': '203.0.113.1' } });
    assert.equal(blocked.status, 429); assert.ok(Number(blocked.response.headers.get('retry-after')) > 0);
    assert.equal((await request('/api/catalog')).status, 200);
    assert.equal((await request('/api/auth/login', { method: 'POST', body: { username: 'different-user', password: account.password } })).status, 401);
    await service.restart();
    assert.equal((await request('/api/auth/login', { method: 'POST', body: account })).status, 429);
  });
  await t.test('限流到期正常解除，无需清空账号或会话', async () => {
    service.database().prepare('UPDATE auth_throttle SET reset_at=?').run(Date.now() - 1);
    const login = await request('/api/auth/login', { method: 'POST', body: account });
    assert.equal(login.status, 200); active = session(login);
    const changed = await request('/api/admin/password', { method: 'POST', body: { currentPassword: account.password, newPassword: 'BetterPassword2026!' }, session: active });
    assert.equal(changed.status, 200);
  });
});

test('登录IP聚合限流阻止轮换账号及伪造转发头绕过，生产Cookie默认Secure', async t => {
  await t.test('同一socket IP轮换账号最多执行30次失败验证，重启仍限流', async () => {
    const service = await passwordTestServer(t), { request } = service;
    const account = { username: 'real-admin', password: 'RealAdminPassword2026!' };
    const setup = await request('/api/auth/setup', { method: 'POST', body: account });
    assert.equal(setup.status, 201);
    for (let i = 0; i < 30; i++) {
      const result = await request('/api/auth/login', { method: 'POST', body: { username: `rotating-user-${i}`, password: 'WrongPassword2026!' }, headers: { 'X-Forwarded-For': `198.51.100.${i + 1}` } });
      assert.equal(result.status, 401);
    }
    const blocked = await request('/api/auth/login', { method: 'POST', body: { username: 'another-new-user', password: 'WrongPassword2026!' }, headers: { 'X-Forwarded-For': '203.0.113.88' } });
    assert.equal(blocked.status, 429);
    assert.ok(Number(blocked.response.headers.get('retry-after')) > 0);
    assert.equal(service.database().prepare("SELECT COUNT(*) AS count FROM auth_throttle WHERE scope='login'").get().count, 30);
    assert.equal((await request('/api/catalog')).status, 200);
    assert.equal((await request('/api/admin/settings', { session: service.session(setup) })).status, 200);
    await service.restart();
    assert.equal((await request('/api/auth/login', { method: 'POST', body: account })).status, 429);
  });
  await t.test('生产默认安全Cookie，显式环境和测试选项按优先级生效', async () => {
    const previousEnvironment = process.env.NODE_ENV, previousCookie = process.env.COOKIE_SECURE;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vehicle-cookie-'));
    const common = { dbPath: ':memory:', seedPath: path.join(dir, 'none.json'), publicDir: path.join(dir, 'public'), uploadDir: path.join(dir, 'uploads'), distDir: path.join(dir, 'dist'), allowSetup: true, allowedOrigins: [ORIGIN] };
    async function cookieFor(options) {
      const app = createApp({ ...common, ...options });
      const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
      try {
        const response = await fetch(`http://127.0.0.1:${server.address().port}/api/auth/setup`, { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'cookie-admin', password: 'CookiePassword2026!' }) });
        assert.equal(response.status, 201);
        return response.headers.get('set-cookie');
      } finally { await new Promise(resolve => server.close(resolve)); app.locals.closeDatabase(); }
    }
    try {
      process.env.NODE_ENV = 'production'; delete process.env.COOKIE_SECURE;
      assert.match(await cookieFor({}), /; Secure(?:;|$)/);
      process.env.COOKIE_SECURE = 'false';
      assert.doesNotMatch(await cookieFor({}), /; Secure(?:;|$)/);
      assert.match(await cookieFor({ secureCookies: true }), /; Secure(?:;|$)/);
      process.env.COOKIE_SECURE = 'true';
      assert.doesNotMatch(await cookieFor({ secureCookies: false }), /; Secure(?:;|$)/);
    } finally {
      if (previousEnvironment === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previousEnvironment;
      if (previousCookie === undefined) delete process.env.COOKIE_SECURE; else process.env.COOKIE_SECURE = previousCookie;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
