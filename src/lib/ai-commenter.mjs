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

async function fetchWithTimeout(url, options = {}, timeoutMs = 90_000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error(`Request timed out after ${Math.round(timeoutMs / 1000)}s`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
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

function isDebugEnabled() {
  return process.env.DEBUG === '1';
}

function debugLog(message) {
  console.log(message);
}

function debugWarn(message) {
  console.warn(message);
}

function logLLMDebug(label, payload) {
  if (!isDebugEnabled()) return;
  console.log(`[llm-comment-debug] ${label}: ${JSON.stringify(payload, null, 2)}`);
}

function formatLinks(links = [], label = 'Link') {
  if (!links.length) return '';
  return links
    .map((link, index) => `${label} ${index + 1}: ${link.tcoUrl || ''} expanded=${link.expandedUrl || ''}`)
    .join('\n');
}

function formatMedia(media = [], label = 'Media') {
  if (!media.length) return '';
  return media
    .map((item, index) => `${label} ${index + 1}: ${mediaLabel(item)}`)
    .join('\n');
}

function buildPrompt({ tweetText, links = [], media = [], quotedTweet = null, recentComments = [] }) {
  let historySection = '';
  if (recentComments && recentComments.length > 0) {
    const recentTexts = recentComments.map((c, i) => `${i + 1}. ${c.text}`).join('\n');
    historySection = `\n\nYour 10 most recent replies:\n${recentTexts}\n`;
  }

  const tweetContext = [
    formatLinks(links),
    formatMedia(media),
  ].filter(Boolean).join('\n');
  const quoteContext = quotedTweet ? [
    formatLinks(quotedTweet.links || [], 'Quote link'),
    formatMedia(quotedTweet.media || [], 'Quote media'),
  ].filter(Boolean).join('\n') : '';

  const quoteSection = quotedTweet?.text
    ? `\n\nQuoted tweet:\nAuthor: @${quotedTweet.author || 'unknown'}\n"${quotedTweet.text}"${quoteContext ? `\n${quoteContext}` : ''}`
    : '';

  return `Tweet content:
"${tweetText}"${tweetContext ? `\n${tweetContext}` : ''}${quoteSection}${historySection}`;
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
  const res = await fetchWithTimeout('https://api.deepseek.com/chat/completions', {
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
  const res = await fetchWithTimeout('https://api.openai.com/v1/chat/completions', {
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
  const res = await fetchWithTimeout('https://openrouter.ai/api/v1/chat/completions', {
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
  const res = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
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

function imageUrlForModel(mediaUrl) {
  if (!mediaUrl) return '';
  return mediaUrl.includes('?') ? mediaUrl : `${mediaUrl}?format=jpg&name=large`;
}

function mediaLabel(media) {
  const parts = [
    `type=${media.type || 'unknown'}`,
    media.tcoUrl ? `tco=${media.tcoUrl}` : '',
    media.expandedUrl ? `expanded=${media.expandedUrl}` : '',
    media.mediaUrl ? `image=${imageUrlForModel(media.mediaUrl)}` : '',
    media.width && media.height ? `size=${media.width}x${media.height}` : '',
  ].filter(Boolean);
  return parts.join(' ');
}

function collectRouterImages(tweetChunk) {
  const seen = new Set();
  const images = [];
  for (const tweet of tweetChunk) {
    const allMedia = [
      ...(tweet.media || []),
      ...(tweet.quotedTweet?.media || []),
    ];
    for (const media of allMedia) {
      const imageUrl = imageUrlForModel(media.mediaUrl);
      if (!imageUrl || seen.has(imageUrl)) continue;
      seen.add(imageUrl);
      images.push(imageUrl);
      if (images.length >= 20) return images;
    }
  }
  return images;
}

function buildUserContent(prompt, imageUrls) {
  if (!imageUrls || imageUrls.length === 0) return prompt;
  return [
    { type: 'text', text: prompt },
    ...imageUrls.map((url) => ({ type: 'image_url', image_url: { url } })),
  ];
}

async function callRouterModel({ ai, provider, prompt, imageUrls = [] }) {
  const userContent = buildUserContent(prompt, imageUrls);

  if (provider === 'openai') {
    const res = await fetchWithTimeout('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${ai.apiKey}` },
      body: JSON.stringify({
        model: ai.model || PROVIDER_DEFAULTS.openai.model,
        messages: [
          { role: 'system', content: ROUTER_SYSTEM_PROMPT },
          { role: 'user', content: userContent },
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
    const res = await fetchWithTimeout('https://openrouter.ai/api/v1/chat/completions', {
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
          { role: 'user', content: userContent },
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
  const tweetsList = tweetChunk.map((t) => {
    const lines = [
      `ID: ${t.id}`,
      `Author: ${t.author || ''}`,
      `Text: ${t.fullText}`,
    ];
    for (const [index, link] of (t.links || []).entries()) {
      lines.push(`Link ${index + 1}: ${link.tcoUrl} expanded=${link.expandedUrl || ''}`);
    }
    for (const [index, media] of (t.media || []).entries()) {
      lines.push(`Media ${index + 1}: ${mediaLabel(media)}`);
    }
    if (t.quotedTweet?.text) {
      lines.push(`Quote author: ${t.quotedTweet.author || ''}`);
      lines.push(`Quote text: ${t.quotedTweet.text}`);
      for (const [index, link] of (t.quotedTweet.links || []).entries()) {
        lines.push(`Quote link ${index + 1}: ${link.tcoUrl} expanded=${link.expandedUrl || ''}`);
      }
      for (const [index, media] of (t.quotedTweet.media || []).entries()) {
        lines.push(`Quote media ${index + 1}: ${mediaLabel(media)}`);
      }
    }
    return lines.join('\n');
  }).join('\n---\n');
  const prompt = `Analyze these tweets. If media image inputs are attached, first understand what each image shows using the Media/Quote media lines, then combine that with Text and Quote text before deciding.\n\n${tweetsList}`;
  const imageUrls = collectRouterImages(tweetChunk);
  const provider = (ai.provider || 'openai').toLowerCase();
  const text = await callRouterModel({ ai, provider, prompt, imageUrls });
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
      resultMap[tweet.id] = { shouldComment: false, skill: '', omitted: true };
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

async function callFilterBatchWithRetry(tweetChunk, ai, review) {
  const resultMap = await callFilterBatch(tweetChunk, ai, review);
  const missingTweets = tweetChunk.filter((tweet) => {
    const route = resultMap[tweet.id];
    return route?.omitted === true;
  });

  if (missingTweets.length === 0 || tweetChunk.length === 1) {
    return resultMap;
  }

  debugWarn(`[filterTweetsBatch] Router omitted ${missingTweets.length}/${tweetChunk.length} result(s); retrying individually...`);
  for (const tweet of missingTweets) {
    try {
      const retryResult = await callFilterBatch([tweet], ai, review);
      Object.assign(resultMap, retryResult);
    } catch (error) {
      console.error(`[filterTweetsBatch] Retry failed for ${tweet.id}: ${error.message}`);
    }
  }
  return resultMap;
}

export async function filterTweetsBatch({ tweets, ai, review }) {
  if (!tweets || tweets.length === 0) return {};

  // Smaller chunks reduce skipped IDs, especially when tweets include image inputs.
  const CHUNK_SIZE = 5;
  const chunks = [];
  for (let i = 0; i < tweets.length; i += CHUNK_SIZE) {
    chunks.push(tweets.slice(i, i + CHUNK_SIZE));
  }

  try {
    debugLog(`[filterTweetsBatch] Processing ${tweets.length} tweets in ${chunks.length} chunk(s)...`);

    const mergedResults = {};

    for (let i = 0; i < chunks.length; i++) {
      try {
        debugLog(`[filterTweetsBatch] Processing chunk ${i + 1}/${chunks.length} (${chunks[i].length} tweets)...`);
        const chunkResults = await callFilterBatchWithRetry(chunks[i], ai, review);
        Object.assign(mergedResults, chunkResults);
        const passed = Object.values(chunkResults).filter((route) => route.shouldComment).length;
        debugLog(`[filterTweetsBatch] Chunk ${i + 1} done: ${passed}/${chunks[i].length} passed`);
      } catch (chunkErr) {
        console.error(`[filterTweetsBatch] Chunk ${i + 1} failed: ${chunkErr.message}`);
        continue;
      }
    }

    const totalPassed = Object.values(mergedResults).filter((route) => route.shouldComment).length;
    debugLog(`[filterTweetsBatch] All chunks merged. Total filter results: ${totalPassed}/${tweets.length} passed`);

    return mergedResults;
  } catch (error) {
    console.error(`Batch filter failed: ${error.message}`);
    return {};
  }
}

export async function generateComment({ tweetText, links = [], media = [], quotedTweet = null, lang, ai, skill = DEFAULT_COMMENT_SKILL, review }) {
  if (isFollowBackRequest(tweetText)) {
    return followBackReply(lang);
  }

  const recentComments = readRecentComments(10);
  const prompt = buildPrompt({ tweetText, links, media, quotedTweet, recentComments });
  const systemPrompt = buildCommentSystemPrompt(skill);
  const provider = (ai.provider || 'deepseek').toLowerCase();
  const model = ai.model || PROVIDER_DEFAULTS[provider]?.model || '';
  const imageUrls = collectRouterImages([{ media, quotedTweet }]).slice(0, 4);
  const promptForModel = (provider === 'openai' || provider === 'openrouter')
    ? buildUserContent(prompt, imageUrls)
    : prompt;
  let text = '';

  logLLMDebug('request', {
    provider,
    model,
    skill,
    systemPrompt,
    userPrompt: prompt,
    imageUrls,
  });

  try {
    if (provider === 'deepseek') text = await callDeepseek({ apiKey: ai.apiKey, model: ai.model, prompt: promptForModel, systemPrompt });
    else if (provider === 'openai') text = await callOpenAI({ apiKey: ai.apiKey, model: ai.model, prompt: promptForModel, systemPrompt });
    else if (provider === 'openrouter') text = await callOpenRouter({ apiKey: ai.apiKey, model: ai.model, prompt: promptForModel, systemPrompt });
    else if (provider === 'anthropic') text = await callAnthropic({ apiKey: ai.apiKey, model: ai.model, prompt: promptForModel, systemPrompt });
    else throw new Error(`Unknown AI provider: ${provider}`);
  } catch (error) {
    console.error(`[generateComment] AI call failed: ${error.message}. Waiting 1 hour before retry...`);
    await sleep(60 * 60 * 1000);

    try {
      if (provider === 'deepseek') text = await callDeepseek({ apiKey: ai.apiKey, model: ai.model, prompt: promptForModel, systemPrompt });
      else if (provider === 'openai') text = await callOpenAI({ apiKey: ai.apiKey, model: ai.model, prompt: promptForModel, systemPrompt });
      else if (provider === 'openrouter') text = await callOpenRouter({ apiKey: ai.apiKey, model: ai.model, prompt: promptForModel, systemPrompt });
      else if (provider === 'anthropic') text = await callAnthropic({ apiKey: ai.apiKey, model: ai.model, prompt: promptForModel, systemPrompt });
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
  logLLMDebug('response', {
    provider,
    model,
    skill,
    rawOutput: text,
    cleanedComment: cleanedText,
  });
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
      comment_image_urls: imageUrls,
      ai_raw_output: text,
      cleaned_comment: cleanedText,
    });
  }
  return cleanedText;
}
