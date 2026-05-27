# Router Output Schema

## Purpose

Router filters tweets and selects one skill for each tweet that should receive a comment.

## Input

Router receives an array of tweets with:
- `id`
- `text`

## Output

Router must return JSON only:

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

## Rules

- Exactly one result per input tweet.
- Preserve input `id` exactly.
- If `should_comment` is `false`, `skill` must be empty string.
- If `should_comment` is `true`, `skill` must be one of:
  - `bullish_reaction`
  - `product_update`
  - `market_analysis`
  - `article_reaction`
- If uncertain, router should return `should_comment=false`.

## Runtime normalization

In `src/lib/ai-commenter.mjs`, route normalization is strict:
- unknown/missing skill => `shouldComment: false`
- missing tweet result => default reject

This is a light guard, not a heavy validator.
