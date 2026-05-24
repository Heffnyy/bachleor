'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { UploadForm } from '@/components/upload-form';
import { TranscriptList } from '@/components/transcript-list';
import {
  getDashboard,
  getMe,
  login,
  logout,
  register,
  type DashboardData,
  type Task,
  type User,
} from '@/lib/api';

const TOKEN_KEY = 'voice-task-token';

type AuthMode = 'login' | 'register';

type AuthFormState = {
  username: string;
  password: string;
  first_name: string;
  last_name: string;
};

type TranscriptItem = DashboardData['my_voice_messages'][number];

type DueDatePrompt = {
  id: string;
  transcriptId: number;
  taskTitles: string[];
  transcriptText: string;
  message: string;
};

const initialFormState: AuthFormState = {
  username: '',
  password: '',
  first_name: '',
  last_name: '',
};

function formatDueDate(value: string | null) {
  if (!value) {
    return 'No due date';
  }

  return new Intl.DateTimeFormat('en', {
    dateStyle: 'medium',
  }).format(new Date(value));
}

function buildDueDatePrompt(taskTitles: string[]) {
  if (taskTitles.length === 1) {
    return `The task "${taskTitles[0]}" does not include a due date. Please say the due date for this task.`;
  }

  if (taskTitles.length === 2) {
    return `Two tasks are missing due dates: "${taskTitles[0]}" and "${taskTitles[1]}". Please say the due date for each task.`;
  }

  return `There are ${taskTitles.length} tasks missing due dates. Please say the due date for each task.`;
}

function createDueDatePrompt(transcript: TranscriptItem): DueDatePrompt | null {
  const tasksMissingDueDate = transcript.tasks.filter((task) => !task.due_date);
  if (tasksMissingDueDate.length === 0 || !transcript.transcript.trim()) {
    return null;
  }

  const taskTitles = tasksMissingDueDate.map((task) => task.title);

  return {
    id: `${transcript.id}:${taskTitles.join('|')}`,
    transcriptId: transcript.id,
    taskTitles,
    transcriptText: transcript.transcript,
    message: buildDueDatePrompt(taskTitles),
  };
}

function getNewestDueDatePrompt(transcripts: TranscriptItem[]) {
  for (const transcript of transcripts) {
    const prompt = createDueDatePrompt(transcript);
    if (prompt) {
      return prompt;
    }
  }

  return null;
}

function findMostFeminineVoice(voices: SpeechSynthesisVoice[]) {
  const rankedVoices = voices
    .map((voice) => {
      const name = `${voice.name} ${voice.lang}`.toLowerCase();
      let score = 0;

      if (name.includes('female')) score += 5;
      if (name.includes('woman')) score += 5;
      if (name.includes('girl')) score += 5;
      if (name.includes('samantha')) score += 4;
      if (name.includes('victoria')) score += 4;
      if (name.includes('zira')) score += 4;
      if (name.includes('ava')) score += 3;
      if (name.includes('aria')) score += 3;
      if (name.includes('jenny')) score += 3;
      if (name.includes('nora')) score += 3;
      if (name.includes('alice')) score += 3;
      if (name.includes('monica')) score += 3;
      if (voice.default) score += 1;

      return { voice, score };
    })
    .sort((a, b) => b.score - a.score);

  return rankedVoices[0]?.voice ?? null;
}

function speakPrompt(message: string) {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    return false;
  }

  const synth = window.speechSynthesis;
  synth.cancel();

  const utterance = new SpeechSynthesisUtterance(message);
  utterance.rate = 0.95;
  utterance.pitch = 1.15;

  const selectedVoice = findMostFeminineVoice(synth.getVoices());
  if (selectedVoice) {
    utterance.voice = selectedVoice;
    utterance.lang = selectedVoice.lang;
  } else {
    utterance.lang = 'en-US';
  }

  synth.speak(utterance);
  return true;
}

function TaskBoard({ tasks }: { tasks: Task[] }) {
  return (
    <section className="listSection">
      <div className="sectionHeader">
        <div>
          <p className="eyebrow">Assigned To You</p>
          <h2>Your tasks</h2>
        </div>
      </div>

      {tasks.length === 0 ? (
        <p className="muted">No tasks are assigned to your username yet.</p>
      ) : (
        <div className="taskBoardGrid">
          {tasks.map((task) => (
            <article className="taskBoardCard" key={task.id}>
              <div className="taskTopRow">
                <strong>{task.title}</strong>
                <span className={`priorityTag priority-${task.priority}`}>{task.priority}</span>
              </div>
              {task.description ? <p className="taskDescription">{task.description}</p> : null}
              <p className="metaText">Due: {formatDueDate(task.due_date)}</p>
              <p className="metaText">
                Assigned from: {task.assigned_from?.username || 'Unknown'}
              </p>
              <p className="metaText">Voice message: {task.transcription?.original_filename}</p>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function DueDateClarification({ prompt }: { prompt: DueDatePrompt }) {
  const lastSpokenPromptIdRef = useRef('');
  const [speechSupported, setSpeechSupported] = useState(true);

  useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      setSpeechSupported(false);
      return;
    }

    const synth = window.speechSynthesis;

    const trySpeak = () => {
      const started = speakPrompt(prompt.message);
      setSpeechSupported(started);
      if (started) {
        lastSpokenPromptIdRef.current = prompt.id;
      }
    };

    if (synth.getVoices().length > 0 && lastSpokenPromptIdRef.current !== prompt.id) {
      trySpeak();
      return () => synth.cancel();
    }

    const handleVoicesChanged = () => {
      if (lastSpokenPromptIdRef.current !== prompt.id) {
        trySpeak();
      }
    };

    synth.addEventListener('voiceschanged', handleVoicesChanged);
    return () => {
      synth.removeEventListener('voiceschanged', handleVoicesChanged);
      synth.cancel();
    };
  }, [prompt]);

  function replayPrompt() {
    const started = speakPrompt(prompt.message);
    setSpeechSupported(started);
    if (started) {
      lastSpokenPromptIdRef.current = prompt.id;
    }
  }

  return (
    <section className="clarificationPanel">
      <div className="clarificationHeader">
        <div>
          <p className="eyebrow">Due Date Follow-up</p>
          <h2>Some extracted tasks still need a due date.</h2>
        </div>
        <button className="secondaryButton" type="button" onClick={replayPrompt}>
          Replay voice prompt
        </button>
      </div>

      <p className="clarificationPrompt">{prompt.message}</p>
      <p className="metaText">Missing due date for: {prompt.taskTitles.join(', ')}</p>
      {!speechSupported ? (
        <p className="metaText">
          Audio playback is not available in this browser, so the prompt is shown on screen.
        </p>
      ) : null}

      <div className="clarificationTranscriptCard">
        <p className="taskHeading">Transcription on screen</p>
        <div className="transcriptBody">{prompt.transcriptText}</div>
      </div>
    </section>
  );
}

export function ClientPage() {
  const [authMode, setAuthMode] = useState<AuthMode>('login');
  const [formState, setFormState] = useState<AuthFormState>(initialFormState);
  const [token, setToken] = useState('');
  const [user, setUser] = useState<User | null>(null);
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [authError, setAuthError] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [activeDueDatePrompt, setActiveDueDatePrompt] = useState<DueDatePrompt | null>(null);

  useEffect(() => {
    const storedToken = window.localStorage.getItem(TOKEN_KEY);
    if (!storedToken) {
      setIsLoading(false);
      return;
    }
    const activeToken = storedToken;

    async function loadSession() {
      try {
        const currentUser = await getMe(activeToken);
        const dashboardData = await getDashboard(activeToken);
        setToken(activeToken);
        setUser(currentUser);
        setDashboard(dashboardData);
        setActiveDueDatePrompt(getNewestDueDatePrompt(dashboardData.my_voice_messages));
      } catch {
        window.localStorage.removeItem(TOKEN_KEY);
        setToken('');
        setUser(null);
        setDashboard(null);
        setActiveDueDatePrompt(null);
      } finally {
        setIsLoading(false);
      }
    }

    void loadSession();
  }, []);

  async function refreshDashboard(activeToken: string) {
    const dashboardData = await getDashboard(activeToken);
    setDashboard(dashboardData);
    setUser(dashboardData.user);
    setActiveDueDatePrompt(getNewestDueDatePrompt(dashboardData.my_voice_messages));
  }

  function updateField(field: keyof AuthFormState, value: string) {
    setFormState((current) => ({
      ...current,
      [field]: value,
    }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setAuthError('');

    try {
      const normalizedPayload = {
        ...formState,
        username: formState.username.trim().toLowerCase(),
      };

      const response =
        authMode === 'register'
          ? await register(normalizedPayload)
          : await login({
              username: normalizedPayload.username,
              password: normalizedPayload.password,
            });

      window.localStorage.setItem(TOKEN_KEY, response.token);
      setToken(response.token);
      setUser(response.user);
      setFormState(initialFormState);
      await refreshDashboard(response.token);
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : 'Authentication failed.');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleLogout() {
    if (!token) {
      return;
    }

    try {
      await logout(token);
    } catch {
      // The local session is cleared even if the token was already invalidated.
    } finally {
      window.localStorage.removeItem(TOKEN_KEY);
      setToken('');
      setUser(null);
      setDashboard(null);
      setActiveDueDatePrompt(null);
    }
  }

  async function handleUploaded() {
    if (!token) {
      return;
    }

    await refreshDashboard(token);
  }

  if (isLoading) {
    return (
      <main className="pageShell">
        <section className="emptyState">
          <h3>Loading dashboard</h3>
          <p>Checking your login session and fetching your voice workspace.</p>
        </section>
      </main>
    );
  }

  if (!token || !user || !dashboard) {
    return (
      <main className="pageShell">
        <section className="heroSection">
          <div className="heroCopy">
            <p className="eyebrow">Voice To Task</p>
            <h1>Login, assign tasks, and track each user’s voice messages.</h1>
            <p className="heroText">
              Create an account, sign in, upload a voice note, and let the system route tasks to
              usernames like <strong>saif</strong> while showing who assigned each task.
            </p>
          </div>

          <form className="uploadCard authCard" onSubmit={handleSubmit}>
            <div className="authToggleRow">
              <button
                className={authMode === 'login' ? 'primaryButton' : 'ghostButton'}
                type="button"
                onClick={() => setAuthMode('login')}
              >
                Login
              </button>
              <button
                className={authMode === 'register' ? 'primaryButton' : 'ghostButton'}
                type="button"
                onClick={() => setAuthMode('register')}
              >
                Register
              </button>
            </div>

            <label className="fieldGroup">
              <span>Username</span>
              <input
                className="textInput"
                value={formState.username}
                onChange={(event) => updateField('username', event.target.value)}
                placeholder="saif"
                required
              />
            </label>

            {authMode === 'register' ? (
              <>
                <label className="fieldGroup">
                  <span>First name</span>
                  <input
                    className="textInput"
                    value={formState.first_name}
                    onChange={(event) => updateField('first_name', event.target.value)}
                    placeholder="Saif"
                  />
                </label>
                <label className="fieldGroup">
                  <span>Last name</span>
                  <input
                    className="textInput"
                    value={formState.last_name}
                    onChange={(event) => updateField('last_name', event.target.value)}
                    placeholder="Hefny"
                  />
                </label>
              </>
            ) : null}

            <label className="fieldGroup">
              <span>Password</span>
              <input
                className="textInput"
                type="password"
                value={formState.password}
                onChange={(event) => updateField('password', event.target.value)}
                placeholder="Minimum 8 characters"
                required
              />
            </label>

            <button className="primaryButton" type="submit" disabled={isSubmitting}>
              {isSubmitting
                ? authMode === 'register'
                  ? 'Creating account...'
                  : 'Signing in...'
                : authMode === 'register'
                  ? 'Create account'
                  : 'Login'}
            </button>

            {authError ? <p className="errorText">{authError}</p> : null}
          </form>
        </section>
      </main>
    );
  }

  return (
    <main className="pageShell">
      <section className="heroSection">
        <div className="heroCopy">
          <p className="eyebrow">Private Workspace</p>
          <h1>{user.first_name || user.username}, your tasks and recordings are ready.</h1>
          <p className="heroText">
            Upload a new voice message, assign work by mentioning usernames in the transcript, and
            review everything routed to your account.
          </p>
          <div className="heroMetaRow">
            <span className="recordBadge">Signed in as {user.username}</span>
            <button className="ghostButton" type="button" onClick={handleLogout}>
              Logout
            </button>
          </div>
        </div>

        <UploadForm token={token} onUploaded={handleUploaded} />
      </section>

      <TaskBoard tasks={dashboard.assigned_tasks} />
      {activeDueDatePrompt ? <DueDateClarification prompt={activeDueDatePrompt} /> : null}
      <TranscriptList transcripts={dashboard.my_voice_messages} />
    </main>
  );
}
