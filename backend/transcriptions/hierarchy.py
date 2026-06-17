"""Chain-of-command helpers: who reports to whom, and who may command/oversee whom.

Authority is strict-subtree: a user may assign to and oversee only the people who
report up to them through their own branch (direct + indirect reports). OutSource
staff are a special case — only their single assigned manager may task them, not
that manager's superiors.
"""

from django.contrib.auth.models import User

from .models import UserProfile


def ensure_profile(user: User) -> UserProfile:
    """Return the user's profile, creating a sensible default if one is missing."""
    profile = getattr(user, 'profile', None)
    if profile is not None:
        return profile

    is_admin = user.is_superuser
    return UserProfile.objects.create(
        user=user,
        role=UserProfile.ROLE_ADMIN if is_admin else UserProfile.ROLE_EMPLOYEE,
        requested_role=UserProfile.ROLE_ADMIN if is_admin else UserProfile.ROLE_EMPLOYEE,
        status=UserProfile.STATUS_ACTIVE,
    )


def get_profile(user) -> UserProfile | None:
    if user is None:
        return None
    return getattr(user, 'profile', None)


def is_admin(user) -> bool:
    profile = get_profile(user)
    return bool(user and user.is_superuser) or (profile is not None and profile.role == UserProfile.ROLE_ADMIN)


def get_subordinate_ids(user) -> set[int]:
    """All user ids in `user`'s subtree (transitive reports), excluding `user`."""
    result: set[int] = set()
    frontier = [user.id]
    while frontier:
        manager_ids = frontier
        frontier = []
        children = UserProfile.objects.filter(manager_id__in=manager_ids).values_list('user_id', flat=True)
        for child_id in children:
            if child_id not in result and child_id != user.id:
                result.add(child_id)
                frontier.append(child_id)
    return result


def is_strict_ancestor(ancestor, user) -> bool:
    """True if `ancestor` is somewhere above `user` in the management chain."""
    profile = get_profile(user)
    seen: set[int] = set()
    while profile is not None and profile.manager_id:
        if profile.manager_id == ancestor.id:
            return True
        if profile.manager_id in seen:
            break
        seen.add(profile.manager_id)
        profile = UserProfile.objects.filter(user_id=profile.manager_id).select_related('user').first()
    return False


def get_superiors(user) -> list[User]:
    """The chain of managers above `user`, nearest first (direct manager → … → top)."""
    result: list[User] = []
    profile = get_profile(user)
    seen: set[int] = set()
    while profile is not None and profile.manager_id:
        if profile.manager_id in seen:
            break
        seen.add(profile.manager_id)
        manager = User.objects.filter(id=profile.manager_id).select_related('profile').first()
        if manager is None:
            break
        result.append(manager)
        profile = get_profile(manager)
    return result


def get_approver_chain(requester, target) -> list[User]:
    """Ordered intermediate approvers strictly between `requester` and `target`.

    Walks `requester`'s actual manager chain upward (direct manager first). Every user
    encountered BEFORE `target` is an intermediate approver, returned bottom-up (closest
    to the requester first). `target` itself is never included.

    Ancestry is determined solely by the manager chain — never by role rank (a senior in a
    different branch outranks an employee but is not their ancestor). Raises ValueError if
    `target` is not a strict ancestor of `requester` (peer, subordinate, or different branch),
    or for an invalid requester/target. Returns an empty list when `target` is the
    requester's direct manager (no intermediates).
    """
    if requester is None or target is None or requester.id == target.id:
        raise ValueError('Invalid requester or target for an upward task request.')

    chain: list[User] = []
    seen: set[int] = set()
    profile = get_profile(requester)
    while profile is not None and profile.manager_id:
        manager_id = profile.manager_id
        if manager_id == target.id:
            # Reached the target; everyone collected so far is strictly between.
            return chain
        if manager_id in seen:
            break  # cycle guard
        seen.add(manager_id)
        manager = User.objects.filter(id=manager_id).select_related('profile').first()
        if manager is None:
            break
        chain.append(manager)
        profile = get_profile(manager)

    raise ValueError(
        'You can only request a task for someone directly above you in your chain of command.'
    )


def can_assign(actor, target) -> bool:
    """Can `actor` assign a task to `target`?"""
    if actor is None or target is None or actor.id == target.id:
        return False

    target_profile = get_profile(target)
    actor_profile = get_profile(actor)
    if target_profile is None or actor_profile is None:
        return False
    if target_profile.status != UserProfile.STATUS_ACTIVE:
        return False

    # OutSource staff only ever take tasks from their single assigned manager.
    if target_profile.role == UserProfile.ROLE_OUTSOURCE:
        return target_profile.manager_id == actor.id

    # Admins can command anyone active.
    if is_admin(actor):
        return True

    # Everyone else: target must report up to actor through the chain.
    return is_strict_ancestor(actor, target)


def get_assignable_users(actor) -> list[User]:
    """The active users `actor` may assign tasks to."""
    if is_admin(actor):
        candidates = User.objects.filter(profile__status=UserProfile.STATUS_ACTIVE).exclude(id=actor.id)
        return [u for u in candidates.select_related('profile') if not u.is_superuser]

    sub_ids = get_subordinate_ids(actor)
    if not sub_ids:
        return []
    users = User.objects.filter(id__in=sub_ids, profile__status=UserProfile.STATUS_ACTIVE).select_related('profile')
    result = []
    for user in users:
        profile = user.profile
        # OutSource only assignable by their direct manager, not by superiors above that manager.
        if profile.role == UserProfile.ROLE_OUTSOURCE and profile.manager_id != actor.id:
            continue
        result.append(user)
    return result


def get_overseen_user_ids(user) -> set[int]:
    """User ids whose tasks `user` may view/act on as a superior (their whole subtree)."""
    if is_admin(user):
        return set(User.objects.exclude(id=user.id).values_list('id', flat=True))
    return get_subordinate_ids(user)


def can_oversee_task(actor, task) -> bool:
    """Can `actor` reassign/delete this task as a superior of its participants?"""
    if is_admin(actor):
        return True
    overseen = get_overseen_user_ids(actor)
    participants = {task.assigned_to_id, task.assigned_from_id, task.transcription.owner_id}
    return bool(participants & overseen)
