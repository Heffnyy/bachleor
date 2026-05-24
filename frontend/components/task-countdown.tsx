'use client';

import { useEffect, useState } from 'react';

type TaskCountdownProps = {
  dueDate: string | null;
};

function getDueDateDeadline(dueDate: string) {
  return new Date(`${dueDate}T23:59:59`);
}

function formatDurationParts(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (days > 0) {
    return `${days}d ${hours}h ${minutes}m`;
  }

  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  }

  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }

  return `${seconds}s`;
}

function buildCountdownLabel(dueDate: string, now: Date) {
  const deadline = getDueDateDeadline(dueDate);
  const diff = deadline.getTime() - now.getTime();

  if (Number.isNaN(deadline.getTime())) {
    return { tone: 'none', text: 'Countdown unavailable' };
  }

  if (diff < 0) {
    return {
      tone: 'overdue',
      text: `Overdue by ${formatDurationParts(Math.abs(diff))}`,
    };
  }

  if (diff <= 24 * 60 * 60 * 1000) {
    return {
      tone: 'soon',
      text: `Due in ${formatDurationParts(diff)}`,
    };
  }

  return {
    tone: 'normal',
    text: `Due in ${formatDurationParts(diff)}`,
  };
}

export function TaskCountdown({ dueDate }: TaskCountdownProps) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    if (!dueDate) {
      return;
    }

    const timer = window.setInterval(() => {
      setNow(new Date());
    }, 1000);

    return () => window.clearInterval(timer);
  }, [dueDate]);

  if (!dueDate) {
    return <p className="countdownTag countdown-none">No due date</p>;
  }

  const countdown = buildCountdownLabel(dueDate, now);
  return <p className={`countdownTag countdown-${countdown.tone}`}>{countdown.text}</p>;
}
