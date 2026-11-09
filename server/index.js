// TAKE10 — a simulation studio for video. Every character is an independent AI agent that only knows its own
// persona and what it can see; the same moment is run as several takes in parallel, a judge picks the take that
// carries your message best, and the web viewer films it from any camera angle.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ADAPTERS } from './adapters.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WEB = path.join(ROOT, 'web');
const RUNS = path.join(ROOT, 'data', 'runs');
const WORK = path.join(ROOT, 'data', 'work');
fs.mkdirSync(RUNS, { recursive: true }); fs.mkdirSync(WORK, { recursive: true });
const PORT = Number(process.env.PORT || 8795);
const runs = new Map();

// Space packs: a floor plan the agents can reason about (units ≈ metres).
export const SPACES = {
  cafeteria: { name: 'School cafeteria', w: 14, h: 9, objects: [
    { type: 'table', label: '테이블 A(인기 그룹)', x: 3, y: 2, w: 3, h: 1.2 }, { type: 'table', label: '테이블 B', x: 8, y: 2, w: 3, h: 1.2 },
    { type: 'table', label: '테이블 C', x: 3, y: 6, w: 3, h: 1.2 }, { type: 'table', label: '테이블 D(구석)', x: 8, y: 6, w: 3, h: 1.2 },
    { type: 'counter', label: '배식대', x: 12, y: 0.5, w: 1.5, h: 4 }, { type: 'door', label: '출입문', x: 0, y: 4.5, w: 0.3, h: 1.5 } ] },
  office: { name: 'Office floor', w: 14, h: 9, objects: [
    { type: 'table', label: '책상 섬 1', x: 2, y: 2, w: 4, h: 1.4 }, { type: 'table', label: '책상 섬 2', x: 8, y: 2, w: 4, h: 1.4 },
    { type: 'counter', label: '탕비실 카운터', x: 2, y: 6.5, w: 3, h: 1 }, { type: 'table', label: '프린터', x: 11.5, y: 6.5, w: 1, h: 1 },
    { type: 'table', label: '회의 테이블', x: 7, y: 6, w: 2.5, h: 1.5 }, { type: 'door', label: '출입문', x: 0, y: 4.5, w: 0.3, h: 1.5 } ] },
};

const uid = () => 'run_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
const save = (r) => fs.writeFileSync(path.join(RUNS, `${r.id}.json`), JSON.stringify(r));
function extractJson(t) { const s = String(t).replace(/```json|```/g, ''); return JSON.parse(s.slice(s.indexOf('{'), s.lastIndexOf('}') + 1)); }
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// Small concurrency gate so N takes × M agents don't spawn too many CLIs at once.
let active = 0; const queue = [];
const MAX = Number(process.env.MAX_AGENTS || 10);
function gate(fn) {
  return new Promise((resolve) => {
    const go = async () => { active++; try { resolve(await fn()); } finally { active--; queue.shift()?.(); } };
    active < MAX ? go() : queue.push(go);
  });
}

function insideObject(space, x, y) {
  return space.objects.some((o) => o.type !== 'door' && x > o.x - 0.2 && x < o.x + o.w + 0.2 && y > o.y - 0.2 && y < o.y + o.h + 0.2);
}

async function agentTurn(run, take, actor, t, prev) {
  const { space, situation, message } = run.input;
  const me = prev[actor.name];
  const others = run.input.cast.filter((c) => c.name !== actor.name).map((c) => {
    const o = prev[c.name]; const d = Math.hypot(o.x - me.x, o.y - me.y).toFixed(1);
    return `- ${c.name} (${c.role}) 위치 (${o.x.toFixed(1)}, ${o.y.toFixed(1)}), 거리 ${d}m${o.say ? `, 방금 말함: "${o.say}"` : ''}${o.action ? `, 행동: ${o.action}` : ''}`;
  }).join('\n');
  const history = take.ticks.slice(-3).map((tk) => `t${tk.t}: ` + Object.entries(tk.actors).map(([n, a]) => `${n}${a.say ? ` "${a.say}"` : ''}${a.action ? ` (${a.action})` : ''}`).join(' / ')).join('\n');
  const p = `너는 시뮬레이션 속 인물 "${actor.name}"이다. 각본은 없다. 너의 성격대로만, 지금 보이는 것에 반응하라.
너: ${actor.role}. ${actor.persona}
장소: ${space.name} (가로 ${space.w}m × 세로 ${space.h}m). 사물: ${space.objects.map((o) => `${o.label}@(${o.x},${o.y})`).join(', ')}
상황: ${situation}
지금 시각 t=${t}. 네 위치 (${me.x.toFixed(1)}, ${me.y.toFixed(1)}).
주변 사람:\n${others}
최근 흐름:\n${history || '(시작)'}
(테이크 ${take.n} — 같은 상황이라도 이 테이크의 너는 그 순간의 기분대로 자연스럽게 행동한다.)
JSON으로만 답하라: {"thought":"속마음 한 줄(짧게)","say":"소리 내어 하는 말(안 하면 빈 문자열, 짧게)","action":"행동 3~8자","move_to":{"x":숫자,"y":숫자} 또는 null}
한 번에 3m 이상 움직이지 않는다.`;
  const res = await gate(() => ADAPTERS.haiku.run(p, WORK, 45000));
  let a = { thought: '', say: '', action: '', move_to: null };
  try { a = { ...a, ...extractJson(res.text) }; } catch { /* keep idle */ }
  let x = me.x, y = me.y;
  if (a.move_to && Number.isFinite(+a.move_to.x) && Number.isFinite(+a.move_to.y)) {
    let nx = clamp(+a.move_to.x, 0.4, space.w - 0.4), ny = clamp(+a.move_to.y, 0.4, space.h - 0.4);
    const d = Math.hypot(nx - x, ny - y); if (d > 3) { nx = x + (nx - x) * 3 / d; ny = y + (ny - y) * 3 / d; }
    if (!insideObject(space, nx, ny)) { x = nx; y = ny; }
  }
  return { x: +x.toFixed(2), y: +y.toFixed(2), thought: String(a.thought || '').slice(0, 80), say: String(a.say || '').slice(0, 80), action: String(a.action || '').slice(0, 20) };
}

async function runTake(run, take) {
  let prev = Object.fromEntries(run.input.cast.map((c) => [c.name, { x: c.start.x, y: c.start.y, say: '', action: '' }]));
  take.status = 'running';
  for (let t = 0; t < run.input.ticks; t++) {
    const results = await Promise.all(run.input.cast.map((c) => agentTurn(run, take, c, t, prev)));
    const actors = Object.fromEntries(run.input.cast.map((c, i) => [c.name, results[i]]));
    take.ticks.push({ t, actors }); prev = actors; save(run);
  }
  take.status = 'done'; save(run);
}

async function judge(run) {
  run.status = 'judging'; save(run);
  const script = run.takes.map((tk) => `## 테이크 ${tk.n}\n` + tk.ticks.map((x) => `t${x.t}: ` + Object.entries(x.actors).map(([n, a]) => `${n}${a.say ? ` "${a.say}"` : ''}${a.action ? ` (${a.action})` : ''}`).join(' / ')).join('\n')).join('\n\n');
  const p = `너는 영상 감독이다. 아래는 같은 상황을 여러 번 시뮬레이션한 테이크들이다. 전하려는 메시지: "${run.input.message}"
메시지를 가장 자연스럽고 설득력 있게 전달하는 테이크를 골라라. 억지스럽거나 설교조면 감점.
JSON으로만: {"best":테이크번호,"takes":[{"n":번호,"title":"그 테이크를 한 줄로(예: 하준: \\"여기 앉아.\\")","score":0~10,"why":"한 줄"}]}
${script}`;
  const res = await ADAPTERS.claude.run(p, WORK, 120000);
  try {
    const j = extractJson(res.text);
    run.best = Number(j.best);
    for (const x of j.takes || []) { const tk = run.takes.find((k) => k.n === Number(x.n)); if (tk) Object.assign(tk, { title: x.title, score: x.score, why: x.why }); }
  } catch { run.best = run.takes[0].n; }
  run.status = 'done'; save(run);
}

async function startRun(run) {
  run.status = 'simulating'; save(run);
  await Promise.all(run.takes.map((tk) => runTake(run, tk).catch((e) => { tk.status = 'failed'; tk.error = String(e); })));
  await judge(run);
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml' };
const json = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)); };
const readBody = (req) => new Promise((r) => { let b = ''; req.on('data', (d) => { b += d; }); req.on('end', () => { try { r(JSON.parse(b || '{}')); } catch { r({}); } }); });

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/api/spaces') return json(res, 200, SPACES);
  if (url.pathname === '/api/run' && req.method === 'POST') {
    const b = await readBody(req);
    const space = SPACES[b.space] || SPACES.cafeteria;
    const cast = (b.cast || []).filter((c) => c.name).slice(0, 6).map((c, i) => ({
      name: String(c.name).slice(0, 16), role: String(c.role || '').slice(0, 40), persona: String(c.persona || '').slice(0, 240),
      color: c.color || ['#5AA9E6', '#E67AA9', '#9B7AE6', '#F2A541', '#6CC4A1', '#E6D25A'][i],
      start: { x: clamp(+c.start?.x || 1 + i * 2, 0.4, space.w - 0.4), y: clamp(+c.start?.y || 4.5, 0.4, space.h - 0.4) } }));
    if (cast.length < 2) return json(res, 400, { error: 'cast 2+' });
    const nTakes = clamp(Number(b.takes) || 4, 1, 10);
    const run = { id: uid(), createdAt: Date.now(), status: 'queued', best: null,
      input: { space, cast, message: String(b.message || '').slice(0, 120), situation: String(b.situation || '').slice(0, 300), ticks: clamp(Number(b.ticks) || 5, 2, 8) },
      takes: Array.from({ length: nTakes }, (_, i) => ({ n: i + 1, status: 'queued', ticks: [] })) };
    runs.set(run.id, run); save(run); startRun(run);
    return json(res, 200, { id: run.id });
  }
  const m = url.pathname.match(/^\/api\/run\/(run_[a-z0-9]+)$/);
  if (m) {
    const r = runs.get(m[1]) || (fs.existsSync(path.join(RUNS, `${m[1]}.json`)) ? JSON.parse(fs.readFileSync(path.join(RUNS, `${m[1]}.json`), 'utf8')) : null);
    return r ? json(res, 200, r) : json(res, 404, { error: 'not found' });
  }
  const file = path.normalize(path.join(WEB, url.pathname === '/' ? 'index.html' : url.pathname));
  if (!file.startsWith(WEB) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, () => console.log(`TAKE10 on http://localhost:${PORT}`));
