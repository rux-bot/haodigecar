import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { DatabaseSync, backup } from 'node:sqlite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const digest = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function inside(root, candidate) {
  const absolute = path.resolve(candidate);
  const relative = path.relative(root, absolute);
  if (relative === '' || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`路径必须位于指定目录内：${absolute}`);
  }
  return absolute;
}

function copyFile(sourceRoot, relative, destinationRoot) {
  const source = inside(sourceRoot, path.join(sourceRoot, relative));
  const actual = fs.realpathSync(source);
  inside(sourceRoot, actual);
  if (!fs.statSync(actual).isFile()) throw new Error(`不是文件：${source}`);
  const destination = inside(destinationRoot, path.join(destinationRoot, relative));
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(actual, destination, fs.constants.COPYFILE_EXCL);
  return destination;
}

function walk(root, relative = '') {
  const current = path.join(root, relative);
  const files = [];
  for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
    const next = path.join(relative, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`打包目录不能包含符号链接：${path.join(root, next)}`);
    if (entry.isDirectory()) files.push(...walk(root, next));
    else if (entry.isFile()) files.push(next);
  }
  return files;
}

function mediaReference(value) {
  if (typeof value !== 'string' || !/^\/(vehicles|uploads)\/[A-Za-z0-9][A-Za-z0-9_./-]*$/.test(value) || value.split('/').some(segment => ['.', '..'].includes(segment))) {
    throw new Error(`数据库中含不受支持的媒体路径：${String(value)}`);
  }
  return path.join('public', ...value.slice(1).split('/'));
}

function runBuild(root) {
  // npm_execpath is supplied by npm run; direct node invocation uses the installed npm.
  const result = process.env.npm_execpath
    ? spawnSync(process.execPath, [process.env.npm_execpath, 'run', 'build'], { cwd: root, stdio: 'inherit' })
    : spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build'], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error('构建失败，没有生成部署包。');
}

async function snapshot(sourceFile, destinationFile) {
  fs.mkdirSync(path.dirname(destinationFile), { recursive: true });
  const source = new DatabaseSync(sourceFile, { readOnly: true });
  try {
    await backup(source, destinationFile);
  } finally {
    source.close();
  }
  // Mutate only the copied database. Existing source sessions remain valid.
  const copy = new DatabaseSync(destinationFile);
  try {
    const tables = new Set(copy.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name));
    for (const table of ['vehicles', 'settings', 'admins', 'sessions', 'metadata']) {
      if (!tables.has(table)) throw new Error(`数据库缺少 ${table} 表，请先确认网站已完成初始化。`);
    }
    const transientTablesCleared = ['sessions', 'pending_uploads', 'media_gc'].filter(table => tables.has(table));
    copy.exec('PRAGMA journal_mode=DELETE; BEGIN;');
    try {
      for (const table of transientTablesCleared) copy.exec(`DELETE FROM ${table};`);
      copy.exec('COMMIT;');
    } catch (error) {
      copy.exec('ROLLBACK;');
      throw error;
    }
    const integrity = copy.prepare('PRAGMA integrity_check').get();
    if (Object.values(integrity)[0] !== 'ok') throw new Error('部署副本的 SQLite 完整性检查失败。');
    const vehicles = copy.prepare('SELECT document FROM vehicles ORDER BY position,id').all().map(row => JSON.parse(row.document));
    const settingsRow = copy.prepare('SELECT document FROM settings WHERE id=1').get();
    if (!settingsRow) throw new Error('数据库缺少网站设置。');
    return {
      vehicles,
      settings: JSON.parse(settingsRow.document),
      adminInitialized: !!copy.prepare('SELECT id FROM admins LIMIT 1').get(),
      transientTablesCleared,
    };
  } finally {
    copy.close();
  }
}

/** skipBuild exists for isolated fixture validation; the CLI always builds. */
export async function packageDeployment({ root = ROOT, outputParent, skipBuild = false } = {}) {
  const version = process.versions.node.split('.').map(Number);
  if (version[0] < 24 || (version[0] === 24 && version[1] < 15)) throw new Error('需要 Node.js 24.15 或更高版本。');
  root = fs.realpathSync(root);
  if (!skipBuild) runBuild(root);
  const dist = inside(root, path.join(root, 'dist'));
  if (!fs.existsSync(path.join(dist, 'index.html'))) throw new Error('找不到 dist/index.html，请先构建网站。');
  if (fs.existsSync(path.join(dist, 'vehicles')) || fs.existsSync(path.join(dist, 'uploads'))) {
    throw new Error('dist 仍含重复的图片目录。请确认 vite.config.ts 已设置 copyPublicDir:false，并重新构建。');
  }
  const stamp = new Date().toISOString().replace(/[-:.]/g, '').replace('T', '-');
  const parent = path.resolve(outputParent ?? path.join(root, 'deployment'));
  fs.mkdirSync(parent, { recursive: true });
  const output = path.join(parent, `${stamp}-${randomUUID().slice(0, 8)}`, 'vehicle-site');
  fs.mkdirSync(output, { recursive: true });
  const incomplete = path.join(output, 'PACKAGE-INCOMPLETE.txt');
  fs.writeFileSync(incomplete, '打包尚未完成。只有出现 PACKAGE-MANIFEST.json 才能部署此目录。\n', { flag: 'wx' });
  try {
    for (const folder of ['server', 'dist']) {
      for (const relative of walk(path.join(root, folder))) copyFile(root, path.join(folder, relative), output);
    }
    for (const relative of ['package.json', 'package-lock.json', 'public/favicon.svg', '启动网站.cmd', '停止网站.cmd', 'scripts/local-service.ps1', '先看这里.txt']) copyFile(root, relative, output);
    fs.mkdirSync(path.join(output, 'public', 'uploads'), { recursive: true });
    fs.mkdirSync(path.join(output, 'public', 'vehicles'), { recursive: true });
    const sourceDb = path.join(root, 'data', 'catalog.sqlite');
    let catalog;
    const hasDatabase = fs.existsSync(sourceDb);
    if (hasDatabase) {
      catalog = await snapshot(inside(root, fs.realpathSync(sourceDb)), path.join(output, 'data', 'catalog.sqlite'));
    } else {
      const seed = path.join(root, 'data', 'vehicles.json');
      if (!fs.existsSync(seed)) throw new Error('没有运营数据库，也没有可初始化的 data/vehicles.json。');
      const vehicles = readJson(seed);
      if (!Array.isArray(vehicles)) throw new Error('车型种子必须是数组。');
      copyFile(root, path.join('data', 'vehicles.json'), output);
      catalog = { vehicles, settings: {}, adminInitialized: false };
    }
    const references = new Set();
    for (const vehicle of catalog.vehicles) {
      if (!Array.isArray(vehicle.images)) throw new Error(`车型 ${vehicle.id ?? ''} 的 images 不是数组。`);
      for (const image of vehicle.images) references.add(image);
    }
    if (catalog.settings.logoUrl) references.add(catalog.settings.logoUrl);
    for (const reference of [...references].sort()) {
      try { copyFile(root, mediaReference(reference), output); }
      catch (error) { throw new Error(`复制引用图片失败 ${reference}：${error.message}`); }
    }
    const guidance = fs.existsSync(path.join(root, 'docs', 'DEPLOYMENT.md'))
      ? fs.readFileSync(path.join(root, 'docs', 'DEPLOYMENT.md'), 'utf8')
      : '# 部署\n使用 Node.js 24.15+，运行 npm ci --omit=dev 后启动 node server/index.mjs。\n';
    fs.writeFileSync(path.join(output, 'DEPLOYMENT.md'), guidance);
    fs.writeFileSync(path.join(output, 'PRIVATE-PACKAGE.txt'), '这是私有部署包，可能包含管理员密码哈希、网站设置及车型运营数据。不要提交到公开 GitHub 仓库或公开网盘。所有旧登录会话已从数据库副本清空。\n');
    const files = walk(output).filter(file => file !== 'PACKAGE-INCOMPLETE.txt').map(file => ({ path: file.split(path.sep).join('/'), bytes: fs.statSync(path.join(output, file)).size, sha256: digest(path.join(output, file)) }));
    const manifest = {
      createdAt: new Date().toISOString(), nodeMinimum: '24.15.0', databaseIncluded: hasDatabase,
      adminInitialized: catalog.adminInitialized, sourceMode: hasDatabase ? 'sqlite-backup' : 'seed',
      totalVehicles: catalog.vehicles.length, publishedVehicles: catalog.vehicles.filter(vehicle => vehicle.published).length,
      referencedMedia: references.size, sessionsClearedInCopy: hasDatabase,
      transientTablesCleared: catalog.transientTablesCleared ?? [], files,
    };
    fs.writeFileSync(path.join(output, 'PACKAGE-MANIFEST.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
    fs.unlinkSync(incomplete); // Only remove the marker created by this run, never historical output.
    return { output, ...manifest, files: files.length, totalBytes: files.reduce((sum, file) => sum + file.bytes, 0) };
  } catch (error) {
    fs.appendFileSync(incomplete, `失败原因：${error.message}\n`);
    throw new Error(`部署包未完成，保留现场于 ${output}。${error.message}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const result = await packageDeployment();
    console.log(JSON.stringify(result, null, 2));
    console.log(result.adminInitialized ? '已保留管理员账号，部署后需重新登录。' : '尚未创建管理员：请先在本机初始化，再启用生产模式。');
    console.log('部署包含私有运营数据，请勿公开上传。');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
