#!/usr/bin/env node
// 从用户的色卡图里取色，配成进度条的 6 个颜色。
//
//   node palette.mjs 色卡.jpg                         取色并给出配色，打印可直接放进配置的 theme
//   node palette.mjs 色卡.jpg --out 我的配色.json      同时把 theme 存成文件
//   node palette.mjs 色卡.jpg --main 3 --accent 5      按打印出的编号手动指定主色、点缀色
//
// 只要 node 和 ffmpeg，不用 Chrome，沙盒里也能跑。
// 做法：缩小图片 → 去掉透明和接近纯白的背景 → 聚成最多 8 个颜色 → 去掉占比太小的 →
// 按明暗和鲜艳程度分给 main / track / ink / accent。色卡里没有够浅或够深的颜色时，用主色调出来。
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const die = m => { console.error('✗ ' + m); process.exit(1); };
const args = process.argv.slice(2);
const opt = {}; const files = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a.startsWith('--')) { const k = a.slice(2); if (['out', 'main', 'track', 'ink', 'accent'].includes(k)) opt[k] = args[++i]; else die('不认识的参数 ' + a); }
  else files.push(a);
}
if (files.length !== 1) die('用法：node palette.mjs 色卡.jpg [--out 配色.json] [--main 编号] [--track 编号] [--ink 编号] [--accent 编号]');
const img = files[0].replace(/^~(?=\/|$)/, process.env.HOME);
if (!fs.existsSync(img)) die('找不到图片：' + img);

// 1. 解码成 RGBA 像素（最长边 240）
let buf;
try {
  buf = execFileSync('ffmpeg', ['-v', 'error', '-i', img, '-frames:v', '1', '-vf', 'scale=240:240', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { maxBuffer: 1 << 26 });
} catch { die('ffmpeg 打不开这张图。换成 PNG 或 JPG 再试（iPhone 的 HEIC 先转一下）'); }

// 颜色工具
const lin = c => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const lumOf = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const contrast = (a, b) => { const [x, y] = [lumOf(a), lumOf(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
function lab([r, g, b]) {
  const [R, G, B] = [r, g, b].map(lin);
  const f = t => t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
  const X = f((0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047), Y = f(0.2126 * R + 0.7152 * G + 0.0722 * B), Z = f((0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883);
  return [116 * Y - 16, 500 * (X - Y), 200 * (Y - Z)];
}
const chroma = c => { const [, a, b] = lab(c); return Math.hypot(a, b); };
const hue = c => { const [, a, b] = lab(c); return (Math.atan2(b, a) * 180 / Math.PI + 360) % 360; };
const L = c => lab(c)[0];
const hex = c => '#' + c.map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('').toUpperCase();
function fromLab([l, a, b]) {
  const fy = (l + 16) / 116, fx = fy + a / 500, fz = fy - b / 200;
  const g = t => t ** 3 > 0.008856 ? t ** 3 : (t - 16 / 116) / 7.787;
  const X = g(fx) * 0.95047, Y = g(fy), Z = g(fz) * 1.08883;
  const R = 3.2406 * X - 1.5372 * Y - 0.4986 * Z, G = -0.9689 * X + 1.8758 * Y + 0.0415 * Z, B = 0.0557 * X - 0.2040 * Y + 1.0570 * Z;
  const enc = c => 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
  return [R, G, B].map(enc);
}
// 换明度、按比例改鲜艳度，色相不变；超出色域就降鲜艳度
function withL(c, l, k = 1) {
  const [, a, b] = lab(c);
  for (let s = k; s >= 0; s -= 0.05) { const o = fromLab([l, a * s, b * s]); if (o.every(v => v >= -0.5 && v <= 255.5)) return o; }
  return fromLab([l, 0, 0]);
}

// 2. 收集像素，去掉透明、接近纯白（色卡底色）的像素
// 底色：图片四条边上 6 成以上的像素是同一个颜色，就当作色卡的底色去掉（白底、黑底、灰底都行）
const N = 240, at = (x, y) => { const i = (y * N + x) * 4; return buf[i + 3] < 128 ? null : [buf[i], buf[i + 1], buf[i + 2]]; };
const edge = [];
for (let k = 0; k < N; k++) edge.push(at(k, 0), at(k, N - 1), at(0, k), at(N - 1, k));
const solid = edge.filter(Boolean);
let bg = null;
if (solid.length > edge.length * 0.6) {
  const med = [0, 1, 2].map(j => solid.map(c => c[j]).sort((a, b) => a - b)[solid.length >> 1]);
  const ml = lab(med);
  const close = solid.filter(c => { const l = lab(c); return (l[0] - ml[0]) ** 2 + (l[1] - ml[1]) ** 2 + (l[2] - ml[2]) ** 2 < 36; });
  if (close.length > edge.length * 0.6) bg = ml;
}
const px = [];
let dropped = 0;
for (let i = 0; i < buf.length; i += 4) {
  if (buf[i + 3] < 128) continue;
  const c = [buf[i], buf[i + 1], buf[i + 2]];
  if (bg) { const l = lab(c); if ((l[0] - bg[0]) ** 2 + (l[1] - bg[1]) ** 2 + (l[2] - bg[2]) ** 2 < 36) { dropped++; continue; } }
  px.push(c);
}
if (px.length < 50) die('图里几乎只有底色或透明，取不到颜色');

// 3. 聚类：先按 RGB 各 5 位分箱做直方图，从最常见的箱子里挑彼此差得开的当种子，再做加权 k-means（结果是确定的）
const d2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
const bins = new Map();
for (const c of px) {
  const k = (c[0] >> 3) << 10 | (c[1] >> 3) << 5 | (c[2] >> 3);
  const e = bins.get(k) || { s: [0, 0, 0], n: 0 }; e.s[0] += c[0]; e.s[1] += c[1]; e.s[2] += c[2]; e.n++; bins.set(k, e);
}
const B = [...bins.values()].map(e => { const c = e.s.map(v => v / e.n); return { c, l: lab(c), n: e.n }; }).sort((x, y) => y.n - x.n);
const cent = [];
for (const e of B) { if (cent.length >= 8) break; if (e.n < px.length * 0.005) break; if (cent.every(c => d2(c, e.l) > 144)) cent.push(e.l); }
if (!cent.length) cent.push(B[0].l);
let asg = [];
for (let it = 0; it < 15; it++) {
  asg = B.map(e => { let b = 0; for (let k = 1; k < cent.length; k++) if (d2(e.l, cent[k]) < d2(e.l, cent[b])) b = k; return b; });
  for (let k = 0; k < cent.length; k++) {
    let w = 0; const acc = [0, 0, 0];
    B.forEach((e, i) => { if (asg[i] === k) { w += e.n; for (let j = 0; j < 3; j++) acc[j] += e.l[j] * e.n; } });
    if (w) cent[k] = acc.map(v => v / w);
  }
}
const P = { length: px.length };
let clusters = cent.map((_, k) => {
  let w = 0; const acc = [0, 0, 0];
  B.forEach((e, i) => { if (asg[i] === k) { w += e.n; for (let j = 0; j < 3; j++) acc[j] += e.c[j] * e.n; } });
  return w ? { c: acc.map(v => v / w), n: w } : null;
}).filter(Boolean);
// 合并很接近的簇，去掉占比 < 4% 的（多半是色卡上的字、描边、压缩噪点）
clusters.sort((a, b) => b.n - a.n);
const merged = [];
for (const cl of clusters) {
  const hit = merged.find(m => d2(lab(m.c), lab(cl.c)) < 64);
  if (hit) { hit.c = hit.c.map((v, i) => (v * hit.n + cl.c[i] * cl.n) / (hit.n + cl.n)); hit.n += cl.n; } else merged.push({ ...cl });
}
let cols = merged.filter(m => m.n / P.length >= 0.04).sort((a, b) => L(a.c) - L(b.c)).map(m => ({ ...m, share: m.n / P.length }));
if (!cols.length) die('取不到主要颜色');

console.log(`从色卡里取到 ${cols.length} 个颜色${dropped ? '（色卡的底色 ' + hex(fromLab(bg)) + ' 已忽略）' : ''}，从深到浅：`);
cols.forEach((m, i) => console.log(`  ${i + 1}. ${hex(m.c)}  占 ${(m.share * 100).toFixed(0)}%  ${L(m.c) > 85 ? '浅' : L(m.c) < 30 ? '深' : chroma(m.c) > 30 ? '鲜' : '中'}`));

const pick = k => { if (opt[k] == null) return null; const i = +opt[k]; if (!(i >= 1 && i <= cols.length)) die(`--${k} 要填 1–${cols.length} 的编号`); return cols[i - 1].c; };

// 4. 分配角色
// track：最浅且够浅（L ≥ 85）的；没有就用主色兑白
// ink：最深且够深（L ≤ 30）的；没有就用主色兑黑
// main：剩下的里面最鲜艳、且和 track 对比度够的
// accent：和 main 色相差得开的另一个鲜艳色；没有就用 main
let track = pick('track'), ink = pick('ink'), main = pick('main'), accent = pick('accent');
const light = cols.filter(m => L(m.c) >= 85), dark = cols.filter(m => L(m.c) <= 30);
const used = new Set([track, ink].filter(Boolean));
if (!main) {
  const cand = cols.filter(m => !used.has(m.c) && L(m.c) < 85 && L(m.c) > 15);
  const score = m => chroma(m.c) + 20 * Math.min(m.share, 0.4) - Math.max(0, L(m.c) - 60) * 1.5;
  main = (cand.sort((a, b) => score(b) - score(a))[0] || cols.slice().sort((a, b) => chroma(b.c) - chroma(a.c))[0]).c;
}
if (!track) track = light.length ? light[light.length - 1].c : withL(main, 95, 0.18);
if (!ink) ink = dark.length && dark[0].c !== main ? dark[0].c : withL(main, 20, 0.55);
const notes = [];
// 主色太浅压不住浅底：逐步压暗，直到对比度 ≥ 3
let m0 = main, guard = 0;
while (contrast(main, track) < 3 && guard++ < 40) main = withL(main, L(main) - 2);
if (main !== m0) notes.push(`主色 ${hex(m0)} 太浅，在浅底上看不清，压暗成 ${hex(main)}`);
guard = 0; while (contrast(ink, track) < 7 && guard++ < 40) ink = withL(ink, L(ink) - 2);
if (!accent) {
  const hm = hue(main);
  const cand = cols.filter(m => m.c !== main && m.c !== track && m.c !== ink && chroma(m.c) > 15 && L(m.c) < 90)
    .map(m => ({ ...m, dh: Math.min(Math.abs(hue(m.c) - hm), 360 - Math.abs(hue(m.c) - hm)) }))
    .filter(m => m.dh > 25).sort((a, b) => chroma(b.c) - chroma(a.c));
  accent = cand.length ? cand[0].c : main;
}

const theme = { main: hex(main), track: hex(track), ink: hex(ink), accent: hex(accent), onMain: hex(track) };
console.log('\n配色：');
console.log(`  main   主色（填充、标签）   ${theme.main}`);
console.log(`  track  底槽 / 纸色          ${theme.track}${light.length || opt.track ? '' : '（色卡里没有浅色，用主色兑白）'}`);
console.log(`  ink    勾线、描边、投影     ${theme.ink}${dark.length || opt.ink ? '' : '（色卡里没有深色，用主色兑黑）'}`);
console.log(`  accent 点缀                 ${theme.accent}`);
console.log(`  onMain 压在主色上的字       ${theme.onMain}`);
notes.forEach(n => console.log('! ' + n));
const g = Object.values(theme).find(c => { const [r, gg, b] = [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16)); return gg > 120 && gg > r * 1.4 && gg > b * 1.4; });
if (g) console.log(`! 有偏绿的颜色 ${g}：导出绿幕会被一起抠掉，用透明 MOV 或叠原片`);
console.log('\n放进配置：\n  "theme": ' + JSON.stringify(theme));
if (opt.out) {
  const out = opt.out.replace(/^~(?=\/|$)/, process.env.HOME);
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(theme, null, 2) + '\n');
  console.log('已存：' + path.resolve(out));
}
