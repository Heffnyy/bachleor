from rest_framework.routers import DefaultRouter
from django.urls import path

from .views import (
    TaskViewSet,
    TranscriptionViewSet,
    account_request_otp_view,
    account_update_view,
    account_verify_otp_view,
    account_view,
    admin_approve_view,
    admin_change_role_view,
    admin_delete_user_view,
    admin_reject_view,
    admin_users_view,
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
    path('account/', account_view),
    path('account/update/', account_update_view),
    path('account/otp/request/', account_request_otp_view),
    path('account/otp/verify/', account_verify_otp_view),
    path('dashboard/', dashboard_view),
    path('admin/users/', admin_users_view),
    path('admin/users/<int:user_id>/approve/', admin_approve_view),
    path('admin/users/<int:user_id>/reject/', admin_reject_view),
    path('admin/users/<int:user_id>/role/', admin_change_role_view),
    path('admin/users/<int:user_id>/delete/', admin_delete_user_view),
]

urlpatterns += router.urls
