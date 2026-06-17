export type Role =
  | 'admin'
  | 'manager'
  | 'senior_team_leader'
  | 'junior_team_leader'
  | 'employee'
  | 'outsource_staff';

export type UserStatus = 'pending' | 'active' | 'rejected' | 'permanently_rejected';

export const SELF_REGISTER_ROLES: { value: Role; label: string }[] = [
  { value: 'manager', label: 'Manager' },
  { value: 'senior_team_leader', label: 'Senior Team Leader' },
  { value: 'junior_team_leader', label: 'Junior Team Leader' },
  { value: 'employee', label: 'Employee' },
  { value: 'outsource_staff', label: 'OutSource Staff' },
];

export const ASSIGNABLE_ROLES: { value: Role; label: string }[] = [
  { value: 'manager', label: 'Manager' },
  { value: 'senior_team_leader', label: 'Senior Team Leader' },
  { value: 'junior_team_leader', label: 'Junior Team Leader' },
  { value: 'employee', label: 'Employee' },
  { value: 'outsource_staff', label: 'OutSource Staff' },
];

export type User = {
  id: number;
  username: string;
  first_name: string;
  last_name: string;
  role?: Role | null;
  role_display?: string | null;
};

export type ManagerRef = {
  id: number;
  username: string;
  role?: Role | null;
  role_display?: string | null;
};

export type AdminUser = {
  id: number;
  username: string;
  first_name: string;
  last_name: string;
  email: string;
  role: Role;
  role_display: string;
  status: UserStatus;
  status_display: string;
  requested_role: Role;
  requested_role_display: string;
  requested_manager_name: string;
  manager: ManagerRef | null;
  rejection_reason: string;
  date_joined: string;
};

export type TaskStatus = 'delivered' | 'in_progress' | 'done';
export type TaskNoteKind = 'problem' | 'delay' | 'note';

export type TaskNote = {
  id: number;
  kind: TaskNoteKind;
  message: string;
  requested_due_date: string | null;
  author: User | null;
  created_at: string;
};

export type Task = {
  id: number;
  transcription: {
    id: number;
    original_filename: string;
    audio_url: string | null;
  };
  title: string;
  description: string;
  priority: 'low' | 'medium' | 'high';
  status: TaskStatus;
  due_date: string | null;
  assigned_to: User | null;
  assigned_to_name: string;
  assigned_from: User | null;
  is_reviewed: boolean;
  is_completed: boolean;
  completed_at: string | null;
  notes: TaskNote[];
  created_at: string;
};

export type Transcript = {
  id: number;
  original_filename: string;
  owner: User | null;
  detected_language: string;
  transcript: string;
  duration_seconds: string | null;
  status: 'pending' | 'completed' | 'failed';
  error_message: string;
  audio_url: string | null;
  tasks: Task[];
  created_at: string;
  updated_at: string;
};

export type AuthResponse = {
  token: string;
  user: User;
};

export type AccountDetails = {
  id: number;
  username: string;
  first_name: string;
  last_name: string;
  email: string;
  role?: Role;
  role_display?: string;
  status?: UserStatus;
  manager?: { id: number; username: string; role_display: string | null } | null;
};

export type AccountUpdatePayload = {
  username?: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  password?: string;
};

export type DashboardData = {
  user: User;
  account: AccountDetails;
  is_admin: boolean;
  pending_count: number;
  my_voice_messages: Transcript[];
  assigned_tasks: Task[];
  team_tasks: Task[];
  available_users: User[];
  superiors: User[];
};

export type TaskClarificationResponse = {
  task: Task;
  transcribed_reply: string;
};

export type TaskCompletionResponse = {
  task: Task;
};

type AuthPayload = {
  username: string;
  password: string;
  first_name?: string;
  last_name?: string;
  email?: string;
};

export type RegisterPayload = {
  username: string;
  password: string;
  first_name?: string;
  last_name?: string;
  email: string;
  requested_role: Role;
  requested_manager_name?: string;
};

export type RegisterResponse = {
  detail: string;
  status: string;
};

export type ApiErrorPayload = {
  detail?: string;
  code?: string;
  [key: string]: unknown;
};

export function parseApiError(error: unknown): ApiErrorPayload {
  if (!(error instanceof Error)) {
    return { detail: 'Something went wrong. Please try again.' };
  }
  try {
    const parsed = JSON.parse(error.message);
    if (parsed && typeof parsed === 'object') {
      return parsed as ApiErrorPayload;
    }
    return { detail: String(parsed) };
  } catch {
    return { detail: error.message };
  }
}

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL;

if (!API_BASE_URL) {
  throw new Error(
    'Missing required environment variable NEXT_PUBLIC_API_BASE_URL. ' +
      'Set it to the backend API base URL (including the /api suffix), ' +
      'e.g. https://your-backend.example.com/api. For local development, ' +
      'define it in frontend/.env.local.'
  );
}

async function request<T>(path: string, init?: RequestInit, token?: string): Promise<T> {
  const headers = new Headers(init?.headers);

  if (token) {
    headers.set('Authorization', `Token ${token}`);
  }

  if (!(init?.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers,
    cache: 'no-store',
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || 'Request failed');
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json();
}

export function register(payload: RegisterPayload): Promise<RegisterResponse> {
  return request<RegisterResponse>('/auth/register/', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function login(payload: Pick<AuthPayload, 'username' | 'password'>): Promise<AuthResponse> {
  return request<AuthResponse>('/auth/login/', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function logout(token: string): Promise<void> {
  return request<void>(
    '/auth/logout/',
    {
      method: 'POST',
    },
    token
  );
}

export async function getMe(token: string): Promise<User> {
  const payload = await request<{ user: User }>('/auth/me/', undefined, token);
  return payload.user;
}

export function getDashboard(token: string): Promise<DashboardData> {
  return request<DashboardData>('/dashboard/', undefined, token);
}

export async function getAccount(token: string): Promise<AccountDetails> {
  const payload = await request<{ user: AccountDetails }>('/account/', undefined, token);
  return payload.user;
}

export function requestAccountOtp(token: string): Promise<{ detail: string }> {
  return request<{ detail: string }>('/account/otp/request/', { method: 'POST' }, token);
}

export function verifyAccountOtp(code: string, token: string): Promise<{ verification_token: string }> {
  return request<{ verification_token: string }>(
    '/account/otp/verify/',
    {
      method: 'POST',
      body: JSON.stringify({ code }),
    },
    token
  );
}

export async function updateAccount(
  payload: AccountUpdatePayload,
  verificationToken: string,
  token: string
): Promise<AccountDetails> {
  const result = await request<{ user: AccountDetails }>(
    '/account/update/',
    {
      method: 'PATCH',
      body: JSON.stringify({ ...payload, verification_token: verificationToken }),
    },
    token
  );
  return result.user;
}

export type TaskRouting = {
  assigned_down: string[];
  upward_requests: { target: string; current_approver: string | null; title: string }[];
  unidentified: string[];
  unroutable: string[];
};

export type UploadResult = Transcript & { routing?: TaskRouting };

export function uploadAudio(
  file: File,
  token: string,
  language: '' | 'ar' | 'en' = ''
): Promise<UploadResult> {
  const formData = new FormData();
  formData.append('file', file);
  if (language) {
    formData.append('language', language);
  }

  return request<UploadResult>(
    '/transcriptions/',
    {
      method: 'POST',
      body: formData,
    },
    token
  );
}

export function clarifyTask(
  taskId: number,
  payload: FormData,
  token: string
): Promise<TaskClarificationResponse> {
  return request<TaskClarificationResponse>(
    `/tasks/${taskId}/clarify/`,
    {
      method: 'POST',
      body: payload,
    },
    token
  );
}

export function completeTask(taskId: number, token: string): Promise<TaskCompletionResponse> {
  return request<TaskCompletionResponse>(
    `/tasks/${taskId}/complete/`,
    {
      method: 'POST',
    },
    token
  );
}

export function setTaskStatus(
  taskId: number,
  status: TaskStatus,
  token: string
): Promise<{ task: Task }> {
  return request<{ task: Task }>(
    `/tasks/${taskId}/status/`,
    {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    },
    token
  );
}

export type TaskNotePayload = {
  kind: TaskNoteKind;
  message?: string;
  requested_due_date?: string | null;
};

export function notifyTaskSender(
  taskId: number,
  payload: TaskNotePayload,
  token: string
): Promise<{ task: Task; note: TaskNote; email_sent: boolean }> {
  return request<{ task: Task; note: TaskNote; email_sent: boolean }>(
    `/tasks/${taskId}/notify/`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
    token
  );
}

export function reassignTask(
  taskId: number,
  assigneeUsername: string,
  token: string
): Promise<{ task: Task }> {
  return request<{ task: Task }>(
    `/tasks/${taskId}/reassign/`,
    {
      method: 'POST',
      body: JSON.stringify({ assignee_username: assigneeUsername }),
    },
    token
  );
}

export function oversightDeleteTask(
  taskId: number,
  reason: string,
  token: string
): Promise<{ detail: string; email_sent: boolean }> {
  return request<{ detail: string; email_sent: boolean }>(
    `/tasks/${taskId}/oversight-delete/`,
    {
      method: 'POST',
      body: JSON.stringify({ reason }),
    },
    token
  );
}

// --- Admin: registration approval & role management ---

export function getAdminUsers(token: string, status?: UserStatus): Promise<{ users: AdminUser[] }> {
  const query = status ? `?status=${status}` : '';
  return request<{ users: AdminUser[] }>(`/admin/users/${query}`, undefined, token);
}

export function approveUser(
  userId: number,
  payload: { role?: Role; manager_id?: number | null },
  token: string
): Promise<{ user: AdminUser; email_sent: boolean }> {
  return request<{ user: AdminUser; email_sent: boolean }>(
    `/admin/users/${userId}/approve/`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
    token
  );
}

export function rejectUser(
  userId: number,
  payload: { reason?: string; permanent: boolean },
  token: string
): Promise<{ user: AdminUser; email_sent: boolean }> {
  return request<{ user: AdminUser; email_sent: boolean }>(
    `/admin/users/${userId}/reject/`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
    token
  );
}

export function changeUserRole(
  userId: number,
  payload: { role: Role; manager_id?: number | null },
  token: string
): Promise<{ user: AdminUser }> {
  return request<{ user: AdminUser }>(
    `/admin/users/${userId}/role/`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
    token
  );
}

export function deleteUser(
  userId: number,
  payload: { reason?: string; notify: boolean },
  token: string
): Promise<{ detail: string; email_sent: boolean }> {
  return request<{ detail: string; email_sent: boolean }>(
    `/admin/users/${userId}/delete/`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
    token
  );
}

// --- Upward task-assignment requests (approved up the chain of command) ---

export type TaskRequestStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export type TaskAssignmentRequest = {
  id: number;
  requester: User;
  target: User;
  title: string;
  description: string;
  priority: 'low' | 'medium' | 'high';
  priority_display: string;
  due_date: string | null;
  status: TaskRequestStatus;
  status_display: string;
  current_approver: User | null;
  rejection_reason: string;
  rejected_by: User | null;
  created_task: number | null;
  created_at: string;
  updated_at: string;
};

export function createTaskRequest(
  payload: {
    target_username: string;
    title: string;
    description?: string;
    priority?: 'low' | 'medium' | 'high';
    due_date?: string | null;
  },
  token: string
): Promise<{ request: TaskAssignmentRequest }> {
  return request<{ request: TaskAssignmentRequest }>(
    '/task-requests/',
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
    token
  );
}

export function createTaskRequestFromAudio(
  targetUsername: string,
  file: File,
  token: string,
  language: '' | 'ar' | 'en' = ''
): Promise<{ request: TaskAssignmentRequest; transcript: string }> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('target_username', targetUsername);
  if (language) {
    formData.append('language', language);
  }
  return request<{ request: TaskAssignmentRequest; transcript: string }>(
    '/task-requests/from-audio/',
    {
      method: 'POST',
      body: formData,
    },
    token
  );
}

export function getRequestsAwaitingMe(
  token: string
): Promise<{ requests: TaskAssignmentRequest[] }> {
  return request<{ requests: TaskAssignmentRequest[] }>(
    '/task-requests/awaiting-me/',
    undefined,
    token
  );
}

export function getMyTaskRequests(
  token: string
): Promise<{ requests: TaskAssignmentRequest[] }> {
  return request<{ requests: TaskAssignmentRequest[] }>('/task-requests/', undefined, token);
}

export function approveTaskRequest(
  id: number,
  token: string
): Promise<{ request: TaskAssignmentRequest }> {
  return request<{ request: TaskAssignmentRequest }>(
    `/task-requests/${id}/approve/`,
    { method: 'POST' },
    token
  );
}

export function rejectTaskRequest(
  id: number,
  reason: string,
  token: string
): Promise<{ request: TaskAssignmentRequest }> {
  return request<{ request: TaskAssignmentRequest }>(
    `/task-requests/${id}/reject/`,
    {
      method: 'POST',
      body: JSON.stringify({ reason }),
    },
    token
  );
}

export function cancelTaskRequest(
  id: number,
  token: string
): Promise<{ request: TaskAssignmentRequest }> {
  return request<{ request: TaskAssignmentRequest }>(
    `/task-requests/${id}/cancel/`,
    { method: 'POST' },
    token
  );
}
