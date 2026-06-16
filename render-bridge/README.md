# Render RSS Bridge

این سرویس یک جایگزین ساده برای n8n است که خبرها را از RSS می‌خواند، یک خبر برجسته انتخاب می‌کند، آن را به سرویس‌های Cloudflare Workers می‌فرستد و سپس تلگرام را از طریق بات اطلاع می‌دهد.

## چه کاری انجام می‌دهد

- می‌خواند RSS feedها
- فیلتر و رتبه‌بندی خبرهای تازه
- ارسال خبر انتخاب شده به:
  - سرویس تحلیل `ANALYZER_API_BASE`
  - تولید پرامپت `PROMPT_API_BASE`
  - تولید تصویر و ارسال تلگرام `IMAGE_API_BASE`
  - اعلام به بات تلگرام `TELEGRAM_NOTIFY_URL`

## نصب

```bash
cd render-bridge
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## راه‌اندازی محلی

```bash
cd render-bridge
python manage.py migrate
python manage.py runserver
```

## متغیرهای محیطی

- `RUN_SECRET` (اختیاری): برای محافظت endpoint `/run-rss/`
- `ANALYZER_API_BASE`: آدرس سرویس تحلیل (مثال: https://llm-chat-app-template-v2.ysblasqsla.workers.dev)
- `PROMPT_API_BASE`: آدرس prompt-generator (مثال: https://llm-chat-app-template.ysblasqsla.workers.dev)
- `IMAGE_API_BASE`: آدرس سرویس تصویر (مثال: https://text-to-image-template.ysblasqsla.workers.dev)
- `TELEGRAM_NOTIFY_URL`: آدرس بات تلگرام برای `POST /notify`
- `TELEGRAM_NOTIFY_TOKEN`: توکن `x-notify-token`
- `TELEGRAM_DEFAULT_CHAT_ID`: آی‌دی پیش‌فرض چت برای ارسال تصویر
- `RSS_FEEDS`: فیدهای RSS جدا شده با کاما
- `DATABASE_URL`: (اختیاری) اگر می‌خواهید PostgreSQL یا دیتابیس دیگر استفاده کنید.

## اجرا روی Render

1. به حساب Render بروید و پروژه جدید بسازید.
2. `render.yaml` را به ریشه پروژه اضافه کنید.
3. متغیرهای محیطی را در Render تنظیم کنید.
4. Deploy را اجرا کنید.

### کرون

اگر از `render.yaml` استفاده می‌کنید، یک سرویس Cron ایجاد می‌شود که هر ۱۵ دقیقه درخواست می‌زند به `/run-rss/`.

## تست دستی

```bash
curl -X POST http://localhost:8000/run-rss/ -H "X-RUN-TOKEN: your-secret"
```

## نکته

این سرویس جایگزینی برای n8n است، نه یک کپی ۱۰۰٪ از تمام منطق آن. اگر لازم باشد، می‌توانم تبدیل دقیق‌تر رتبه‌بندی، فیلتر دوباره و فرمت notification را هم پیاده کنم.
