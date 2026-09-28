# AI News Analyzor

خلاصه: یک پایپ‌لاین اخبار مبتنی بر Cloudflare Workers که فیدهای RSS را می‌خواند، موارد را آنالیز می‌کند، در صورت نیاز برای هر خبر prompt و تصویر تولید می‌کند و خروجی را از طریق بات به تلگرام ارسال می‌نماید.

هدف README جدید: تقسیم اطلاعات به بخش‌های عملی، مرور هر بخش از منظر توسعه/امنیت/دیپلوی و دستورالعمل‌های گام‌به‌گام برای راه‌اندازی و امن‌سازی.

--

**فهرست سریع**
- [معماری و اجزا](#معماری-و-اجزا)
- [راه‌اندازی محلی و دیپلوی](#راه‌اندازی-محلی-و-دیپلوی)
- [تنظیم سکرت‌ها و بررسی آن‌ها](#تنظیم-سکرت‌ها-و-بررسی-آن‌ها)
- [مرور بخش‌ها (به ترتیب اهمیت)](#مرور-بخش‌ها-به-ترتیب-اهمیت)
- [دیباگ و بررسی خطاهای رایج](#دیباگ-و-بررسی-خطاهای-رایج)
- [پاک‌سازی تاریخچه گیت در صورت لو رفتن سکرت](#پاک‌سازی-تاریچه-گیت-در-صورت-لو-رفتن-سکرت)
- [مشارکت و لایسنس](#مشارکت-و-لایسنس)

--

## معماری و اجزا

- `worker-bridge/` — Orchestrator و Durable Object: وظیفهٔ اجراهای زمانبندی‌شده (cron) و فراخوانی pipeline.
- `llm-chat-app-template/` — Analyzer: درخواست به مدل‌های LLM جهت تولید تحلیل متنی.
- `prompt-generator/` — تولید و مدیریت promptها و ذخیرهٔ آن‌ها در D1.
- `text-to-image-template/` — تولید تصویر با Workers AI (Flux/SDXL) و ارسال به بات.
- `telegrambot/` (نمونه‌ها در هر قالب) — ارسال نوتیفیکیشن/وبهوک تلگرام و تعامل با کاربر.
- `github-shareable/public-code/` — مثال‌های امن برای انتشار عمومی.

هر جزء در دایرکتوری مربوطه کد اجرا، `wrangler.jsonc` و فایل‌های نوع (`worker-configuration.d.ts`) دارد.

--

## راه‌اندازی محلی و دیپلوی

پیش‌نیازها:
- `node` (v18+)، `npm`، `npx`
- `wrangler` نصب و احراز هویت شده

نمونهٔ گام‌ها (محلی و Cloudflare):

```bash
# نصب وابستگی‌ها در هر پکیج (مثال root)
npm install

# تنظیم سکرت‌ها (مثال):
npx wrangler --config worker-bridge/wrangler.jsonc secret put RUN_SECRET
npx wrangler --config worker-bridge/wrangler.jsonc secret put NOTIFY_SHARED_TOKEN
npx wrangler --config llm-chat-app-template/wrangler.jsonc secret put ANALYZER_API_KEY
npx wrangler --config text-to-image-template/wrangler.json secret put TELEGRAM_BOT_TOKEN

# تولید/تطبيق دیتابیس D1 (در صورت نیاز):
npx wrangler d1 create prompt_generator_db
npx wrangler d1 execute prompt_generator_db --file=prompt-generator/schema.sql

# دیپلوی
npx wrangler publish --config worker-bridge/wrangler.jsonc
npx wrangler publish --config llm-chat-app-template/wrangler.jsonc
npx wrangler publish --config prompt-generator/wrangler.jsonc
npx wrangler publish --config text-to-image-template/wrangler.json
```

--

## تنظیم سکرت‌ها و بررسی آن‌ها

راهنمای ایمن اضافه کردن سکرت‌ها با `wrangler`: هر مقداری که محرمانه است باید با `wrangler secret put` اضافه شود؛ هرگز در `vars` با مقدار واقعی commit نشود.

نمونهٔ دستورها:

```bash
# برای bridge
npx wrangler --config worker-bridge/wrangler.jsonc secret put RUN_SECRET
npx wrangler --config worker-bridge/wrangler.jsonc secret put NOTIFY_SHARED_TOKEN

# برای analyzer
npx wrangler --config llm-chat-app-template/wrangler.jsonc secret put ANALYZER_API_KEY

# برای telegram bot
npx wrangler --config text-to-image-template/wrangler.json secret put TELEGRAM_BOT_TOKEN
npx wrangler --config text-to-image-template/wrangler.json secret put TELEGRAM_WEBHOOK_SECRET
```

بررسی سکرت‌ها (فقط برای نام‌ها):

```bash
npx wrangler --config worker-bridge/wrangler.jsonc secret list
npx wrangler --config text-to-image-template/wrangler.json secret list
```

نکته: `wrangler secret list` نام سکرت‌ها را نمایش می‌دهد اما مقادیر را نشان نمی‌دهد.

--

## مرور بخش‌ها (به ترتیب اهمیت)

هر بخش شامل مرور کوتاه (چه کار می‌کند، محل کد، سکرت‌های مورد نیاز، وضعیت فعلی و پیشنهادات) است.

- `worker-bridge/` (مسیر: `worker-bridge/`)
   - وظیفه: راه‌اندازی cron، ایجاد runها، هماهنگی با Analyzer و ارسال notify به بات.
   - کد کلیدی: `worker-bridge/src/index.ts`, `worker-bridge/src/bridge-do.ts`, `worker-bridge/wrangler.jsonc`.
   - سکرت‌ها/Vars: `RUN_SECRET` (secret)، `NOTIFY_SHARED_TOKEN` (باید secret شود)، `RSS_FEEDS` (غیرحساس).
   - وضعیت: قبلاً `NOTIFY_SHARED_TOKEN` در `vars` با مقدار `workerbridge-notify-v1` بود — اکنون تبدیل به placeholder شده است. پیشنهاد: اگر مقدار واقعی در تاریخچه گیت وجود دارد، پاک‌سازی تاریخچه.

- `llm-chat-app-template/` (مسیر: `llm-chat-app-template/`)
   - وظیفه: ارسال متن به مدل LLM و ذخیرهٔ نتایج در D1.
   - کد کلیدی: `llm-chat-app-template/src/index.ts` و `worker-configuration.d.ts`.
   - سکرت‌ها: `ANALYZER_API_KEY` یا هر binding مرتبط با Workers AI.
   - وضعیت: کارکرد اصلی آنالایزر قابل دسترسی است اما لاگ‌ها نشان‌دهنده 500 errors در برخی runs است — نیاز به بررسی لاگ‌های اجرای Worker و تنظیم bindingهای AI.

- `prompt-generator/` (مسیر: `prompt-generator/`)
   - وظیفه: ساخت promptها و ذخیره در D1.
   - سکرت‌ها: D1 binding (database id) و احتمالا دسترسی به APIهای خارجی در صورت نیاز.
   - وضعیت: آماده؛ بررسی migration/schema در `prompt-generator/schema.sql` را توصیه می‌کنم.

- `text-to-image-template/` (مسیر: `text-to-image-template/`)
   - وظیفه: تولید تصویر و ارسال به Telegram در صورت نیاز.
   - سکرت‌ها: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET` (اختیاری).
   - وضعیت: نمونه template؛ مطمئن شوید که مدل تصویر/Workers AI binding فعال است و محدودیت‌های هزینه را بررسی کنید.

- `telegrambot/` (مسیر: نمونه‌ها در `telegrambot/` و `github-shareable/public-code/telegrambot/`)
   - وظیفه: endpoint `/notify`, validation token، ارسال پیام.
   - سکرت‌ها: `TELEGRAM_BOT_TOKEN`, `ALLOWED_TELEGRAM_USER_ID`, `NOTIFY_SHARED_TOKEN`.
   - وضعیت: کد به صورت امن نوشته شده و placeholderها استفاده می‌شوند؛ فقط اطمینان از سکرتها و هماهنگی توکن لازم است.

--

## دیباگ و بررسی خطاهای رایج

- Analyzer 500: در `llm-chat-app-template` لاگ‌ها را در Cloudflare dashboard بررسی کنید؛ بررسی کنید bindingهای Workers AI و quota/limits مدل درست است.
- Timeout polling (bot منتظر تحلیل): باتها از polling استفاده می‌کنند؛ اگر Analyzer نتیجه را در DB ننویسد، بات timeout برمی‌گرداند — چک کنید که D1 write انجام شود.
- Telegram 401: بررسی `TELEGRAM_BOT_TOKEN` و مقدار `NOTIFY_SHARED_TOKEN` همگرا باشد بین bridge و bot.

دستورات مفید:

```bash
# نمایش logs
npx wrangler tail --env production --config worker-bridge/wrangler.jsonc

# بررسی secrets
npx wrangler --config worker-bridge/wrangler.jsonc secret list
```

--

## پاک‌سازی تاریخچه گیت در صورت لو رفتن سکرت

اگر مقدار سکرت واقعی در commit history وجود دارد، مراحل پیشنهادی (local):

1. نصب `git-filter-repo` یا BFG.

با `git-filter-repo`:

```bash
# مثال حذف یک سکرت واقعی
git clone --mirror <repo_url>
cd repo.git
git filter-repo --replace-text ../replacements.txt
# فایل replacements.txt شامل: 'old_secret==>REDACTED'
git push --force
```

با BFG (ساده‌تر برای حذف توکن‌ها):

```bash
java -jar bfg.jar --replace-text replacements.txt repo.git
cd repo.git
git reflog expire --expire=now --all && git gc --prune=now --aggressive
git push --force
```

نکتهٔ امنیتی: پس از بازنویسی تاریخچه، همه کلون‌های محلی باید reclone شوند.

--

## مشارکت و لایسنس

برای مشارکت، issue باز کنید یا PR ارسال نمایید. دستورالعمل کدنویسی و تست در هر زیرپروژه موجود است.

License: MIT

