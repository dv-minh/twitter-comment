# List Comment Mode

## What does it do?

**Bot workflow**:
1. Periodically crawl your configured Twitter lists
2. Find new tweets that haven't been commented yet
3. Generate contextual, human-like comments using AI
4. Automatically reply to tweets in the detected language

## Best for

- Building presence in niche communities (crypto lists, trader lists, dev lists, etc.)
- Increasing engagement within curated Twitter lists
- Growing organically with filtered, relevant audience
- Learning natural comment patterns across different languages

## Configuration

When you run `npm run setup`, you'll be asked:

**List IDs** (comma-separated)
- Find your list URL: `https://x.com/i/lists/1234567890`
- Extract the ID: `1234567890`
- You can add multiple lists: `1234567890, 2345678901`

Example config:
```json
{
  "listIds": ["1234567890", "2345678901"],
  "commentsPerHour": 15
}
```

## How comments are generated

- **Language detection**: Bot automatically detects the tweet language (English, Vietnamese, Japanese, Korean, Chinese)
- **System prompt**: Hardcoded to match Crypto Twitter (CT) culture
  - Natural, conversational tone (not blog post)
  - Short replies (10-30 words)
  - Uses CT slang naturally (gm, tbh, ngl, lfg, etc.)
  - Matches the tweet's energy
  - No hashtags, no URLs, no emojis (unless tweet needs it)

## Pros & Cons

✅ **Pros**:
- Safest approach — only engaging with pre-filtered lists
- Organic growth without spam signals
- Natural interaction pattern
- Works in any language

❌ **Cons**:
- Slower follower growth vs. broader engagement
- Requires good list curation (quality lists = quality comments)

---

## Tips for best results

1. **Start with 1-2 high-quality lists**
   - Better to comment well on small, relevant lists than spam large ones
   - Quality > quantity always

2. **Adjust comment rate based on list size**
   - Small list (50-200 tweets/day): 5-10 comments/hour
   - Medium list (200-500 tweets/day): 10-15 comments/hour
   - Large list (500+ tweets/day): 15-20 comments/hour

3. **Monitor and tweak**
   - Check `data/run.log` for patterns
   - If getting few replies → comments may be too generic
   - If getting engagement → keep the AI prompt and rate working

4. **Re-export cookies every 2-4 weeks**
   - Twitter sessions expire
   - When bot stops → re-run `npm run setup` (Q1 only)

