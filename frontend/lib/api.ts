export type User = {
  id: number;
  username: string;
  first_name: string;
  last_name: string;
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
  due_date: string | null;
  assigned_to: User | null;
  assigned_to_name: string;
  assigned_from: User | null;
  is_reviewed: boolean;
  is_completed: boolean;
  completed_at: string | null;
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

export type DashboardData = {
  user: User;
  my_voice_messages: Transcript[];
  assigned_tasks: Task[];
  available_users: User[];
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
};

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://127.0.0.1:8000/api';

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

export function register(payload: AuthPayload): Promise<AuthResponse> {
  return request<AuthResponse>('/auth/register/', {
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

export function uploadAudio(
  file: File,
  token: string,
  language: '' | 'ar' | 'en' = ''
): Promise<Transcript> {
  const formData = new FormData();
  formData.append('file', file);
  if (language) {
    formData.append('language', language);
  }

  return request<Transcript>(
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
