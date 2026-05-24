from datetime import date
from pathlib import Path
import re
from tempfile import NamedTemporaryFile
import unicodedata

from django.contrib.auth import authenticate
from django.contrib.auth.models import User
from django.db.models import Q
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.authtoken.models import Token
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from .models import Task, Transcription
from .serializers import (
    BasicUserSerializer,
    LoginSerializer,
    TaskClarificationSerializer,
    RegisterSerializer,
    TaskSerializer,
    TranscriptionSerializer,
)
from .services import (
    TaskExtractorServiceError,
    TranscriberServiceError,
    extract_tasks,
    normalize_due_date,
    normalize_due_date_text,
    normalize_duration,
    transcribe_file,
)


def resolve_assigned_user(raw_username: str) -> User | None:
    if not raw_username:
        return None

    normalized_candidate = normalize_username_value(raw_username)
    if not normalized_candidate:
        return None

    direct_match = User.objects.filter(username__iexact=normalized_candidate).first()
    if direct_match:
        return direct_match

    for user in User.objects.all():
        possible_keys = {
            normalize_username_value(user.username),
            normalize_username_value(user.first_name),
            normalize_username_value(user.last_name),
            normalize_username_value(f'{user.first_name}{user.last_name}'),
            normalize_username_value(f'{user.first_name} {user.last_name}'),
        }
        if normalized_candidate in possible_keys:
            return user

    return None


def normalize_username_value(value: str) -> str:
    if not value:
        return ''

    normalized = unicodedata.normalize('NFKD', value)
    ascii_value = normalized.encode('ascii', 'ignore').decode('ascii')
    lowered = ascii_value.strip().lower()
    return re.sub(r'[^a-z0-9]', '', lowered)


@api_view(['POST'])
@permission_classes([AllowAny])
def register_view(request):
    serializer = RegisterSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    user = serializer.save()
    token, _ = Token.objects.get_or_create(user=user)
    return Response(
        {
            'token': token.key,
            'user': BasicUserSerializer(user).data,
        },
        status=status.HTTP_201_CREATED,
    )


@api_view(['POST'])
@permission_classes([AllowAny])
def login_view(request):
    serializer = LoginSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    username = serializer.validated_data['username'].strip().lower()
    password = serializer.validated_data['password']
    user = authenticate(username=username, password=password)

    if user is None:
        return Response({'detail': 'Invalid username or password.'}, status=status.HTTP_400_BAD_REQUEST)

    token, _ = Token.objects.get_or_create(user=user)
    return Response(
        {
            'token': token.key,
            'user': BasicUserSerializer(user).data,
        }
    )


@api_view(['POST'])
def logout_view(request):
    if request.auth:
        request.auth.delete()
    return Response(status=status.HTTP_204_NO_CONTENT)


@api_view(['GET'])
def me_view(request):
    return Response({'user': BasicUserSerializer(request.user).data})


@api_view(['GET'])
def dashboard_view(request):
    transcriptions = (
        Transcription.objects.filter(owner=request.user)
        .prefetch_related('tasks__assigned_to', 'tasks__assigned_from')
        .order_by('-created_at')
    )
    assigned_tasks = (
        Task.objects.filter(assigned_to=request.user, is_reviewed=True)
        .select_related('assigned_to', 'assigned_from', 'transcription')
        .order_by('-created_at')
    )
    available_users = User.objects.order_by('username')

    return Response(
        {
            'user': BasicUserSerializer(request.user).data,
            'my_voice_messages': TranscriptionSerializer(
                transcriptions, many=True, context={'request': request}
            ).data,
            'assigned_tasks': TaskSerializer(
                assigned_tasks, many=True, context={'request': request}
            ).data,
            'available_users': BasicUserSerializer(available_users, many=True).data,
        }
    )


class TranscriptionViewSet(viewsets.ModelViewSet):
    serializer_class = TranscriptionSerializer
    parser_classes = [MultiPartParser, FormParser]

    def get_queryset(self):
        return (
            Transcription.objects.filter(owner=self.request.user)
            .select_related('owner')
            .prefetch_related('tasks__assigned_to', 'tasks__assigned_from')
            .order_by('-created_at')
        )

    def create(self, request, *args, **kwargs):
        uploaded_file = request.FILES.get('file')
        selected_language = (request.data.get('language') or '').strip().lower()
        if uploaded_file is None:
            return Response({'detail': 'Audio file is required in the file field.'}, status=status.HTTP_400_BAD_REQUEST)
        if selected_language and selected_language not in {'ar', 'en'}:
            return Response(
                {'detail': 'language must be one of: ar, en, or omitted.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        instance = Transcription.objects.create(
            owner=request.user,
            original_file=uploaded_file,
            original_filename=uploaded_file.name,
            status=Transcription.STATUS_PENDING,
        )

        try:
            payload = transcribe_file(
                Path(instance.original_file.path),
                language=selected_language or None,
            )
            instance.transcript = payload.get('text', '')
            instance.detected_language = payload.get('language', '') or ''
            instance.duration_seconds = normalize_duration(payload.get('duration_seconds'))
            instance.status = Transcription.STATUS_COMPLETED
            instance.error_message = ''

            if instance.transcript.strip():
                available_usernames = list(
                    User.objects.order_by('username').values_list('username', flat=True)
                )
                tasks = extract_tasks(
                    instance.transcript,
                    available_usernames=available_usernames,
                )
                Task.objects.filter(transcription=instance).delete()
                for task in tasks:
                    raw_assignee = normalize_username_value(task.get('assignee_username') or '')
                    assigned_user = resolve_assigned_user(raw_assignee)

                    Task.objects.create(
                        transcription=instance,
                        title=task.get('title', '').strip() or 'Untitled task',
                        description=task.get('description', '').strip(),
                        priority=task.get('priority', Task.PRIORITY_MEDIUM),
                        assigned_to=assigned_user,
                        assigned_to_name=assigned_user.username if assigned_user else raw_assignee,
                        assigned_from=request.user,
                        due_date=normalize_due_date(task.get('due_date')),
                    )
        except TranscriberServiceError as exc:
            instance.status = Transcription.STATUS_FAILED
            instance.error_message = str(exc)
        except TaskExtractorServiceError as exc:
            instance.status = Transcription.STATUS_COMPLETED
            instance.error_message = f'Task extraction failed: {exc}'
        except Exception as exc:
            instance.status = Transcription.STATUS_FAILED
            instance.error_message = f'Unexpected error: {exc}'

        instance.save()
        serializer = self.get_serializer(instance)
        return Response(serializer.data, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=['get'], permission_classes=[AllowAny])
    def health(self, request):
        return Response({'status': 'ok'})


class TaskViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = TaskSerializer
    parser_classes = [JSONParser, MultiPartParser, FormParser]

    def get_queryset(self):
        return (
            Task.objects.filter(
                Q(transcription__owner=self.request.user)
                | Q(assigned_from=self.request.user)
                | Q(assigned_to=self.request.user)
            )
            .select_related('assigned_to', 'assigned_from', 'transcription')
            .distinct()
            .order_by('id')
        )

    @action(detail=True, methods=['patch', 'post'])
    def clarify(self, request, pk=None):
        task = self.get_object()
        if task.transcription.owner_id != request.user.id and task.assigned_from_id != request.user.id:
            return Response(
                {'detail': 'Only the person who assigned this task can review and send it.'},
                status=status.HTTP_403_FORBIDDEN,
            )

        serializer = TaskClarificationSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        title = serializer.validated_data.get('title')
        description = serializer.validated_data.get('description')
        assignee_username = serializer.validated_data.get('assignee_username')
        due_date = serializer.validated_data.get('due_date')
        priority = serializer.validated_data.get('priority')
        reference_date = serializer.validated_data.get('reference_date') or timezone.localdate()
        uploaded_file = request.FILES.get('file')
        selected_language = (request.data.get('language') or '').strip().lower()

        if selected_language and selected_language not in {'ar', 'en'}:
            return Response(
                {'detail': 'language must be one of: ar, en, or omitted.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        transcribed_reply = ''

        if due_date is None and uploaded_file is not None:
            suffix = Path(uploaded_file.name or 'reply.webm').suffix or '.webm'
            with NamedTemporaryFile(delete=True, suffix=suffix) as temp_file:
                for chunk in uploaded_file.chunks():
                    temp_file.write(chunk)
                temp_file.flush()

                payload = transcribe_file(Path(temp_file.name), language=selected_language or None)
                transcribed_reply = payload.get('text', '').strip()

            if not transcribed_reply:
                return Response(
                    {'detail': 'The recorded reply could not be transcribed.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            due_date = normalize_due_date_text(transcribed_reply, reference_date=reference_date)
            if due_date is None:
                return Response(
                    {
                        'detail': 'The recorded reply did not contain a clear due date.',
                        'transcribed_reply': transcribed_reply,
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )

        if title is not None:
            task.title = title.strip()

        if description is not None:
            task.description = description.strip()

        if assignee_username is not None:
            normalized_assignee = normalize_username_value(assignee_username)
            assigned_user = resolve_assigned_user(normalized_assignee)
            task.assigned_to = assigned_user
            task.assigned_to_name = assigned_user.username if assigned_user else normalized_assignee

        if due_date is not None:
            task.due_date = due_date

        if priority is not None:
            task.priority = priority

        task.is_reviewed = True
        task.save()

        return Response(
            {
                'task': TaskSerializer(task).data,
                'transcribed_reply': transcribed_reply,
            }
        )

    @action(detail=True, methods=['patch', 'post'])
    def complete(self, request, pk=None):
        task = self.get_object()
        can_complete = request.user.id in {
            task.assigned_to_id,
            task.assigned_from_id,
            task.transcription.owner_id,
        }
        if not can_complete:
            return Response(
                {'detail': 'Only the sender or receiver can complete this task.'},
                status=status.HTTP_403_FORBIDDEN,
            )

        if not task.is_completed:
            task.is_completed = True
            task.completed_at = timezone.now()
            task.save(update_fields=['is_completed', 'completed_at'])

        return Response({'task': TaskSerializer(task).data})
