from django.contrib.auth.models import User
from rest_framework import serializers
from .models import Task, Transcription


class BasicUserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ['id', 'username', 'first_name', 'last_name']


class TaskTranscriptionSerializer(serializers.ModelSerializer):
    audio_url = serializers.SerializerMethodField()

    class Meta:
        model = Transcription
        fields = ['id', 'original_filename', 'audio_url']

    def get_audio_url(self, obj: Transcription) -> str | None:
        request = self.context.get('request')
        if not obj.original_file:
            return None
        url = obj.original_file.url
        return request.build_absolute_uri(url) if request else url


class TaskSerializer(serializers.ModelSerializer):
    assigned_to = BasicUserSerializer(read_only=True)
    assigned_from = BasicUserSerializer(read_only=True)
    transcription = TaskTranscriptionSerializer(read_only=True)

    class Meta:
        model = Task
        fields = [
            'id',
            'transcription',
            'title',
            'description',
            'priority',
            'due_date',
            'assigned_to',
            'assigned_to_name',
            'assigned_from',
            'is_reviewed',
            'is_completed',
            'completed_at',
            'created_at',
        ]


class TaskClarificationSerializer(serializers.Serializer):
    title = serializers.CharField(required=False, allow_blank=False, max_length=255)
    description = serializers.CharField(required=False, allow_blank=True)
    assignee_username = serializers.CharField(required=False, allow_blank=True, max_length=150)
    due_date = serializers.DateField(required=False)
    priority = serializers.ChoiceField(choices=Task.PRIORITY_CHOICES, required=False)
    reference_date = serializers.DateField(required=False)


class TranscriptionSerializer(serializers.ModelSerializer):
    audio_url = serializers.SerializerMethodField()
    tasks = TaskSerializer(many=True, read_only=True)
    owner = BasicUserSerializer(read_only=True)

    class Meta:
        model = Transcription
        fields = [
            'id',
            'original_filename',
            'owner',
            'detected_language',
            'transcript',
            'duration_seconds',
            'status',
            'error_message',
            'audio_url',
            'tasks',
            'created_at',
            'updated_at',
        ]

    def get_audio_url(self, obj: Transcription) -> str | None:
        request = self.context.get('request')
        if not obj.original_file:
            return None
        url = obj.original_file.url
        return request.build_absolute_uri(url) if request else url


class RegisterSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, min_length=8)

    class Meta:
        model = User
        fields = ['id', 'username', 'first_name', 'last_name', 'password']

    def validate_username(self, value: str) -> str:
        normalized_value = value.strip().lower()
        if User.objects.filter(username__iexact=normalized_value).exists():
            raise serializers.ValidationError('A user with this username already exists.')
        return normalized_value

    def create(self, validated_data):
        password = validated_data.pop('password')
        user = User(**validated_data)
        user.set_password(password)
        user.save()
        return user


class LoginSerializer(serializers.Serializer):
    username = serializers.CharField()
    password = serializers.CharField(write_only=True)
