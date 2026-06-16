from django.db import models

class ProcessedNews(models.Model):
    external_id = models.CharField(max_length=128, unique=True)
    title = models.TextField()
    summary = models.TextField(blank=True, null=True)
    source_url = models.TextField(blank=True, null=True)
    published_at = models.DateTimeField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    sent_at = models.DateTimeField(blank=True, null=True)
    status = models.CharField(max_length=32, default='pending')
    last_error = models.TextField(blank=True, null=True)

    class Meta:
        ordering = ['-published_at']

    def __str__(self):
        return f'{self.external_id} {self.title[:60]}'
