from django.urls import path
from bridge.views import health, run_rss_view

urlpatterns = [
    path('health/', health, name='health'),
    path('run-rss/', run_rss_view, name='run_rss'),
]
