/**
 * Multi-provider AI comment generator.
 * Supports: deepseek, openai, openrouter, anthropic. All via fetch - no SDK deps.
 */
import { isFollowBackRequest, followBackReply } from './language.mjs';
import {
  ROUTER_SYSTEM_PROMPT,
  PROVIDER_DEFAULTS,
  DEFAULT_COMMENT_SKILL,
  isAllowedCommentSkill,
  buildCommentSystemPrompt,
} from './ai-prompts.mjs';
import { readFileSync, writeFileSync } from 'fs';
import { existsSync } from 'fs';
import path from 'path';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getHistoryPath() {
  return path.join(process.cwd(), 'data', 'comment-history.json');
}

function readRecentComments(limit = 10) {
  const historyPath = getHistoryPath();
  try {
    if (!existsSync(historyPath)) return [];
    const data = JSON.parse(readFileSync(historyPath, 'utf8'));
    return (data.comments || []).slice(-limit);
  } catch (error) {
    console.error(`[ai-commenter] Failed to read comment history: ${error.message}`);
    return [];
  }
}

function saveCommentToHistory(comment) {
  const historyPath = getHistoryPath();
  try {
    let data = { comments: [] };
    if (existsSync(historyPath)) {
      data = JSON.parse(readFileSync(historyPath, 'utf8'));
    }

    if (!Array.isArray(data.comments)) data.comments = [];
    data.comments.push({
      text: comment,
      timestamp: new Date().toISOString(),
    });
    data.comments = data.comments.slice(-10);

    writeFileSync(historyPath, JSON.stringify(data, null, 2), 'utf8');
  } catch (error) {
    console.error(`[ai-commenter] Failed to save comment to history: ${error.message}`);
  }
}

function buildPrompt({ tweetText, recentComments = [] }) {
  let historySection = '';
  if (recentComments && recentComments.length > 0) {
    const recentTexts = recentComments.map((c, i) => `${i + 1}. ${c.text}`).join('\n');
    historySection = `\n\nYour 10 most recent replies:\n${recentTexts}\n`;
  }

  return `Tweet content:
"${tweetText}"${historySection}`;
}

function normalizeRoute(rawRoute) {
  const shouldComment = rawRoute?.should_comment === true;
  const rawSkill = typeof rawRoute?.skill === 'string' ? rawRoute.skill.trim() : '';
  const hasValidSkill = isAllowedCommentSkill(rawSkill);
  if (!shouldComment || !hasValidSkill) {
    return { shouldComment: false, skill: '' };
  }
  return { shouldComment: true, skill: rawSkill };
}

function extractFirstJsonObject(text) {
  const s = (text || '').trim();
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start >= 0 && end > start) {
    return s.slice(start, end + 1);
  }
  return s;
}

function parseModelJson(text) {
  const raw = (text || '').trim();
  try {
    return JSON.parse(raw);
  } catch (_) {
    const withoutFence = raw
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();
    try {
      return JSON.parse(withoutFence);
    } catch (_) {
      const objText = extractFirstJsonObject(withoutFence);
      return JSON.parse(objText);
    }
  }
}

async function callDeepseek({ apiKey, model, prompt, systemPrompt }) {
  const res = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: model || PROVIDER_DEFAULTS.deepseek.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt },
      ],
      max_tokens: PROVIDER_DEFAULTS.deepseek.maxTokens,
      temperature: PROVIDER_DEFAULTS.deepseek.temperature,
    }),
  });
  if (!res.ok) throw new Error(`DeepSeek HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return (data?.choices?.[0]?.message?.content || '').trim();
}

async function callOpenAI({ apiKey, model, prompt, systemPrompt }) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: model || PROVIDER_DEFAULTS.openai.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt },
      ],
      max_completion_tokens: PROVIDER_DEFAULTS.openai.maxTokens,
      temperature: PROVIDER_DEFAULTS.openai.temperature,
    }),
  });
  if (!res.ok) throw new Error(`OpenAI HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return (data?.choices?.[0]?.message?.content || '').trim();
}

async function callOpenRouter({ apiKey, model, prompt, systemPrompt }) {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
      'http-referer': 'https://twitter-comment-pack.local',
      'x-title': 'TwitterCommentPack',
    },
    body: JSON.stringify({
      model: model || PROVIDER_DEFAULTS.openrouter.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt },
      ],
      max_tokens: PROVIDER_DEFAULTS.openrouter.maxTokens,
      temperature: PROVIDER_DEFAULTS.openrouter.temperature,
    }),
  });

  if (!res.ok) {
    const errorText = await res.text();
    console.error(`[callOpenRouter] HTTP ${res.status}: ${errorText.slice(0, 300)}`);
    throw new Error(`OpenRouter HTTP ${res.status}: ${errorText.slice(0, 200)}`);
  }

  const data = await res.json();
  const content = (data?.choices?.[0]?.message?.content || '').trim();
  if (!content) {
    console.error('[callOpenRouter] Empty content!');
  }
  return content;
}

async function callAnthropic({ apiKey, model, prompt, systemPrompt }) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: model || PROVIDER_DEFAULTS.anthropic.model,
      system: systemPrompt,
      max_tokens: PROVIDER_DEFAULTS.anthropic.maxTokens,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const block = (data?.content || []).find((b) => b.type === 'text');
  return (block?.text || '').trim();
}

async function callRouterModel({ ai, provider, prompt }) {
  if (provider === 'openai') {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${ai.apiKey}` },
      body: JSON.stringify({
        model: ai.model || PROVIDER_DEFAULTS.openai.model,
        messages: [
          { role: 'system', content: ROUTER_SYSTEM_PROMPT },
          { role: 'user', content: prompt },
        ],
        max_completion_tokens: 3000,
        temperature: 0.7,
      }),
    });
    if (!res.ok) throw new Error(`OpenAI Batch Filter HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    return (data?.choices?.[0]?.message?.content || '').trim();
  }

  if (provider === 'openrouter') {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${ai.apiKey}`,
        'http-referer': 'https://twitter-comment-pack.local',
        'x-title': 'TwitterCommentPack',
      },
      body: JSON.stringify({
        model: ai.model || PROVIDER_DEFAULTS.openrouter.model,
        messages: [
          { role: 'system', content: ROUTER_SYSTEM_PROMPT },
          { role: 'user', content: prompt },
        ],
        max_tokens: 3000,
        temperature: 0.7,
      }),
    });
    if (!res.ok) throw new Error(`OpenRouter Batch Filter HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    return (data?.choices?.[0]?.message?.content || '').trim();
  }

  throw new Error(`Batch filter does not support provider "${provider}"`);
}

async function callFilterBatch(tweetChunk, ai, review) {
  const tweetsList = tweetChunk.map((t) => `ID: ${t.id}\nText: ${t.fullText}`).join('\n---\n');
  const prompt = `Analyze these tweets:\n\n${tweetsList}`;
  const provider = (ai.provider || 'openai').toLowerCase();
  const text = await callRouterModel({ ai, provider, prompt });
  const json = parseModelJson(text);

  const resultMap = {};
  const validIds = new Set(tweetChunk.map((t) => String(t.id)));

  for (const item of json.results || []) {
    const id = String(item?.id || '');
    if (!validIds.has(id)) continue;
    resultMap[id] = normalizeRoute(item);
  }

  for (const tweet of tweetChunk) {
    if (!resultMap[tweet.id]) {
      resultMap[tweet.id] = { shouldComment: false, skill: '' };
    }
    if (review?.enabled) {
      review.writeRouter({
        trace_id: review.traceByTweetId?.[tweet.id] || '',
        tweet_id: tweet.id,
        should_comment: resultMap[tweet.id].shouldComment,
        skill: resultMap[tweet.id].skill,
        source: 'fresh',
        router_prompt_full: ROUTER_SYSTEM_PROMPT,
        router_user_input_full: prompt,
        router_raw_output: text,
      });
    }
  }

  return resultMap;
}

export async function filterTweetsBatch({ tweets, ai, review }) {
  if (!tweets || tweets.length === 0) return {};

  // Smaller chunk size improves router consistency by reducing cross-tweet interference.
  const CHUNK_SIZE = 10;
  const chunks = [];
  for (let i = 0; i < tweets.length; i += CHUNK_SIZE) {
    chunks.push(tweets.slice(i, i + CHUNK_SIZE));
  }

  try {
    console.log(`[filterTweetsBatch] Processing ${tweets.length} tweets in ${chunks.length} chunk(s)...`);

    const mergedResults = {};

    for (let i = 0; i < chunks.length; i++) {
      try {
        console.log(`[filterTweetsBatch] Processing chunk ${i + 1}/${chunks.length} (${chunks[i].length} tweets)...`);
        const chunkResults = await callFilterBatch(chunks[i], ai, review);
        Object.assign(mergedResults, chunkResults);
        const passed = Object.values(chunkResults).filter((route) => route.shouldComment).length;
        console.log(`[filterTweetsBatch] Chunk ${i + 1} done: ${passed}/${chunks[i].length} passed`);
      } catch (chunkErr) {
        console.error(`[filterTweetsBatch] Chunk ${i + 1} failed: ${chunkErr.message}`);
        continue;
      }
    }

    const totalPassed = Object.values(mergedResults).filter((route) => route.shouldComment).length;
    console.log(`[filterTweetsBatch] All chunks merged. Total filter results: ${totalPassed}/${tweets.length} passed`);

    return mergedResults;
  } catch (error) {
    console.error(`Batch filter failed: ${error.message}`);
    return {};
  }
}

export async function generateComment({ tweetText, lang, ai, skill = DEFAULT_COMMENT_SKILL, review }) {
  if (isFollowBackRequest(tweetText)) {
    return followBackReply(lang);
  }

  const recentComments = readRecentComments(10);
  const prompt = buildPrompt({ tweetText, recentComments });
  const systemPrompt = buildCommentSystemPrompt(skill);
  const provider = (ai.provider || 'deepseek').toLowerCase();
  const model = ai.model || PROVIDER_DEFAULTS[provider]?.model || '';
  let text = '';

  try {
    if (provider === 'deepseek') text = await callDeepseek({ apiKey: ai.apiKey, model: ai.model, prompt, systemPrompt });
    else if (provider === 'openai') text = await callOpenAI({ apiKey: ai.apiKey, model: ai.model, prompt, systemPrompt });
    else if (provider === 'openrouter') text = await callOpenRouter({ apiKey: ai.apiKey, model: ai.model, prompt, systemPrompt });
    else if (provider === 'anthropic') text = await callAnthropic({ apiKey: ai.apiKey, model: ai.model, prompt, systemPrompt });
    else throw new Error(`Unknown AI provider: ${provider}`);
  } catch (error) {
    console.error(`[generateComment] AI call failed: ${error.message}. Waiting 1 hour before retry...`);
    await sleep(60 * 60 * 1000);

    try {
      if (provider === 'deepseek') text = await callDeepseek({ apiKey: ai.apiKey, model: ai.model, prompt, systemPrompt });
      else if (provider === 'openai') text = await callOpenAI({ apiKey: ai.apiKey, model: ai.model, prompt, systemPrompt });
      else if (provider === 'openrouter') text = await callOpenRouter({ apiKey: ai.apiKey, model: ai.model, prompt, systemPrompt });
      else if (provider === 'anthropic') text = await callAnthropic({ apiKey: ai.apiKey, model: ai.model, prompt, systemPrompt });
      else throw new Error(`Unknown AI provider: ${provider}`);
    } catch (retryError) {
      console.error(`[generateComment] Retry also failed: ${retryError.message}`);
      throw retryError;
    }
  }

  if (!text) {
    console.error('[generateComment] AI returned empty comment after retry');
    throw new Error('AI returned empty comment');
  }

  const cleanedText = text.replace(/^["'`]+|["'`]+$/g, '').replace(/—/g, '').trim();
  saveCommentToHistory(cleanedText);
  if (review?.enabled) {
    review.writeGenerate({
      trace_id: review.traceId || '',
      tweet_id: review.tweetId || '',
      skill,
      provider,
      model,
      comment_system_prompt_full: systemPrompt,
      comment_user_prompt_full: prompt,
      ai_raw_output: text,
      cleaned_comment: cleanedText,
    });
  }
  return cleanedText;
}
