import logging

from django.conf import settings
from django.contrib.auth.models import User
from django.core.mail import send_mail

from .models import AccountChangeOTP, Task, TaskNote, UserProfile

logger = logging.getLogger(__name__)


def _admin_emails() -> list[str]:
    admins = User.objects.filter(profile__role=UserProfile.ROLE_ADMIN) | User.objects.filter(is_superuser=True)
    return list(admins.exclude(email='').values_list('email', flat=True).distinct())


def send_new_registration_admin_email(new_user: User) -> bool:
    """Tell admins that someone registered and is waiting for approval."""
    recipients = _admin_emails()
    if not recipients:
        return False

    profile = new_user.profile
    role_label = dict(UserProfile.ROLE_CHOICES).get(profile.requested_role, profile.requested_role)
    lines = [
        'A new user registered and is waiting for approval.',
        '',
        f'Username: {new_user.username}',
        f'Name: {new_user.get_full_name() or "—"}',
        f'Email: {new_user.email}',
        f'Applying as: {role_label}',
    ]
    if profile.requested_manager_name:
        lines.append(f'Wants to report to: {profile.requested_manager_name}')
    lines += ['', f'Review it in the admin panel: {settings.FRONTEND_BASE_URL}']

    try:
        send_mail(
            f'New registration pending approval: {new_user.username}',
            '\n'.join(lines),
            settings.DEFAULT_FROM_EMAIL,
            recipients,
            fail_silently=False,
        )
        return True
    except Exception:
        logger.exception('Failed to send new-registration email to admins')
        return False


def send_account_activated_email(user: User) -> bool:
    """Tell a newly approved user their account is active, their role, and their direct superior."""
    if not user.email:
        return False

    profile = user.profile
    role_label = profile.get_role_display()
    manager = profile.manager
    if manager is not None:
        manager_profile = getattr(manager, 'profile', None)
        manager_role = manager_profile.get_role_display() if manager_profile else ''
        manager_name = manager.get_full_name() or manager.username
        reports_line = f'You report directly to {manager_name}' + (f' ({manager_role}).' if manager_role else '.')
    else:
        reports_line = 'You are at the top of your chain of command.'

    lines = [
        f'Hi {user.first_name or user.username},',
        '',
        'Your account has been approved and is now active.',
        '',
        f'Your role: {role_label}',
        reports_line,
        '',
        f'Log in here: {settings.FRONTEND_BASE_URL}',
    ]

    try:
        send_mail(
            'Your account is now active',
            '\n'.join(lines),
            settings.DEFAULT_FROM_EMAIL,
            [user.email],
            fail_silently=False,
        )
        return True
    except Exception:
        logger.exception('Failed to send activation email to %s', user.email)
        return False


def send_account_rejected_email(user: User, reason: str, permanent: bool) -> bool:
    """Tell a registrant their application was rejected, with the admin's message."""
    if not user.email:
        return False

    lines = [
        f'Hi {user.first_name or user.username},',
        '',
        'We have reviewed your registration and it was not approved at this time.',
    ]
    if reason:
        lines += ['', 'Message from the administration:', reason]
    if permanent:
        lines += ['', 'This decision is permanent, and you will not be able to apply here again.']
    else:
        lines += ['', 'You are welcome to apply again in the future.']

    try:
        send_mail(
            'Update on your registration',
            '\n'.join(lines),
            settings.DEFAULT_FROM_EMAIL,
            [user.email],
            fail_silently=False,
        )
        return True
    except Exception:
        logger.exception('Failed to send rejection email to %s', user.email)
        return False


def send_account_deleted_email(email: str, name: str, reason: str) -> bool:
    """Tell a user their account was deleted by an administrator, with an optional reason.

    Takes plain values (not a User) because it is called after the row is deleted.
    """
    if not email:
        return False

    lines = [
        f'Hi {name},',
        '',
        'Your Voice To Task account has been deleted by an administrator and can no longer be used.',
    ]
    if reason:
        lines += ['', 'Reason:', reason]
    lines += ['', 'If you believe this was a mistake, please contact the administration.']

    try:
        send_mail(
            'Your account has been deleted',
            '\n'.join(lines),
            settings.DEFAULT_FROM_EMAIL,
            [email],
            fail_silently=False,
        )
        return True
    except Exception:
        logger.exception('Failed to send account deletion email to %s', email)
        return False


def send_task_status_email(task: Task, actor, previous_status: str) -> bool:
    """Email the task's sender when the assignee moves the task to a new status."""
    sender = task.assigned_from or task.transcription.owner
    if sender is None or not sender.email:
        return False

    actor_name = (actor.get_full_name() or actor.username) if actor else 'The assignee'
    status_labels = dict(Task.STATUS_CHOICES)
    previous_label = status_labels.get(previous_status, previous_status)
    new_label = status_labels.get(task.status, task.status)

    subject = f'Task status updated: {task.title}'
    lines = [
        f'Hi {sender.first_name or sender.username},',
        '',
        f'{actor_name} changed the status of the task "{task.title}".',
        '',
        f'Status: {previous_label} → {new_label}',
        '',
        f'Log in to review it: {settings.FRONTEND_BASE_URL}',
    ]

    try:
        send_mail(
            subject,
            '\n'.join(lines),
            settings.DEFAULT_FROM_EMAIL,
            [sender.email],
            fail_silently=False,
        )
        return True
    except Exception:
        logger.exception('Failed to send task status email to %s', sender.email)
        return False


def send_task_deleted_email(task: Task, actor, reason: str) -> bool:
    """Tell the task's sender that a superior deleted the task, with the reason why."""
    sender = task.assigned_from or task.transcription.owner
    if sender is None or not sender.email:
        return False
    if actor is not None and sender.id == actor.id:
        return False

    actor_name = (actor.get_full_name() or actor.username) if actor else 'A superior'
    lines = [
        f'Hi {sender.first_name or sender.username},',
        '',
        f'{actor_name} deleted the task "{task.title}".',
    ]
    if reason:
        lines += ['', 'Reason:', reason]
    lines += ['', f'Log in for more: {settings.FRONTEND_BASE_URL}']

    try:
        send_mail(
            f'A task was deleted: {task.title}',
            '\n'.join(lines),
            settings.DEFAULT_FROM_EMAIL,
            [sender.email],
            fail_silently=False,
        )
        return True
    except Exception:
        logger.exception('Failed to send task deletion email to %s', sender.email)
        return False


def send_task_note_email(note: TaskNote) -> bool:
    """Email the task's sender when the assignee reports a problem or requests a delay."""
    task = note.task
    sender = task.assigned_from or task.transcription.owner
    if sender is None or not sender.email:
        return False

    author = note.author
    author_name = (author.get_full_name() or author.username) if author else 'The assignee'

    kind_labels = {
        TaskNote.KIND_PROBLEM: 'reported a problem with',
        TaskNote.KIND_DELAY: 'requested more time on',
        TaskNote.KIND_NOTE: 'sent an update about',
    }
    action_text = kind_labels.get(note.kind, 'sent an update about')

    subject = f'Update on your task: {task.title}'
    lines = [
        f'Hi {sender.first_name or sender.username},',
        '',
        f'{author_name} {action_text} the task "{task.title}".',
    ]
    if note.requested_due_date:
        lines += ['', f'Proposed new due date: {note.requested_due_date.isoformat()}']
    if note.message:
        lines += ['', 'Message:', note.message]
    lines += ['', f'Log in to review it: {settings.FRONTEND_BASE_URL}']

    try:
        send_mail(
            subject,
            '\n'.join(lines),
            settings.DEFAULT_FROM_EMAIL,
            [sender.email],
            fail_silently=False,
        )
        return True
    except Exception:
        logger.exception('Failed to send task note email to %s', sender.email)
        return False


def send_account_otp_email(otp: AccountChangeOTP, code: str) -> bool:
    """Email a verification code to the account owner. Returns True if it was sent."""
    recipient = otp.user
    if not recipient.email:
        return False

    subject = 'Your Voice To Task verification code'
    lines = [
        f'Hi {recipient.first_name or recipient.username},',
        '',
        'Use this code to confirm changes to your account details:',
        '',
        f'    {code}',
        '',
        f'The code expires in {AccountChangeOTP.TTL_MINUTES} minutes.',
        "If you didn't request this, you can safely ignore this email and your details stay unchanged.",
    ]

    try:
        send_mail(
            subject,
            '\n'.join(lines),
            settings.DEFAULT_FROM_EMAIL,
            [recipient.email],
            fail_silently=False,
        )
        return True
    except Exception:
        logger.exception('Failed to send account OTP email to %s', recipient.email)
        return False


def send_task_assignment_email(task: Task) -> None:
    recipient = task.assigned_to
    if recipient is None or not recipient.email:
        return

    assigner = task.assigned_from
    assigner_name = (assigner.get_full_name() or assigner.username) if assigner else 'Someone'
    due = task.due_date.isoformat() if task.due_date else 'No due date'

    subject = f'New task assigned to you: {task.title}'
    lines = [
        f'Hi {recipient.first_name or recipient.username},',
        '',
        f'{assigner_name} just assigned a task to you on Voice To Task.',
        '',
        f'Title: {task.title}',
        f'Priority: {task.priority}',
        f'Due: {due}',
    ]
    if task.description:
        lines += ['', 'Details:', task.description]
    lines += ['', f'Log in to your workspace to review it: {settings.FRONTEND_BASE_URL}']

    try:
        send_mail(
            subject,
            '\n'.join(lines),
            settings.DEFAULT_FROM_EMAIL,
            [recipient.email],
            fail_silently=False,
        )
    except Exception:
        logger.exception('Failed to send task assignment email to %s', recipient.email)
