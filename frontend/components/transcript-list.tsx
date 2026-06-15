'use client';

import { TaskCountdown } from '@/components/task-countdown';
import { type TaskNote, type TaskStatus, type Transcript } from '@/lib/api';

type TranscriptListProps = {
  transcripts: Transcript[];
};

const STATUS_LABELS: Record<TaskStatus, string> = {
  delivered: 'Delivered',
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

export function TranscriptList({ transcripts }: TranscriptListProps) {
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
