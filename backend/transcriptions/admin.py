from django.contrib import admin
from .models import Task, TaskNote, Transcription, UserProfile


@admin.register(UserProfile)
class UserProfileAdmin(admin.ModelAdmin):
    list_display = ('id', 'user', 'role', 'status', 'manager', 'requested_role', 'requested_manager_name')
    search_fields = ('user__username', 'user__email', 'requested_manager_name')
    list_filter = ('role', 'status')
    raw_id_fields = ('user', 'manager')


@admin.register(Transcription)
class TranscriptionAdmin(admin.ModelAdmin):
    list_display = ('id', 'original_filename', 'owner', 'status', 'detected_language', 'created_at')
    search_fields = ('original_filename', 'transcript', 'owner__username')
    list_filter = ('status', 'detected_language', 'created_at', 'owner')
    actions = ['delete_transcriptions']

    @admin.action(description='Delete selected transcriptions and audio files')
    def delete_transcriptions(self, request, queryset):
        deleted_count = 0
        for transcription in queryset:
            transcription.delete()
            deleted_count += 1
        self.message_user(request, f'Deleted {deleted_count} transcription(s).')

    def delete_queryset(self, request, queryset):
        for transcription in queryset:
            transcription.delete()


@admin.register(Task)
class TaskAdmin(admin.ModelAdmin):
    list_display = ('id', 'title', 'priority', 'status', 'assigned_to', 'assigned_from', 'due_date', 'transcription')
    search_fields = ('title', 'description', 'assigned_to_name', 'assigned_to__username', 'assigned_from__username')
    list_filter = ('priority', 'status', 'due_date', 'assigned_to', 'assigned_from')


@admin.register(TaskNote)
class TaskNoteAdmin(admin.ModelAdmin):
    list_display = ('id', 'task', 'kind', 'author', 'requested_due_date', 'created_at')
    search_fields = ('message', 'task__title', 'author__username')
    list_filter = ('kind', 'created_at')
