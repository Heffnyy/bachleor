'use client';

import { useState } from 'react';
import { TaskCountdown } from '@/components/task-countdown';
import { type Transcript } from '@/lib/api';

type TranscriptListProps = {
  transcripts: Transcript[];
  onTaskCompleted?: (taskId: number) => Promise<void>;
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

export function TranscriptList({ transcripts, onTaskCompleted }: TranscriptListProps) {
  const [completingTaskId, setCompletingTaskId] = useState<number | null>(null);
  const [completionError, setCompletionError] = useState('');

  async function handleComplete(taskId: number) {
    if (!onTaskCompleted) {
      return;
    }

    try {
      setCompletionError('');
      setCompletingTaskId(taskId);
      await onTaskCompleted(taskId);
    } catch (error) {
      setCompletionError(error instanceof Error ? error.message : 'Could not complete the task.');
    } finally {
      setCompletingTaskId(null);
    }
  }

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
                          {!task.is_reviewed ? <span className="reviewTag">Pending review</span> : null}
                          {task.is_completed ? <span className="status status-completed">completed</span> : null}
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
                      {!task.is_completed && onTaskCompleted ? (
                        <button
                          className="primaryButton"
                          type="button"
                          onClick={() => void handleComplete(task.id)}
                          disabled={completingTaskId === task.id}
                        >
                          {completingTaskId === task.id ? 'Saving...' : 'Done'}
                        </button>
                      ) : null}
                      {task.is_completed && task.completed_at ? (
                        <p className="metaText">Completed: {formatDueDate(task.completed_at)}</p>
                      ) : null}
                    </div>
                  ))}
                </div>
                {completionError ? <p className="errorText">{completionError}</p> : null}
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
