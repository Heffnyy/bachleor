'use client';

import { useEffect, useState } from 'react';
import { AdminPanel } from '@/components/admin-panel';

const TOKEN_KEY = 'voice-task-token';

export default function AdminPage() {
  const [token, setToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setToken(window.localStorage.getItem(TOKEN_KEY));
    setReady(true);
  }, []);

  if (!ready) {
    return (
      <main className="pageShell">
        <section className="emptyState">
          <h3>Loading…</h3>
        </section>
      </main>
    );
  }

  if (!token) {
    return (
      <main className="pageShell">
        <section className="emptyState">
          <h3>Not signed in</h3>
          <p>Open the app in the main tab and log in as an administrator first, then reopen this page.</p>
        </section>
      </main>
    );
  }

  return (
    <main className="pageShell">
      <section className="heroSection">
        <div className="heroCopy">
          <p className="eyebrow">Admin</p>
          <h1>User management</h1>
          <p className="heroText">
            Approve or reject registrations, set each person&apos;s role and who they report to, and
            promote or demote existing users.
          </p>
          <div className="heroMetaRow">
            <a className="ghostButton" href="/" target="_self">
              ← Back to app
            </a>
          </div>
        </div>
      </section>

      <AdminPanel token={token} />
    </main>
  );
}
