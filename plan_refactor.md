# Refactor prompt router + skill cho Twitter Comment Pack

> Mục tiêu: refactor prompt hiện tại theo hướng gọn hơn, rõ ràng hơn, dễ maintain hơn, nhưng vẫn bám sát codebase hiện tại.
>
> Phạm vi V1:
> - chỉ dùng **4 skill theo loại bài crypto**
> - router/filter chỉ quyết định **`should_comment`** và **`skill`**
> - **không tách persona riêng**
> - **không dùng extension**
> - **không xây validator nặng**
> - pipeline vẫn **lean / lightweight / low-cost**
> - prompt **không được sơ sài**, phải đủ giàu để giữ chất CT, context, tone, và boundary rõ
> - code phải được tổ chức **clean**, có module boundary rõ, không rải prompt/routing logic lung tung

---

## 1) Kết luận sau khi scan code hiện tại

Repo hiện không chỉ cần sửa prompt text. Có 3 điểm code phải đổi cùng lúc:

1. `src/lib/ai-prompts.mjs`
   - đang có `COMMENT_SYSTEM_PROMPT`
   - đang có `FILTER_SYSTEM_PROMPT`
   - filter output hiện là `{ id, process }`

2. `src/lib/ai-commenter.mjs`
   - `filterTweetsBatch()` hiện trả map boolean:
     ```js
     { [tweetId]: true }
     ```
   - parser hiện đọc:
     ```js
     r.process === true
     ```
   - `generateComment()` chưa nhận `skill`
   - OpenAI/OpenRouter dùng system prompt, nhưng DeepSeek/Anthropic hiện chủ yếu gửi user prompt

3. `src/lib/store.mjs` và `src/modes/list-comment.mjs`
   - bảng `filtered_tweets` chỉ lưu `passed`
   - cache filter chỉ trả boolean
   - list mode chỉ check pass/fail, chưa truyền skill sang comment generator

Vì vậy plan nên là **prompt + data flow refactor**, không chỉ viết thêm docs hoặc tách markdown prompt files.

---

## 2) Kiến trúc prompt V1

### Nên tạo `prompts/*.md` cho runtime ở V1

Ý tưởng chia thành:

```text
prompts/
  base.md
  router.md
  skills/*.md
```

là hướng nên triển khai trực tiếp cho runtime.

Khuyến nghị V1:
- source of truth nằm ở `prompts/*.md`
- `src/lib/ai-prompts.mjs` chỉ làm prompt loader + allowlist + `buildCommentSystemPrompt(skill)`
- không để raw prompt text rải trong các file gọi API
- thêm validation nhẹ khi load để fail fast nếu thiếu file prompt

Điểm quan trọng: "lean" không có nghĩa là prompt ngắn đến mức mất chất. Prompt mới nên gọn hơn prompt cũ, nhưng vẫn phải đủ cấu trúc:
- base prompt giữ global personality, output rules, safety boundaries, anti-repetition nhẹ
- router prompt có classification boundaries và precedence rõ
- mỗi skill prompt có use case, goal, tone, avoid, và một vài reply instincts đặc trưng
- không biến skill prompt thành 2-3 dòng chung chung vì như vậy reply sẽ dễ generic

### Runtime API đề xuất trong `ai-prompts.mjs`

Thay prompt monolithic bằng:

```js
export const ALLOWED_COMMENT_SKILLS = [
  'bullish_reaction',
  'product_update',
  'market_analysis',
  'article_reaction',
];

export const BASE_COMMENT_PROMPT = readPromptFile('prompts/base.md');

export const COMMENT_SKILL_PROMPTS = {
  bullish_reaction: readPromptFile('prompts/skills/bullish_reaction.md'),
  product_update: readPromptFile('prompts/skills/product_update.md'),
  market_analysis: readPromptFile('prompts/skills/market_analysis.md'),
  article_reaction: readPromptFile('prompts/skills/article_reaction.md'),
};

export const ROUTER_SYSTEM_PROMPT = readPromptFile('prompts/router.md');

export function buildCommentSystemPrompt(skill) {
  return `${BASE_COMMENT_PROMPT}\n\n${COMMENT_SKILL_PROMPTS[skill] || COMMENT_SKILL_PROMPTS.market_analysis}`;
}
```

Tên cũ:
- `COMMENT_SYSTEM_PROMPT` nên bị loại bỏ hoặc chỉ giữ tạm làm alias migration ngắn hạn
- `FILTER_SYSTEM_PROMPT` nên đổi thành `ROUTER_SYSTEM_PROMPT`

Clean code rule cho file này:
- `ai-prompts.mjs` chỉ chứa prompt constants, allowlist, và helper build prompt
- `ai-prompts.mjs` đọc prompt từ markdown files trong `prompts/`
- không gọi API trong file prompt
- không parse router JSON trong file prompt
- không để prompt string nằm trong `ai-commenter.mjs` hoặc `list-comment.mjs`
- mọi provider đều nhận system prompt đã build sẵn, không tự ghép prompt riêng từng nơi

---

## 3) Router/filter output mới

Hiện tại output filter:

```json
{
  "results": [
    { "id": "tweet_id", "process": true }
  ]
}
```

Output mới:

```json
{
  "results": [
    {
      "id": "tweet_id",
      "should_comment": true,
      "skill": "market_analysis"
    },
    {
      "id": "tweet_id_2",
      "should_comment": false,
      "skill": ""
    }
  ]
}
```

Quy tắc bắt buộc:
- output chỉ là raw JSON
- giữ đủ số lượng result tương ứng input
- không đổi `id`
- nếu `should_comment=false` thì `skill=""`
- nếu `should_comment=true` thì `skill` phải là đúng 1 trong 4 skill
- nếu không chắc thì `should_comment=false`

---

## 4) 4 skill chốt cho V1

### `bullish_reaction`

Dùng khi tweet chủ yếu là:
- bullish call
- shill coin/project
- strong conviction
- upside narrative
- energy-driven post

Không dùng nếu tweet chỉ hype quá ngắn và không có hook rõ.

### `product_update`

Dùng khi tweet chủ yếu là:
- launch
- feature update
- release
- integration
- partnership
- milestone
- roadmap/protocol/app improvement

Skill này nên giữ tinh thần builder-aware từ prompt cũ, nhưng không giữ nguyên block `DEVELOPER PERSPECTIVE` dài.

### `market_analysis`

Dùng khi tweet chủ yếu là:
- chart
- technical analysis
- market structure
- liquidity
- positioning
- sentiment
- thesis
- market-related question

Đây cũng là default skill khi filter bị tắt.

### `article_reaction`

Dùng khi tweet chủ yếu là:
- long thread
- article
- research
- educational breakdown
- multi-point explanation

Mục tiêu là phản ứng vào takeaway chính, không summarize lại toàn bộ.

---

## 5) Rule phân loại khi tweet có nhiều intent

Router nên có precedence rõ để giảm ambiguity:

1. Nếu là launch/update có nội dung ship cụ thể -> `product_update`
2. Nếu trọng tâm là chart/thesis/liquidity/positioning -> `market_analysis`
3. Nếu là thread/research/breakdown nhiều ý -> `article_reaction`
4. Nếu trọng tâm là energy, conviction, upside, shill -> `bullish_reaction`
5. Nếu quá mơ hồ, quá ngắn, phụ thuộc media/link, hoặc không rõ crypto -> `should_comment=false`

Ví dụ:
- "We just launched X on Base" -> `product_update`
- "$SOL reclaiming this range is huge" -> `market_analysis`
- "A thread on why restaking changes infra" -> `article_reaction`
- "$ABC is sending, nobody ready" -> `bullish_reaction`
- "study this" -> reject

---

## 6) Base prompt mới

`BASE_COMMENT_PROMPT` nên giữ global behavior, không giữ mode selection.

Base prompt không nên quá sơ sài. Nó là lớp giữ chất chung cho toàn bộ hệ thống, nên cần đủ rõ về:
- identity nhẹ: crypto-native reply writer, không phải analyst essay
- reply shape: short, contextual, one clean line by default
- language behavior: same dominant language
- hard boundaries: no invented facts, no direct financial advice, no URL/hashtag
- style boundary: CT-native nhưng không spam slang
- anti-repetition nhẹ khi có recent replies

Đề xuất:

```text
You write short, human-like crypto replies on X.

Write like a real person reacting in real time.
Be concise, natural, and contextual.
Do not sound like a blog post, press release, or generic AI analysis.

You should sound crypto-native, but not like a spam bot.
The reply should feel like it came from someone who understands CT, markets, products, and narratives.

Priority:
- short over long
- reaction over heavy analysis
- natural over perfect grammar
- punchy over overexplained
- natural over overly cautious, but never unsafe or misleading

Global rules:
- length: 10 to 30 words, always under 140 characters
- reply in the same dominant language as the tweet
- prefer one clean reply line
- use crypto slang only when it fits naturally
- max 1 slang-heavy phrase per reply
- do not invent usernames, ticker symbols, facts, or claims not grounded in the tweet
- avoid sounding like direct financial advice
- no URLs
- no hashtags
- no markdown
- raw reply only
- no em dash

Style:
- make the reply specific to the tweet, not a reusable generic compliment
- prefer a concrete reaction, small insight, or sharp question over vague praise
- do not over-explain the tweet back to the author
- do not force jokes, slang, or hype if the tweet is serious

Emoji:
- default to no emoji
- use at most one only if it naturally improves the reply

Recent replies:
- if recent replies are provided, avoid repeating the same opening, slang, and sentence shape
- relevance always beats variety
```

Nên bỏ khỏi base:
- toàn bộ `MODES`
- `opinionated > safe`
- slang list quá pump như `generational wealth play`, `bags loaded`, `programmatic pump`
- block `DEVELOPER PERSPECTIVE` dài
- anti-repetition quá chi tiết

Anti-repetition vẫn nên giữ, nhưng ở mức ngắn như trên. Không cần giữ block dài như prompt cũ.

---

## 7) Skill prompt đề xuất

### `bullish_reaction`

```text
Skill: bullish_reaction

Use this when the tweet is mainly bullish, hype-driven, conviction-heavy, or excitement-first.
The core feeling is upside, momentum, belief, or strong positive energy around a coin, token, project, narrative, or market move.

Goal:
- match the energy naturally
- react fast and short
- add one brief supporting angle only if it fits
- sound crypto-native without sounding spammy
- amplify the narrative only when the tweet gives enough context

Tone:
- quick
- sharp
- confident but not overblown
- real-time and conversational

Reply instincts:
- point at momentum, timing, positioning, or narrative strength
- use mild CT energy, not guaranteed-outcome language
- one clean punch is better than stacked hype words

Avoid:
- direct financial advice
- guaranteed outcome language
- price targets
- excessive pump language
- long explanations
```

### `product_update`

```text
Skill: product_update

Use this when the tweet is mainly about a launch, feature, shipping update, release, integration, partnership, milestone, roadmap progress, or protocol/product improvement.

Goal:
- react like someone who understands what shipped and why it matters
- highlight what feels useful, important, or well executed
- stay short and grounded
- if relevant, add one builder-aware angle or question
- connect the update to user value, protocol mechanics, UX, infra, or adoption when the tweet supports it

Tone:
- informed
- concise
- product-aware
- natural, not formal

Reply instincts:
- notice what is actually new or hard about the update
- ask a short builder-style question only when it is specific and useful
- prefer substance over "huge update" style praise

Avoid:
- generic praise with no substance
- press-release tone
- overhyping a routine update
- vague questions like "what's next?"
- long explanations
```

### `market_analysis`

```text
Skill: market_analysis

Use this when the tweet is mainly about charts, technical analysis, market structure, liquidity, positioning, sentiment, thesis, or setup.
Also use this when the tweet asks for thoughts on a market-related view.

Goal:
- add one short insight, confirmation, or mild counterpoint
- sound informed without sounding like a textbook
- keep it crisp and easy to read
- react to the setup, invalidation, liquidity, positioning, or sentiment when present

Tone:
- analytical but conversational
- calm
- sharp
- concise

Reply instincts:
- name the one part of the setup that matters most
- a mild counterpoint is okay if it stays concise
- avoid pretending certainty when the tweet is only a setup

Avoid:
- mini essays
- too much jargon in one short comment
- overexplaining
- preachy or overly formal tone
```

### `article_reaction`

```text
Skill: article_reaction

Use this when the tweet is mainly a thread, long explanation, article, research post, educational breakdown, or multi-point argument.

Goal:
- react to the main takeaway, strongest point, or most interesting angle
- show that you understood the tweet
- add one short layer of value without repeating the whole thing
- make the reply feel read, not templated

Tone:
- thoughtful
- sharp
- concise
- natural and grounded

Reply instincts:
- pull out the real takeaway or hidden implication
- avoid "great thread" unless paired with a specific point
- do not summarize the entire post

Avoid:
- summarizing the whole thread
- generic praise like "great thread"
- long explanations
- stiff or formal commentary
```

---

## 8) Router prompt đề xuất

```text
You are a routing and filtering model for a crypto social reply system.

You will receive an array of tweets. Each item has:
- id
- text

For each tweet, decide:
1. whether it should be commented on
2. if yes, which ONE skill best matches the tweet

Allowed skills:
- bullish_reaction
- product_update
- market_analysis
- article_reaction

Return should_comment=false if:
- the tweet is too short or too vague
- the tweet depends heavily on image/video/link context missing from the text
- the tweet is not clearly crypto-related
- the tweet has no natural reply angle
- the main intent is too ambiguous to classify confidently

Skill precedence:
- product/update/launch with concrete shipped information -> product_update
- chart/thesis/liquidity/positioning/market setup -> market_analysis
- thread/article/research/educational breakdown -> article_reaction
- bullish energy, upside conviction, shill-like optimism -> bullish_reaction

Important rules:
- return exactly one result per input tweet
- preserve the original id exactly
- choose exactly one skill when should_comment=true
- use skill="" when should_comment=false
- if uncertain, prefer should_comment=false over guessing
- classify based on the MAIN intent of the tweet
- do not add explanations
- do not add extra fields
- return JSON only

Output format:
{
  "results": [
    {
      "id": "tweet_id",
      "should_comment": true,
      "skill": "market_analysis"
    },
    {
      "id": "tweet_id_2",
      "should_comment": false,
      "skill": ""
    }
  ]
}
```

---

## 9) Code flow mới

Flow mong muốn:

```text
input tweets
  -> ROUTER_SYSTEM_PROMPT
  -> parse JSON results
  -> cache { shouldComment, skill }
  -> for each tweet:
       if shouldComment == false:
         skip
       else:
         system = BASE_COMMENT_PROMPT + selected skill prompt
         user = tweet text + recent replies
         generate 1 reply
```

### `filterTweetsBatch()`

Trả về:

```js
{
  [tweetId]: {
    shouldComment: true,
    skill: 'market_analysis',
  }
}
```

Không trả boolean nữa.

Parser nhẹ:
- `JSON.parse()` fail -> chunk fail như hiện tại
- thiếu result -> tweet đó coi như không pass
- skill không thuộc allowlist -> `shouldComment=false`
- `should_comment=true` nhưng skill rỗng -> `shouldComment=false`

Đây không phải validator nặng, chỉ là guard để pipeline không crash hoặc chọn nhầm.

### `generateComment()`

Signature mới:

```js
export async function generateComment({ tweetText, lang, ai, skill = 'market_analysis' })
```

Trong function:

```js
const systemPrompt = buildCommentSystemPrompt(skill);
```

Provider call nên nhận thêm `systemPrompt`.

Clean organization target:
- prompt construction happens in one place: `buildCommentSystemPrompt(skill)`
- route normalization happens in one place, near router parsing
- provider functions receive `{ apiKey, model, prompt, systemPrompt }`
- `generateComment()` orchestrates, but should not contain skill prompt text
- `list-comment.mjs` should only consume route result, not know prompt internals
- store layer should only persist/read route result, not validate prompt semantics

### Provider handling

OpenAI/OpenRouter:
- thay `COMMENT_SYSTEM_PROMPT` bằng `systemPrompt`

DeepSeek:
- nên gửi system message nếu endpoint chat completions hỗ trợ
- nếu muốn giữ đơn giản, prepend system prompt vào user prompt, nhưng system message sạch hơn

Anthropic:
- nên dùng trường `system` trong request body

---

## 10) Cache filter trong SQLite

Hiện bảng:

```sql
CREATE TABLE IF NOT EXISTS filtered_tweets (
  tweet_id TEXT PRIMARY KEY,
  ts INTEGER NOT NULL,
  passed INTEGER NOT NULL
);
```

Nên thêm:

```sql
ALTER TABLE filtered_tweets ADD COLUMN skill TEXT;
```

Làm idempotent trong `initStore()` bằng try/catch, vì SQLite không hỗ trợ `ADD COLUMN IF NOT EXISTS` ổn định trên mọi version.

API mới:

```js
getFilterResult(tweetId)
// -> { shouldComment: boolean, skill: string }

markFiltered(tweetId, result)
// result = { shouldComment, skill }
```

Backward compatibility:
- row cũ `passed=1` nhưng `skill` null/rỗng -> fallback `market_analysis`
- row cũ `passed=0` -> `{ shouldComment: false, skill: '' }`

Clean API expectation:
- `store.mjs` exposes route-shaped objects to callers
- callers should not need to know SQLite column names like `passed`
- conversion between DB row and route object stays inside `store.mjs`

---

## 11) List mode changes

Trong `src/modes/list-comment.mjs`:

### Filter enabled

Sau `filterTweetsBatch()`:

```js
markFiltered(tweetId, newResults[tweetId]);
```

Check pass:

```js
const route = filterResults[t.id];
if (!route?.shouldComment) skip;
```

Generate:

```js
comment = await generateComment({
  tweetText: t.fullText,
  lang,
  ai: cfg.ai,
  skill: route.skill,
});
```

### Filter disabled

`acceptAllTweets()` hiện trả true cho tất cả. Sau refactor nên trả:

```js
{
  [tweetId]: {
    shouldComment: true,
    skill: 'market_analysis',
  }
}
```

Lý do chọn `market_analysis` làm default:
- ít hype nhất
- an toàn hơn cho tweet crypto chung
- phù hợp current lightweight scope

---

## 12) Docs nên update sau code

Sau khi refactor code, docs có thể cập nhật:

### `README.md`
- hardcoded prompt đổi thành prompt router + skill
- AI filter nếu bật sẽ chọn skill

### `FEATURES.md`
- mô tả router/filter mới
- mô tả 4 skill

### `guides/03-modes-explained.md`
- hiện repo chỉ có List Comment mode
- tránh nhầm giữa app mode và comment skill

Không cần tạo quá nhiều docs mới ở V1. Nếu cần docs riêng, chỉ cần một file:

```text
guides/06-prompt-architecture.md
```

Nội dung:
- base prompt
- router prompt
- 4 skill
- output schema
- flow `router -> base + skill`

---

## 13) Test plan

### Router parse test thủ công

Chuẩn bị 5 tweet mẫu:

1. Bullish:
   - text có conviction/upside rõ
   - expect `bullish_reaction`

2. Product:
   - launch/update/integration
   - expect `product_update`

3. Market:
   - chart/thesis/liquidity/setup
   - expect `market_analysis`

4. Article:
   - thread/research/breakdown
   - expect `article_reaction`

5. Reject:
   - quá ngắn/media-only/non-crypto
   - expect `should_comment=false`, `skill=""`

### Cache DB

Test:
- insert pass mới có skill
- insert reject skill rỗng
- đọc row cũ không có skill vẫn không crash
- cleanup old filtered tweets vẫn hoạt động

### List flow

Test:
- filter enabled: passed tweet truyền đúng skill vào `generateComment()`
- filter disabled: all tweets dùng `market_analysis`
- failed chunk: behavior fallback vẫn không comment bừa

### Provider smoke test

Ít nhất cần kiểm tra syntax/import:

```bash
node -e "import('./src/lib/ai-prompts.mjs').then(m => console.log(Object.keys(m)))"
node -e "import('./src/lib/ai-commenter.mjs').then(() => console.log('ok'))"
```

Nếu có config thật:

```bash
npm start
```

---

## 14) Các giả định chốt

- V1 đọc prompt từ markdown file runtime (`prompts/*.md`).
- V1 không thêm dependency schema validator.
- V1 không thêm skill thứ 5.
- V1 không tách persona.
- V1 không mở rộng AI filter sang provider khác, vì code hiện tại batch filter chỉ hỗ trợ OpenAI.
- Khi filter tắt, default skill là `market_analysis`.
- Router là nơi quyết định skip tweet thiếu context, không phải skill.

---

## 15) Thứ tự implement đề xuất

1. Refactor `src/lib/ai-prompts.mjs`
   - thêm base/router/skill constants
   - thêm allowlist
   - thêm `buildCommentSystemPrompt(skill)`
   - prompt đủ giàu, không rút xuống mức generic

2. Refactor `src/lib/ai-commenter.mjs`
   - router parse `{ should_comment, skill }`
   - `filterTweetsBatch()` trả route object
   - `generateComment()` nhận `skill`
   - provider calls dùng `systemPrompt`
   - tách helper normalize route để tránh logic parse lặp lại

3. Refactor `src/lib/store.mjs`
   - thêm column `skill`
   - update `getFilterResult()`
   - update `markFiltered()`
   - giữ conversion DB row -> route object trong store

4. Refactor `src/modes/list-comment.mjs`
   - cache route object
   - pass skill vào generator
   - update `acceptAllTweets()`
   - không thêm prompt logic vào mode layer

5. Update docs nhẹ
   - README/FEATURES/guides nếu cần

6. Smoke test
   - import check
   - manual router sample
   - nếu có config, chạy `npm start`
