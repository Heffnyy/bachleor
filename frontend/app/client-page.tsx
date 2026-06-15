'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { UploadForm } from '@/components/upload-form';
import { TaskCountdown } from '@/components/task-countdown';
import { TranscriptList } from '@/components/transcript-list';
import {
  clarifyTask,
  getAccount,
  getDashboard,
  getMe,
  login,
  logout,
  notifyTaskSender,
  oversightDeleteTask,
  parseApiError,
  reassignTask,
  register,
  requestAccountOtp,
  setTaskStatus,
  updateAccount,
  verifyAccountOtp,
  SELF_REGISTER_ROLES,
  type AccountDetails,
  type AccountUpdatePayload,
  type DashboardData,
  type Role,
  type Task,
  type TaskNote,
  type TaskNoteKind,
  type TaskNotePayload,
  type TaskStatus,
  type User,
} from '@/lib/api';

const STATUS_LABELS: Record<TaskStatus, string> = {
  delivered: 'Delivered',
  in_progress: 'In progress',
  done: 'Done',
};

const STATUS_ORDER: TaskStatus[] = ['delivered', 'in_progress', 'done'];

function formatNoteTimestamp(value: string) {
  return new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(value)
  );
}

function NoteItem({ note }: { note: TaskNote }) {
  const label =
    note.kind === 'problem'
      ? 'Problem reported'
      : note.kind === 'delay'
        ? 'Delay requested'
        : 'Update';

  return (
    <div className="noteItem">
      <div className="noteItemHead">
        <span className={`noteTag noteTag-${note.kind}`}>{label}</span>
        <span className="metaText">{formatNoteTimestamp(note.created_at)}</span>
      </div>
      {note.requested_due_date ? (
        <p className="metaText">Proposed new due date: {formatDueDate(note.requested_due_date)}</p>
      ) : null}
      {note.message ? <p className="taskDescription">{note.message}</p> : null}
    </div>
  );
}

const TOKEN_KEY = 'voice-task-token';
const PRIORITY_OPTIONS: Array<Task['priority']> = ['low', 'medium', 'high'];

type AuthMode = 'login' | 'register';

type AuthFormState = {
  username: string;
  password: string;
  first_name: string;
  last_name: string;
  email: string;
  requested_role: Role;
  requested_manager_name: string;
};

type TranscriptItem = DashboardData['my_voice_messages'][number];

type ReviewPrompt = {
  id: string;
  taskId: number;
  taskTitle: string;
  taskDescription: string;
  taskPriority: Task['priority'];
  dueDate: string | null;
  assigneeUsername: string;
  transcriptText: string;
  message: string;
  language: '' | 'ar' | 'en';
};

const initialFormState: AuthFormState = {
  username: '',
  password: '',
  first_name: '',
  last_name: '',
  email: '',
  requested_role: 'employee',
  requested_manager_name: '',
};

function formatDueDate(value: string | null) {
  if (!value) {
    return 'No due date';
  }

  return new Intl.DateTimeFormat('en', {
    dateStyle: 'medium',
  }).format(new Date(value));
}

function buildReviewPrompt(taskTitle: string, hasDueDate: boolean, language: '' | 'ar' | 'en') {
  if (language === 'ar') {
    if (!hasDueDate) {
      return `راجع المهمة "${taskTitle}" قبل إرسالها. يمكنك تعديل أي شيء فيها، والموعد النهائي غير مذكور حاليًا إذا أردت إضافته.`;
    }

    return `راجع المهمة "${taskTitle}" قبل إرسالها. إذا كان هناك أي خطأ في التفريغ أو في تفاصيل المهمة يمكنك تعديله الآن.`;
  }

  if (!hasDueDate) {
    return `Review the task "${taskTitle}" before sending it. You can change anything now, and the due date is currently missing if you want to add it.`;
  }

  return `Review the task "${taskTitle}" before sending it. If the transcription missed anything, you can correct it now.`;
}

function createReviewPrompts(transcripts: TranscriptItem[]) {
  return transcripts.flatMap((transcript) =>
    transcript.tasks
      .filter((task) => !task.is_reviewed)
      .map((task) => {
        const language = (
          transcript.detected_language === 'ar' || transcript.detected_language === 'en'
            ? transcript.detected_language
            : ''
        ) as '' | 'ar' | 'en';

        return {
          id: `${transcript.id}:${task.id}`,
          taskId: task.id,
          taskTitle: task.title,
          taskDescription: task.description,
          taskPriority: task.priority,
          dueDate: task.due_date,
          assigneeUsername: task.assigned_to?.username || task.assigned_to_name || '',
          transcriptText: transcript.transcript,
          message: buildReviewPrompt(task.title, Boolean(task.due_date), language),
          language,
        };
      })
  );
}

function findMostFeminineVoice(voices: SpeechSynthesisVoice[], language: '' | 'ar' | 'en') {
  const languagePrefix = language === 'ar' ? 'ar' : 'en';
  const rankedVoices = voices
    .map((voice) => {
      const name = `${voice.name} ${voice.lang}`.toLowerCase();
      let score = 0;

      if (voice.lang.toLowerCase().startsWith(languagePrefix)) score += 6;
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
      if (name.includes('arabic')) score += language === 'ar' ? 4 : 0;
      if (name.includes('amira')) score += language === 'ar' ? 4 : 0;
      if (name.includes('hala')) score += language === 'ar' ? 4 : 0;
      if (voice.default) score += 1;

      return { voice, score };
    })
    .sort((a, b) => b.score - a.score);

  return rankedVoices[0]?.voice ?? null;
}

function speakPrompt(message: string, language: '' | 'ar' | 'en') {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    return false;
  }

  const synth = window.speechSynthesis;
  synth.cancel();

  const utterance = new SpeechSynthesisUtterance(message);
  utterance.rate = 0.95;
  utterance.pitch = 1.15;

  const selectedVoice = findMostFeminineVoice(synth.getVoices(), language);
  if (selectedVoice) {
    utterance.voice = selectedVoice;
    utterance.lang = selectedVoice.lang;
  } else if (language === 'ar') {
    utterance.lang = 'ar-EG';
  } else {
    utterance.lang = 'en-US';
  }

  synth.speak(utterance);
  return true;
}

function createRecordingFile(blob: Blob) {
  const extension = blob.type.includes('mp4') ? 'mp4' : 'webm';
  return new File([blob], `due-date-response-${Date.now()}.${extension}`, {
    type: blob.type || 'audio/webm',
  });
}

function TaskStatusControls({
  task,
  token,
  onChanged,
}: {
  task: Task;
  token: string;
  onChanged: () => Promise<void>;
}) {
  const [busyStatus, setBusyStatus] = useState<TaskStatus | null>(null);
  const [error, setError] = useState('');

  async function change(nextStatus: TaskStatus) {
    if (nextStatus === task.status) {
      return;
    }

    try {
      setError('');
      setBusyStatus(nextStatus);
      await setTaskStatus(task.id, nextStatus, token);
      await onChanged();
    } catch (changeError) {
      setError(changeError instanceof Error ? changeError.message : 'Could not update the status.');
    } finally {
      setBusyStatus(null);
    }
  }

  return (
    <div className="statusControls">
      <span className="metaText">Update status</span>
      <div className="statusButtonRow">
        {STATUS_ORDER.map((option) => (
          <button
            key={option}
            type="button"
            className={`statusButton${task.status === option ? ' statusButton-active' : ''}`}
            onClick={() => void change(option)}
            disabled={busyStatus !== null}
          >
            {busyStatus === option ? '…' : STATUS_LABELS[option]}
          </button>
        ))}
      </div>
      {error ? <p className="errorText">{error}</p> : null}
    </div>
  );
}

function TaskNotifyForm({
  task,
  token,
  onChanged,
}: {
  task: Task;
  token: string;
  onChanged: () => Promise<void>;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [kind, setKind] = useState<TaskNoteKind>('problem');
  const [message, setMessage] = useState('');
  const [requestedDate, setRequestedDate] = useState('');
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  async function send() {
    try {
      setIsBusy(true);
      setError('');
      setInfo('');

      const payload: TaskNotePayload = { kind, message: message.trim() };
      if (kind === 'delay' && requestedDate) {
        payload.requested_due_date = requestedDate;
      }

      const response = await notifyTaskSender(task.id, payload, token);
      setMessage('');
      setRequestedDate('');
      setInfo(
        response.email_sent
          ? 'Your update was emailed to the sender.'
          : 'Your update was saved; the sender will see it on their dashboard.'
      );
      setIsOpen(false);
      await onChanged();
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : 'Could not send your update.');
    } finally {
      setIsBusy(false);
    }
  }

  if (!isOpen) {
    return (
      <div className="notifyTrigger">
        <button
          type="button"
          className="secondaryButton"
          onClick={() => {
            setIsOpen(true);
            setInfo('');
          }}
        >
          Report a problem / request delay
        </button>
        {info ? <p className="successText">{info}</p> : null}
      </div>
    );
  }

  return (
    <div className="notifyForm">
      <label className="fieldGroup">
        <span>What do you want to tell the sender?</span>
        <select
          className="textInput"
          value={kind}
          onChange={(event) => setKind(event.target.value as TaskNoteKind)}
          disabled={isBusy}
        >
          <option value="problem">I have a problem with this task</option>
          <option value="delay">I need more time</option>
          <option value="note">General update</option>
        </select>
      </label>

      {kind === 'delay' ? (
        <label className="fieldGroup">
          <span>Proposed new due date (optional)</span>
          <input
            className="textInput"
            type="date"
            value={requestedDate}
            onChange={(event) => setRequestedDate(event.target.value)}
            disabled={isBusy}
          />
        </label>
      ) : null}

      <label className="fieldGroup">
        <span>Message</span>
        <textarea
          className="textInput textAreaInput"
          rows={3}
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          disabled={isBusy}
          placeholder="Explain the problem or why you need more time"
        />
      </label>

      {error ? <p className="errorText">{error}</p> : null}

      <div className="modalActionRow">
        <button type="button" className="primaryButton" onClick={() => void send()} disabled={isBusy}>
          {isBusy ? 'Sending…' : 'Send to sender'}
        </button>
        <button
          type="button"
          className="ghostButton"
          onClick={() => {
            setIsOpen(false);
            setError('');
          }}
          disabled={isBusy}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function TaskBoard({
  tasks,
  token,
  onChanged,
}: {
  tasks: Task[];
  token: string;
  onChanged: () => Promise<void>;
}) {
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
                <div className="taskMetaStack">
                  <span className={`status status-task-${task.status}`}>{STATUS_LABELS[task.status]}</span>
                  <span className={`priorityTag priority-${task.priority}`}>{task.priority}</span>
                </div>
              </div>
              {task.description ? <p className="taskDescription">{task.description}</p> : null}
              <p className="metaText">Due: {formatDueDate(task.due_date)}</p>
              <TaskCountdown dueDate={task.due_date} />
              <p className="metaText">Assigned from: {task.assigned_from?.username || 'Unknown'}</p>
              <p className="metaText">Voice message: {task.transcription?.original_filename}</p>
              {task.transcription?.audio_url ? (
                <audio controls className="audioPlayer" src={task.transcription.audio_url}>
                  Your browser does not support audio playback.
                </audio>
              ) : null}

              <TaskStatusControls task={task} token={token} onChanged={onChanged} />
              {task.completed_at && task.status === 'done' ? (
                <p className="metaText">Completed {formatDueDate(task.completed_at)}</p>
              ) : null}

              <TaskNotifyForm task={task} token={token} onChanged={onChanged} />

              {task.notes.length > 0 ? (
                <div className="noteThread">
                  <p className="taskHeading">Updates you sent</p>
                  {task.notes.map((note) => (
                    <NoteItem key={note.id} note={note} />
                  ))}
                </div>
              ) : null}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

type TaskReviewModalProps = {
  prompt: ReviewPrompt;
  token: string;
  availableUsers: User[];
  onSaved: () => Promise<void>;
  onClose: () => void;
};

function TaskReviewModal({
  prompt,
  token,
  availableUsers,
  onSaved,
  onClose,
}: TaskReviewModalProps) {
  const [title, setTitle] = useState(prompt.taskTitle);
  const [description, setDescription] = useState(prompt.taskDescription);
  const [manualDate, setManualDate] = useState(prompt.dueDate || '');
  const [assigneeUsername, setAssigneeUsername] = useState(prompt.assigneeUsername);
  const [priority, setPriority] = useState<Task['priority']>(prompt.taskPriority);
  const [error, setError] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordedFile, setRecordedFile] = useState<File | null>(null);
  const [recordedAudioUrl, setRecordedAudioUrl] = useState('');
  const [speechSupported, setSpeechSupported] = useState(true);
  const lastSpokenPromptIdRef = useRef('');
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  useEffect(() => {
    setTitle(prompt.taskTitle);
    setDescription(prompt.taskDescription);
    setManualDate(prompt.dueDate || '');
    setAssigneeUsername(prompt.assigneeUsername);
    setPriority(prompt.taskPriority);
    setError('');
    setRecordedFile(null);
    if (recordedAudioUrl) {
      URL.revokeObjectURL(recordedAudioUrl);
      setRecordedAudioUrl('');
    }
  }, [prompt]);

  useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      setSpeechSupported(false);
      return;
    }

    const synth = window.speechSynthesis;

    const trySpeak = () => {
      const started = speakPrompt(prompt.message, prompt.language);
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

  useEffect(() => {
    return () => {
      if (recordedAudioUrl) {
        URL.revokeObjectURL(recordedAudioUrl);
      }
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, [recordedAudioUrl]);

  function replayPrompt() {
    const started = speakPrompt(prompt.message, prompt.language);
    setSpeechSupported(started);
    if (started) {
      lastSpokenPromptIdRef.current = prompt.id;
    }
  }

  function stopActiveStream() {
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;
  }

  async function startRecording() {
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('This browser does not support microphone recording.');
      return;
    }

    try {
      setError('');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;

      const recorder = new MediaRecorder(stream);
      audioChunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = () => {
        const mimeType = recorder.mimeType || 'audio/webm';
        const blob = new Blob(audioChunksRef.current, { type: mimeType });
        const file = createRecordingFile(blob);

        if (recordedAudioUrl) {
          URL.revokeObjectURL(recordedAudioUrl);
        }

        setRecordedFile(file);
        setRecordedAudioUrl(URL.createObjectURL(blob));
        setIsRecording(false);
        stopActiveStream();
      };

      mediaRecorderRef.current = recorder;
      recorder.start();
      setIsRecording(true);
      setRecordedFile(null);

      if (recordedAudioUrl) {
        URL.revokeObjectURL(recordedAudioUrl);
        setRecordedAudioUrl('');
      }
    } catch {
      setError('Microphone access was blocked. Please allow access and try again.');
      stopActiveStream();
      setIsRecording(false);
    }
  }

  function stopRecording() {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
    }
  }

  async function sendAsIs() {
    try {
      setIsSaving(true);
      setError('');

      const formData = new FormData();
      formData.append('title', title);
      formData.append('description', description);
      formData.append('assignee_username', assigneeUsername);
      formData.append('priority', priority);
      if (manualDate) {
        formData.append('due_date', manualDate);
      }

      await clarifyTask(prompt.taskId, formData, token);
      await onSaved();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save the task update.');
    } finally {
      setIsSaving(false);
    }
  }

  async function saveManual() {
    await sendAsIs();
  }

  async function saveRecording() {
    if (!recordedFile) {
      setError('Record a reply before saving.');
      return;
    }

    try {
      setIsSaving(true);
      setError('');

      const formData = new FormData();
      formData.append('title', title);
      formData.append('description', description);
      formData.append('assignee_username', assigneeUsername);
      formData.append('file', recordedFile);
      formData.append('priority', priority);
      formData.append('reference_date', new Date().toISOString().slice(0, 10));
      if (prompt.language) {
        formData.append('language', prompt.language);
      }

      await clarifyTask(prompt.taskId, formData, token);
      await onSaved();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save the recorded reply.');
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="modalOverlay">
      <section className="clarificationModal" role="dialog" aria-modal="true" aria-labelledby="due-date-title">
        <div className="clarificationHeader">
          <div>
            <p className="eyebrow">{prompt.language === 'ar' ? 'مراجعة المهمة' : 'Task Review'}</p>
            <h2 id="due-date-title">
              {prompt.language === 'ar'
                ? 'راجع المهمة قبل إرسالها.'
                : 'Review the task before sending it.'}
            </h2>
          </div>
          <button className="ghostButton" type="button" onClick={onClose} disabled={isSaving || isRecording}>
            {prompt.language === 'ar' ? 'ذكرني لاحقًا' : 'Remind me later'}
          </button>
        </div>

        <p className="clarificationPrompt">{prompt.message}</p>
        {!speechSupported ? (
          <p className="metaText">
            {prompt.language === 'ar'
              ? 'تشغيل الصوت غير متاح هنا، لذلك سيظل التنبيه ظاهرًا على الشاشة.'
              : 'Audio playback is not available here, so the prompt stays visible on screen.'}
          </p>
        ) : null}

        <div className="modalActionRow">
          <button className="primaryButton" type="button" onClick={sendAsIs} disabled={isSaving || isRecording}>
            {isSaving
              ? prompt.language === 'ar'
                ? 'جارٍ الإرسال...'
                : 'Sending...'
              : prompt.language === 'ar'
                ? 'إرسال كما هي'
                : 'Send as is'}
          </button>
          <button className="secondaryButton" type="button" onClick={replayPrompt} disabled={isSaving}>
            {prompt.language === 'ar' ? 'إعادة تشغيل التنبيه الصوتي' : 'Replay voice prompt'}
          </button>
        </div>

        <div className="clarificationGrid">
          <div className="clarificationColumn">
            <p className="taskHeading">{prompt.language === 'ar' ? 'تفاصيل المهمة' : 'Task details'}</p>
            <label className="fieldGroup">
              <span>{prompt.language === 'ar' ? 'عنوان المهمة' : 'Task title'}</span>
              <input
                className="textInput"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                disabled={isSaving}
              />
            </label>
            <label className="fieldGroup">
              <span>{prompt.language === 'ar' ? 'الوصف' : 'Description'}</span>
              <textarea
                className="textInput textAreaInput"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                disabled={isSaving}
                rows={4}
              />
            </label>
            <label className="fieldGroup">
              <span>{prompt.language === 'ar' ? 'إرسال إلى' : 'Send to'}</span>
              <select
                className="textInput"
                value={assigneeUsername}
                onChange={(event) => setAssigneeUsername(event.target.value)}
                disabled={isSaving}
              >
                <option value="">{prompt.language === 'ar' ? 'غير محدد' : 'Unassigned'}</option>
                {availableUsers.map((userOption) => (
                  <option key={userOption.id} value={userOption.username}>
                    {userOption.username}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="clarificationColumn">
            <p className="taskHeading">{prompt.language === 'ar' ? 'الموعد والأولوية' : 'Timing and priority'}</p>
        <div className="fieldGroup">
          <span>{prompt.language === 'ar' ? 'درجة الاستعجال' : 'Urgency'}</span>
          <select
            className="textInput"
            value={priority}
            onChange={(event) => setPriority(event.target.value as Task['priority'])}
            disabled={isSaving}
          >
            {PRIORITY_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>

            <p className="taskHeading">{prompt.language === 'ar' ? 'إدخال يدوي' : 'Enter manually'}</p>
            <label className="fieldGroup">
              <span>{prompt.language === 'ar' ? 'الموعد النهائي' : 'Due date'}</span>
              <input
                className="textInput"
                type="date"
                value={manualDate}
                onChange={(event) => setManualDate(event.target.value)}
                disabled={isSaving}
              />
            </label>
            <button className="primaryButton" type="button" onClick={saveManual} disabled={isSaving}>
              {isSaving
                ? prompt.language === 'ar'
                  ? 'جارٍ الحفظ...'
                  : 'Saving...'
                : prompt.language === 'ar'
                  ? 'حفظ التعديلات والإرسال'
                  : 'Save changes and send'}
            </button>
            <p className="taskHeading">{prompt.language === 'ar' ? 'تسجيل رد' : 'Record a reply'}</p>
            <div className="recordActions">
              <button
                className="secondaryButton"
                type="button"
                onClick={startRecording}
                disabled={isRecording || isSaving}
              >
                {prompt.language === 'ar' ? 'ابدأ التسجيل' : 'Start recording'}
              </button>
              <button
                className="ghostButton"
                type="button"
                onClick={stopRecording}
                disabled={!isRecording || isSaving}
              >
                {prompt.language === 'ar' ? 'إيقاف التسجيل' : 'Stop recording'}
              </button>
            </div>
            {recordedAudioUrl ? (
              <audio controls className="audioPreview" src={recordedAudioUrl}>
                Your browser does not support audio playback.
              </audio>
            ) : null}
            <button className="primaryButton" type="button" onClick={saveRecording} disabled={isSaving}>
              {isSaving
                ? prompt.language === 'ar'
                  ? 'جارٍ الحفظ...'
                  : 'Saving...'
                : prompt.language === 'ar'
                  ? 'استخدام الرد المسجل ثم الإرسال'
                  : 'Use recorded reply and send'}
            </button>
          </div>
        </div>

        {error ? <p className="errorText">{error}</p> : null}

        <div className="clarificationTranscriptCard">
          <p className="taskHeading">
            {prompt.language === 'ar' ? 'النص الظاهر على الشاشة' : 'Transcription on screen'}
          </p>
          <div className="transcriptBody">{prompt.transcriptText}</div>
        </div>
      </section>
    </div>
  );
}

function extractErrorMessage(error: unknown): string {
  const fallback = 'Something went wrong. Please try again.';
  if (!(error instanceof Error)) {
    return fallback;
  }

  const raw = error.message;
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === 'string') {
      return parsed;
    }
    if (parsed?.detail) {
      return parsed.detail;
    }
    const firstKey = Object.keys(parsed)[0];
    if (firstKey) {
      const value = parsed[firstKey];
      return Array.isArray(value) ? String(value[0]) : String(value);
    }
  } catch {
    // Message was not JSON; fall through to the raw text.
  }

  return raw || fallback;
}

type AccountStep = 'view' | 'otp' | 'edit';

function AccountModal({
  token,
  onClose,
  onSaved,
}: {
  token: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [step, setStep] = useState<AccountStep>('view');
  const [isLoading, setIsLoading] = useState(true);
  const [username, setUsername] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [verificationToken, setVerificationToken] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [isBusy, setIsBusy] = useState(false);

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const data: AccountDetails = await getAccount(token);
        if (!active) {
          return;
        }
        setUsername(data.username);
        setFirstName(data.first_name);
        setLastName(data.last_name);
        setEmail(data.email);
      } catch (loadError) {
        if (active) {
          setError(extractErrorMessage(loadError));
        }
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    }

    void load();
    return () => {
      active = false;
    };
  }, [token]);

  async function handleRequestOtp() {
    try {
      setIsBusy(true);
      setError('');
      setInfo('');
      const response = await requestAccountOtp(token);
      setInfo(response.detail);
      setCode('');
      setStep('otp');
    } catch (requestError) {
      setError(extractErrorMessage(requestError));
    } finally {
      setIsBusy(false);
    }
  }

  async function handleVerify() {
    try {
      setIsBusy(true);
      setError('');
      const response = await verifyAccountOtp(code.trim(), token);
      setVerificationToken(response.verification_token);
      setInfo('');
      setStep('edit');
    } catch (verifyError) {
      setError(extractErrorMessage(verifyError));
    } finally {
      setIsBusy(false);
    }
  }

  async function handleSave() {
    try {
      setIsBusy(true);
      setError('');

      const payload: AccountUpdatePayload = {
        username: username.trim().toLowerCase(),
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        email: email.trim().toLowerCase(),
      };
      if (password) {
        payload.password = password;
      }

      const updated = await updateAccount(payload, verificationToken, token);
      setUsername(updated.username);
      setFirstName(updated.first_name);
      setLastName(updated.last_name);
      setEmail(updated.email);
      setPassword('');
      setVerificationToken('');
      setCode('');
      setInfo('Your account details were updated.');
      setStep('view');
      await onSaved();
    } catch (saveError) {
      setError(extractErrorMessage(saveError));
    } finally {
      setIsBusy(false);
    }
  }

  const fieldsLocked = step !== 'edit';

  return (
    <div className="modalOverlay">
      <section className="clarificationModal" role="dialog" aria-modal="true" aria-labelledby="account-title">
        <div className="clarificationHeader">
          <div>
            <p className="eyebrow">Account</p>
            <h2 id="account-title">Your details</h2>
          </div>
          <button className="ghostButton" type="button" onClick={onClose} disabled={isBusy}>
            Close
          </button>
        </div>

        {isLoading ? (
          <p className="metaText">Loading your details…</p>
        ) : (
          <>
            <p className="metaText">
              {step === 'edit'
                ? 'Identity verified. Update your details below and save.'
                : 'Your details are locked. Verify with a code sent to your email to edit them.'}
            </p>

            <label className="fieldGroup">
              <span>Username</span>
              <input
                className="textInput"
                value={username}
                disabled={fieldsLocked || isBusy}
                onChange={(event) => setUsername(event.target.value)}
              />
            </label>
            <label className="fieldGroup">
              <span>First name</span>
              <input
                className="textInput"
                value={firstName}
                disabled={fieldsLocked || isBusy}
                onChange={(event) => setFirstName(event.target.value)}
              />
            </label>
            <label className="fieldGroup">
              <span>Last name</span>
              <input
                className="textInput"
                value={lastName}
                disabled={fieldsLocked || isBusy}
                onChange={(event) => setLastName(event.target.value)}
              />
            </label>
            <label className="fieldGroup">
              <span>Email</span>
              <input
                className="textInput"
                type="email"
                value={email}
                disabled={fieldsLocked || isBusy}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>

            {step === 'edit' ? (
              <label className="fieldGroup">
                <span>New password (optional)</span>
                <input
                  className="textInput"
                  type="password"
                  value={password}
                  disabled={isBusy}
                  placeholder="Leave blank to keep your current password"
                  onChange={(event) => setPassword(event.target.value)}
                />
              </label>
            ) : null}

            {step === 'otp' ? (
              <label className="fieldGroup">
                <span>Verification code</span>
                <input
                  className="textInput"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={code}
                  disabled={isBusy}
                  placeholder="6-digit code"
                  onChange={(event) => setCode(event.target.value)}
                />
                <span className="metaText">Check your email for the code. It expires in 10 minutes.</span>
              </label>
            ) : null}

            {info ? <p className="successText">{info}</p> : null}
            {error ? <p className="errorText">{error}</p> : null}

            <div className="modalActionRow">
              {step === 'view' ? (
                <button className="primaryButton" type="button" onClick={handleRequestOtp} disabled={isBusy}>
                  {isBusy ? 'Sending code…' : 'Edit details'}
                </button>
              ) : null}

              {step === 'otp' ? (
                <>
                  <button
                    className="primaryButton"
                    type="button"
                    onClick={handleVerify}
                    disabled={isBusy || !code.trim()}
                  >
                    {isBusy ? 'Verifying…' : 'Verify code'}
                  </button>
                  <button className="secondaryButton" type="button" onClick={handleRequestOtp} disabled={isBusy}>
                    Resend code
                  </button>
                  <button
                    className="ghostButton"
                    type="button"
                    onClick={() => {
                      setStep('view');
                      setError('');
                      setInfo('');
                      setCode('');
                    }}
                    disabled={isBusy}
                  >
                    Cancel
                  </button>
                </>
              ) : null}

              {step === 'edit' ? (
                <button className="primaryButton" type="button" onClick={handleSave} disabled={isBusy}>
                  {isBusy ? 'Saving…' : 'Save changes'}
                </button>
              ) : null}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

// --- Oversight: a superior viewing/acting on their team's tasks ---

function TeamTaskCard({
  task,
  token,
  availableUsers,
  onChanged,
}: {
  task: Task;
  token: string;
  availableUsers: User[];
  onChanged: () => Promise<void>;
}) {
  const [reassignTo, setReassignTo] = useState('');
  const [showDelete, setShowDelete] = useState(false);
  const [reason, setReason] = useState('');
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState('');

  async function doReassign() {
    if (!reassignTo) {
      return;
    }
    try {
      setIsBusy(true);
      setError('');
      await reassignTask(task.id, reassignTo, token);
      await onChanged();
    } catch (reassignError) {
      setError(parseApiError(reassignError).detail || 'Could not reassign the task.');
    } finally {
      setIsBusy(false);
    }
  }

  async function doDelete() {
    try {
      setIsBusy(true);
      setError('');
      await oversightDeleteTask(task.id, reason.trim(), token);
      await onChanged();
    } catch (deleteError) {
      setError(parseApiError(deleteError).detail || 'Could not delete the task.');
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <article className="taskBoardCard">
      <div className="taskTopRow">
        <strong>{task.title}</strong>
        <div className="taskMetaStack">
          <span className={`status status-task-${task.status}`}>{STATUS_LABELS[task.status]}</span>
          <span className={`priorityTag priority-${task.priority}`}>{task.priority}</span>
        </div>
      </div>
      {task.description ? <p className="taskDescription">{task.description}</p> : null}
      <p className="metaText">Due: {formatDueDate(task.due_date)}</p>
      <p className="metaText">
        From {task.assigned_from?.username || 'Unknown'} → to{' '}
        {task.assigned_to?.username || task.assigned_to_name || 'Unassigned'}
      </p>

      <div className="oversightActions">
        <label className="fieldGroup">
          <span>Reassign to someone under you</span>
          <div className="statusButtonRow">
            <select
              className="textInput"
              value={reassignTo}
              onChange={(event) => setReassignTo(event.target.value)}
              disabled={isBusy}
            >
              <option value="">Choose a person…</option>
              {availableUsers.map((option) => (
                <option key={option.id} value={option.username}>
                  {option.username}
                  {option.role_display ? ` (${option.role_display})` : ''}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="secondaryButton"
              onClick={() => void doReassign()}
              disabled={isBusy || !reassignTo}
            >
              Reassign
            </button>
          </div>
        </label>

        {!showDelete ? (
          <button type="button" className="ghostButton" onClick={() => setShowDelete(true)} disabled={isBusy}>
            Delete task…
          </button>
        ) : (
          <div className="notifyForm">
            <label className="fieldGroup">
              <span>Reason (emailed to the sender)</span>
              <textarea
                className="textInput textAreaInput"
                rows={2}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                disabled={isBusy}
                placeholder="Why are you removing this task?"
              />
            </label>
            <div className="modalActionRow">
              <button type="button" className="secondaryButton" onClick={() => void doDelete()} disabled={isBusy}>
                Confirm delete
              </button>
              <button type="button" className="ghostButton" onClick={() => setShowDelete(false)} disabled={isBusy}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {error ? <p className="errorText">{error}</p> : null}
    </article>
  );
}

function TeamTasksBoard({
  tasks,
  token,
  availableUsers,
  onChanged,
}: {
  tasks: Task[];
  token: string;
  availableUsers: User[];
  onChanged: () => Promise<void>;
}) {
  return (
    <section className="listSection">
      <div className="sectionHeader">
        <div>
          <p className="eyebrow">Oversight</p>
          <h2>Your team&apos;s tasks</h2>
        </div>
      </div>
      <p className="muted">
        Tasks sent and received by everyone beneath you in the chain of command. You can reassign or
        delete any of them.
      </p>
      <div className="taskBoardGrid">
        {tasks.map((task) => (
          <TeamTaskCard
            key={task.id}
            task={task}
            token={token}
            availableUsers={availableUsers}
            onChanged={onChanged}
          />
        ))}
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
  const [authNotice, setAuthNotice] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pendingReviewPrompts, setPendingReviewPrompts] = useState<ReviewPrompt[]>([]);
  const [isClarificationDismissed, setIsClarificationDismissed] = useState(false);
  const [isAccountOpen, setIsAccountOpen] = useState(false);

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
        setPendingReviewPrompts(createReviewPrompts(dashboardData.my_voice_messages));
        setIsClarificationDismissed(false);
      } catch {
        window.localStorage.removeItem(TOKEN_KEY);
        setToken('');
        setUser(null);
        setDashboard(null);
        setPendingReviewPrompts([]);
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
    setPendingReviewPrompts(createReviewPrompts(dashboardData.my_voice_messages));
    setIsClarificationDismissed(false);
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
    setAuthNotice('');

    const username = formState.username.trim().toLowerCase();

    try {
      if (authMode === 'register') {
        const response = await register({
          username,
          password: formState.password,
          first_name: formState.first_name,
          last_name: formState.last_name,
          email: formState.email,
          requested_role: formState.requested_role,
          requested_manager_name: formState.requested_manager_name,
        });
        setFormState(initialFormState);
        setAuthMode('login');
        setAuthNotice(response.detail);
        return;
      }

      const response = await login({ username, password: formState.password });
      window.localStorage.setItem(TOKEN_KEY, response.token);
      setToken(response.token);
      setUser(response.user);
      setFormState(initialFormState);
      await refreshDashboard(response.token);
    } catch (error) {
      const payload = parseApiError(error);
      setAuthError(payload.detail || 'Authentication failed.');
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
      setPendingReviewPrompts([]);
      setIsClarificationDismissed(false);
    }
  }

  async function handleUploaded() {
    if (!token) {
      return;
    }

    await refreshDashboard(token);
  }

  async function handleTaskChanged() {
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
                <label className="fieldGroup">
                  <span>Email</span>
                  <input
                    className="textInput"
                    type="email"
                    value={formState.email}
                    onChange={(event) => updateField('email', event.target.value)}
                    placeholder="you@example.com"
                    required
                  />
                  <span className="metaText">We&apos;ll email you here when a task is assigned to you.</span>
                </label>
                <label className="fieldGroup">
                  <span>Role you are applying for</span>
                  <select
                    className="textInput"
                    value={formState.requested_role}
                    onChange={(event) => updateField('requested_role', event.target.value)}
                  >
                    {SELF_REGISTER_ROLES.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                {formState.requested_role === 'outsource_staff' ? (
                  <label className="fieldGroup">
                    <span>Manager you will report to</span>
                    <input
                      className="textInput"
                      value={formState.requested_manager_name}
                      onChange={(event) => updateField('requested_manager_name', event.target.value)}
                      placeholder="Their username or full name"
                      required
                    />
                    <span className="metaText">
                      OutSource staff only take tasks from this one person.
                    </span>
                  </label>
                ) : null}
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

            {authNotice ? <p className="successText">{authNotice}</p> : null}
            {authError ? <p className="errorText">{authError}</p> : null}
          </form>
        </section>
      </main>
    );
  }

  const activePrompt =
    isClarificationDismissed || pendingReviewPrompts.length === 0 ? null : pendingReviewPrompts[0];

  return (
    <>
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
              <span className="recordBadge">
                Signed in as {user.username}
                {dashboard.account?.role_display ? ` • ${dashboard.account.role_display}` : ''}
              </span>
              {dashboard.is_admin ? (
                <a className="primaryButton" href="/admin" target="_blank" rel="noopener noreferrer">
                  Admin{dashboard.pending_count > 0 ? ` (${dashboard.pending_count})` : ''}
                </a>
              ) : null}
              <button className="ghostButton" type="button" onClick={() => setIsAccountOpen(true)}>
                Account
              </button>
              <button className="ghostButton" type="button" onClick={handleLogout}>
                Logout
              </button>
            </div>
            {dashboard.account?.manager ? (
              <p className="metaText">
                You report to {dashboard.account.manager.username}
                {dashboard.account.manager.role_display
                  ? ` (${dashboard.account.manager.role_display})`
                  : ''}
                .
              </p>
            ) : null}
          </div>

          <UploadForm token={token} onUploaded={handleUploaded} />
        </section>

        <TaskBoard tasks={dashboard.assigned_tasks} token={token} onChanged={handleTaskChanged} />
        {dashboard.team_tasks.length > 0 ? (
          <TeamTasksBoard
            tasks={dashboard.team_tasks}
            token={token}
            availableUsers={dashboard.available_users}
            onChanged={handleTaskChanged}
          />
        ) : null}
        <TranscriptList transcripts={dashboard.my_voice_messages} />
      </main>

      {activePrompt ? (
        <TaskReviewModal
          prompt={activePrompt}
          token={token}
          availableUsers={dashboard.available_users}
          onSaved={async () => {
            await refreshDashboard(token);
          }}
          onClose={() => setIsClarificationDismissed(true)}
        />
      ) : null}

      {isAccountOpen ? (
        <AccountModal
          token={token}
          onClose={() => setIsAccountOpen(false)}
          onSaved={async () => {
            await refreshDashboard(token);
          }}
        />
      ) : null}
    </>
  );
}
