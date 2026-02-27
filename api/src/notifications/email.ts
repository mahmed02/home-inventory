import { env } from "../config/env";
import { URL } from "node:url";

type EmailMessage = {
  to: string;
  subject: string;
  text: string;
  html: string;
};

export type EmailSendResult = {
  sent: boolean;
  provider: string;
  message_id?: string;
};

type VerificationEmailInput = {
  to: string;
  verificationToken: string;
  expiresAtIso: string;
};

type PasswordResetEmailInput = {
  to: string;
  resetToken: string;
  expiresAtIso: string;
};

type HouseholdInviteEmailInput = {
  to: string;
  invitationToken: string;
  role: string;
  expiresAtIso: string;
  householdName?: string | null;
  invitedByEmail?: string | null;
};

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function resolveBaseUrl(): URL {
  const raw = (env.appBaseUrl ?? "").trim();
  if (!raw) {
    return new URL(`http://localhost:${env.port}`);
  }
  if (/^https?:\/\//i.test(raw)) {
    return new URL(raw);
  }
  return new URL(`https://${raw}`);
}

function buildAppUrl(pathname: string, params: Record<string, string>): string {
  const url = new URL(pathname, resolveBaseUrl());
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

async function sendViaResend(message: EmailMessage): Promise<EmailSendResult> {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.emailResendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.emailFrom,
      to: [message.to],
      subject: message.subject,
      text: message.text,
      html: message.html,
      ...(env.emailReplyTo ? { reply_to: env.emailReplyTo } : {}),
    }),
  });

  if (!response.ok) {
    throw new Error(`resend request failed with status ${response.status}`);
  }

  const payload = (await response.json()) as { id?: string };
  return {
    sent: true,
    provider: "resend",
    message_id: payload.id,
  };
}

export async function sendEmail(message: EmailMessage): Promise<EmailSendResult> {
  if (env.emailProvider === "disabled") {
    return { sent: false, provider: "disabled" };
  }

  if (env.emailProvider === "log") {
    console.info(
      JSON.stringify({
        event: "email.send",
        provider: "log",
        to: message.to,
        subject: message.subject,
      })
    );
    return { sent: true, provider: "log" };
  }

  return sendViaResend(message);
}

export async function sendVerificationEmail(
  input: VerificationEmailInput
): Promise<EmailSendResult> {
  const verifyUrl = buildAppUrl("/auth", {
    mode: "verify-email",
    token: input.verificationToken,
  });
  const expiresAt = new Date(input.expiresAtIso).toUTCString();
  const escapedVerifyUrl = escapeHtml(verifyUrl);

  const subject = "Verify your Home Inventory email";
  const text = [
    "Verify your email for Home Inventory.",
    `Verification link: ${verifyUrl}`,
    `This link expires at ${expiresAt}.`,
  ].join("\n");
  const html = [
    "<p>Verify your email for <strong>Home Inventory</strong>.</p>",
    `<p><a href="${escapedVerifyUrl}">Verify email</a></p>`,
    `<p>This link expires at ${escapeHtml(expiresAt)}.</p>`,
  ].join("");

  return sendEmail({
    to: input.to,
    subject,
    text,
    html,
  });
}

export async function sendPasswordResetEmail(
  input: PasswordResetEmailInput
): Promise<EmailSendResult> {
  const resetUrl = buildAppUrl("/auth", {
    mode: "reset-password",
    token: input.resetToken,
  });
  const expiresAt = new Date(input.expiresAtIso).toUTCString();
  const escapedResetUrl = escapeHtml(resetUrl);

  const subject = "Reset your Home Inventory password";
  const text = [
    "A password reset was requested for your Home Inventory account.",
    `Reset link: ${resetUrl}`,
    `This link expires at ${expiresAt}.`,
  ].join("\n");
  const html = [
    "<p>A password reset was requested for your Home Inventory account.</p>",
    `<p><a href="${escapedResetUrl}">Reset password</a></p>`,
    `<p>This link expires at ${escapeHtml(expiresAt)}.</p>`,
  ].join("");

  return sendEmail({
    to: input.to,
    subject,
    text,
    html,
  });
}

export async function sendHouseholdInvitationEmail(
  input: HouseholdInviteEmailInput
): Promise<EmailSendResult> {
  const inviteUrl = buildAppUrl("/auth", {
    mode: "accept-invite",
    token: input.invitationToken,
  });
  const expiresAt = new Date(input.expiresAtIso).toUTCString();
  const escapedInviteUrl = escapeHtml(inviteUrl);
  const householdName = input.householdName?.trim() || "a household";
  const inviter = input.invitedByEmail?.trim() || "A household owner";
  const roleText = input.role.trim().toLowerCase();

  const subject = "Home Inventory household invitation";
  const text = [
    `${inviter} invited you to join ${householdName} as ${roleText}.`,
    `Invitation link: ${inviteUrl}`,
    `This link expires at ${expiresAt}.`,
  ].join("\n");
  const html = [
    `<p>${escapeHtml(inviter)} invited you to join <strong>${escapeHtml(householdName)}</strong> as <strong>${escapeHtml(roleText)}</strong>.</p>`,
    `<p><a href="${escapedInviteUrl}">Open invitation</a></p>`,
    `<p>This link expires at ${escapeHtml(expiresAt)}.</p>`,
  ].join("");

  return sendEmail({
    to: input.to,
    subject,
    text,
    html,
  });
}
