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
import { createReviewLogger, createTraceId } from '../lib/review-logger.mjs';

/**
 * Apply AI filtering to tweets — calls filterTweetsBatch() to identify good tweets
 */
async function applyAIFilter(pool, cfg, log, review, traceByTweetId) {
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
        log(`[list-comment] using cached filter for ${t.id} (${result?.shouldComment ? 'pass' : 'fail'})`);
        if (review.enabled) {
          review.writeRouter({
            trace_id: traceByTweetId[t.id] || '',
            tweet_id: t.id,
            should_comment: result?.shouldComment === true,
            skill: result?.skill || '',
            source: 'cache',
            router_prompt_full: '',
            router_user_input_full: '',
            router_raw_output: '',
          });
        }
      } else {
        tweetsToFilter.push(t);
      }
    }
    
    const cachedCount = Object.keys(cachedResults).length;
    log(`[list-comment] ${cachedCount} tweets already filtered, ${tweetsToFilter.length} need filtering`);
    
    // Batch filter only new tweets
    let newResults = {};
    if (tweetsToFilter.length > 0) {
      newResults = await filterTweetsBatch({
        tweets: tweetsToFilter,
        ai: cfg.llm.router,
        review: {
          enabled: review.enabled,
          traceByTweetId,
          writeRouter: review.writeRouter,
        },
      });
      
      // Mark each new tweet as filtered
      for (const tweetId of Object.keys(newResults)) {
        markFiltered(tweetId, newResults[tweetId]);
      }
    }
    
    // Merge cached + new results
    const mergedResults = { ...cachedResults, ...newResults };
    
    const passCount = Object.values(mergedResults).filter((v) => v?.shouldComment === true).length;
    const skipCount = pool.length - passCount;
    log(`[list-comment] batch filter: ${pool.length} → ${passCount} tweets (${skipCount} skipped)`);

    // Write filtered tweets to file
    try {
      const filteredTweetsLog = pool
        .filter((t) => mergedResults[t.id]?.shouldComment === true)
        .map(t => ({
          id: t.id,
          author: t.author,
          createdAt: t.createdAt,
          text: t.fullText,
          skill: mergedResults[t.id]?.skill || '',
        }));
      await writeFile('data/fetch-tweet-filter.txt', JSON.stringify(filteredTweetsLog, null, 2));
      log(`[list-comment] wrote ${filteredTweetsLog.length} filtered tweets to data/fetch-tweet-filter.txt`);
    } catch (e) {
      log(`[list-comment] failed to write fetch-tweet-filter.txt: ${e.message}`);
    }
    
    // If no tweets passed filter, wait 1 hour
    if (passCount === 0) {
      const waitMs = 60 * 60 * 1000; // 1 hour
      log(`[list-comment] no tweets passed filter, waiting 1 hour before next run...`);
      await new Promise(resolve => setTimeout(resolve, waitMs));
    }
    
    return mergedResults;
  } catch (e) {
    log(`[list-comment] batch filter failed: ${e.message}`);
    return filterResults;
  }
}

export async function runListMode(cfg, log) {
  const listIds = cfg.listIds || [];
  if (listIds.length === 0) {
    log('[list-comment] no list IDs configured; skipping');
    return;
  }

  // Clean up old filter data (> 6 hours old)
  const deletedCount = clearOldFilteredTweets(6);
  if (deletedCount > 0) {
    log(`[list-comment] cleaned up ${deletedCount} old filtered tweets from DB`);
  }

  const review = createReviewLogger(cfg, log);
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
      log(`[list-comment] list ${id}: pool size now ${pool.length}`);
    } catch (e) {
      log(`[list-comment] list ${id} fetch failed: ${e.message}`);
      if (/401|403/.test(e.message)) {
        throw e;
      }
    }
  }

  pool.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  const traceByTweetId = {};
  for (const t of pool) {
    traceByTweetId[t.id] = createTraceId(t.id);
  }

  // Write all fetched tweets to file
  try {
    const fetchedTweetsLog = pool.map(t => ({
      id: t.id,
      author: t.author,
      createdAt: t.createdAt,
      text: t.fullText,
    }));
    await writeFile('data/fetch-tweet.txt', JSON.stringify(fetchedTweetsLog, null, 2));
    log(`[list-comment] wrote ${pool.length} fetched tweets to data/fetch-tweet.txt`);
  } catch (e) {
    log(`[list-comment] failed to write fetch-tweet.txt: ${e.message}`);
  }

  // Apply AI filter (always enabled)
  const filterResults = await applyAIFilter(pool, cfg, log, review, traceByTweetId);

  const postStats = {
    total: pool.length,
    pass_router: 0,
    skipped: 0,
    post_ok: 0,
    post_fail: 0,
    by_skill: {},
  };

  for (const t of pool) {
    const route = filterResults[t.id];
    const traceId = traceByTweetId[t.id] || createTraceId(t.id);
    const lang = detectLanguage(t.fullText);
    if (review.enabled) {
      review.writeInput({
        trace_id: traceId,
        tweet_id: t.id,
        author: t.author,
        created_at: t.createdAt,
        tweet_text: t.fullText,
        detected_lang: lang,
      });
    }
    // Check if tweet passed filter - skip if NOT explicitly marked true
    if (!route?.shouldComment) {
      // log(`[list-comment] skip filtered ${t.id} @${t.author} (not worth engaging)`);
      postStats.skipped++;
      if (review.enabled) {
        review.writePost({
          trace_id: traceId,
          tweet_id: t.id,
          reply_text: '',
          post_attempted_at: new Date().toISOString(),
          post_status: 'skip',
          skip_reason: 'filtered',
          error_message: '',
        });
      }
      continue;
    }

    postStats.pass_router++;
    postStats.by_skill[route.skill] = (postStats.by_skill[route.skill] || 0) + 1;
    await waitForSlot(cfg, log);

    let comment;
    try {
      comment = await generateComment({
        tweetText: t.fullText,
        lang,
        ai: cfg.llm.comment,
        skill: route.skill,
        review: {
          enabled: review.enabled,
          traceId,
          tweetId: t.id,
          writeGenerate: review.writeGenerate,
        },
      });
    } catch (e) {
      log(`[list-comment] AI fail for ${t.id}: ${e.message}`);
      postStats.post_fail++;
      if (review.enabled) {
        review.writePost({
          trace_id: traceId,
          tweet_id: t.id,
          reply_text: '',
          post_attempted_at: new Date().toISOString(),
          post_status: 'skip',
          skip_reason: 'ai_fail',
          error_message: e.message,
        });
      }
      continue;
    }

    try {
      // reserve atomically to avoid race where two workers post same tweet
      if (!tryReserve(t.id, t.author)) {
        log(`[list-comment] skip reserved ${t.id} @${t.author}`);
        postStats.skipped++;
        if (review.enabled) {
          review.writePost({
            trace_id: traceId,
            tweet_id: t.id,
            reply_text: comment,
            post_attempted_at: new Date().toISOString(),
            post_status: 'skip',
            skip_reason: 'reserved',
            error_message: '',
          });
        }
        continue;
      }
      if (review.enabled) {
        review.writePost({
          trace_id: traceId,
          tweet_id: t.id,
          reply_text: comment,
          post_attempted_at: new Date().toISOString(),
          post_status: 'attempt',
          skip_reason: '',
          error_message: '',
        });
      }
      await postTweet(comment, cfg.cookiesFile, { replyToId: t.id });
      markCommented(t.id, t.author);
      markPostInBatch();
      log(`[list-comment] OK reply ${t.id} @${t.author} lang=${lang} "${comment.slice(0, 60)}..."`);
      postStats.post_ok++;
      if (review.enabled) {
        review.writePost({
          trace_id: traceId,
          tweet_id: t.id,
          reply_text: comment,
          post_attempted_at: new Date().toISOString(),
          post_status: 'ok',
          skip_reason: '',
          error_message: '',
        });
      }
    } catch (e) {
      log(`[list-comment] post fail ${t.id}: ${e.message}`);
      postStats.post_fail++;
      if (review.enabled) {
        review.writePost({
          trace_id: traceId,
          tweet_id: t.id,
          reply_text: comment || '',
          post_attempted_at: new Date().toISOString(),
          post_status: 'fail',
          skip_reason: '',
          error_message: e.message,
        });
      }
      if (/RATE_LIMITED/.test(e.message)) {
        if (review.enabled) {
          review.writeSummary({
            total_tweets: postStats.total,
            pass_router: postStats.pass_router,
            skipped: postStats.skipped,
            post_ok: postStats.post_ok,
            post_fail: postStats.post_fail,
            by_skill: postStats.by_skill,
            early_stop_reason: 'RATE_LIMITED',
          });
        }
        return;
      }
      continue;
    }
    await postSleep(cfg, log);
  }

  if (review.enabled) {
    review.writeSummary({
      total_tweets: postStats.total,
      pass_router: postStats.pass_router,
      skipped: postStats.skipped,
      post_ok: postStats.post_ok,
      post_fail: postStats.post_fail,
      by_skill: postStats.by_skill,
      early_stop_reason: '',
    });
  }
}
