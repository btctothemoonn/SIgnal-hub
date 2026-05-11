"use client";

import { useActionState } from "react";
import { loginAdmin, type LoginState } from "./actions";

const initialState: LoginState = { error: null };

export function LoginForm({ nextPath }: { nextPath: string }) {
  const [state, formAction, pending] = useActionState(loginAdmin, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input name="next" type="hidden" value={nextPath} />
      <div className="flex flex-col gap-2">
        <label htmlFor="password" className="text-sm font-semibold text-foreground">
          Admin password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          autoFocus
          required
          className="h-11 rounded-lg border border-line/70 bg-panel-strong px-3 text-base text-foreground outline-none transition-colors placeholder:text-muted focus:border-accent/50 focus:bg-panel"
        />
      </div>

      {state.error ? (
        <p className="rounded-lg border border-danger/25 bg-danger-soft px-3 py-2 text-sm text-danger">
          {state.error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="inline-flex h-11 items-center justify-center rounded-lg bg-foreground px-4 text-sm font-semibold text-background transition-opacity disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? "Signing in..." : "Sign in"}
      </button>
    </form>
  );
}
