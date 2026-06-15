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

from .hierarchy import (
    can_assign,
    can_oversee_task,
    ensure_profile,
    get_assignable_users,
    get_overseen_user_ids,
    is_admin,
)
from .models import AccountChangeOTP, Task, TaskNote, Transcription, UserProfile
from .notifications import (
    send_account_activated_email,
    send_account_deleted_email,
    send_account_otp_email,
    send_account_rejected_email,
    send_new_registration_admin_email,
    send_task_assignment_email,
    send_task_deleted_email,
    send_task_note_email,
    send_task_status_email,
)
from .serializers import (
    AccountDetailSerializer,
    AccountUpdateSerializer,
    AdminUserSerializer,
    ApproveUserSerializer,
    BasicUserSerializer,
    ChangeRoleSerializer,
    DeleteUserSerializer,
    LoginSerializer,
    OTPRequestSerializer,
    RejectUserSerializer,
    TaskClarificationSerializer,
    TaskNoteCreateSerializer,
    TaskNoteSerializer,
    TaskOversightDeleteSerializer,
    TaskReassignSerializer,
    TaskStatusSerializer,
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
    data = serializer.validated_data
    username = data['username']
    email = data['email']

    # A previously, permanently rejected applicant cannot apply again with the same email.
    permanent = UserProfile.objects.filter(
        user__email__iexact=email, status=UserProfile.STATUS_PERMANENTLY_REJECTED
    ).first()
    if permanent is not None:
        return Response(
            {
                'detail': 'You have been permanently rejected from this company and cannot apply again here.',
                'code': 'permanently_rejected',
            },
            status=status.HTTP_403_FORBIDDEN,
        )

    if User.objects.filter(username__iexact=username).exists():
        return Response(
            {'username': ['A user with this username already exists.']},
            status=status.HTTP_400_BAD_REQUEST,
        )

    # Let a temporarily rejected applicant re-apply by reusing their record; otherwise block dup emails.
    existing = UserProfile.objects.filter(user__email__iexact=email).select_related('user').first()
    if existing is not None and existing.status != UserProfile.STATUS_REJECTED:
        return Response(
            {'email': ['An account with this email already exists.']},
            status=status.HTTP_400_BAD_REQUEST,
        )

    if existing is not None:
        user = existing.user
        user.username = username
        user.first_name = data.get('first_name', '')
        user.last_name = data.get('last_name', '')
        user.set_password(data['password'])
        user.is_active = False
        user.save()
        profile = existing
    else:
        user = User(
            username=username,
            email=email,
            first_name=data.get('first_name', ''),
            last_name=data.get('last_name', ''),
            is_active=False,
        )
        user.set_password(data['password'])
        user.save()
        profile = UserProfile.objects.create(user=user)

    profile.requested_role = data['requested_role']
    profile.requested_manager_name = (data.get('requested_manager_name') or '').strip()
    profile.role = UserProfile.ROLE_EMPLOYEE
    profile.manager = None
    profile.status = UserProfile.STATUS_PENDING
    profile.rejection_reason = ''
    profile.save()

    send_new_registration_admin_email(user)

    return Response(
        {
            'detail': 'Your registration was received and is pending approval by administration. '
            'You will get an email once your account is active.',
            'status': 'pending',
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

    user = User.objects.filter(username__iexact=username).first()
    if user is None or not user.check_password(password):
        return Response({'detail': 'Invalid username or password.'}, status=status.HTTP_400_BAD_REQUEST)

    profile = ensure_profile(user)

    if profile.status == UserProfile.STATUS_PENDING:
        return Response(
            {
                'detail': 'Your account is still pending approval by administration and you will get '
                'an email once your account is active.',
                'code': 'pending',
            },
            status=status.HTTP_403_FORBIDDEN,
        )
    if profile.status == UserProfile.STATUS_PERMANENTLY_REJECTED:
        return Response(
            {
                'detail': 'You have been permanently rejected from this company and cannot apply again here.',
                'code': 'permanently_rejected',
            },
            status=status.HTTP_403_FORBIDDEN,
        )
    if profile.status == UserProfile.STATUS_REJECTED:
        return Response(
            {
                'detail': profile.rejection_reason
                or 'Your registration was not approved. You may apply again.',
                'code': 'rejected',
            },
            status=status.HTTP_403_FORBIDDEN,
        )

    if not user.is_active:
        user.is_active = True
        user.save(update_fields=['is_active'])

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
def account_view(request):
    return Response({'user': AccountDetailSerializer(request.user).data})


@api_view(['POST'])
def account_request_otp_view(request):
    user = request.user
    if not user.email:
        return Response(
            {'detail': 'Your account has no email on file, so a code cannot be sent. Contact an administrator.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    otp, code = AccountChangeOTP.issue(user)
    if not send_account_otp_email(otp, code):
        otp.is_consumed = True
        otp.save(update_fields=['is_consumed'])
        return Response(
            {'detail': 'We could not send the verification email. Please try again later.'},
            status=status.HTTP_502_BAD_GATEWAY,
        )

    masked_email = _mask_email(user.email)
    return Response({'detail': f'A verification code was sent to {masked_email}.'})


@api_view(['POST'])
def account_verify_otp_view(request):
    serializer = OTPRequestSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    submitted_code = serializer.validated_data['code'].strip()

    otp = (
        AccountChangeOTP.objects.filter(user=request.user, is_consumed=False, is_verified=False)
        .order_by('-created_at')
        .first()
    )
    if otp is None or otp.is_expired():
        return Response(
            {'detail': 'Your code has expired. Request a new one.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    if otp.attempts >= AccountChangeOTP.MAX_ATTEMPTS:
        otp.is_consumed = True
        otp.save(update_fields=['is_consumed'])
        return Response(
            {'detail': 'Too many incorrect attempts. Request a new code.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    if not otp.check_code(submitted_code):
        otp.attempts += 1
        otp.save(update_fields=['attempts'])
        remaining = max(AccountChangeOTP.MAX_ATTEMPTS - otp.attempts, 0)
        return Response(
            {'detail': f'That code is incorrect. {remaining} attempt(s) remaining.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    verification_token = otp.mark_verified()
    return Response({'verification_token': verification_token})


@api_view(['PATCH', 'POST'])
def account_update_view(request):
    verification_token = (request.data.get('verification_token') or '').strip()
    if not verification_token:
        return Response(
            {'detail': 'A verification code is required before changing your details.'},
            status=status.HTTP_403_FORBIDDEN,
        )

    otp = (
        AccountChangeOTP.objects.filter(
            user=request.user,
            verification_token=verification_token,
            is_verified=True,
            is_consumed=False,
        )
        .order_by('-created_at')
        .first()
    )
    if otp is None or otp.is_expired():
        return Response(
            {'detail': 'Your verification has expired. Request a new code.'},
            status=status.HTTP_403_FORBIDDEN,
        )

    serializer = AccountUpdateSerializer(data=request.data, instance_user=request.user)
    serializer.is_valid(raise_exception=True)
    changes = serializer.validated_data

    user = request.user
    if 'username' in changes:
        user.username = changes['username']
    if 'first_name' in changes:
        user.first_name = changes['first_name'].strip()
    if 'last_name' in changes:
        user.last_name = changes['last_name'].strip()
    if 'email' in changes:
        user.email = changes['email']
    if changes.get('password'):
        user.set_password(changes['password'])
    user.save()

    otp.is_consumed = True
    otp.save(update_fields=['is_consumed'])

    return Response({'user': AccountDetailSerializer(user).data})


def _mask_email(email: str) -> str:
    local, _, domain = email.partition('@')
    if not domain:
        return email
    visible = local[:2]
    return f'{visible}{"*" * max(len(local) - 2, 1)}@{domain}'


@api_view(['GET'])
def dashboard_view(request):
    transcriptions = (
        Transcription.objects.filter(owner=request.user)
        .prefetch_related('tasks__assigned_to', 'tasks__assigned_from', 'tasks__notes__author')
        .order_by('-created_at')
    )
    assigned_tasks = (
        Task.objects.filter(assigned_to=request.user, is_reviewed=True)
        .select_related('assigned_to', 'assigned_from', 'transcription')
        .prefetch_related('notes__author')
        .order_by('-created_at')
    )

    # Tasks anywhere in this user's subtree (for superiors to oversee), excluding their own.
    overseen_ids = get_overseen_user_ids(request.user)
    team_tasks = []
    if overseen_ids:
        team_tasks = (
            Task.objects.filter(
                Q(assigned_to_id__in=overseen_ids) | Q(assigned_from_id__in=overseen_ids)
            )
            .exclude(assigned_to=request.user)
            .exclude(assigned_from=request.user)
            .select_related('assigned_to', 'assigned_from', 'transcription')
            .prefetch_related('notes__author')
            .distinct()
            .order_by('-created_at')
        )

    available_users = get_assignable_users(request.user)
    profile = ensure_profile(request.user)

    return Response(
        {
            'user': BasicUserSerializer(request.user).data,
            'account': AccountDetailSerializer(request.user).data,
            'is_admin': is_admin(request.user),
            'pending_count': UserProfile.objects.filter(status=UserProfile.STATUS_PENDING).count()
            if is_admin(request.user)
            else 0,
            'my_voice_messages': TranscriptionSerializer(
                transcriptions, many=True, context={'request': request}
            ).data,
            'assigned_tasks': TaskSerializer(
                assigned_tasks, many=True, context={'request': request}
            ).data,
            'team_tasks': TaskSerializer(team_tasks, many=True, context={'request': request}).data,
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
            .prefetch_related('tasks__assigned_to', 'tasks__assigned_from', 'tasks__notes__author')
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
                blocked_assignees = []
                for task in tasks:
                    raw_assignee = normalize_username_value(task.get('assignee_username') or '')
                    assigned_user = resolve_assigned_user(raw_assignee)

                    # Enforce the chain of command: you can only assign to people you may command.
                    if assigned_user is not None and not can_assign(request.user, assigned_user):
                        blocked_assignees.append(assigned_user.username)
                        assigned_user = None

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

                if blocked_assignees:
                    names = ', '.join(sorted(set(blocked_assignees)))
                    instance.error_message = (
                        f'Some tasks were left unassigned because they are not under you in the '
                        f'chain of command: {names}. Reassign them during review if needed.'
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
        user = self.request.user
        overseen_ids = get_overseen_user_ids(user)
        return (
            Task.objects.filter(
                Q(transcription__owner=user)
                | Q(assigned_from=user)
                | Q(assigned_to=user)
                | Q(assigned_to_id__in=overseen_ids)
                | Q(assigned_from_id__in=overseen_ids)
            )
            .select_related('assigned_to', 'assigned_from', 'transcription')
            .prefetch_related('notes__author')
            .distinct()
            .order_by('id')
        )

    @action(detail=True, methods=['patch', 'post'])
    def clarify(self, request, pk=None):
        task = self.get_object()
        was_reviewed = task.is_reviewed
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
            if assigned_user is not None and not can_assign(request.user, assigned_user):
                return Response(
                    {
                        'detail': f'You cannot assign this task to {assigned_user.username}. '
                        'They are not under you in the chain of command.'
                    },
                    status=status.HTTP_403_FORBIDDEN,
                )
            task.assigned_to = assigned_user
            task.assigned_to_name = assigned_user.username if assigned_user else normalized_assignee

        if due_date is not None:
            task.due_date = due_date

        if priority is not None:
            task.priority = priority

        task.is_reviewed = True
        task.save()

        if not was_reviewed:
            send_task_assignment_email(task)

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
            task.status = Task.STATUS_DONE
            task.completed_at = timezone.now()
            task.save(update_fields=['is_completed', 'status', 'completed_at'])

        return Response({'task': TaskSerializer(task).data})

    @action(detail=True, methods=['patch', 'post'], url_path='status')
    def set_status(self, request, pk=None):
        task = self.get_object()
        if request.user.id not in {
            task.assigned_to_id,
            task.assigned_from_id,
            task.transcription.owner_id,
        }:
            return Response(
                {'detail': 'Only the sender or receiver can change this task status.'},
                status=status.HTTP_403_FORBIDDEN,
            )

        serializer = TaskStatusSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        new_status = serializer.validated_data['status']
        previous_status = task.status

        task.status = new_status
        if new_status == Task.STATUS_DONE:
            task.is_completed = True
            if task.completed_at is None:
                task.completed_at = timezone.now()
        else:
            task.is_completed = False
            task.completed_at = None
        task.save(update_fields=['status', 'is_completed', 'completed_at'])

        # Notify the sender when the assignee changes the status (no point emailing yourself).
        email_sent = False
        if previous_status != new_status and request.user.id == task.assigned_to_id:
            email_sent = send_task_status_email(task, request.user, previous_status)

        return Response({'task': TaskSerializer(task).data, 'email_sent': email_sent})

    @action(detail=True, methods=['post'], url_path='notify')
    def notify(self, request, pk=None):
        task = self.get_object()
        if request.user.id != task.assigned_to_id:
            return Response(
                {'detail': 'Only the person the task is assigned to can send an update to the sender.'},
                status=status.HTTP_403_FORBIDDEN,
            )

        serializer = TaskNoteCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        message = (serializer.validated_data.get('message') or '').strip()
        requested_due_date = serializer.validated_data.get('requested_due_date')

        if not message and requested_due_date is None:
            return Response(
                {'detail': 'Add a short message or a proposed new date before sending.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        note = TaskNote.objects.create(
            task=task,
            author=request.user,
            kind=serializer.validated_data['kind'],
            message=message,
            requested_due_date=requested_due_date,
        )
        email_sent = send_task_note_email(note)

        return Response(
            {
                'task': TaskSerializer(task).data,
                'note': TaskNoteSerializer(note).data,
                'email_sent': email_sent,
            },
            status=status.HTTP_201_CREATED,
        )

    @action(detail=True, methods=['post'], url_path='reassign')
    def reassign(self, request, pk=None):
        task = self.get_object()
        if not can_oversee_task(request.user, task):
            return Response(
                {'detail': 'Only a superior of the people on this task can reassign it.'},
                status=status.HTTP_403_FORBIDDEN,
            )

        serializer = TaskReassignSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        new_user = resolve_assigned_user(serializer.validated_data['assignee_username'])
        if new_user is None:
            return Response({'detail': 'That user could not be found.'}, status=status.HTTP_404_NOT_FOUND)

        # The overseer may only move it to someone they themselves can command.
        if not can_assign(request.user, new_user):
            return Response(
                {
                    'detail': f'You cannot reassign this task to {new_user.username}. '
                    'They are not under you in the chain of command.'
                },
                status=status.HTTP_403_FORBIDDEN,
            )

        task.assigned_to = new_user
        task.assigned_to_name = new_user.username
        task.status = Task.STATUS_DELIVERED
        task.is_completed = False
        task.completed_at = None
        task.save(update_fields=['assigned_to', 'assigned_to_name', 'status', 'is_completed', 'completed_at'])

        if task.is_reviewed:
            send_task_assignment_email(task)

        return Response({'task': TaskSerializer(task).data})

    @action(detail=True, methods=['post'], url_path='oversight-delete')
    def oversight_delete(self, request, pk=None):
        task = self.get_object()
        if not can_oversee_task(request.user, task):
            return Response(
                {'detail': 'Only a superior of the people on this task can delete it.'},
                status=status.HTTP_403_FORBIDDEN,
            )

        serializer = TaskOversightDeleteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        reason = (serializer.validated_data.get('reason') or '').strip()

        email_sent = send_task_deleted_email(task, request.user, reason)
        task.delete()
        return Response({'detail': 'Task deleted.', 'email_sent': email_sent})


# ---------------------------------------------------------------------------
# Admin: registration approval and role management
# ---------------------------------------------------------------------------


def _require_admin(request):
    if not is_admin(request.user):
        return Response(
            {'detail': 'Only administrators can perform this action.'},
            status=status.HTTP_403_FORBIDDEN,
        )
    return None


@api_view(['GET'])
def admin_users_view(request):
    denied = _require_admin(request)
    if denied is not None:
        return denied

    status_filter = request.query_params.get('status')
    users = User.objects.select_related('profile', 'profile__manager').order_by('-date_joined')
    if status_filter:
        users = users.filter(profile__status=status_filter)

    return Response({'users': AdminUserSerializer(users, many=True).data})


@api_view(['POST'])
def admin_approve_view(request, user_id):
    denied = _require_admin(request)
    if denied is not None:
        return denied

    target = User.objects.filter(id=user_id).select_related('profile').first()
    if target is None:
        return Response({'detail': 'User not found.'}, status=status.HTTP_404_NOT_FOUND)

    profile = ensure_profile(target)
    serializer = ApproveUserSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)

    if profile.requested_role == UserProfile.ROLE_OUTSOURCE:
        # OutSource staff can only be attached to the user they named at registration.
        manager = resolve_assigned_user(profile.requested_manager_name)
        if manager is None:
            return Response(
                {
                    'detail': f'Could not find the manager "{profile.requested_manager_name}" this '
                    'OutSource applicant chose. Fix the name or reject the registration.'
                },
                status=status.HTTP_400_BAD_REQUEST,
            )
        profile.role = UserProfile.ROLE_OUTSOURCE
        profile.manager = manager
    else:
        profile.role = serializer.validated_data.get('role') or profile.requested_role
        manager_id = serializer.validated_data.get('manager_id')
        if manager_id is not None:
            manager = User.objects.filter(id=manager_id).first()
            if manager is None:
                return Response({'detail': 'Selected manager not found.'}, status=status.HTTP_404_NOT_FOUND)
            profile.manager = manager
        else:
            profile.manager = None

    profile.status = UserProfile.STATUS_ACTIVE
    profile.rejection_reason = ''
    profile.save()

    target.is_active = True
    target.save(update_fields=['is_active'])

    email_sent = send_account_activated_email(target)
    return Response({'user': AdminUserSerializer(target).data, 'email_sent': email_sent})


@api_view(['POST'])
def admin_reject_view(request, user_id):
    denied = _require_admin(request)
    if denied is not None:
        return denied

    target = User.objects.filter(id=user_id).select_related('profile').first()
    if target is None:
        return Response({'detail': 'User not found.'}, status=status.HTTP_404_NOT_FOUND)

    profile = ensure_profile(target)
    serializer = RejectUserSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    reason = (serializer.validated_data.get('reason') or '').strip()
    permanent = serializer.validated_data['permanent']

    profile.status = (
        UserProfile.STATUS_PERMANENTLY_REJECTED if permanent else UserProfile.STATUS_REJECTED
    )
    profile.rejection_reason = reason
    profile.save()

    target.is_active = False
    target.save(update_fields=['is_active'])
    Token.objects.filter(user=target).delete()

    email_sent = send_account_rejected_email(target, reason, permanent)
    return Response({'user': AdminUserSerializer(target).data, 'email_sent': email_sent})


@api_view(['POST'])
def admin_change_role_view(request, user_id):
    denied = _require_admin(request)
    if denied is not None:
        return denied

    target = User.objects.filter(id=user_id).select_related('profile').first()
    if target is None:
        return Response({'detail': 'User not found.'}, status=status.HTTP_404_NOT_FOUND)
    if target.id == request.user.id:
        return Response({'detail': 'You cannot change your own role.'}, status=status.HTTP_400_BAD_REQUEST)

    profile = ensure_profile(target)
    serializer = ChangeRoleSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)

    profile.role = serializer.validated_data['role']
    if 'manager_id' in serializer.validated_data:
        manager_id = serializer.validated_data['manager_id']
        if manager_id is None:
            profile.manager = None
        else:
            manager = User.objects.filter(id=manager_id).first()
            if manager is None:
                return Response({'detail': 'Selected manager not found.'}, status=status.HTTP_404_NOT_FOUND)
            if manager.id == target.id:
                return Response({'detail': 'A user cannot report to themselves.'}, status=status.HTTP_400_BAD_REQUEST)
            profile.manager = manager
    profile.save()

    return Response({'user': AdminUserSerializer(target).data})


@api_view(['POST', 'DELETE'])
def admin_delete_user_view(request, user_id):
    denied = _require_admin(request)
    if denied is not None:
        return denied

    target = User.objects.filter(id=user_id).select_related('profile').first()
    if target is None:
        return Response({'detail': 'User not found.'}, status=status.HTTP_404_NOT_FOUND)
    if target.id == request.user.id:
        return Response({'detail': 'You cannot delete your own account.'}, status=status.HTTP_400_BAD_REQUEST)

    serializer = DeleteUserSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    reason = (serializer.validated_data.get('reason') or '').strip()
    notify = serializer.validated_data['notify']

    # Capture details before the row is gone — the email is sent after deletion succeeds.
    email = target.email
    name = target.first_name or target.username
    username = target.username

    target.delete()

    email_sent = send_account_deleted_email(email, name, reason) if notify else False
    return Response(
        {'detail': f'Deleted user "{username}".', 'email_sent': email_sent},
        status=status.HTTP_200_OK,
    )

    return Response({'user': AdminUserSerializer(target).data})
