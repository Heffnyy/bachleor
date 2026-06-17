from django.contrib.auth.models import User
from rest_framework import serializers
from .models import Task, TaskAssignmentRequest, TaskNote, Transcription, UserProfile


class BasicUserSerializer(serializers.ModelSerializer):
    role = serializers.SerializerMethodField()
    role_display = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ['id', 'username', 'first_name', 'last_name', 'role', 'role_display']

    def get_role(self, obj: User) -> str | None:
        profile = getattr(obj, 'profile', None)
        return profile.role if profile else None

    def get_role_display(self, obj: User) -> str | None:
        profile = getattr(obj, 'profile', None)
        return profile.get_role_display() if profile else None


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


class TaskNoteSerializer(serializers.ModelSerializer):
    author = BasicUserSerializer(read_only=True)

    class Meta:
        model = TaskNote
        fields = ['id', 'kind', 'message', 'requested_due_date', 'author', 'created_at']


class TaskSerializer(serializers.ModelSerializer):
    assigned_to = BasicUserSerializer(read_only=True)
    assigned_from = BasicUserSerializer(read_only=True)
    transcription = TaskTranscriptionSerializer(read_only=True)
    notes = TaskNoteSerializer(many=True, read_only=True)

    class Meta:
        model = Task
        fields = [
            'id',
            'transcription',
            'title',
            'description',
            'priority',
            'status',
            'due_date',
            'assigned_to',
            'assigned_to_name',
            'assigned_from',
            'is_reviewed',
            'is_completed',
            'completed_at',
            'notes',
            'created_at',
        ]


class TaskStatusSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=Task.STATUS_CHOICES)


class TaskAssignmentRequestSerializer(serializers.ModelSerializer):
    requester = BasicUserSerializer(read_only=True)
    target = BasicUserSerializer(read_only=True)
    current_approver = BasicUserSerializer(read_only=True)
    rejected_by = BasicUserSerializer(read_only=True)
    priority_display = serializers.CharField(source='get_priority_display', read_only=True)
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    created_task = serializers.PrimaryKeyRelatedField(read_only=True)

    class Meta:
        model = TaskAssignmentRequest
        fields = [
            'id',
            'requester',
            'target',
            'title',
            'description',
            'priority',
            'priority_display',
            'due_date',
            'status',
            'status_display',
            'current_approver',
            'rejection_reason',
            'rejected_by',
            'created_task',
            'created_at',
            'updated_at',
        ]


class TaskAssignmentRequestCreateSerializer(serializers.Serializer):
    target_username = serializers.CharField(max_length=150)
    title = serializers.CharField(max_length=255)
    description = serializers.CharField(required=False, allow_blank=True)
    priority = serializers.ChoiceField(choices=Task.PRIORITY_CHOICES, default=Task.PRIORITY_MEDIUM)
    due_date = serializers.DateField(required=False, allow_null=True)


class TaskRequestRejectSerializer(serializers.Serializer):
    reason = serializers.CharField(required=False, allow_blank=True)


class TaskNoteCreateSerializer(serializers.Serializer):
    kind = serializers.ChoiceField(choices=TaskNote.KIND_CHOICES)
    message = serializers.CharField(allow_blank=True, required=False)
    requested_due_date = serializers.DateField(required=False, allow_null=True)


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


class RegisterSerializer(serializers.Serializer):
    username = serializers.CharField(max_length=150)
    password = serializers.CharField(write_only=True, min_length=8)
    first_name = serializers.CharField(required=False, allow_blank=True, max_length=150)
    last_name = serializers.CharField(required=False, allow_blank=True, max_length=150)
    email = serializers.EmailField(required=True)
    requested_role = serializers.ChoiceField(choices=[(role, role) for role in UserProfile.SELF_REGISTER_ROLES])
    requested_manager_name = serializers.CharField(required=False, allow_blank=True, max_length=150)

    def validate_username(self, value: str) -> str:
        normalized_value = value.strip().lower()
        if not normalized_value:
            raise serializers.ValidationError('Username is required.')
        return normalized_value

    def validate_email(self, value: str) -> str:
        return value.strip().lower()

    def validate(self, attrs):
        if attrs['requested_role'] == UserProfile.ROLE_OUTSOURCE and not (
            attrs.get('requested_manager_name') or ''
        ).strip():
            raise serializers.ValidationError(
                {'requested_manager_name': 'OutSource staff must name the manager they will report to.'}
            )
        return attrs


class LoginSerializer(serializers.Serializer):
    username = serializers.CharField()
    password = serializers.CharField(write_only=True)


class AdminUserSerializer(serializers.ModelSerializer):
    role = serializers.CharField(source='profile.role', read_only=True)
    role_display = serializers.CharField(source='profile.get_role_display', read_only=True)
    status = serializers.CharField(source='profile.status', read_only=True)
    status_display = serializers.CharField(source='profile.get_status_display', read_only=True)
    requested_role = serializers.CharField(source='profile.requested_role', read_only=True)
    requested_role_display = serializers.CharField(source='profile.get_requested_role_display', read_only=True)
    requested_manager_name = serializers.CharField(source='profile.requested_manager_name', read_only=True)
    rejection_reason = serializers.CharField(source='profile.rejection_reason', read_only=True)
    manager = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = [
            'id',
            'username',
            'first_name',
            'last_name',
            'email',
            'role',
            'role_display',
            'status',
            'status_display',
            'requested_role',
            'requested_role_display',
            'requested_manager_name',
            'manager',
            'rejection_reason',
            'date_joined',
        ]

    def get_manager(self, obj: User):
        profile = getattr(obj, 'profile', None)
        manager = profile.manager if profile else None
        if manager is None:
            return None
        manager_profile = getattr(manager, 'profile', None)
        return {
            'id': manager.id,
            'username': manager.username,
            'role': manager_profile.role if manager_profile else None,
            'role_display': manager_profile.get_role_display() if manager_profile else None,
        }


class ApproveUserSerializer(serializers.Serializer):
    role = serializers.ChoiceField(choices=UserProfile.ROLE_CHOICES, required=False)
    manager_id = serializers.IntegerField(required=False, allow_null=True)


class RejectUserSerializer(serializers.Serializer):
    reason = serializers.CharField(required=False, allow_blank=True)
    permanent = serializers.BooleanField(default=False)


class DeleteUserSerializer(serializers.Serializer):
    reason = serializers.CharField(required=False, allow_blank=True)
    notify = serializers.BooleanField(default=False)


class ChangeRoleSerializer(serializers.Serializer):
    role = serializers.ChoiceField(choices=UserProfile.ROLE_CHOICES)
    manager_id = serializers.IntegerField(required=False, allow_null=True)


class TaskReassignSerializer(serializers.Serializer):
    assignee_username = serializers.CharField(max_length=150)


class TaskOversightDeleteSerializer(serializers.Serializer):
    reason = serializers.CharField(required=False, allow_blank=True)


class AccountDetailSerializer(serializers.ModelSerializer):
    role = serializers.CharField(source='profile.role', read_only=True)
    role_display = serializers.CharField(source='profile.get_role_display', read_only=True)
    status = serializers.CharField(source='profile.status', read_only=True)
    manager = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ['id', 'username', 'first_name', 'last_name', 'email', 'role', 'role_display', 'status', 'manager']

    def get_manager(self, obj: User):
        profile = getattr(obj, 'profile', None)
        manager = profile.manager if profile else None
        if manager is None:
            return None
        manager_profile = getattr(manager, 'profile', None)
        return {
            'id': manager.id,
            'username': manager.username,
            'role_display': manager_profile.get_role_display() if manager_profile else None,
        }


class AccountUpdateSerializer(serializers.Serializer):
    username = serializers.CharField(required=False, max_length=150)
    first_name = serializers.CharField(required=False, allow_blank=True, max_length=150)
    last_name = serializers.CharField(required=False, allow_blank=True, max_length=150)
    email = serializers.EmailField(required=False)
    password = serializers.CharField(required=False, write_only=True, min_length=8)

    def __init__(self, *args, **kwargs):
        self.instance_user = kwargs.pop('instance_user', None)
        super().__init__(*args, **kwargs)

    def validate_username(self, value: str) -> str:
        normalized_value = value.strip().lower()
        if not normalized_value:
            raise serializers.ValidationError('Username cannot be empty.')
        conflict = User.objects.filter(username__iexact=normalized_value)
        if self.instance_user is not None:
            conflict = conflict.exclude(pk=self.instance_user.pk)
        if conflict.exists():
            raise serializers.ValidationError('A user with this username already exists.')
        return normalized_value

    def validate_email(self, value: str) -> str:
        normalized_value = value.strip().lower()
        conflict = User.objects.filter(email__iexact=normalized_value)
        if self.instance_user is not None:
            conflict = conflict.exclude(pk=self.instance_user.pk)
        if conflict.exists():
            raise serializers.ValidationError('A user with this email already exists.')
        return normalized_value


class OTPRequestSerializer(serializers.Serializer):
    code = serializers.CharField(min_length=4, max_length=12)
