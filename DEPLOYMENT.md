DEPLOYMENT GUIDE: Complete Project Setup
========================================

نقشه کلی ترتیب دیپلوی
--------------------

1. صفحات Cloudflare D1 (دیتابیس)
2. سه Cloudflare Worker (تحلیل، پرامپت، تصویر)
3. بات تلگرام Cloudflare Worker
4. Django Render Bridge
5. تنظیم webhook‌ها و متغیرهای محیطی


مرحله ۰: شناسایی مقادیر حالی
----------------------------

Worker Names:
  - llm-chat-app-template-v2 (تحلیل خبر)
  - llm-chat-app-template (پرامپت - نام تعارض‌داری دارد!)
  - text-to-image-template (تولید تصویر)
  - telegram-news-bot (بات تلگرام)

D1 Databases:
  - llm_persona_memory_v2 (برای تحلیل)
  - prompt_generator_db (برای پرامپت)

⚠️ مشکل: prompt-generator worker نام "llm-chat-app-template" دارد که می‌تواند آشفته‌کننده باشد.
   در n8n workflow تغییر شده و بات در جای‌های متفاوت به آن اشاره می‌کند.


مرحله ۱: D1 Databases ایجاد/تأیید کنید
---------------------------------------

```bash
# تحلیلگر خبر
cd llm-chat-app-template
npx wrangler d1 create llm_persona_memory_v2

# پرامپت تولید کننده
cd ../prompt-generator
npx wrangler d1 create prompt_generator_db
```

اگر از قبل موجود است، تنها ID آن‌ها را به وانفیگ‌های مربوطه اضافه کنید.

⚠️ بعد از ایجاد، ID دیتابیس را در فایل‌های زیر به‌روز کنید:
  - llm-chat-app-template/wrangler.jsonc (database_id)
  - prompt-generator/wrangler.jsonc (database_id)


مرحله ۲: اسکیمای D1 را اعمال کنید
----------------------------------

```bash
# برای تحلیل خبر
cd llm-chat-app-template
npx wrangler d1 execute llm_persona_memory_v2 --file=./migrations/001_persona_memory.sql
npx wrangler d1 execute llm_persona_memory_v2 --file=./migrations/002_analysis_reference_samples.sql

# برای پرامپت
cd ../prompt-generator
npx wrangler d1 execute prompt_generator_db --file=./schema.sql
```


مرحله ۳: نصب وابستگی‌ها
------------------------

```bash
# تحلیل
cd llm-chat-app-template
npm install

# پرامپت
cd ../prompt-generator
npm install

# تصویر
cd ../text-to-image-template
npm install
```


مرحله ۴: تنظیم سرت‌های سرویس
----------------------------

#### llm-chat-app-template (تحلیلگر)
```bash
cd llm-chat-app-template
npx wrangler secret put TAVILY_API_KEY
# داخل پرامپت: tvly-dev-... (اگر استفاده شود)
```

#### prompt-generator (بدون سرت اضافی)
```bash
# این سرویس سرت اضافی نیاز ندارد
# اما اگر صفحه اینترنتی خواستید:
cd prompt-generator
# فقط اگر بخواهید کنترل CORS یا محدود کنید
```

#### text-to-image-template
```bash
cd text-to-image-template
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET  # اختیاری
```

#### telegram-news-bot
```bash
cd llm-chat-app-template/telegrambot
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put ANALYZER_API_BASE
# اگر بخواهید توکن‌های دیگر:
npx wrangler secret put ALLOWED_TELEGRAM_USER_ID
npx wrangler secret put BOT_NOTIFY_TOKEN
npx wrangler secret put PUBLIC_WEBHOOK_URL
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
npx wrangler secret put TELEGRAM_CHANNEL_ID
```


مرحله ۵: Deploy Workers
-----------------------

```bash
# تحلیل
cd llm-chat-app-template
npx wrangler deploy -c wrangler.jsonc
# یادداشت: This deploys as "llm-chat-app-template-v2"

# پرامپت
cd ../prompt-generator
npx wrangler deploy -c wrangler.jsonc
# یادداشت: This deploys as "prompt-generator-cf" (نام تصحیح‌شده)

# تصویر
cd ../text-to-image-template
npx wrangler deploy -c wrangler.json
# This deploys as "text-to-image-template"

# بات تلگرام
cd ../llm-chat-app-template/telegrambot
npx wrangler deploy -c wrangler.jsonc
# This deploys as "telegram-news-bot"
```

⚠️ بعد از deploy، دومین URL worker‌ها را بنویسید:
  - llm-chat-app-template-v2: https://llm-chat-app-template-v2.YOUR_DOMAIN.workers.dev
  - llm-chat-app-template (prompt): https://llm-chat-app-template.YOUR_DOMAIN.workers.dev
  - text-to-image-template: https://text-to-image-template.YOUR_DOMAIN.workers.dev
  - telegram-news-bot: https://telegram-news-bot.YOUR_DOMAIN.workers.dev


مرحله ۶: تنظیم متغیرهای محیطی بات تلگرام
--------------------------------------

```bash
cd llm-chat-app-template/telegrambot

# سرت‌های اصلی
npx wrangler secret put TELEGRAM_BOT_TOKEN -c wrangler.jsonc
# مقدار: توکن بات تلگرام (از @BotFather)

npx wrangler secret put ALLOWED_TELEGRAM_USER_ID -c wrangler.jsonc
# مقدار: آی‌دی عددی کاربر تلگرام (فقط این کاربر می‌تواند استفاده کند)

npx wrangler secret put ANALYZER_API_BASE -c wrangler.jsonc
# مقدار: https://llm-chat-app-template-v2.YOUR_DOMAIN.workers.dev

# سرت‌های امنیتی
npx wrangler secret put BOT_NOTIFY_TOKEN -c wrangler.jsonc
# مقدار: یک رشته تصادفی برای امن‌سازی POST /notify
# مثال: $(openssl rand -hex 32)

# تنظیمات webhook
npx wrangler secret put PUBLIC_WEBHOOK_URL -c wrangler.jsonc
# مقدار: https://telegram-news-bot.YOUR_DOMAIN.workers.dev

npx wrangler secret put TELEGRAM_WEBHOOK_SECRET -c wrangler.jsonc
# مقدار: یک رشته برای امن‌سازی وبهوک تلگرام

# انتشار کانال (اختیاری)
npx wrangler secret put TELEGRAM_CHANNEL_ID -c wrangler.jsonc
# مقدار: آی‌دی کانال (برای انتشار نهایی)
```


مرحله ۷: راه‌اندازی webhook بات تلگرام
--------------------------------

اگر بخواهید بات تلگرام از webhook استفاده کند:

```bash
curl "https://telegram-news-bot.YOUR_DOMAIN.workers.dev/set-webhook"
```

بات خودکار وبهوک را با Telegram API ثبت می‌کند.


مرحله ۸: Deploy Render Bridge (جایگزین n8n)
-------------------------------------------

```bash
cd render-bridge

# تنظیم متغیرهای محیطی در Render
# اینها را در dashboard Render تنظیم کن:

ANALYZER_API_BASE=https://llm-chat-app-template-v2.YOUR_DOMAIN.workers.dev
PROMPT_API_BASE=https://llm-chat-app-template.YOUR_DOMAIN.workers.dev
IMAGE_API_BASE=https://text-to-image-template.YOUR_DOMAIN.workers.dev
TELEGRAM_NOTIFY_URL=https://telegram-news-bot.YOUR_DOMAIN.workers.dev/notify
TELEGRAM_NOTIFY_TOKEN=<همان BOT_NOTIFY_TOKEN>
TELEGRAM_DEFAULT_CHAT_ID=<آی‌دی چت پیش‌فرض>
RUN_SECRET=<رشته امنیتی برای POST /run-rss/>
RSS_FEEDS=<آدرس فیدهای RSS یا پیش‌فرض>
```

�گر render-bridge را روی Render deploy کنی:

1. ریپو را push کن
2. Render dashboard به `render-bridge` بروید
3. `render.yaml` را انتخاب کن
4. متغیرهای محیطی را تنظیم کن
5. Deploy را اجرا کن


مرحله ۹: تست ساده
-----------------

```bash
# تست بات تلگرام
curl https://telegram-news-bot.YOUR_DOMAIN.workers.dev/health

# تست سرویس تحلیل
curl https://llm-chat-app-template-v2.YOUR_DOMAIN.workers.dev/

# تست render-bridge
curl https://render-bridge.onrender.com/health/
```


مرحله ۱۰: Cron RSS
-----------------

اگر از render-bridge استفاده می‌کنی:
- Render cron خودکار هر ۱۵ دقیقه درخواست POST به `/run-rss/` می‌زند.

اگر می‌خواهی دستی تست کنی:
```bash
curl -X POST https://render-bridge.onrender.com/run-rss/ \
  -H "X-RUN-TOKEN: <RUN_SECRET>" \
  -H "Content-Type: application/json"
```


جدول اتصال‌ها
--------------

Service             | Worker Name               | URL
---------------------|---------------------------|----------
تحلیل خبر           | llm-chat-app-template-v2  | https://...workers.dev
پرامپت تولیدی       | llm-chat-app-template     | https://...workers.dev
تصویر + تلگرام      | text-to-image-template    | https://...workers.dev
بات تلگرام          | telegram-news-bot         | https://...workers.dev
Render Bridge (RSS) | render-bridge             | https://...onrender.com


متغیرهای کلیدی
--------------

بات تلگرام باید بداند:
- ANALYZER_API_BASE (به سرویس تحلیل)
- ALLOWED_TELEGRAM_USER_ID (کاربر مجاز)
- BOT_NOTIFY_TOKEN (توکن امنیتی)
- TELEGRAM_BOT_TOKEN (توکن Telegram)

Render Bridge باید بداند:
- ANALYZER_API_BASE
- PROMPT_API_BASE
- IMAGE_API_BASE
- TELEGRAM_NOTIFY_URL (به بات تلگرام)
- TELEGRAM_NOTIFY_TOKEN (همان BOT_NOTIFY_TOKEN)
- TELEGRAM_DEFAULT_CHAT_ID


نکات ضروری
---------

1. ⚠️ نام worker prompt-generator با نام تحلیل‌گر تعارض دارد.
   اگر می‌خواهی واضح‌تر باشد، می‌توانی آن را "prompt-generator-cf" تغییر دهی.

2. 🔐 تمام سرت‌ها (توکن‌ها) را محفوظ نگاه دار.

3. 🌐 URL worker‌ها پس از deploy فوری دستیاب نیستند؛ ۲-۵ دقیقه منتظر بمان.

4. 📝 مطمئن شو که همه worker‌ها هم‌زمان deploy شده‌اند.

5. 🔗 Render Bridge باید تمام URL worker‌ها را داشته باشد.


troubleshooting
---------------

اگر render-bridge درخواست‌ها را دریافت نمی‌کند:
- بررسی کن ANALYZER_API_BASE، PROMPT_API_BASE و غیره صحیح هستند
- log‌های Render را بررسی کن

اگر بات تلگرام پاسخ نمی‌دهد:
- بررسی کن TELEGRAM_BOT_TOKEN صحیح است
- بررسی کن webhook تنظیم شده (GET /set-webhook)
- log‌های worker را بررسی کن

اگر تصویر تولید نشود:
- بررسی کن TELEGRAM_BOT_TOKEN در text-to-image-template درست است
- بررسی کن chatId یا TELEGRAM_DEFAULT_CHAT_ID موجود است
