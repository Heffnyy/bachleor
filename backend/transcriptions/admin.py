from django.contrib import admin
from .models import Task, Transcription


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
    list_display = ('id', 'title', 'priority', 'assigned_to', 'assigned_from', 'due_date', 'transcription')
    search_fields = ('title', 'description', 'assigned_to_name', 'assigned_to__username', 'assigned_from__username')
    list_filter = ('priority', 'due_date', 'assigned_to', 'assigned_from')
