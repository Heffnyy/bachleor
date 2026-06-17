from datetime import timedelta

from django.conf import settings
from django.contrib.auth.hashers import check_password, make_password
from django.db import models
from django.utils import timezone
from django.utils.crypto import get_random_string


class RequestPermissionError(ValueError):
    """Raised when a user acts on a request it's not their turn/right to act on (-> HTTP 403)."""


class RequestStateError(ValueError):
    """Raised when a request transition isn't valid for its current status (-> HTTP 400)."""


class UserProfile(models.Model):
    """Role, chain-of-command position, and approval state for each user."""

    ROLE_ADMIN = 'admin'
    ROLE_MANAGER = 'manager'
    ROLE_SENIOR = 'senior_team_leader'
    ROLE_JUNIOR = 'junior_team_leader'
    ROLE_EMPLOYEE = 'employee'
    ROLE_OUTSOURCE = 'outsource_staff'
    ROLE_CHOICES = [
        (ROLE_ADMIN, 'Admin'),
        (ROLE_MANAGER, 'Manager'),
        (ROLE_SENIOR, 'Senior Team Leader'),
        (ROLE_JUNIOR, 'Junior Team Leader'),
        (ROLE_EMPLOYEE, 'Employee'),
        (ROLE_OUTSOURCE, 'OutSource Staff'),
    ]
    # Higher rank can command lower rank. OutSource sits outside the normal ladder.
    ROLE_RANK = {
        ROLE_ADMIN: 100,
        ROLE_MANAGER: 40,
        ROLE_SENIOR: 30,
        ROLE_JUNIOR: 20,
        ROLE_EMPLOYEE: 10,
        ROLE_OUTSOURCE: 5,
    }
    # Roles a person is allowed to self-select when registering (admin is granted, never applied for).
    SELF_REGISTER_ROLES = [ROLE_MANAGER, ROLE_SENIOR, ROLE_JUNIOR, ROLE_EMPLOYEE, ROLE_OUTSOURCE]

    STATUS_PENDING = 'pending'
    STATUS_ACTIVE = 'active'
    STATUS_REJECTED = 'rejected'
    STATUS_PERMANENTLY_REJECTED = 'permanently_rejected'
    STATUS_CHOICES = [
        (STATUS_PENDING, 'Pending approval'),
        (STATUS_ACTIVE, 'Active'),
        (STATUS_REJECTED, 'Rejected'),
        (STATUS_PERMANENTLY_REJECTED, 'Permanently rejected'),
    ]

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        related_name='profile',
        on_delete=models.CASCADE,
    )
    role = models.CharField(max_length=32, choices=ROLE_CHOICES, default=ROLE_EMPLOYEE)
    requested_role = models.CharField(max_length=32, choices=ROLE_CHOICES, default=ROLE_EMPLOYEE)
    manager = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        related_name='subordinates',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
    )
    requested_manager_name = models.CharField(max_length=150, blank=True)
    status = models.CharField(max_length=32, choices=STATUS_CHOICES, default=STATUS_PENDING)
    rejection_reason = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    @property
    def rank(self) -> int:
        return self.ROLE_RANK.get(self.role, 0)

    @property
    def is_admin(self) -> bool:
        return self.role == self.ROLE_ADMIN or self.user.is_superuser

    @property
    def is_outsource(self) -> bool:
        return self.role == self.ROLE_OUTSOURCE

    def __str__(self) -> str:
        return f'{self.user.username} ({self.get_role_display()}, {self.status})'


class AccountChangeOTP(models.Model):
    """A one-time code emailed to a user before they can edit their account details."""

    CODE_LENGTH = 6
    TTL_MINUTES = 10
    MAX_ATTEMPTS = 5

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        related_name='account_otps',
        on_delete=models.CASCADE,
    )
    code_hash = models.CharField(max_length=128)
    verification_token = models.CharField(max_length=64, blank=True)
    is_verified = models.BooleanField(default=False)
    is_consumed = models.BooleanField(default=False)
    attempts = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()

    class Meta:
        ordering = ['-created_at']

    @classmethod
    def issue(cls, user) -> tuple['AccountChangeOTP', str]:
        """Invalidate any outstanding codes and create a fresh one. Returns (otp, plain_code)."""
        cls.objects.filter(user=user, is_consumed=False).update(is_consumed=True)
        plain_code = ''.join(get_random_string(1, '0123456789') for _ in range(cls.CODE_LENGTH))
        otp = cls.objects.create(
            user=user,
            code_hash=make_password(plain_code),
            expires_at=timezone.now() + timedelta(minutes=cls.TTL_MINUTES),
        )
        return otp, plain_code

    def is_expired(self) -> bool:
        return timezone.now() >= self.expires_at

    def check_code(self, raw_code: str) -> bool:
        return check_password(raw_code, self.code_hash)

    def mark_verified(self) -> str:
        self.is_verified = True
        self.verification_token = get_random_string(48)
        self.save(update_fields=['is_verified', 'verification_token'])
        return self.verification_token

    def __str__(self) -> str:
        return f'OTP for {self.user} ({"used" if self.is_consumed else "active"})'


class Transcription(models.Model):
    STATUS_PENDING = 'pending'
    STATUS_COMPLETED = 'completed'
    STATUS_FAILED = 'failed'
    STATUS_CHOICES = [
        (STATUS_PENDING, 'Pending'),
        (STATUS_COMPLETED, 'Completed'),
        (STATUS_FAILED, 'Failed'),
    ]

    SOURCE_AUDIO = 'audio'
    SOURCE_TEXT = 'text'
    SOURCE_CHOICES = [
        (SOURCE_AUDIO, 'Audio'),
        (SOURCE_TEXT, 'Text'),
    ]

    # Blank for text-origin records (e.g. an approved upward task request has no audio).
    original_file = models.FileField(upload_to='audio/', blank=True)
    original_filename = models.CharField(max_length=255)
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        related_name='transcriptions',
        on_delete=models.CASCADE,
        null=True,
        blank=True,
    )
    source = models.CharField(max_length=8, choices=SOURCE_CHOICES, default=SOURCE_AUDIO)
    detected_language = models.CharField(max_length=16, blank=True)
    transcript = models.TextField(blank=True)
    duration_seconds = models.DecimalField(max_digits=8, decimal_places=2, null=True, blank=True)
    status = models.CharField(max_length=32, choices=STATUS_CHOICES, default=STATUS_PENDING)
    error_message = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']

    def delete(self, *args, **kwargs):
        storage = self.original_file.storage
        file_name = self.original_file.name
        super().delete(*args, **kwargs)
        if file_name:
            storage.delete(file_name)

    def __str__(self) -> str:
        return f'{self.original_filename} ({self.status})'


class Task(models.Model):
    PRIORITY_LOW = 'low'
    PRIORITY_MEDIUM = 'medium'
    PRIORITY_HIGH = 'high'
    PRIORITY_CHOICES = [
        (PRIORITY_LOW, 'Low'),
        (PRIORITY_MEDIUM, 'Medium'),
        (PRIORITY_HIGH, 'High'),
    ]

    STATUS_DELIVERED = 'delivered'
    STATUS_IN_PROGRESS = 'in_progress'
    STATUS_DONE = 'done'
    STATUS_CHOICES = [
        (STATUS_DELIVERED, 'Pending'),
        (STATUS_IN_PROGRESS, 'In progress'),
        (STATUS_DONE, 'Done'),
    ]

    transcription = models.ForeignKey(Transcription, related_name='tasks', on_delete=models.CASCADE)
    title = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    priority = models.CharField(max_length=16, choices=PRIORITY_CHOICES, default=PRIORITY_MEDIUM)
    status = models.CharField(max_length=16, choices=STATUS_CHOICES, default=STATUS_DELIVERED)
    assigned_to = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        related_name='assigned_tasks',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
    )
    assigned_to_name = models.CharField(max_length=150, blank=True)
    assigned_from = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        related_name='created_tasks',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
    )
    due_date = models.DateField(null=True, blank=True)
    is_reviewed = models.BooleanField(default=False)
    is_completed = models.BooleanField(default=False)
    completed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['id']

    def __str__(self) -> str:
        return self.title


class TaskNote(models.Model):
    """A message the assignee sends back to the task's sender (e.g. a problem or a delay request)."""

    KIND_PROBLEM = 'problem'
    KIND_DELAY = 'delay'
    KIND_NOTE = 'note'
    KIND_CHOICES = [
        (KIND_PROBLEM, 'Problem'),
        (KIND_DELAY, 'Delay request'),
        (KIND_NOTE, 'Note'),
    ]

    task = models.ForeignKey(Task, related_name='notes', on_delete=models.CASCADE)
    author = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        related_name='task_notes',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
    )
    kind = models.CharField(max_length=16, choices=KIND_CHOICES, default=KIND_NOTE)
    message = models.TextField(blank=True)
    requested_due_date = models.DateField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self) -> str:
        return f'{self.get_kind_display()} on {self.task_id}'


class TaskAssignmentRequest(models.Model):
    """A request to assign a task UP the chain of command, approved sequentially.

    `approver_chain` holds the ordered intermediate user IDs (the requester's manager,
    then that manager's manager, ... up to but excluding the target). They approve
    bottom-up (closest to the requester first). When the last intermediate approves, the
    Task is created and assigned to the target. For a direct-manager request there are no
    intermediates, so the target approves it (and becomes the assignee).
    """

    STATUS_PENDING = 'pending'
    STATUS_APPROVED = 'approved'
    STATUS_REJECTED = 'rejected'
    STATUS_CANCELLED = 'cancelled'
    STATUS_CHOICES = [
        (STATUS_PENDING, 'Pending'),
        (STATUS_APPROVED, 'Approved'),
        (STATUS_REJECTED, 'Rejected'),
        (STATUS_CANCELLED, 'Cancelled'),
    ]

    requester = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        related_name='submitted_task_requests',
        on_delete=models.CASCADE,
    )
    target = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        related_name='incoming_task_requests',
        on_delete=models.CASCADE,
    )

    # Proposed task fields — mirror Task so the Task can be built from them on approval.
    title = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    priority = models.CharField(
        max_length=16, choices=Task.PRIORITY_CHOICES, default=Task.PRIORITY_MEDIUM
    )
    due_date = models.DateField(null=True, blank=True)

    status = models.CharField(max_length=16, choices=STATUS_CHOICES, default=STATUS_PENDING)
    # Ordered intermediate approver user IDs (excludes the target).
    approver_chain = models.JSONField(default=list)
    current_approver = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        related_name='pending_task_request_approvals',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
    )

    rejection_reason = models.TextField(blank=True)
    rejected_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        related_name='rejected_task_requests',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
    )
    created_task = models.ForeignKey(
        Task,
        related_name='origin_request',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self) -> str:
        return f'Request {self.id}: {self.requester_id} -> {self.target_id} ({self.status})'

    # --- transition helpers -------------------------------------------------
    # These mutate state only; the view layer fires notifications based on what
    # they return, so the model never imports notifications (avoids a cycle).

    def _next_approver_id(self, after_user_id: int):
        """The next approver ID after `after_user_id` in the chain, or None if that was
        the last intermediate (or the target in the empty-chain case) → time to finalize."""
        chain = list(self.approver_chain or [])
        if after_user_id in chain:
            idx = chain.index(after_user_id)
            if idx + 1 < len(chain):
                return chain[idx + 1]
        return None

    def _create_task(self) -> 'Task':
        """Build the real Task assigned to the target, backed by a text-origin
        Transcription that carries the requester's typed title/description."""
        content = '\n\n'.join(part for part in (self.title, self.description) if part).strip()
        transcription = Transcription.objects.create(
            owner=self.requester,
            original_filename='Upward task request',
            source=Transcription.SOURCE_TEXT,
            status=Transcription.STATUS_COMPLETED,
            detected_language='text',
            transcript=content,
        )
        return Task.objects.create(
            transcription=transcription,
            title=self.title,
            description=self.description,
            priority=self.priority,
            due_date=self.due_date,
            assigned_to=self.target,
            assigned_to_name=self.target.username,
            assigned_from=self.requester,
            is_reviewed=True,
        )

    def approve(self, user) -> 'TaskAssignmentRequest':
        """Current approver approves. Either advances to the next approver, or — if this
        was the last one — creates the Task assigned to the target and marks approved.
        Raises ValueError if it's not this user's turn or the request isn't pending."""
        if self.status != self.STATUS_PENDING:
            raise RequestStateError('This request is no longer pending.')
        if self.current_approver_id != user.id:
            raise RequestPermissionError('It is not your turn to approve this request.')

        next_id = self._next_approver_id(user.id)
        if next_id is not None:
            self.current_approver_id = next_id
            self.save(update_fields=['current_approver', 'updated_at'])
            return self  # advanced; current_approver is the next person

        # No one left in the chain → finalize: create the task assigned to the target.
        task = self._create_task()
        self.created_task = task
        self.status = self.STATUS_APPROVED
        self.current_approver = None
        self.save(update_fields=['created_task', 'status', 'current_approver', 'updated_at'])
        return self

    def reject(self, user, reason: str = '') -> 'TaskAssignmentRequest':
        """Current approver rejects → stops the whole request immediately."""
        if self.status != self.STATUS_PENDING:
            raise RequestStateError('This request is no longer pending.')
        if self.current_approver_id != user.id:
            raise RequestPermissionError('It is not your turn to act on this request.')
        self.status = self.STATUS_REJECTED
        self.rejection_reason = (reason or '').strip()
        self.rejected_by = user
        self.current_approver = None
        self.save(
            update_fields=['status', 'rejection_reason', 'rejected_by', 'current_approver', 'updated_at']
        )
        return self

    def cancel(self, user) -> 'TaskAssignmentRequest':
        """Requester cancels their own request while it is still pending."""
        if self.status != self.STATUS_PENDING:
            raise RequestStateError('Only a pending request can be cancelled.')
        if self.requester_id != user.id:
            raise RequestPermissionError('Only the requester can cancel this request.')
        self.status = self.STATUS_CANCELLED
        self.current_approver = None
        self.save(update_fields=['status', 'current_approver', 'updated_at'])
        return self
