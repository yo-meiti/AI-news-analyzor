import hashlib
import re
from datetime import datetime
from urllib.parse import urlparse

TRUSTED_DOMAINS = {
    'reuters.com',
    'bloomberg.com',
    'ft.com',
    'wsj.com',
    'theinformation.com',
    'techcrunch.com',
    'theverge.com',
    'openai.com',
    'anthropic.com',
    'nvidia.com',
    'microsoft.com',
    'google.com',
}


def safe_text(value):
    if not value:
        return ''
    return re.sub(r'\s+', ' ', str(value)).strip()


def normalize_title(raw: str) -> str:
    value = safe_text(raw)
    value = value.replace('ك', 'ک').replace('ي', 'ی').lower()
    return re.sub(r'[^\w\s]', '', value, flags=re.UNICODE).strip()


def canonical_url(raw: str) -> str:
    if not raw:
        return ''
    try:
        parsed = urlparse(raw.strip())
        if not parsed.scheme:
            parsed = parsed._replace(scheme='https')
        netloc = parsed.netloc.lower().replace('www.', '')
        path = parsed.path.rstrip('/')
        query = parsed.query
        return f'{parsed.scheme}://{netloc}{path}{f"?{query}" if query else ""}'
    except Exception:
        return raw.strip()


def make_external_id(source_url: str, title: str) -> str:
    source = canonical_url(source_url)
    title_safe = normalize_title(title)
    digest = hashlib.sha256(f'{source}|{title_safe}'.encode('utf-8')).hexdigest()[:16]
    return f'news-{digest}'


def published_timestamp(value):
    if not value:
        return None
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        try:
            return datetime.strptime(value, '%a, %d %b %Y %H:%M:%S %z')
        except Exception:
            return None


def score_candidate(item):
    score = 0
    if item.get('published_at'):
        score += 10
    domain = urlparse(item.get('source_url', '') or '').hostname or ''
    domain = domain.replace('www.', '').lower()
    if domain in TRUSTED_DOMAINS:
        score += 10
    summary = safe_text(item.get('summary', ''))
    score += min(len(summary) / 50.0, 5)
    return score
