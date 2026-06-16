import os
import json
from django.views.decorators.csrf import csrf_exempt
from django.http import JsonResponse, HttpResponseNotAllowed
from .tasks import run_rss_job

RUN_SECRET = os.environ.get('RUN_SECRET', '')


def health(request):
    return JsonResponse({'ok': True, 'service': 'render-bridge'})


@csrf_exempt
def run_rss_view(request):
    if request.method != 'POST':
        return HttpResponseNotAllowed(['POST'])

    if RUN_SECRET:
        header = request.headers.get('X-RUN-TOKEN', '')
        if header != RUN_SECRET:
            return JsonResponse({'ok': False, 'error': 'Unauthorized'}, status=401)

    try:
        result = run_rss_job()
        return JsonResponse({'ok': True, 'result': result})
    except Exception as exc:
        return JsonResponse({'ok': False, 'error': str(exc)}, status=500)
