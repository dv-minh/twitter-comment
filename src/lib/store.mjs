import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { DEFAULT_COMMENT_SKILL, isAllowedCommentSkill } from './ai-prompts.mjs';

let db = null;

export function initStore(dbPath = 'data/store.db') {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS commented (
      tweet_id TEXT PRIMARY KEY,
      ts INTEGER NOT NULL,
      author TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_commented_ts ON commented(ts);

    CREATE TABLE IF NOT EXISTS filtered_tweets (
      tweet_id TEXT PRIMARY KEY,
      ts INTEGER NOT NULL,
      passed INTEGER NOT NULL,
      skill TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_filtered_ts ON filtered_tweets(ts);

    CREATE TABLE IF NOT EXISTS warmup_state (
      target TEXT NOT NULL,
      tweet_id TEXT NOT NULL,
      action TEXT NOT NULL,
      last_action_ts INTEGER NOT NULL,
      PRIMARY KEY(target, tweet_id, action)
    );

    CREATE TABLE IF NOT EXISTS meta (
      k TEXT PRIMARY KEY,
      v TEXT
    );
  `);
  try {
    db.exec('ALTER TABLE filtered_tweets ADD COLUMN skill TEXT');
  } catch (error) {
    if (!String(error.message).includes('duplicate column name')) {
      throw error;
    }
  }
  return db;
}

export function alreadyCommented(tweetId) {
  if (!db) return false;
  const row = db.prepare('SELECT 1 FROM commented WHERE tweet_id = ?').get(tweetId);
  return !!row;
}

export function tryReserve(tweetId, author = '') {
  if (!db) return false;
  const info = db.prepare('INSERT OR IGNORE INTO commented(tweet_id, ts, author) VALUES(?, ?, ?)')
    .run(tweetId, Date.now(), author);
  return info.changes > 0;
}

export function markCommented(tweetId, author = '') {
  db.prepare('INSERT OR REPLACE INTO commented(tweet_id, ts, author) VALUES(?, ?, ?)')
    .run(tweetId, Date.now(), author);
}

export function commentsInLastHour() {
  if (!db) return 0;
  const since = Date.now() - 60 * 60 * 1000;
  const row = db.prepare('SELECT COUNT(*) AS c FROM commented WHERE ts >= ?').get(since);
  return row.c;
}

export function warmupSeen(target, tweetId, action) {
  if (!db) return false;
  const row = db.prepare(
    'SELECT 1 FROM warmup_state WHERE target = ? AND tweet_id = ? AND action = ?'
  ).get(target, tweetId, action);
  return !!row;
}

export function warmupMark(target, tweetId, action) {
  db.prepare(
    'INSERT OR REPLACE INTO warmup_state(target, tweet_id, action, last_action_ts) VALUES(?, ?, ?, ?)'
  ).run(target, tweetId, action, Date.now());
}

export function getMeta(k) {
  if (!db) return null;
  const row = db.prepare('SELECT v FROM meta WHERE k = ?').get(k);
  return row ? row.v : null;
}

export function setMeta(k, v) {
  db.prepare('INSERT OR REPLACE INTO meta(k, v) VALUES(?, ?)').run(k, String(v));
}

export function alreadyFiltered(tweetId) {
  if (!db) return false;
  const row = db.prepare('SELECT 1 FROM filtered_tweets WHERE tweet_id = ?').get(tweetId);
  return !!row;
}

export function getFilterResult(tweetId) {
  if (!db) return null;
  const row = db.prepare('SELECT passed, skill FROM filtered_tweets WHERE tweet_id = ?').get(tweetId);
  if (!row) return null;
  if (row.passed !== 1) return { shouldComment: false, skill: '' };

  const skill = isAllowedCommentSkill(row.skill) ? row.skill : DEFAULT_COMMENT_SKILL;
  return { shouldComment: true, skill };
}

export function markFiltered(tweetId, result) {
  if (!db) return;
  const shouldComment = result?.shouldComment === true;
  const skill = shouldComment && isAllowedCommentSkill(result.skill) ? result.skill : '';
  db.prepare('INSERT OR REPLACE INTO filtered_tweets(tweet_id, ts, passed, skill) VALUES(?, ?, ?, ?)')
    .run(tweetId, Date.now(), shouldComment ? 1 : 0, skill);
}

export function clearOldFilteredTweets(hoursOld = 6) {
  if (!db) return 0;
  const cutoffTime = Date.now() - hoursOld * 60 * 60 * 1000;
  const info = db.prepare('DELETE FROM filtered_tweets WHERE ts < ?').run(cutoffTime);
  return info.changes;
}
