from django.db import migrations, models

class Migration(migrations.Migration):

    initial = True

    dependencies = []

    operations = [
        migrations.CreateModel(
            name='ProcessedNews',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('external_id', models.CharField(max_length=128, unique=True)),
                ('title', models.TextField()),
                ('summary', models.TextField(blank=True, null=True)),
                ('source_url', models.TextField(blank=True, null=True)),
                ('published_at', models.DateTimeField(blank=True, null=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('sent_at', models.DateTimeField(blank=True, null=True)),
                ('status', models.CharField(default='pending', max_length=32)),
                ('last_error', models.TextField(blank=True, null=True)),
            ],
            options={
                'ordering': ['-published_at'],
            },
        ),
    ]
