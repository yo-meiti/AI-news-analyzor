import os
import re
import json
import requests
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from django.utils import timezone as django_timezone
from .models import ProcessedNews
from .utils import safe_text, make_external_id, score_candidate, canonical_url, published_timestamp

RSS_FEEDS = [
    os.environ.get('RSS_FEEDS') or 'https://news.google.com/rss/search?q=(OpenAI%20OR%20Anthropic%20OR%20Google%20DeepMind%20OR%20Meta%20AI%20OR%20NVIDIA%20OR%20Microsoft%20Copilot%20OR%20Claude%20OR%20GPT-5%20OR%20Llama%203%20OR%20Mistral)%20(enterprise%20OR%20infrastructure%20OR%20datacenter%20OR%20chip%20OR%20agentic%20OR%20API%20OR%20pricing%20OR%20funding%20OR%20regulation)&hl=en-US&gl=US&ceid=US:en'
]
ANALYZER_API_BASE = os.environ.get('ANALYZER_API_BASE')
PROMPT_API_BASE = os.environ.get('PROMPT_API_BASE')
IMAGE_API_BASE = os.environ.get('IMAGE_API_BASE')
TELEGRAM_NOTIFY_URL = os.environ.get('TELEGRAM_NOTIFY_URL')
TELEGRAM_NOTIFY_TOKEN = os.environ.get('TELEGRAM_NOTIFY_TOKEN')
TELEGRAM_DEFAULT_CHAT_ID = os.environ.get('TELEGRAM_DEFAULT_CHAT_ID')

TIME_WINDOW_HOURS = int(os.environ.get('NEWS_WINDOW_HOURS', '72'))
DUPLICATE_TTL_DAYS = int(os.environ.get('DUPLICATE_TTL_DAYS', '30'))


class BridgeError(Exception):
    pass


def fetch_rss(url):
    response = requests.get(url, timeout=20)
    response.raise_for_status()
    return response.text


def parse_rss(xml_text):
    items = []
    root = ET.fromstring(xml_text)
    for item in root.findall('.//item'):
        title = safe_text(item.findtext('title') or '')
        link = safe_text(item.findtext('link') or '')
        description = safe_text(item.findtext('description') or '')
        content = safe_text(item.findtext('{http://purl.org/rss/1.0/modules/content/}encoded') or '')
        pub_date = safe_text(item.findtext('pubDate') or '')
        items.append({
            'title': title,
            'link': link,
            'summary': description or content,
            'source_url': link,
            'published_at': pub_date,
        })
    return items


def canonical_published_at(item):
    ts = published_timestamp(item.get('published_at'))
    if ts is None:
        return None
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=timezone.utc)
    return ts.astimezone(timezone.utc)


def build_news_text(item):
    lines = [f"Title: {item['title']}"]
    if item.get('summary'):
        lines.append(f"Summary: {item['summary']}")
    if item.get('source_url'):
        lines.append(f"Source URL: {item['source_url']}")
    if item.get('published_at'):
        lines.append(f"Published: {item['published_at']}")
    return '\n'.join(lines)


def choose_best_candidate(items):
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(hours=TIME_WINDOW_HOURS)
    valid = []
    for item in items:
        item['published_at'] = item.get('published_at') or ''
        item['published_at_ts'] = canonical_published_at(item)
        if item['published_at_ts'] and item['published_at_ts'] < cutoff:
            continue
        if not item['title'] or not item['source_url']:
            continue
        item['score'] = score_candidate(item)
        valid.append(item)
    valid.sort(key=lambda x: (x['score'], x['published_at_ts'] or datetime.min), reverse=True)
    return valid[0] if valid else None


def already_processed(external_id, title, source_url):
    cutoff = django_timezone.now() - timedelta(days=DUPLICATE_TTL_DAYS)
    title_norm = make_external_id(source_url or '', title or '')
    return ProcessedNews.objects.filter(external_id=external_id).exists() or ProcessedNews.objects.filter(title__icontains=title[:50], source_url=canonical_url(source_url), sent_at__gte=cutoff).exists()


def post_json(url, data, headers=None):
    if headers is None:
        headers = {}
    response = requests.post(url, json=data, headers=headers, timeout=30)
    try:
        response.raise_for_status()
    except requests.HTTPError as exc:
        raise BridgeError(f'HTTP {response.status_code} at {url}: {response.text}') from exc
    try:
        return response.json()
    except ValueError:
        return {'raw': response.text}


def analyze_news(item):
    if not ANALYZER_API_BASE:
        raise BridgeError('ANALYZER_API_BASE is not configured')
    url = f"{ANALYZER_API_BASE.rstrip('/')}/api/chat"
    payload = {
        'external_id': item['external_id'],
        'news_title': item['title'],
        'messages': [{'role': 'user', 'content': build_news_text(item)}],
    }
    return post_json(url, payload)


def generate_prompt(item):
    if not PROMPT_API_BASE:
        raise BridgeError('PROMPT_API_BASE is not configured')
    url = f"{PROMPT_API_BASE.rstrip('/')}/api/prompts"
    payload = {'input': build_news_text(item)}
    return post_json(url, payload)


def send_image(prompt_text, caption=None):
    if not IMAGE_API_BASE:
        raise BridgeError('IMAGE_API_BASE is not configured')
    url = f"{IMAGE_API_BASE.rstrip('/')}/api/generate-to-telegram"
    payload = {'prompt': prompt_text}
    if TELEGRAM_DEFAULT_CHAT_ID:
        payload['chatId'] = TELEGRAM_DEFAULT_CHAT_ID
    if caption:
        payload['caption'] = caption
    return post_json(url, payload)


def notify_bot(item):
    if not TELEGRAM_NOTIFY_URL:
        raise BridgeError('TELEGRAM_NOTIFY_URL is not configured')
    if not TELEGRAM_NOTIFY_TOKEN:
        raise BridgeError('TELEGRAM_NOTIFY_TOKEN is not configured')
    payload = {'external_id': item['external_id'], 'title': item['title']}
    headers = {'x-notify-token': TELEGRAM_NOTIFY_TOKEN, 'content-type': 'application/json'}
    return post_json(TELEGRAM_NOTIFY_URL, payload, headers=headers)


def run_rss_job():
    if not ANALYZER_API_BASE or not PROMPT_API_BASE or not IMAGE_API_BASE or not TELEGRAM_NOTIFY_URL:
        raise BridgeError('Required service endpoints are not configured')

    all_items = []
    for feed in RSS_FEEDS:
        try:
            xml = fetch_rss(feed)
            all_items.extend(parse_rss(xml))
        except Exception as exc:
            continue

    candidate = choose_best_candidate(all_items)
    if not candidate:
        return {'status': 'no-candidate'}

    candidate['external_id'] = make_external_id(candidate['source_url'], candidate['title'])
    if already_processed(candidate['external_id'], candidate['title'], candidate['source_url']):
        return {'status': 'duplicate', 'external_id': candidate['external_id']}

    processed = ProcessedNews.objects.create(
        external_id=candidate['external_id'],
        title=candidate['title'],
        summary=candidate['summary'],
        source_url=canonical_url(candidate['source_url']),
        published_at=canonical_published_at(candidate),
        status='processing',
    )

    try:
        analyze_result = analyze_news(candidate)
        prompt_result = generate_prompt(candidate)
        prompt_text = prompt_result.get('prompt') or prompt_result.get('data', {}).get('prompt') or prompt_result.get('input')
        if not prompt_text:
            raise BridgeError('Prompt generation returned no prompt')
        send_result = send_image(prompt_text, caption=f'📰 {candidate["title"]}')
        notify_result = notify_bot(candidate)
        processed.status = 'sent'
        processed.sent_at = django_timezone.now()
        processed.last_error = json.dumps({'analyze': analyze_result, 'send': send_result, 'notify': notify_result})
        processed.save()
        return {'status': 'sent', 'external_id': candidate['external_id']}
    except Exception as exc:
        processed.status = 'error'
        processed.last_error = str(exc)
        processed.save()
        raise
