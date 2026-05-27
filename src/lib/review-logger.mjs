import fs from 'fs';
import path from 'path';

const FILES = {
  input: '01-input-tweets.jsonl',
  router: '02-router.jsonl',
  generate: '03-generate.jsonl',
  post: '04-post.jsonl',
  summary: '05-summary.jsonl',
};

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function appendJsonl(dir, fileKey, payload) {
  const fp = path.join(dir, FILES[fileKey]);
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    ...payload,
  });
  fs.appendFileSync(fp, line + '\n', 'utf8');
}

function randomSuffix() {
  return Math.random().toString(36).slice(2, 8);
}

export function createTraceId(tweetId) {
  return `${Date.now()}-${tweetId}-${randomSuffix()}`;
}

export function createReviewLogger(cfg, log) {
  const enabled = cfg?.debug?.reviewLogsEnabled === true;
  const dir = cfg?.debug?.reviewLogsDir || 'data/review-logs';

  if (!enabled) {
    return {
      enabled: false,
      dir,
      writeInput: () => {},
      writeRouter: () => {},
      writeGenerate: () => {},
      writePost: () => {},
      writeSummary: () => {},
    };
  }

  ensureDir(dir);
  log(`[review-logs] enabled, writing to ${dir}`);

  return {
    enabled: true,
    dir,
    writeInput: (payload) => appendJsonl(dir, 'input', payload),
    writeRouter: (payload) => appendJsonl(dir, 'router', payload),
    writeGenerate: (payload) => appendJsonl(dir, 'generate', payload),
    writePost: (payload) => appendJsonl(dir, 'post', payload),
    writeSummary: (payload) => appendJsonl(dir, 'summary', payload),
  };
}

