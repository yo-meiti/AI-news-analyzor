# فهرست مدل‌های Workers AI به‌همراه کاربرد و رتبه‌بندی

تاریخ به‌روزرسانی این فایل: `2026-02-20`

معیار رتبه‌بندی در هر دسته:
- اولویت با کیفیت خروجی و دقت عملی در کاربرد اصلی آن دسته
- سپس پایداری/بلوغ مدل
- هزینه و سرعت معیار اصلی این رتبه‌بندی نیست (ممکن است مدل پایین‌تر سریع‌تر یا ارزان‌تر باشد)

نکته:
- این ترتیب برای استفاده عمومی است. برای بعضی سناریوهای تخصصی (مثل فقط کدنویسی، فقط زبان آلمانی، یا فقط گاردریل) ممکن است مدل تخصصی بهتر از رتبه‌اش عمل کند.

## Text Generation (از قوی‌تر به ضعیف‌تر در استفاده عمومی)

| رتبه | مدل | کاربرد اصلی |
|---|---|---|
| 1 | `gpt-oss-120b` | بهترین گزینه عمومی برای استدلال سنگین، پاسخ دقیق و پروداکشن |
| 2 | `llama-4-scout-17b-16e-instruct` | LLM قوی با درک چندوجهی (متن/تصویر) و عملکرد بالا |
| 3 | `llama-3.3-70b-instruct-fp8-fast` | کیفیت نزدیک مدل‌های بزرگ با سرعت بهتر |
| 4 | `llama-3.1-70b-instruct` | پاسخ‌های عمیق و پایدار برای چت و تحلیل |
| 5 | `qwq-32b` | مدل استدلالی قوی برای مسائل چندمرحله‌ای |
| 6 | `qwen3-30b-a3b-fp8` | عملکرد عمومی قوی با تعادل کیفیت/سرعت |
| 7 | `deepseek-r1-distill-qwen-32b` | استدلال و حل مسئله، مخصوص کارهای منطقی |
| 8 | `mistral-small-3.1-24b-instruct` | مدل عمومی دقیق برای چت و کارهای سازمانی |
| 9 | `gemma-3-12b-it` | مدل جدید و قوی برای مکالمه و تولید محتوا |
| 10 | `gpt-oss-20b` | گزینه سبک‌تر GPT-OSS برای کاربرد عمومی |
| 11 | `glm-4.7-flash` | چت سریع، ابزارمحور، چندزبانه |
| 12 | `granite-4.0-h-micro` | مناسب agent/workflow با تمرکز بر دستورپذیری |
| 13 | `llama-3.2-11b-vision-instruct` | کارهای ترکیبی متن+تصویر با کیفیت خوب |
| 14 | `gemma-sea-lion-v4-27b-it` | قوی برای سناریوهای چندزبانه (به‌ویژه جنوب‌شرق آسیا) |
| 15 | `llama-3.1-8b-instruct` | گزینه متعادل برای چت عمومی |
| 16 | `llama-3.1-8b-instruct-fast` | نسخه سریع‌تر 8B برای latency پایین |
| 17 | `llama-3.1-8b-instruct-fp8` | نسخه بهینه‌شده سرعت/هزینه |
| 18 | `llama-3.1-8b-instruct-awq` | نسخه quantized برای مصرف کمتر |
| 19 | `llama-3-8b-instruct` | چت عمومی خوب |
| 20 | `meta-llama-3-8b-instruct` | همان خانواده Llama3 برای کاربرد عمومی |
| 21 | `llama-3-8b-instruct-awq` | نسخه AWQ برای اجرای سبک‌تر |
| 22 | `qwen2.5-coder-32b-instruct` | بهترین کاربرد در کدنویسی/دیباگ |
| 23 | `deepseek-coder-6.7b-instruct-awq` | تولید کد و توضیح کد با هزینه کمتر |
| 24 | `sqlcoder-7b-2` | تولید و اصلاح SQL |
| 25 | `deepseek-math-7b-instruct` | مسائل ریاضی و استدلال فرمولی |
| 26 | `qwen1.5-14b-chat-awq` | چت عمومی میان‌رده |
| 27 | `mistral-7b-instruct-v0.2` | مدل سبک و خوب برای چت روزمره |
| 28 | `mistral-7b-instruct-v0.2-lora` | نسخه سبک‌تر/تنظیم‌شده v0.2 |
| 29 | `hermes-2-pro-mistral-7b` | چت instruction-following |
| 30 | `mistral-7b-instruct-v0.1` | نسل قدیمی‌تر Mistral Instruct |
| 31 | `mistral-7b-instruct-v0.1-awq` | نسخه AWQ از v0.1 |
| 32 | `openhermes-2.5-mistral-7b-awq` | مدل چت سبک مبتنی بر Mistral |
| 33 | `openchat-3.5-0106` | مکالمه عمومی سبک |
| 34 | `zephyr-7b-beta-awq` | چت سبک و سریع |
| 35 | `starling-lm-7b-beta` | مکالمه عمومی در بار سبک |
| 36 | `neural-chat-7b-v3-1-awq` | چت سبک با latency پایین |
| 37 | `una-cybertron-7b-v2-bf16` | مدل چت عمومی BF16 |
| 38 | `llama-2-13b-chat-awq` | نسل قبل، هنوز قابل‌استفاده برای چت |
| 39 | `qwen1.5-7b-chat-awq` | چت عمومی سبک |
| 40 | `qwen1.5-1.8b-chat` | چت خیلی سبک و ارزان |
| 41 | `qwen1.5-0.5b-chat` | فوق‌سبک برای پاسخ سریع |
| 42 | `gemma-7b-it` | مدل instruction نسل قبل |
| 43 | `gemma-7b-it-lora` | نسخه LoRA برای مصرف پایین‌تر |
| 44 | `gemma-2b-it-lora` | مدل خیلی سبک instruction |
| 45 | `llama-3.2-3b-instruct` | مدل کوچک برای edge سبک |
| 46 | `llama-3.2-1b-instruct` | مدل بسیار کوچک برای سناریوهای کم‌هزینه |
| 47 | `llama-2-7b-chat-fp16` | مدل قدیمی‌تر، کیفیت متوسط |
| 48 | `llama-2-7b-chat-int8` | نسخه int8 از Llama2 7B |
| 49 | `llama-2-7b-chat-hf-lora` | نسخه LoRA قدیمی |
| 50 | `falcon-7b-instruct` | مدل قدیمی instruction |
| 51 | `phi-2` | مدل کوچک برای کارهای ساده‌تر |
| 52 | `tinyllama-1.1b-chat-v1.0` | خیلی سبک برای تست/edge |
| 53 | `discolm-german-7b-v1-awq` | تخصصی زبان آلمانی |
| 54 | `deepseek-coder-6.7b-base-awq` | نسخه base (کمتر محاوره‌ای) برای کد |
| 55 | `llama-guard-3-8b` | تخصصی ایمنی محتوا (Guardrail) |
| 56 | `llamaguard-7b-awq` | Guardrail سبک‌تر برای فیلتر محتوا |

## Text-to-Image

| رتبه | مدل | کاربرد اصلی |
|---|---|---|
| 1 | `flux-2-dev` | کیفیت تصویر بالاتر و جزئیات بهتر برای خروجی حرفه‌ای |
| 2 | `flux-2-klein-9b` | کیفیت بالا با سرعت مناسب‌تر |
| 3 | `flux-2-klein-4b` | سریع‌تر با کیفیت خوب برای تولید انبوه |
| 4 | `flux-1-schnell` | سرعت بالا برای preview/real-time |
| 5 | `stable-diffusion-xl-base-1.0` | مدل پایدار و عمومی برای تولید تصویر |
| 6 | `stable-diffusion-xl-lightning` | نسخه سریع SDXL |
| 7 | `phoenix-1.0` | تولید تصویر خلاقانه عمومی |
| 8 | `lucid-origin` | تولید هنری/استایلیزه |
| 9 | `dreamshaper-8-lcm` | خروجی هنری سریع |
| 10 | `stable-diffusion-v1-5-img2img` | تبدیل تصویر به تصویر |
| 11 | `stable-diffusion-v1-5-inpainting` | inpainting و اصلاح بخشی تصویر |

## Text-to-Speech

| رتبه | مدل | کاربرد اصلی |
|---|---|---|
| 1 | `aura-2-en` | TTS طبیعی انگلیسی با کیفیت بالا |
| 2 | `aura-2-es` | TTS طبیعی اسپانیایی با کیفیت بالا |
| 3 | `aura-1` | نسل قبل Aura، هنوز مناسب تولید گفتار |
| 4 | `melotts` | گزینه سبک‌تر برای TTS |

## Automatic Speech Recognition

| رتبه | مدل | کاربرد اصلی |
|---|---|---|
| 1 | `nova-3` | تشخیص گفتار قوی و مناسب پروداکشن |
| 2 | `whisper-large-v3-turbo` | دقت بالا با سرعت خوب |
| 3 | `flux` | ASR مکالمه‌ای real-time |
| 4 | `whisper` | مدل مرجع پایدار برای تبدیل گفتار به متن |
| 5 | `whisper-tiny-en` | بسیار سبک و سریع برای انگلیسی |

## Text Embeddings

| رتبه | مدل | کاربرد اصلی |
|---|---|---|
| 1 | `bge-m3` | embedding چندزبانه قوی برای جستجو/RAG |
| 2 | `bge-large-en-v1.5` | کیفیت بالا برای انگلیسی |
| 3 | `qwen3-embedding-0.6b` | embedding جدید با کیفیت خوب |
| 4 | `bge-base-en-v1.5` | تعادل خوب کیفیت/هزینه |
| 5 | `plamo-embedding-1b` | مناسب سناریوهای ژاپنی/چندزبانه خاص |
| 6 | `embeddinggemma-300m` | سبک و سریع |
| 7 | `bge-small-en-v1.5` | اقتصادی‌ترین گزینه embedding انگلیسی |

## Text Classification

| رتبه | مدل | کاربرد اصلی |
|---|---|---|
| 1 | `bge-reranker-base` | رتبه‌بندی relevance برای search/RAG |
| 2 | `distilbert-sst-2-int8` | sentiment analysis (مثبت/منفی) |

## Translation

| رتبه | مدل | کاربرد اصلی |
|---|---|---|
| 1 | `m2m100-1.2b` | ترجمه چندزبانه عمومی |
| 2 | `indictrans2-en-indic-1B` | تخصصی ترجمه EN↔Indic |

## Image-to-Text

| رتبه | مدل | کاربرد اصلی |
|---|---|---|
| 1 | `llava-1.5-7b-hf` | توصیف و درک تصویر با کیفیت بهتر |
| 2 | `uform-gen2-qwen-500m` | گزینه سبک و سریع برای caption ساده |

## Summarization

| رتبه | مدل | کاربرد اصلی |
|---|---|---|
| 1 | `bart-large-cnn` | خلاصه‌سازی متون خبری/عمومی |

## Object Detection

| رتبه | مدل | کاربرد اصلی |
|---|---|---|
| 1 | `detr-resnet-50` | تشخیص آبجکت در تصویر |

## Image Classification

| رتبه | مدل | کاربرد اصلی |
|---|---|---|
| 1 | `resnet-50` | دسته‌بندی تصویر |

## Voice Activity Detection

| رتبه | مدل | کاربرد اصلی |
|---|---|---|
| 1 | `smart-turn-v2` | تشخیص شروع/پایان صحبت در مکالمه صوتی |

## منابع

- `https://developers.cloudflare.com/workers-ai/models/`
- `https://developers.cloudflare.com/workers-ai/models/index.md`
