from django.core.management.base import BaseCommand
from bridge.tasks import run_rss_job


class Command(BaseCommand):
    help = 'Fetch RSS feeds and route a selected story through the Cloudflare worker pipeline.'

    def handle(self, *args, **options):
        result = run_rss_job()
        self.stdout.write(self.style.SUCCESS(str(result)))
