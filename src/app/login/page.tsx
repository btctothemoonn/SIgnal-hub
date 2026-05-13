import type { Metadata } from "next";
import { normalizeAdminNextPath } from "@/lib/admin-auth";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Sign in | Signal Hub",
};

type LoginPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = searchParams ? await searchParams : {};
  const rawNext = Array.isArray(params.next) ? params.next[0] : params.next;
  const rawError = Array.isArray(params.error) ? params.error[0] : params.error;
  const nextPath = normalizeAdminNextPath(rawNext);
  const error =
    rawError === "config"
      ? "Admin login is not configured."
      : rawError === "invalid"
        ? "Invalid password."
        : null;

  return (
    <main className="min-h-screen bg-background px-4 py-8 text-foreground sm:px-6">
      <section className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-md flex-col justify-center">
        <div className="mb-8">
          <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-lg bg-foreground text-sm font-bold text-background shadow-[0_18px_36px_-28px_rgba(38,31,27,0.8)]">
            SH
          </div>
          <h1 className="font-serif text-3xl font-medium leading-tight">
            Signal Hub
          </h1>
          <p className="mt-2 text-sm text-muted">Private admin access</p>
        </div>

        <div className="rounded-lg border border-line/70 bg-panel-strong p-5 shadow-[0_24px_60px_-48px_rgba(38,31,27,0.55)]">
          <LoginForm error={error} nextPath={nextPath} />
        </div>
      </section>
    </main>
  );
}
