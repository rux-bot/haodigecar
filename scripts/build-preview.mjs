import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repository = process.env.GITHUB_REPOSITORY?.split('/').at(-1) || 'haodigecar';
const base = process.argv[2] || `/${repository}/`;
if (base !== '/' && !/^\/[A-Za-z0-9._-]+\/$/.test(base)) throw new Error('预览路径应为 /仓库名称/ 或 /');
const output = path.join(root, 'dist-preview');
// Only the reviewed, versioned seed is published. Never read the operating database.
const seed = JSON.parse(fs.readFileSync(path.join(root, 'data/vehicles.json'), 'utf8'));
const vehicles = seed.filter(vehicle => vehicle.published).map(({ sourceFiles: _sources, ...vehicle }) => vehicle);
const settings = {
  siteName: '浙江好滴哥物流科技有限公司', tagline: '商用车租售，一站选好车',
  phone: '', wechat: '', address: '', logoUrl: '',
};
const images = [...new Set(vehicles.flatMap(vehicle => vehicle.images))];
for (const image of images) {
  if (!/^\/vehicles\/[a-z0-9-]+\/[A-Za-z0-9_-]+\.(webp|png|jpg|jpeg)$/.test(image)) throw new Error(`预览图片路径无效：${image}`);
  const source = path.join(root, 'public', image.slice(1));
  const real = fs.realpathSync(source);
  const relative = path.relative(path.join(root, 'public', 'vehicles'), real);
  if (relative.startsWith('..') || path.isAbsolute(relative) || !fs.statSync(real).isFile()) throw new Error(`预览图片不在车型目录内：${image}`);
}
await build({
  root, base,
  define: { 'import.meta.env.VITE_STATIC_PREVIEW': JSON.stringify('true') },
  build: { outDir: output, copyPublicDir: false },
});
fs.writeFileSync(path.join(output, 'catalog.json'), JSON.stringify({ vehicles, settings }));
fs.copyFileSync(path.join(root, 'public/favicon.svg'), path.join(output, 'favicon.svg'));
fs.writeFileSync(path.join(output, '.nojekyll'), '');
for (const image of images) {
  const destination = path.join(output, image.slice(1));
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(path.join(root, 'public', image.slice(1)), destination);
}
console.log(`静态预览已生成：${vehicles.length} 款车型，${images.length} 张图片，路径 ${base}`);
