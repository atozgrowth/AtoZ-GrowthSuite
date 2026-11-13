import type { Session, User } from "@supabase/supabase-js";
import { createContext, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { isSupabaseConfigured, supabase } from "../lib/supabase";
export type SignUpResult = { status: "authenticated" | "confirmation-required" | "existing-account" };
export interface AuthContextValue {
  session: Session | null; user: User | null; loading: boolean; configured: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<SignUpResult>;
  signOut: () => Promise<void>;
}
export const AuthContext = createContext<AuthContextValue | undefined>(undefined);

async function verifiedSession(next: Session | null): Promise<Session | null> {
  if (!next?.access_token || !supabase) return null;
  // Cached session metadata is not an authorization source. Validate with Auth.
  const { data, error } = await supabase.auth.getUser(next.access_token);
  if (error || !data.user) return null;
  return { ...next, user: data.user };
}
export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(isSupabaseConfigured);
  useEffect(() => {
    if (!supabase) { setLoading(false); return; }
    let active = true, generation = 0, observedEvent = false;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    async function restore(next: Session | null, current = ++generation) {
      setLoading(true);
      try {
        const verified = await verifiedSession(next);
        if (active && current === generation) setSession(verified);
      } catch {
        if (active && current === generation) setSession(null);
      } finally {
        if (active && current === generation) setLoading(false);
      }
    }
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      if (!active) return;
      observedEvent = true;
      // Invalidate older verification immediately, including a cross-tab logout.
      const current = ++generation;
      setSession(null); setLoading(Boolean(next));
      if (!next) return;
      // Leave Supabase's callback/lock before making another Auth call.
      const timer = setTimeout(() => {
        timers.delete(timer);
        if (active && current === generation) void restore(next, current);
      }, 0);
      timers.add(timer);
    });
    void supabase.auth.getSession().then(({ data: initial, error }) => {
      if (active && !observedEvent) void restore(error ? null : initial.session);
    }).catch(() => { if (active && !observedEvent) void restore(null); });
    return () => { active = false; generation++; data.subscription.unsubscribe(); timers.forEach(clearTimeout); };
  }, []);
  const signIn = useCallback(async (email: string, password: string) => {
    if (!supabase) throw new Error("Authentication is not available. Please try again later.");
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    const next = await verifiedSession(data.session);
    if (!next) throw new Error("We could not verify your session. Please try again.");
    // Session state is owned by the versioned auth-event restoration above.
  }, []);
  const signUp = useCallback(async (email: string, password: string): Promise<SignUpResult> => {
    if (!supabase) throw new Error("Authentication is not available. Please try again later.");
    const { data, error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: new URL("/auth/callback", window.location.origin).toString() } });
    if (error) throw error;
    if (data.session) {
      const next = await verifiedSession(data.session);
      if (!next) throw new Error("We could not verify your session. Please sign in again.");
      return { status: "authenticated" };
    }
    return { status: data.user?.identities?.length === 0 ? "existing-account" : "confirmation-required" };
  }, []);
  const signOut = useCallback(async () => {
    if (supabase) { const { error } = await supabase.auth.signOut({ scope: "local" }); if (error) throw error; }
    setSession(null);
  }, []);
  const value = useMemo(() => ({ session, user: session?.user ?? null, loading, configured: isSupabaseConfigured, signIn, signUp, signOut }), [session, loading, signIn, signUp, signOut]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
