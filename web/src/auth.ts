import { createClient } from "@supabase/supabase-js";
import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
export const supabase =
  url && key
    ? createClient(url, key, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      })
    : null;

export function useSession() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(!!supabase);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    let eventSeen = false;
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, value) => {
      eventSeen = true;
      if (!cancelled) {
        setSession(value);
        setLoading(false);
      }
    });
    supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) setError(error.message);
        if (!eventSeen) setSession(data.session);
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) {
          setError("Unable to restore your session. Please sign in again.");
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);
  return { session, loading, error };
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function api<T>(
  params: Record<string, string>,
  signal?: AbortSignal,
  mutation?: { method: "POST" | "PATCH" | "DELETE"; body: unknown },
): Promise<T> {
  const { data } = await supabase!.auth.getSession();
  if (!data.session) throw new ApiError("Your session has expired. Please sign in again.", 401);
  const response = await fetch(`/api/dashboard?${new URLSearchParams(params)}`, {
    headers: {
      Authorization: `Bearer ${data.session.access_token}`,
      ...(mutation ? { "Content-Type": "application/json" } : {}),
    },
    method: mutation?.method ?? "GET",
    body: mutation ? JSON.stringify(mutation.body) : undefined,
    signal,
    cache: "no-store",
  });
  const body = await response.json();
  if (!response.ok)
    throw new ApiError(body.error ?? "Unable to load dashboard data", response.status);
  return body as T;
}
