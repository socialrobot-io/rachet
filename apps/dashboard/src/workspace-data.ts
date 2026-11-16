import { useEffect, useState } from 'react';
import { api, ApiError } from './api';
import { useAuth } from './auth';
import type { Enrollment, Message, Workflow } from './types';

export function useWorkspaceData() {
  const { workspaceId } = useAuth();
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!workspaceId) {
      setWorkflows([]);
      setEnrollments([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    void Promise.all([
      api.workflows(workspaceId),
      api.enrollments(workspaceId),
    ])
      .then(([nextWorkflows, nextEnrollments]) => {
        if (cancelled) return;
        setWorkflows(nextWorkflows);
        setEnrollments(nextEnrollments);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : 'Failed to load workspace');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  return { workspaceId, workflows, enrollments, error, loading, setEnrollments };
}

export function useMessageHistory(workspaceId: string | null | undefined, enrollmentId: string | undefined, oneOff?: true) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshCount, setRefreshCount] = useState(0);

  useEffect(() => {
    setMessages([]);
    setError(null);
    if (!workspaceId || (!oneOff && !enrollmentId)) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const filter = enrollmentId ? { enrollmentId } : { oneOff: true as const };
    void api.messages(workspaceId, filter)
      .then((rows) => {
        if (!cancelled) setMessages(rows);
      })
      .catch(() => {
        if (!cancelled) setError('Could not load message history.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [workspaceId, enrollmentId, oneOff, refreshCount]);

  return { messages, error, loading, refresh: () => setRefreshCount((count) => count + 1) };
}
