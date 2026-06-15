'use client';

import { useEffect, useState } from 'react';
import {
  approveUser,
  changeUserRole,
  deleteUser,
  getAdminUsers,
  parseApiError,
  rejectUser,
  ASSIGNABLE_ROLES,
  type AdminUser,
  type Role,
} from '@/lib/api';

const ALL_ROLE_OPTIONS: { value: Role; label: string }[] = [
  { value: 'admin', label: 'Admin' },
  ...ASSIGNABLE_ROLES,
];

function RegistrationCard({
  user,
  activeUsers,
  token,
  onChanged,
}: {
  user: AdminUser;
  activeUsers: AdminUser[];
  token: string;
  onChanged: () => Promise<void>;
}) {
  const isOutsource = user.requested_role === 'outsource_staff';
  const [role, setRole] = useState<Role>(isOutsource ? 'outsource_staff' : user.requested_role);
  const [managerId, setManagerId] = useState('');
  const [reason, setReason] = useState('');
  const [permanent, setPermanent] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState('');

  async function approve() {
    try {
      setIsBusy(true);
      setError('');
      const payload: { role?: Role; manager_id?: number | null } = {};
      if (!isOutsource) {
        payload.role = role;
        payload.manager_id = managerId ? Number(managerId) : null;
      }
      await approveUser(user.id, payload, token);
      await onChanged();
    } catch (approveError) {
      setError(parseApiError(approveError).detail || 'Could not approve this registration.');
    } finally {
      setIsBusy(false);
    }
  }

  async function reject() {
    try {
      setIsBusy(true);
      setError('');
      await rejectUser(user.id, { reason: reason.trim(), permanent }, token);
      await onChanged();
    } catch (rejectError) {
      setError(parseApiError(rejectError).detail || 'Could not reject this registration.');
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <div className="adminCard">
      <div className="taskTopRow">
        <strong>{user.username}</strong>
        <span className="noteTag noteTag-note">{user.requested_role_display}</span>
      </div>
      <p className="metaText">
        {[user.first_name, user.last_name].filter(Boolean).join(' ') || '—'} • {user.email}
      </p>

      {isOutsource ? (
        <p className="metaText">
          OutSource staff — will be attached to <strong>{user.requested_manager_name}</strong> (the
          person they chose; cannot be changed).
        </p>
      ) : (
        <>
          <label className="fieldGroup">
            <span>Approve as role</span>
            <select
              className="textInput"
              value={role}
              onChange={(event) => setRole(event.target.value as Role)}
              disabled={isBusy}
            >
              {ASSIGNABLE_ROLES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="fieldGroup">
            <span>Reports to (direct manager)</span>
            <select
              className="textInput"
              value={managerId}
              onChange={(event) => setManagerId(event.target.value)}
              disabled={isBusy}
            >
              <option value="">— None (top of chain) —</option>
              {activeUsers
                .filter((candidate) => candidate.id !== user.id)
                .map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.username} ({candidate.role_display})
                  </option>
                ))}
            </select>
          </label>
        </>
      )}

      <div className="modalActionRow">
        <button type="button" className="primaryButton" onClick={() => void approve()} disabled={isBusy}>
          Approve
        </button>
      </div>

      <label className="fieldGroup">
        <span>Rejection message (optional, emailed to them)</span>
        <textarea
          className="textInput textAreaInput"
          rows={2}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          disabled={isBusy}
        />
      </label>
      <label className="checkboxRow">
        <input
          type="checkbox"
          checked={permanent}
          onChange={(event) => setPermanent(event.target.checked)}
          disabled={isBusy}
        />
        <span>Permanent rejection — they can never apply again with this email</span>
      </label>
      <div className="modalActionRow">
        <button type="button" className="secondaryButton" onClick={() => void reject()} disabled={isBusy}>
          Reject
        </button>
      </div>

      {error ? <p className="errorText">{error}</p> : null}
    </div>
  );
}

function UserRow({
  user,
  activeUsers,
  token,
  onChanged,
}: {
  user: AdminUser;
  activeUsers: AdminUser[];
  token: string;
  onChanged: () => Promise<void>;
}) {
  const [role, setRole] = useState<Role>(user.role);
  const [managerId, setManagerId] = useState(user.manager?.id ? String(user.manager.id) : '');
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteReason, setDeleteReason] = useState('');
  const [notify, setNotify] = useState(false);

  async function save() {
    try {
      setIsBusy(true);
      setError('');
      setInfo('');
      await changeUserRole(
        user.id,
        { role, manager_id: managerId ? Number(managerId) : null },
        token
      );
      setInfo('Saved.');
      await onChanged();
    } catch (saveError) {
      setError(parseApiError(saveError).detail || 'Could not save changes.');
    } finally {
      setIsBusy(false);
    }
  }

  async function remove() {
    try {
      setIsBusy(true);
      setError('');
      setInfo('');
      await deleteUser(user.id, { reason: deleteReason.trim(), notify }, token);
      await onChanged();
    } catch (deleteError) {
      setError(parseApiError(deleteError).detail || 'Could not delete this user.');
      setIsBusy(false);
    }
  }

  return (
    <div className="adminCard">
      <div className="taskTopRow">
        <strong>{user.username}</strong>
        <span className={`status status-task-${user.status === 'active' ? 'done' : 'delivered'}`}>
          {user.status_display}
        </span>
      </div>
      <p className="metaText">{user.email}</p>

      <label className="fieldGroup">
        <span>Role</span>
        <select
          className="textInput"
          value={role}
          onChange={(event) => setRole(event.target.value as Role)}
          disabled={isBusy}
        >
          {ALL_ROLE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label className="fieldGroup">
        <span>Reports to</span>
        <select
          className="textInput"
          value={managerId}
          onChange={(event) => setManagerId(event.target.value)}
          disabled={isBusy}
        >
          <option value="">— None (top of chain) —</option>
          {activeUsers
            .filter((candidate) => candidate.id !== user.id)
            .map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.username} ({candidate.role_display})
              </option>
            ))}
        </select>
      </label>

      <div className="modalActionRow">
        <button type="button" className="secondaryButton" onClick={() => void save()} disabled={isBusy}>
          Save
        </button>
        {!confirmingDelete ? (
          <button
            type="button"
            className="dangerButton"
            onClick={() => {
              setConfirmingDelete(true);
              setError('');
              setInfo('');
            }}
            disabled={isBusy}
          >
            Delete user
          </button>
        ) : null}
        {info ? <span className="successText">{info}</span> : null}
      </div>

      {confirmingDelete ? (
        <div className="deleteConfirm">
          <p className="metaText">
            Permanently delete <strong>{user.username}</strong> and everything they own (profile,
            tasks, transcripts). This cannot be undone.
          </p>
          <label className="fieldGroup">
            <span>Reason (optional{user.email ? ', included in the email' : ''})</span>
            <textarea
              className="textInput textAreaInput"
              rows={2}
              value={deleteReason}
              onChange={(event) => setDeleteReason(event.target.value)}
              disabled={isBusy}
            />
          </label>
          <label className="checkboxRow">
            <input
              type="checkbox"
              checked={notify}
              onChange={(event) => setNotify(event.target.checked)}
              disabled={isBusy || !user.email}
            />
            <span>
              {user.email
                ? `Email ${user.email} to let them know`
                : 'No email on file — cannot notify this user'}
            </span>
          </label>
          <div className="modalActionRow">
            <button
              type="button"
              className="dangerButton"
              onClick={() => void remove()}
              disabled={isBusy}
            >
              {isBusy ? 'Deleting…' : 'Confirm delete'}
            </button>
            <button
              type="button"
              className="ghostButton"
              onClick={() => setConfirmingDelete(false)}
              disabled={isBusy}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {error ? <p className="errorText">{error}</p> : null}
    </div>
  );
}

const ROLE_RANK: Record<Role, number> = {
  admin: 100,
  manager: 40,
  senior_team_leader: 30,
  junior_team_leader: 20,
  employee: 10,
  outsource_staff: 5,
};

function TreeNode({
  user,
  childrenByManager,
  seen,
}: {
  user: AdminUser;
  childrenByManager: Map<number, AdminUser[]>;
  seen: Set<number>;
}) {
  if (seen.has(user.id)) {
    return null;
  }
  const children = [...(childrenByManager.get(user.id) ?? [])].sort(
    (a, b) => ROLE_RANK[b.role] - ROLE_RANK[a.role] || a.username.localeCompare(b.username)
  );
  const nextSeen = new Set(seen);
  nextSeen.add(user.id);

  return (
    <li>
      <div className={`treeNode treeNode-${user.role}`}>
        <strong>{user.username}</strong>
        <span className="treeRole">{user.role_display}</span>
      </div>
      {children.length > 0 ? (
        <ul>
          {children.map((child) => (
            <TreeNode
              key={child.id}
              user={child}
              childrenByManager={childrenByManager}
              seen={nextSeen}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function UnassignedChip({
  user,
  activeUsers,
  token,
  onChanged,
}: {
  user: AdminUser;
  activeUsers: AdminUser[];
  token: string;
  onChanged: () => Promise<void>;
}) {
  const [managerId, setManagerId] = useState('');
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState('');

  async function place() {
    if (!managerId) {
      return;
    }
    try {
      setIsBusy(true);
      setError('');
      await changeUserRole(user.id, { role: user.role, manager_id: Number(managerId) }, token);
      await onChanged();
    } catch (placeError) {
      setError(parseApiError(placeError).detail || 'Could not place this user.');
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <div className="unassignedChip">
      <div className="unassignedChipHead">
        <strong>{user.username}</strong>
        <span className="treeRole">{user.role_display}</span>
      </div>
      <select
        className="textInput"
        value={managerId}
        onChange={(event) => setManagerId(event.target.value)}
        disabled={isBusy}
      >
        <option value="">Place under…</option>
        {activeUsers
          .filter((candidate) => candidate.id !== user.id)
          .map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.username} ({candidate.role_display})
            </option>
          ))}
      </select>
      <button
        type="button"
        className="secondaryButton"
        onClick={() => void place()}
        disabled={isBusy || !managerId}
      >
        Place in tree
      </button>
      {error ? <p className="errorText">{error}</p> : null}
    </div>
  );
}

function HierarchyView({
  users,
  activeUsers,
  token,
  onChanged,
}: {
  users: AdminUser[];
  activeUsers: AdminUser[];
  token: string;
  onChanged: () => Promise<void>;
}) {
  const activeIds = new Set(activeUsers.map((candidate) => candidate.id));
  const childrenByManager = new Map<number, AdminUser[]>();
  activeUsers.forEach((candidate) => {
    const managerId = candidate.manager?.id;
    if (managerId && activeIds.has(managerId)) {
      const siblings = childrenByManager.get(managerId) ?? [];
      siblings.push(candidate);
      childrenByManager.set(managerId, siblings);
    }
  });

  const hasChildren = (id: number) => (childrenByManager.get(id)?.length ?? 0) > 0;
  const isRooted = (candidate: AdminUser) =>
    !candidate.manager?.id || !activeIds.has(candidate.manager.id);

  const roots = activeUsers
    .filter((candidate) => isRooted(candidate) && (hasChildren(candidate.id) || candidate.role === 'admin'))
    .sort((a, b) => ROLE_RANK[b.role] - ROLE_RANK[a.role] || a.username.localeCompare(b.username));

  const unassigned = activeUsers
    .filter((candidate) => isRooted(candidate) && !hasChildren(candidate.id) && candidate.role !== 'admin')
    .sort((a, b) => ROLE_RANK[b.role] - ROLE_RANK[a.role] || a.username.localeCompare(b.username));

  return (
    <div className="hierarchyLayout">
      <div className="treeWrap">
        {roots.length === 0 ? (
          <p className="metaText">No reporting lines yet. Assign managers to build the tree.</p>
        ) : (
          <div className="tree">
            <ul>
              {roots.map((root) => (
                <TreeNode
                  key={root.id}
                  user={root}
                  childrenByManager={childrenByManager}
                  seen={new Set()}
                />
              ))}
            </ul>
          </div>
        )}
      </div>

      <aside className="unassignedPanel">
        <p className="taskHeading">Not linked yet ({unassigned.length})</p>
        {unassigned.length === 0 ? (
          <p className="metaText">Everyone active is placed in the tree.</p>
        ) : (
          unassigned.map((candidate) => (
            <UnassignedChip
              key={candidate.id}
              user={candidate}
              activeUsers={activeUsers}
              token={token}
              onChanged={onChanged}
            />
          ))
        )}
      </aside>
    </div>
  );
}

export function AdminPanel({ token }: { token: string }) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<'pending' | 'all' | 'tree'>('pending');

  async function load() {
    try {
      setIsLoading(true);
      setError('');
      const response = await getAdminUsers(token);
      setUsers(response.users);
    } catch (loadError) {
      setError(parseApiError(loadError).detail || 'Could not load users.');
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const pending = users.filter((candidate) => candidate.status === 'pending');
  const activeUsers = users.filter((candidate) => candidate.status === 'active');

  return (
    <section className="listSection">
      <div className="authToggleRow">
        <button
          type="button"
          className={tab === 'pending' ? 'primaryButton' : 'ghostButton'}
          onClick={() => setTab('pending')}
        >
          Pending ({pending.length})
        </button>
        <button
          type="button"
          className={tab === 'all' ? 'primaryButton' : 'ghostButton'}
          onClick={() => setTab('all')}
        >
          All users ({users.length})
        </button>
        <button
          type="button"
          className={tab === 'tree' ? 'primaryButton' : 'ghostButton'}
          onClick={() => setTab('tree')}
        >
          Hierarchy
        </button>
        <button type="button" className="ghostButton" onClick={() => void load()} disabled={isLoading}>
          Refresh
        </button>
      </div>

      {isLoading ? (
        <p className="metaText">Loading users…</p>
      ) : error ? (
        <p className="errorText">{error}</p>
      ) : tab === 'tree' ? (
        <HierarchyView users={users} activeUsers={activeUsers} token={token} onChanged={load} />
      ) : (
        <div className="adminPageGrid">
          {tab === 'pending' ? (
            pending.length === 0 ? (
              <p className="metaText">No registrations are waiting for approval.</p>
            ) : (
              pending.map((candidate) => (
                <RegistrationCard
                  key={candidate.id}
                  user={candidate}
                  activeUsers={activeUsers}
                  token={token}
                  onChanged={load}
                />
              ))
            )
          ) : (
            users.map((candidate) => (
              <UserRow
                key={candidate.id}
                user={candidate}
                activeUsers={activeUsers}
                token={token}
                onChanged={load}
              />
            ))
          )}
        </div>
      )}
    </section>
  );
}
