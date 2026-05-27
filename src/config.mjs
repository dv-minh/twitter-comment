import fs from 'fs';
import path from 'path';

const CONFIG_PATH = path.resolve('data/config.json');

export function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    throw new Error(
      `Missing data/config.json. Run: npm run setup`
    );
  }
  const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
  validate(cfg);
  return cfg;
}

function validate(cfg) {
  if (!cfg.cookiesFile) throw new Error('config.cookiesFile missing');
  if (!fs.existsSync(cfg.cookiesFile)) throw new Error(`Cookies file not found: ${cfg.cookiesFile}`);
  if (!cfg.listIds || !Array.isArray(cfg.listIds) || cfg.listIds.length === 0) {
    throw new Error('config.listIds must be a non-empty array');
  }
  const isValidLlm = (x) => x && typeof x.provider === 'string' && typeof x.apiKey === 'string' && x.apiKey.length > 0;
  if (!cfg.llm) throw new Error('config.llm.{comment,router} is required');
  if (!isValidLlm(cfg.llm.comment)) throw new Error('config.llm.comment.{provider,apiKey} required');
  if (!isValidLlm(cfg.llm.router)) throw new Error('config.llm.router.{provider,apiKey} required');
  // Compatibility: accept misplaced debug block under llm from older/manual configs.
  if (!cfg.debug && cfg.llm && typeof cfg.llm.debug === 'object') {
    cfg.debug = { ...cfg.llm.debug };
  }
  if (!cfg.debug) {
    cfg.debug = {};
  }
  if (typeof cfg.debug.reviewLogsEnabled !== 'boolean') {
    cfg.debug.reviewLogsEnabled = false;
  }
  if (!cfg.debug.reviewLogsDir || typeof cfg.debug.reviewLogsDir !== 'string') {
    cfg.debug.reviewLogsDir = 'data/review-logs';
  }
  if (!cfg.commentsPerHour) {
    cfg.commentsPerHour = 15;
  } else if (typeof cfg.commentsPerHour === 'object') {
    if (typeof cfg.commentsPerHour.min !== 'number' || typeof cfg.commentsPerHour.max !== 'number') {
      throw new Error('config.commentsPerHour min and max must be numbers');
    }
    if (cfg.commentsPerHour.min < 1 || cfg.commentsPerHour.max < cfg.commentsPerHour.min) {
      throw new Error('config.commentsPerHour invalid min/max range');
    }
  } else if (typeof cfg.commentsPerHour !== 'number') {
    throw new Error('config.commentsPerHour must be a number or an object with {min, max}');
  }
}

export const CONFIG_FILE_PATH = CONFIG_PATH;
