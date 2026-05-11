"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  ADMIN_SESSION_COOKIE,
  buildAdminSessionCookieOptions,
  createAdminSessionToken,
  isAdminAuthConfigured,
  normalizeAdminNextPath,
  verifyAdminPassword,
} from "@/lib/admin-auth";

export type LoginState = {
  error: string | null;
};

function formText(value: FormDataEntryValue | null): string | null {
  return typeof value === "string" ? value : null;
}

export async function loginAdmin(
  _state: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const nextPath = normalizeAdminNextPath(formText(formData.get("next")));

  if (!isAdminAuthConfigured()) {
    return { error: "Admin login is not configured." };
  }

  if (!verifyAdminPassword(formData.get("password"))) {
    return { error: "Invalid password." };
  }

  const cookieStore = await cookies();
  cookieStore.set(
    ADMIN_SESSION_COOKIE,
    createAdminSessionToken(),
    buildAdminSessionCookieOptions(),
  );

  redirect(nextPath);
}
