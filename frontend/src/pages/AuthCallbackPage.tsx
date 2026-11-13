import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Brand } from "../components/Brand";
import { isSupabaseConfigured, supabase } from "../lib/supabase";

type CallbackState = "processing" | "success" | "invalid" | "failure";

function callbackParameter(url: URL, name: string) {
  const searchValue = url.searchParams.get(name);
  if (searchValue) return searchValue;
  return new URLSearchParams(url.hash.replace(/^#/, "")).get(name);
}

function isInvalidConfirmationError(message: string) {
  const normalized = message.toLowerCase();
  return ["expired", "invalid", "otp", "pkce", "verifier", "already been used"].some((term) =>
    normalized.includes(term),
  );
}

function clearCallbackParameters() {
  window.history.replaceState(window.history.state, document.title, "/auth/callback");
}

export function AuthCallbackPage() {
  const [state, setState] = useState<CallbackState>("processing");
  const confirmation = useRef<Promise<CallbackState> | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    let redirectTimer: number | undefined;
    let active = true;

    async function confirmEmail(): Promise<CallbackState> {
      const callbackUrl = new URL(window.location.href);
      const callbackError = callbackParameter(callbackUrl, "error");
      const callbackErrorCode = callbackParameter(callbackUrl, "error_code");
      const callbackErrorDescription = callbackParameter(callbackUrl, "error_description");
      const authorizationCode = callbackUrl.searchParams.get("code");
      const flowId = callbackUrl.searchParams.get("sb_flow_id");
      const hashParameters = new URLSearchParams(callbackUrl.hash.replace(/^#/, ""));
      const accessToken = hashParameters.get("access_token");
      const refreshToken = hashParameters.get("refresh_token");

      clearCallbackParameters();
      if (!isSupabaseConfigured || !supabase) return "failure";

      if (callbackError || callbackErrorCode || callbackErrorDescription) return "invalid";

      try {
        let token: string | undefined;
        if (authorizationCode) {
          const { data, error } = await supabase.auth.exchangeCodeForSession(
            authorizationCode,
            flowId ? { flowId } : undefined,
          );
          if (error) throw error;
          if (!data.session) return "invalid";
          token = data.session.access_token;
        } else if (accessToken && refreshToken) {
          const { data, error } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          if (error) throw error;
          if (!data.session) return "invalid";
          token = data.session.access_token;
        } else {
          const { data, error } = await supabase.auth.getSession();
          if (error) throw error;
          if (!data.session) return "invalid";
          token = data.session.access_token;
        }

        if (!token) return "invalid";
        const verified = await supabase.auth.getUser(token);
        return verified.error || !verified.data.user ? "invalid" : "success";
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        return isInvalidConfirmationError(message) ? "invalid" : "failure";
      }
    }

    confirmation.current ??= confirmEmail();
    void confirmation.current.then((nextState) => {
      if (!active) return;
      setState(nextState);
      if (nextState === "success") {
        redirectTimer = window.setTimeout(() => navigate("/dashboard", { replace: true }), 1200);
      }
    });

    return () => {
      active = false;
      if (redirectTimer !== undefined) window.clearTimeout(redirectTimer);
    };
  }, [navigate]);

  return (
    <main className="auth-callback-page">
      <section className="auth-callback-card" aria-live="polite">
        <Brand />
        {state === "processing" && (
          <>
            <div className="spinner" aria-hidden="true" />
            <h1>Confirming your email…</h1>
            <p>Please keep this page open while we securely finish setting up your account.</p>
          </>
        )}
        {state === "success" && (
          <>
            <div className="callback-status success" aria-hidden="true">✓</div>
            <h1>Email verified</h1>
            <p>Your account is ready. We’re taking you to your workspace now.</p>
          </>
        )}
        {state === "invalid" && (
          <>
            <div className="callback-status error" aria-hidden="true">!</div>
            <h1>Confirmation link expired or invalid</h1>
            <p>This link may have expired or already been used. Return to account creation and sign up again to receive a fresh confirmation email.</p>
            <Link className="button primary" to="/signup">Return to account creation</Link>
          </>
        )}
        {state === "failure" && (
          <>
            <div className="callback-status error" aria-hidden="true">!</div>
            <h1>We couldn’t confirm your email</h1>
            <p>Please try the confirmation link again. If it still fails, return to account creation and request a fresh email.</p>
            <Link className="button primary" to="/login">Return to sign in</Link>
          </>
        )}
      </section>
    </main>
  );
}
