from rest_framework.routers import DefaultRouter
from django.urls import path

from .views import (
    TaskViewSet,
    TranscriptionViewSet,
    dashboard_view,
    login_view,
    logout_view,
    me_view,
    register_view,
)

router = DefaultRouter()
router.register('transcriptions', TranscriptionViewSet, basename='transcription')
router.register('tasks', TaskViewSet, basename='task')

urlpatterns = [
    path('auth/register/', register_view),
    path('auth/login/', login_view),
    path('auth/logout/', logout_view),
    path('auth/me/', me_view),
    path('dashboard/', dashboard_view),
]

urlpatterns += router.urls
