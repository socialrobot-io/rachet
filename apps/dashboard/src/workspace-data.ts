import { useEffect, useState } from 'react';
import { api, ApiError } from './api';
import { useAuth } from './auth';
import type { Enrollment, Message, Workflow } from './types';

export function useWorkspaceData(withMessages = true) {
  const { workspaceId } = useAuth();
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!workspaceId) {
      setWorkflows([]);
      setEnrollments([]);
      setMessages([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    void Promise.all([
      api.workflows(workspaceId),
      api.enrollments(workspaceId),
      withMessages ? api.messages(workspaceId) : Promise.resolve([]),
    ])
      .then(([nextWorkflows, nextEnrollments, nextMessages]) => {
        if (cancelled) return;
        setWorkflows(nextWorkflows);
        setEnrollments(nextEnrollments);
        setMessages(nextMessages);
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
  }, [workspaceId, withMessages]);

  return { workspaceId, workflows, enrollments, messages, error, loading, setEnrollments };
}
