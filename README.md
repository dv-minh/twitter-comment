# Twitter Comment Pack

Bộ công cụ tự động bình luận Twitter/X — gói gọn, chạy 5 phút là xong.
(Self-contained Twitter/X auto-comment toolkit — clone, run wizard, done in 5 min.)

---

## Tiếng Việt — Quick Start

### Yêu cầu
- Node.js 20 trở lên
- Một tài khoản Twitter/X có cookies hợp lệ
- API key của một trong 4 nhà cung cấp AI: DeepSeek (rẻ), OpenAI, OpenRouter, hoặc Anthropic

### 3 bước cài đặt

```bash
git clone <repo-url> twitter-comment-pack
cd twitter-comment-pack
npm install
npm run setup
```

Wizard sẽ hỏi 3 câu hỏi chính:
1. **Cookies Twitter** — paste JSON từ extension Cookie-Editor (xem `guides/01-get-cookies.md`)
2. **Twitter list IDs** — danh sách các list để bot crawl comment (xem `guides/03-modes-explained.md`)
3. **Số comment mỗi giờ** — mặc định 15. Xem `guides/04-rate-limits.md`

Sau đó chọn AI provider (DeepSeek/OpenAI/OpenRouter/Anthropic) + API key.

Sau khi setup xong:
```bash
npm start              # chạy ngay
# hoặc bot đã được cài auto-start lúc boot Windows nếu bạn chọn Y ở wizard
```

Logs: `data/run.log`. Xem real-time: `Get-Content data/run.log -Wait` (PowerShell)

### Chế độ
- **List Comment**: bot crawl các list bạn cấu hình, AI tự động comment vào từng tweet

### Quan trọng
- KHÔNG commit `data/config.json` lên git — đã được gitignore sẵn.
- Cookies hết hạn (~2-4 tuần) → re-export và `npm run setup` lại (chỉ cần làm lại Q1).
- **Ngôn ngữ tự động**: bot tự detect ngôn ngữ của tweet và reply bằng ngôn ngữ đó
- **Prompt Markdown tách lớp**: prompt nằm trong `prompts/base.md`, `prompts/router.md`, `prompts/skills/*.md`
- **Router output chuẩn**: `should_comment + skill` (xem `guides/07-router-output-schema.md`)
- Chi tiết kiến trúc prompt: `guides/06-prompt-architecture.md`

### Gỡ auto-start
```cmd
schtasks /Delete /TN TwitterCommentPack /F
schtasks /Delete /TN TwitterCommentPack_Startup /F
```

---

## English — Quick Start

### Requirements
- Node.js 20+
- Valid Twitter/X account cookies
- API key for one of: DeepSeek (cheap), OpenAI, OpenRouter, or Anthropic

### 3 steps

```bash
git clone <repo-url> twitter-comment-pack
cd twitter-comment-pack
npm install
npm run setup
```

The wizard asks 3 main questions:
1. **Twitter cookies** — paste JSON from Cookie-Editor extension (see `guides/01-get-cookies.md`)
2. **List IDs** — which lists to crawl for comments (see `guides/03-modes-explained.md`)
3. **Comments per hour** — default 15, see `guides/04-rate-limits.md`

Then choose AI provider (DeepSeek/OpenAI/OpenRouter/Anthropic) + API key.

Start: `npm start`. Logs: `data/run.log`.

### Mode
- **List Comment**: crawl chosen lists, AI auto-comment on each tweet in detected language

### Notes
- `data/config.json` is gitignored — never commit secrets.
- Cookies expire (~2-4 weeks) → re-export and re-run wizard (Q1 only).
- **Auto language detection**: bot detects tweet language and replies in the same language
- **Layered Markdown prompts**: prompt source files are in `prompts/base.md`, `prompts/router.md`, and `prompts/skills/*.md`
- **Router schema**: `should_comment + skill` (see `guides/07-router-output-schema.md`)
- Prompt architecture details: `guides/06-prompt-architecture.md`
