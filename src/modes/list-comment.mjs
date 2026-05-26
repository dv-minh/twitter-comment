/**
 * Mode A — crawl one or more lists, comment on each unique tweet using
 * the configured language + style.
 */
import { writeFile } from 'fs/promises';
import { fetchListTweets, postTweet } from '../lib/twitter-http.mjs';
import { detectLanguage } from '../lib/language.mjs';
import { filterTweetsBatch, generateComment } from '../lib/ai-commenter.mjs';
import { alreadyCommented, markCommented, tryReserve, alreadyFiltered, getFilterResult, markFiltered, clearOldFilteredTweets } from '../lib/store.mjs';
import { waitForSlot, postSleep, markPostInBatch } from '../lib/rate-limiter.mjs';
import { sendAlert } from '../lib/telegram.mjs';

// ===== TOGGLE FILTER MODE HERE =====
const ENABLE_AI_FILTER = false; // Set to true to enable AI filtering, false to accept all tweets
// ===================================

/**
 * Apply AI filtering to tweets — calls filterTweetsBatch() to identify good tweets
 */
async function applyAIFilter(pool, cfg, log) {
  const filterResults = {};
  
  if (pool.length === 0) return filterResults;

  try {
    // Check which tweets are already filtered
    const tweetsToFilter = [];
    const cachedResults = {};
    
    for (const t of pool) {
      if (alreadyFiltered(t.id)) {
        const result = getFilterResult(t.id);
        cachedResults[t.id] = result;
        log(`[mode-A] using cached filter for ${t.id} (${result ? 'pass' : 'fail'})`);
      } else {
        tweetsToFilter.push(t);
      }
    }
    
    const cachedCount = Object.keys(cachedResults).length;
    log(`[mode-A] ${cachedCount} tweets already filtered, ${tweetsToFilter.length} need filtering`);
    
    // Batch filter only new tweets
    let newResults = {};
    if (tweetsToFilter.length > 0) {
      newResults = await filterTweetsBatch({
        tweets: tweetsToFilter,
        ai: cfg.ai,
      });
      
      // Mark each new tweet as filtered
      for (const tweetId of Object.keys(newResults)) {
        markFiltered(tweetId, newResults[tweetId]);
      }
    }
    
    // Merge cached + new results
    const mergedResults = { ...cachedResults, ...newResults };
    
    const passCount = Object.values(mergedResults).filter(v => v === true).length;
    const skipCount = pool.length - passCount;
    log(`[mode-A] batch filter: ${pool.length} → ${passCount} tweets (${skipCount} skipped)`);

    // Write filtered tweets to file
    try {
      const filteredTweetsLog = pool
        .filter(t => mergedResults[t.id] === true)
        .map(t => ({
          id: t.id,
          author: t.author,
          createdAt: t.createdAt,
          text: t.fullText,
        }));
      await writeFile('data/fetch-tweet-filter.txt', JSON.stringify(filteredTweetsLog, null, 2));
      log(`[mode-A] wrote ${filteredTweetsLog.length} filtered tweets to data/fetch-tweet-filter.txt`);
    } catch (e) {
      log(`[mode-A] failed to write fetch-tweet-filter.txt: ${e.message}`);
    }
    
    // If no tweets passed filter, wait 1 hour
    if (passCount === 0) {
      const waitMs = 60 * 60 * 1000; // 1 hour
      log(`[mode-A] no tweets passed filter, waiting 1 hour before next run...`);
      await new Promise(resolve => setTimeout(resolve, waitMs));
    }
    
    return mergedResults;
  } catch (e) {
    log(`[mode-A] batch filter failed: ${e.message}`);
    return filterResults;
  }
}

/**
 * Accept all tweets without AI filtering
 */
function acceptAllTweets(pool, log) {
  const filterResults = {};
  for (const t of pool) {
    filterResults[t.id] = true; // Accept all tweets
  }
  log(`[mode-A] FILTER DISABLED: accepting all ${pool.length} tweets`);
  return filterResults;
}

export async function runListMode(cfg, log) {
  const listIds = cfg.modeA?.listIds || [];
  if (listIds.length === 0) {
    log('[mode-A] no list IDs configured; skipping');
    return;
  }

  // Clean up old filter data (> 6 hours old)
  const deletedCount = clearOldFilteredTweets(6);
  if (deletedCount > 0) {
    log(`[mode-A] cleaned up ${deletedCount} old filtered tweets from DB`);
  }

  const pool = [];
  const seen = new Set();
  for (const id of listIds) {
    try {
      const tweets = await fetchListTweets(String(id).trim(), cfg.cookiesFile, 30);
      for (const t of tweets) {
        if (!t.id || !t.fullText || t.fullText.length < 10) continue;
        if (t.isRetweet) continue;
        if (seen.has(t.id)) continue;
        if (alreadyCommented(t.id)) continue;
        seen.add(t.id);
        pool.push(t);
      }
      log(`[mode-A] list ${id}: pool size now ${pool.length}`);
    } catch (e) {
      log(`[mode-A] list ${id} fetch failed: ${e.message}`);
      if (/401|403/.test(e.message)) {
        await sendAlert(cfg.telegram?.botToken, cfg.telegram?.chatId, `[twitter-comment-pack] Session expired — re-export cookies`);
        throw e;
      }
    }
  }

  pool.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  // Write all fetched tweets to file
  try {
    const fetchedTweetsLog = pool.map(t => ({
      id: t.id,
      author: t.author,
      createdAt: t.createdAt,
      text: t.fullText,
    }));
    await writeFile('data/fetch-tweet.txt', JSON.stringify(fetchedTweetsLog, null, 2));
    log(`[mode-A] wrote ${pool.length} fetched tweets to data/fetch-tweet.txt`);
  } catch (e) {
    log(`[mode-A] failed to write fetch-tweet.txt: ${e.message}`);
  }

  // Apply filter (AI or accept-all based on toggle)
  const filterResults = ENABLE_AI_FILTER 
    ? await applyAIFilter(pool, cfg, log)
    : acceptAllTweets(pool, log);

  for (const t of pool) {
    // Check if tweet passed filter - skip if NOT explicitly marked true
    if (filterResults[t.id] !== true) {
      log(`[mode-A] skip filtered ${t.id} @${t.author} (not worth engaging)`);
      continue;
    }
    
    await waitForSlot(cfg, log);
    const langSetting = cfg.modeA?.language || 'auto';
    const lang = langSetting === 'auto' ? detectLanguage(t.fullText) : langSetting;

    let comment;
    try {
      comment = await generateComment({
        tweetText: t.fullText,
        lang,
        style: cfg.modeA?.stylePrompt || '',
        ai: cfg.ai,
      });
    } catch (e) {
      log(`[mode-A] AI fail for ${t.id}: ${e.message}`);
      continue;
    }

    try {
      // reserve atomically to avoid race where two workers post same tweet
      if (!tryReserve(t.id, t.author)) {
        log(`[mode-A] skip reserved ${t.id} @${t.author}`);
        continue;
      }
      await postTweet(comment, cfg.cookiesFile, { replyToId: t.id });
      markCommented(t.id, t.author);
      markPostInBatch();
      log(`[mode-A] OK reply ${t.id} @${t.author} lang=${lang} "${comment.slice(0, 60)}..."`);
    } catch (e) {
      log(`[mode-A] post fail ${t.id}: ${e.message}`);
      if (/RATE_LIMITED/.test(e.message)) {
        await sendAlert(cfg.telegram?.botToken, cfg.telegram?.chatId, `[twitter-comment-pack] Rate limited (${e.message})`);
        return;
      }
      continue;
    }
    await postSleep(cfg, log);
  }
}
