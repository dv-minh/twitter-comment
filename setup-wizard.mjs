/**
 * Interactive setup wizard. Asks 3 questions, writes data/config.json + data/cookies.json.
 * Simplified version: List Comment mode only, no Telegram, no stylePrompt.
 */
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { spawnSync } from 'child_process';

const DATA_DIR = path.resolve('data');
const CONFIG_PATH = path.join(DATA_DIR, 'config.json');
const COOKIES_PATH = path.join(DATA_DIR, 'cookies.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((res) => rl.question(q, (a) => res(a.trim())));
const ALLOWED_PROVIDERS = ['deepseek', 'openai', 'openrouter', 'anthropic'];

async function askMultiline(prompt) {
  console.log(prompt);
  console.log('(Paste content, then on a NEW line type EOF and press Enter)');
  return new Promise((res) => {
    let buf = '';
    const onLine = (line) => {
      if (line.trim() === 'EOF') {
        rl.removeListener('line', onLine);
        res(buf);
        return;
      }
      buf += line + '\n';
    };
    rl.on('line', onLine);
  });
}

function normalizeCookies(raw) {
  // Accepts:
  //   1) Cookie-Editor JSON array: [{name, value, domain, ...}, ...]
  //   2) Object with {auth_token, ct0, ...}
  //   3) Already-wrapped {cookies: [...]}
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error('Cookies input is not valid JSON: ' + e.message);
  }

  let cookies;
  if (Array.isArray(parsed)) {
    cookies = parsed.map((c) => ({
      name: c.name,
      value: c.value,
      domain: c.domain || '.x.com',
      path: c.path || '/',
    }));
  } else if (parsed && Array.isArray(parsed.cookies)) {
    cookies = parsed.cookies;
  } else if (parsed && typeof parsed === 'object') {
    cookies = Object.entries(parsed).map(([name, value]) => ({
      name,
      value: String(value),
      domain: '.x.com',
      path: '/',
    }));
  } else {
    throw new Error('Unrecognized cookies format');
  }

  if (!cookies.find((c) => c.name === 'ct0')) {
    throw new Error('ct0 cookie not present — did you copy ALL cookies from x.com?');
  }
  if (!cookies.find((c) => c.name === 'auth_token')) {
    throw new Error('auth_token cookie not present');
  }
  return { cookies };
}

async function askLlmConfig(label, defaults = {}) {
  console.log(`\n--- ${label} LLM ---`);
  console.log('Options: deepseek | openai | openrouter | anthropic');
  let provider = (await ask(`Provider [${defaults.provider || 'deepseek'}]: `)).toLowerCase() || (defaults.provider || 'deepseek');
  if (!ALLOWED_PROVIDERS.includes(provider)) provider = defaults.provider || 'deepseek';
  const apiKey = (await ask(`${provider} API key${defaults.apiKey ? ' (Enter to reuse existing)' : ''}: `)) || defaults.apiKey || '';
  const model = await ask(`Model override (Enter for default${defaults.model ? `, current: ${defaults.model}` : ''}): `);
  return { provider, apiKey, model };
}

(async function main() {
  console.log('\n=== Twitter Comment Pack — Setup Wizard ===\n');
  console.log('You will be asked 3 short questions. See guides/ for help.\n');

  // Q1: cookies
  console.log('--- Question 1/3: Twitter cookies ---');
  console.log('Use the "Cookie-Editor" extension on x.com → Export → JSON.');
  console.log('You can also paste {"auth_token": "...", "ct0": "..."} format.');
  const rawCookies = await askMultiline('Paste cookies JSON now:');
  let cookieObj;
  try {
    cookieObj = normalizeCookies(rawCookies);
  } catch (e) {
    console.error('ERROR:', e.message);
    process.exit(1);
  }
  fs.writeFileSync(COOKIES_PATH, JSON.stringify(cookieObj, null, 2));
  console.log(`Saved ${cookieObj.cookies.length} cookies to ${COOKIES_PATH}\n`);

  // Q2: List IDs
  console.log('--- Question 2/3: Twitter list IDs ---');
  console.log('Enter one or more list IDs (comma-separated).');
  console.log('See guides/03-modes-explained.md for how to find list IDs.');
  const ids = await ask('List IDs: ');
  const listIds = ids.split(',').map((s) => s.trim()).filter(Boolean);
  if (listIds.length === 0) {
    console.error('ERROR: At least one list ID is required');
    process.exit(1);
  }

  // Q3: rate
  console.log('\n--- Question 3/3: Rate limit ---');
  console.log('See guides/04-rate-limits.md. Safe: 10-20/hr. Aggressive: 20-30. >30 risky.');
  const rateMinRaw = await ask('Comments/hour MIN [8]: ');
  const rateMaxRaw = await ask('Comments/hour MAX [12]: ');
  let rateMin = parseInt(rateMinRaw, 10);
  let rateMax = parseInt(rateMaxRaw, 10);
  if (!Number.isFinite(rateMin) || rateMin < 1) rateMin = 8;
  if (!Number.isFinite(rateMax) || rateMax < rateMin) rateMax = Math.max(rateMin, 12);

  // AI lanes
  console.log('\n--- AI / LLM Setup ---');
  console.log('You can use one model for both lanes, or separate models for comment vs router/filter.');
  console.log('  comment lane: generate final reply');
  console.log('  router lane: decide should_comment + skill');
  const useSame = (await ask('Use same provider/key/model for both lanes? (Y/n): ')).toLowerCase() !== 'n';
  const llmComment = await askLlmConfig('Comment', { provider: 'deepseek' });
  if (!llmComment.apiKey) {
    console.error('ERROR: Comment lane API key is required');
    process.exit(1);
  }
  let llmRouter = { ...llmComment };
  if (!useSame) {
    llmRouter = await askLlmConfig('Router/Filter', {
      provider: llmComment.provider,
      apiKey: llmComment.apiKey,
      model: llmComment.model,
    });
    if (!llmRouter.apiKey) {
      console.error('ERROR: Router lane API key is required');
      process.exit(1);
    }
  }

  const cfg = {
    cookiesFile: 'data/cookies.json',
    listIds,
    commentsPerHour: {
      min: rateMin,
      max: rateMax,
    },
    delayMinMs: 60000,
    delayMaxMs: 240000,
    llm: {
      comment: { ...llmComment },
      router: { ...llmRouter },
    },
    debug: {
      reviewLogsEnabled: false,
      reviewLogsDir: 'data/review-logs',
      reviewLogsMode: 'full',
      reviewLogsPreviewChars: 240,
    },
  };
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
  console.log(`\nWrote ${CONFIG_PATH}`);

  // Auto-start
  if (process.platform === 'win32') {
    const auto = (await ask('\nAuto-start on Windows boot? (Y/n): ')).toLowerCase();
    if (auto !== 'n') {
      const r = spawnSync(process.execPath, ['scripts/install-autostart.mjs'], { stdio: 'inherit' });
      if (r.status !== 0) console.log('(autostart install failed — you can re-run with: npm run install-service)');
    }
  }

  console.log('\nSetup complete! Start the bot with:  npm start');
  console.log('Logs:  data/run.log');
  rl.close();
})();
