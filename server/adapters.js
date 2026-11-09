// Adapters: run a prompt on an AI the user already subscribes to, via its official CLI.
// Each returns { ok, text, error, ms }. Output is treated as data, never as instructions.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_TIMEOUT_MS = 6 * 60 * 1000;

function run(cmd, args, { input, cwd, timeoutMs, outFile }) {
  timeoutMs = timeoutMs || DEFAULT_TIMEOUT_MS;
  return new Promise((resolve) => {
    const t0 = Date.now();
    const child = spawn(cmd, args, { cwd, env: process.env });
    let out = '', err = '';
    const timer = setTimeout(() => { child.kill('SIGTERM'); err += '\n[studio] timeout'; }, timeoutMs);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => { clearTimeout(timer); resolve({ ok: false, text: '', error: String(e), ms: Date.now() - t0 }); });
    child.on('close', (code) => {
      clearTimeout(timer);
      let text = out;
      if (outFile && fs.existsSync(outFile)) text = fs.readFileSync(outFile, 'utf8');
      const ok = code === 0 && text.trim().length > 0;
      resolve({ ok, text: text.trim(), error: ok ? null : (err.trim().slice(-800) || `exit ${code}`), ms: Date.now() - t0 });
    });
    if (input) child.stdin.end(input); else child.stdin.end();
  });
}

export const ADAPTERS = {
  claude: {
    label: 'Claude',
    run: (prompt, workdir, timeoutMs) => run('claude', ['-p', '--setting-sources', '', '--output-format', 'text'], { input: prompt, cwd: workdir, timeoutMs }),
  },
  // Fast model for the many per-character agent turns.
  haiku: {
    label: 'Claude Haiku',
    run: (prompt, workdir, timeoutMs) => run('claude', ['-p', '--setting-sources', '', '--model', 'haiku', '--output-format', 'text'], { input: prompt, cwd: workdir, timeoutMs }),
  },
  codex: {
    label: 'Codex',
    run: (prompt, workdir, timeoutMs) => {
      const outFile = path.join(workdir, `codex_${Date.now().toString(36)}.md`);
      return run('codex', ['exec', '--skip-git-repo-check', '-o', outFile, '-'], { input: prompt, cwd: workdir, outFile, timeoutMs });
    },
  },
  grok: {
    label: 'Grok',
    run: (prompt, workdir, timeoutMs) => run('grok', ['-p', prompt], { cwd: workdir, timeoutMs }),
  },
  // Deterministic stand-in so the demo can force a quota error without spending a real call.
  limited: {
    label: 'Limited',
    run: async () => ({ ok: false, text: '', error: 'rate_limit: usage limit reached (simulated for demo)', ms: 300 }),
  },
};

export function isStall(err = '') { return /\[moa\] timeout/.test(err); }
export function isQuotaError(err = '') {
  return /rate.?limit|usage limit|quota|429|too many requests/i.test(err);
}
