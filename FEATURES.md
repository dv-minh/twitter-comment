# Twitter Comment Pack — Mô tả tính năng chi tiết

Bot Twitter/X tự động bình luận, tối ưu cho trader, creator, và analyst muốn tăng engagement mà không cần ngồi reply tay.

---

## 1. Cài đặt 3 phút bằng wizard

Toàn bộ cấu hình gói gọn trong **3 câu hỏi** chạy bằng `npm run setup`. Không cần sửa code, không cần đọc tài liệu kỹ thuật. Wizard sẽ:

- **Validate cookies ngay tại chỗ**: nếu thiếu `auth_token` hoặc `ct0` → báo lỗi rõ ràng, hướng dẫn export lại.
- **Lưu file `data/config.json` + `data/cookies.json`** đã chuẩn hóa, gitignored sẵn.

Nếu sau này muốn đổi cấu hình (vd thêm list mới, đổi rate), chỉ cần chạy lại `npm run setup` — wizard giữ giá trị cũ làm default, chỉ override những gì bạn nhập mới.

---

## 2. List Comment — chế độ duy nhất (an toàn & tự nhiên)

Bot crawl các Twitter list bạn chỉ định, comment vào tweet mới chưa từng comment.

- **Đa list**: nhập nhiều list ID phân cách bằng dấu phẩy, bot chia đều quota giữa các list theo round-robin.
- **Auto-detect ngôn ngữ tweet**: phân biệt tiếng Anh / Nhật / Hàn / Trung / Việt qua Unicode, comment đúng ngôn ngữ tweet gốc → tự nhiên, không bị flag spam.
- **System prompt hardcoded**: bot được tuning riêng cho Crypto Twitter (CT) culture
  - Tone: natural, conversational (không blog post)
  - Độ dài: 10–30 words, dưới 140 ký tự
  - CT slang: gm, tbh, ngl, lfg, bags ready, lfg...
  - Match tweet energy: bullish → hype, meme → funny, analysis → thoughtful
  - NO hashtags, NO URLs, NO emojis (trừ khi cần thiết: 😭 💀 👀 🔥)
  - NO @mentions, NO $tickers không có trong tweet gốc
- **Dedup persistent**: SQLite lưu mọi tweet đã comment → restart bot không bao giờ comment trùng.
- **AI filtering optional**: nếu bạn bật ENABLE_AI_FILTER = true, bot sẽ filter tweet trước (chỉ comment vào tweet "xứng đáng"), giúp tăng chất lượng engagement.

---

## 3. Đa nhà cung cấp AI — bạn cầm chìa khóa

Bot không bundle AI sẵn. Bạn cung cấp API key của 1 trong 4 provider, tùy ngân sách và chất lượng:

| Provider | Model mặc định | Giá tham khảo (per 1M token) | Chất lượng |
|---|---|---|---|
| **DeepSeek** | `deepseek-chat` | ~$0.14 input / $0.28 output | Tốt cho chi phí, hỗ trợ tốt CJK |
| **OpenAI** | `gpt-4o-mini` | ~$0.15 input / $0.60 output | Cân bằng |
| **OpenRouter** | tùy chọn | tùy model | Linh hoạt, routing tự động |
| **Anthropic** | `claude-haiku-4-5` | ~$1 input / $5 output | Tự nhiên nhất, đắt hơn |

- **Override model bất kỳ lúc nào**: edit `data/config.json` field `ai.model`.
- **Switch provider** chỉ cần chạy lại wizard.
- **Không vendor lock-in**: prompt được build chuẩn hóa, mọi provider đều dùng cùng template.
- **Gọi qua HTTP `fetch` trực tiếp**: không phụ thuộc SDK của provider.

---

## 4. Rate limit thông minh

`commentsPerHour` không phải con số cứng. Bot:

- **Jitter delay 60–240 giây** giữa các comment (cấu hình qua `delayMinMs`, `delayMaxMs`) → trông như người thật, không phải burst.
- **Soft fail vs hard fail**:
  - Soft fail (1 tweet bị block, network blip) → bỏ qua, tiếp tục.
  - Hard fail (cookies expired, 401/403 auth) → STOP, log chi tiết.
- **Khuyến nghị**:
  - 10–15/hr: an toàn, có thể chạy 24/7 lâu dài
  - 20–25/hr: aggressive, nên có account đã warm
  - >30/hr: rủi ro cao, không khuyến khích

---

## 5. Logging chi tiết

Mọi sự kiện được ghi vào `data/run.log`:

- **Khởi động**: config đã load, AI provider, rate limit
- **Fetch tweet**: số tweet mới từ mỗi list, dedup
- **Filter tweet** (nếu bật): bao nhiêu tweet pass, bao nhiêu skip
- **Generate comment**: status, AI provider response time
- **Post tweet**: success, error code, tweet ID replied
- **Error detail**: exception stack trace, giúp debug nhanh

Xem live: `Get-Content data/run.log -Wait` (PowerShell) hoặc `tail -f data/run.log` (Linux/macOS).

---

## 6. Auto-start khi máy boot (Windows)

`npm run install-service` tạo 2 Scheduled Task:
- `TwitterCommentPack` — chạy khi đăng nhập user
- `TwitterCommentPack_Startup` — chạy khi boot máy (ngay cả trước khi login)

→ Server reboot, bot tự dậy, không cần đăng nhập tay. Idempotent — chạy lại lệnh không tạo task trùng.

Gỡ cài đặt:
```cmd
schtasks /Delete /TN TwitterCommentPack /F
schtasks /Delete /TN TwitterCommentPack_Startup /F
```

---

## 7. Anti-repetition trong reply

Bot lưu 10 comment gần nhất vào `data/comment-history.json`. Khi generate comment mới:

- Tránh dùng slang giống 3 comment gần nhất
- Tránh mở đầu bằng cùng từ như recent replies
- Vary sentence structure giữa replies
- Áp dụng "relevance > variety" — reply phù hợp tweet hơn là kỳ lạ

---

## 8. Database SQLite persistent

`data/store.db` lưu:

- **Tweet đã comment**: `tweetId, author, timestamp`
- **Tweet đã filter**: `tweetId, passed (true/false), timestamp`
- **Session info**: cookies timestamp, quote status

→ Restart bot lúc nào cũng safe. Không bao giờ double-comment.

---

## Troubleshooting

| Problem | Giải pháp |
|---|---|
| `ct0 cookie not found` | Re-export cookies từ browser (Cookie-Editor), chạy `npm run setup` lại Q1 |
| Bot không comment | Check `data/run.log` cho lỗi. Có thể tweets bị filter hoặc list IDs sai |
| `429 / 403 RATE_LIMITED` | Giảm `commentsPerHour` hoặc đợi 30 phút. Bot tự resume |
| `401 Unauthorized AI` | Kiểm tra API key, chạy lại `npm run setup` |
| Comment chất lượng thấp | Prompt đã hardcoded tối ưu. Vấn đề có thể là list content chất lượng thấp hoặc AI model yếu → đổi sang model tốt hơn |

Gỡ bằng:
```cmd
schtasks /Delete /TN TwitterCommentPack /F
schtasks /Delete /TN TwitterCommentPack_Startup /F
```

(Linux/macOS: hiện chưa có installer, dùng systemd/launchd thủ công hoặc PM2.)

---

## 7. HTTP client tự xây — không phụ thuộc rettiwt-api

Bot dùng client HTTP thuần được port từ các bot production đã chạy:

- **Tự generate `x-client-transaction-id`**: header bắt buộc của Twitter cho mọi request graphql, dùng package `x-client-transaction-id@0.2.0` đã được patch sẵn (`patches/` auto-apply qua `patch-package` postinstall).
- **POST SearchTimeline đúng cách**: Twitter chuyển SearchTimeline từ GET sang POST, bot xử lý đúng (nhiều lib third-party còn sai).
- **Parse cả `core` lẫn `legacy` field**: Twitter rolling-update response shape, bot đọc cả 2 đường để không break khi API thay đổi.
- **Override queryId qua env**: Twitter rotate queryId mỗi vài tuần, bạn chỉ cần set `TWITTER_SEARCH_QUERY_ID=<new_id>` mà không cần rebuild.

---

## 8. Storage & dedup

- **SQLite local** (`data/state.db`) qua `better-sqlite3`:
  - `commented(tweet_id, ts)` — không bao giờ comment trùng tweet
  - `errors(ts, code, msg)` — log lỗi để debug
  - `meta(key, value)` — campaign state, last-seen-tweet
- **Atomic write**: config được ghi qua temp file + rename → không corrupt nếu crash giữa chừng.
- **Backup-friendly**: copy nguyên thư mục `data/` là đủ để khôi phục state.

---

## 9. Logs

- `data/run.log` — main activity log, JSON line per event
- `data/error.log` — chỉ lỗi
- Watch real-time:
  - Windows: `Get-Content data/run.log -Wait`
  - Linux/macOS: `tail -f data/run.log`
- **Không log secrets**: cookies, API key bị mask `***` trước khi ghi log.

---

## 10. Bảo mật

- `data/config.json`, `data/cookies.json`, `*.log`, `node_modules/` đều gitignored — không bao giờ commit lên git.
- Cookies lưu ở local file, không gửi đi đâu ngoài Twitter.
- API key chỉ gửi đến đúng provider bạn chọn.
- Không có telemetry, không phone-home, không update server.
- Toàn bộ source ESM JavaScript trong `src/` — đọc được hết, audit được hết.

---

## 11. Hỗ trợ AI Coding Assistant

Repo có sẵn `CLAUDE.md` và `SETUP.md` viết theo format chuẩn cho:
- **Claude Code** (Anthropic)
- **Google Antigravity / Gemini Code Assist**
- **Cursor** (đọc được CLAUDE.md)

→ User chỉ cần clone repo và bảo AI: *"setup giúp tao theo CLAUDE.md"*. Agent sẽ đọc instruction, hỏi đúng 5 câu, ghi config thay user, chạy bot. Không cần biết Node.js cũng setup được.

---

## 12. Update & maintenance

- **Update code**: `git pull && npm install` (postinstall tự re-apply patch).
- **Cookies hết hạn** (~2–4 tuần): re-export bằng Cookie-Editor → `npm run setup` → chỉ làm Q1.
- **Twitter break HTTP client** (rare, ~1 lần / 2-3 tháng): kiểm tra logs, update queryId hoặc re-patch theo hướng dẫn ở GitHub issues.
- **Đổi style/persona/list/rate**: chạy lại `npm run setup`, bot tự reload lúc cycle tiếp theo.

---

## Tóm tắt quick-reference

| Câu hỏi | Lệnh / file |
|---|---|
| Bắt đầu? | `npm run setup` |
| Chạy ngay? | `npm start` |
| Auto-start boot? | `npm run install-service` |
| Xem log live? | `Get-Content data/run.log -Wait` |
| Đổi config? | `npm run setup` (giữ default cũ) |
| Cookies hết hạn? | Re-export → `npm run setup` Q1 |
| Bot không comment? | Check `data/run.log` for errors |
| Đổi AI provider? | `npm run setup` Q5 |
| Gỡ autostart? | `schtasks /Delete /TN TwitterCommentPack /F` |
| Uninstall hoàn toàn? | Xóa folder, xóa 2 scheduled task |

Chi tiết từng bước trong thư mục [`guides/`](guides/).
