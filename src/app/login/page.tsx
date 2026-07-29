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
    <main data-login-workspace className="min-h-screen bg-background px-4 py-8 text-foreground sm:px-6">
      <section className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-sm flex-col justify-center">
        <div className="mb-6 border-b border-line/70 pb-5">
          <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-[6px] bg-foreground text-sm font-bold text-background">
            SH
          </div>
          <h1 className="text-2xl font-semibold leading-tight">
            Signal Hub
          </h1>
          <p className="mt-2 text-sm text-muted">Admin access</p>
        </div>

        <div className="rounded-[6px] border border-line/70 bg-panel-strong p-4 sm:p-5">
          <LoginForm error={error} nextPath={nextPath} />
        </div>
      </section>
    </main>
  );
}
