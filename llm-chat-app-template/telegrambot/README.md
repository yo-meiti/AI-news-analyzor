# Telegram Bot Worker (n8n Bridge)

این Worker دیگر تحلیل را مستقیم از متن کاربر شروع نمی‌کند.  
نقش آن: رابط بین `n8n` و سرویس تحلیل (`/api/chat` + `analysis_jobs`) است.

## کارکرد

1. `n8n` خبر را تحلیل می‌کند.
2. `n8n` با `POST /notify` به بات، `external_id` و `title` می‌فرستد.
3. بات به اکانت مجاز اعلان می‌دهد:
   - مشاهده خبر
   - ویرایش خبر
   - تایید خبر برای ارسال
4. ویرایش، در دیتابیس همان job ذخیره می‌شود.
5. تایید، آخرین نسخه تحلیل را از دیتابیس می‌گیرد و در کانال منتشر می‌کند.

## Required Secrets

- `TELEGRAM_BOT_TOKEN`
- `ANALYZER_API_BASE`  
  مثال: `https://llm-chat-app-template-v2.ysblasqsla.workers.dev`
- `ALLOWED_TELEGRAM_USER_ID`

## Optional Secrets

- `TELEGRAM_WEBHOOK_SECRET`
- `PUBLIC_WEBHOOK_URL` (برای `/set-webhook`)
- `BOT_NOTIFY_TOKEN` (برای امن‌سازی `POST /notify`)
- `TELEGRAM_CHANNEL_ID` (برای تایید و ارسال خبر به کانال)

## Deploy

از ریشه پروژه:

```bash
npx wrangler deploy -c telegrambot/wrangler.jsonc
```

تنظیم سکرت‌ها:

```bash
npx wrangler secret put TELEGRAM_BOT_TOKEN -c telegrambot/wrangler.jsonc
npx wrangler secret put ANALYZER_API_BASE -c telegrambot/wrangler.jsonc
npx wrangler secret put ALLOWED_TELEGRAM_USER_ID -c telegrambot/wrangler.jsonc
npx wrangler secret put PUBLIC_WEBHOOK_URL -c telegrambot/wrangler.jsonc
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET -c telegrambot/wrangler.jsonc
npx wrangler secret put BOT_NOTIFY_TOKEN -c telegrambot/wrangler.jsonc
npx wrangler secret put TELEGRAM_CHANNEL_ID -c telegrambot/wrangler.jsonc
```

## Webhook

Helper route:

```bash
curl "https://<worker-domain>/set-webhook"
```

## Bot Routes

- `GET /health`
- `GET /set-webhook`
- `GET /delete-webhook`
- `POST /notify`  (ورودی n8n)
- `POST /webhook` (ورودی Telegram)

## n8n -> Bot Notify

نمونه درخواست:

```bash
curl -X POST "https://<bot-worker>/notify" \
  -H "content-type: application/json" \
  -H "x-notify-token: <BOT_NOTIFY_TOKEN>" \
  -d '{
    "external_id": "news-4512",
    "title": "Anthropic و Infosys همکاری agentic اعلام کردند"
  }'
```

## دستورات در تلگرام

- `/latest`
- `/news <external_id>`
- `/save <external_id> متن_ویرایش_شده`

یادداشت:
- فقط `ALLOWED_TELEGRAM_USER_ID` پاسخ می‌گیرد.
- برای انتشار در کانال، بات باید ادمین کانال باشد.
