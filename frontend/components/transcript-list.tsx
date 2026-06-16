'use client';

import { useState } from 'react';

import { TaskCountdown } from '@/components/task-countdown';
import {
  oversightDeleteTask,
  parseApiError,
  type Task,
  type TaskNote,
  type TaskStatus,
  type Transcript,
} from '@/lib/api';

type TranscriptListProps = {
  transcripts: Transcript[];
  token: string;
  canDeleteTasks: boolean;
  onChanged: () => Promise<void>;
};

const STATUS_LABELS: Record<TaskStatus, string> = {
  delivered: 'Pending',
  in_progress: 'In progress',
  done: 'Done',
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function formatDueDate(value: string | null) {
  if (!value) {
    return 'No due date';
  }

  return new Intl.DateTimeFormat('en', {
    dateStyle: 'medium',
  }).format(new Date(value));
}

function ReceiverNote({ note }: { note: TaskNote }) {
  const label =
    note.kind === 'problem'
      ? 'Problem reported'
      : note.kind === 'delay'
        ? 'Delay requested'
        : 'Update';
  const author = note.author?.username || 'the assignee';

  return (
    <div className="noteItem">
      <div className="noteItemHead">
        <span className={`noteTag noteTag-${note.kind}`}>{label}</span>
        <span className="metaText">
          from {author} • {formatDate(note.created_at)}
        </span>
      </div>
      {note.requested_due_date ? (
        <p className="metaText">Proposed new due date: {formatDueDate(note.requested_due_date)}</p>
      ) : null}
      {note.message ? <p className="taskDescription">{note.message}</p> : null}
    </div>
  );
}

function TaskDeleteControl({
  task,
  token,
  onChanged,
}: {
  task: Task;
  token: string;
  onChanged: () => Promise<void>;
}) {
  const [showDelete, setShowDelete] = useState(false);
  const [reason, setReason] = useState('');
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState('');

  async function doDelete() {
    try {
      setIsBusy(true);
      setError('');
      await oversightDeleteTask(task.id, reason.trim(), token);
      await onChanged();
    } catch (deleteError) {
      setError(parseApiError(deleteError).detail || 'Could not delete the task.');
      setIsBusy(false);
    }
  }

  if (!showDelete) {
    return (
      <div className="modalActionRow">
        <button type="button" className="dangerButton" onClick={() => setShowDelete(true)}>
          Delete task…
        </button>
      </div>
    );
  }

  return (
    <div className="deleteConfirm">
      <label className="fieldGroup">
        <span>Reason (emailed to the assignee)</span>
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
        <button type="button" className="dangerButton" onClick={() => void doDelete()} disabled={isBusy}>
          {isBusy ? 'Deleting…' : 'Confirm delete'}
        </button>
        <button
          type="button"
          className="ghostButton"
          onClick={() => setShowDelete(false)}
          disabled={isBusy}
        >
          Cancel
        </button>
      </div>
      {error ? <p className="errorText">{error}</p> : null}
    </div>
  );
}

export function TranscriptList({ transcripts, token, canDeleteTasks, onChanged }: TranscriptListProps) {
  if (transcripts.length === 0) {
    return (
      <section className="emptyState">
        <h3>No transcripts yet</h3>
        <p>Upload an Arabic or English recording to create your first voice message.</p>
      </section>
    );
  }

  return (
    <section className="listSection">
      <div className="sectionHeader">
        <div>
          <p className="eyebrow">My Voice Messages</p>
          <h2>Your transcript history</h2>
        </div>
      </div>

      <div className="transcriptGrid">
        {transcripts.map((item) => (
          <article className="transcriptCard" key={item.id}>
            <div className="cardTopRow">
              <strong>{item.original_filename}</strong>
              <span className={`status status-${item.status}`}>{item.status}</span>
            </div>
            <p className="metaText">Created {formatDate(item.created_at)}</p>
            <p className="metaText">
              Language: {item.detected_language || 'auto'}
              {item.duration_seconds ? ` • ${item.duration_seconds}s` : ''}
            </p>
            <div className="transcriptBody">
              {item.transcript || item.error_message || 'Transcript is not available yet.'}
            </div>
            {item.error_message ? <p className="taskErrorText">{item.error_message}</p> : null}
            {item.tasks.length > 0 ? (
              <div className="taskSection">
                <p className="taskHeading">Extracted tasks</p>
                <div className="taskList">
                  {item.tasks.map((task) => (
                    <div className="taskCard" key={task.id}>
                      <div className="taskTopRow">
                        <strong>{task.title}</strong>
                        <div className="taskMetaStack">
                          {!task.is_reviewed ? (
                            <span className="reviewTag">Pending review</span>
                          ) : (
                            <span className={`status status-task-${task.status}`}>
                              {STATUS_LABELS[task.status]}
                            </span>
                          )}
                          <span className={`priorityTag priority-${task.priority}`}>{task.priority}</span>
                        </div>
                      </div>
                      {task.description ? <p className="taskDescription">{task.description}</p> : null}
                      <p className="metaText">Due: {formatDueDate(task.due_date)}</p>
                      <TaskCountdown dueDate={task.due_date} />
                      <p className="metaText">
                        Assigned to: {task.assigned_to?.username || task.assigned_to_name || 'Unassigned'}
                      </p>
                      <p className="metaText">
                        Assigned from: {task.assigned_from?.username || 'Unknown'}
                      </p>
                      {task.transcription?.audio_url ? (
                        <audio controls className="audioPlayer" src={task.transcription.audio_url}>
                          Your browser does not support audio playback.
                        </audio>
                      ) : null}
                      {task.status === 'done' && task.completed_at ? (
                        <p className="metaText">Completed: {formatDueDate(task.completed_at)}</p>
                      ) : null}
                      {task.notes.length > 0 ? (
                        <div className="noteThread">
                          <p className="taskHeading">Updates from the assignee</p>
                          {task.notes.map((note) => (
                            <ReceiverNote key={note.id} note={note} />
                          ))}
                        </div>
                      ) : null}
                      {canDeleteTasks ? (
                        <TaskDeleteControl task={task} token={token} onChanged={onChanged} />
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            ) : item.status === 'completed' ? (
              <div className="taskSection">
                <p className="taskHeading">Extracted tasks</p>
                <p className="metaText">No tasks were created for this transcript yet.</p>
              </div>
            ) : null}
            {item.audio_url ? (
              <audio controls className="audioPlayer" src={item.audio_url}>
                Your browser does not support audio playback.
              </audio>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}
