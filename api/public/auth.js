const AUTH_TOKEN_STORAGE_KEY = "home_inventory_auth_token";
const AUTH_USER_STORAGE_KEY = "home_inventory_auth_user";
const ACTIVE_HOUSEHOLD_STORAGE_KEY = "home_inventory_active_household_id";
const PENDING_INVITE_TOKEN_STORAGE_KEY = "home_inventory_pending_invite_token";
const PENDING_RESET_TOKEN_STORAGE_KEY = "home_inventory_pending_reset_token";

const authPageBadgeEl = document.getElementById("authPageBadge");
const authPageStateHintEl = document.getElementById("authPageStateHint");
const authPageLoggedOutEl = document.getElementById("authPageLoggedOut");
const authPageLoggedInEl = document.getElementById("authPageLoggedIn");
const authPageUserEmailEl = document.getElementById("authPageUserEmail");
const authPageInventoryLinkEl = document.getElementById("authPageInventoryLink");
const authPageLogoutBtnEl = document.getElementById("authPageLogoutBtn");
const authPageLogoutBtnSecondaryEl = document.getElementById("authPageLogoutBtnSecondary");
const authPageStatusEl = document.getElementById("authPageStatus");

const loginForm = document.getElementById("loginForm");
const registerForm = document.getElementById("registerForm");
const forgotPasswordForm = document.getElementById("forgotPasswordForm");
const resetPasswordForm = document.getElementById("resetPasswordForm");

const loginEmailInput = document.getElementById("loginEmail");
const loginPasswordInput = document.getElementById("loginPassword");
const registerDisplayNameInput = document.getElementById("registerDisplayName");
const registerEmailInput = document.getElementById("registerEmail");
const registerPasswordInput = document.getElementById("registerPassword");
const forgotEmailInput = document.getElementById("forgotEmail");
const resetTokenInput = document.getElementById("resetToken");
const resetNewPasswordInput = document.getElementById("resetNewPassword");

let authToken = "";
let authUser = null;
let authLinkMode = "";
let authLinkToken = "";

function clearAuthLinkQuery() {
  const currentUrl = new URL(window.location.href);
  const params = currentUrl.searchParams;
  const hadMode = params.has("mode");
  const hadToken = params.has("token");
  if (!hadMode && !hadToken) {
    return;
  }
  params.delete("mode");
  params.delete("token");
  const nextQuery = params.toString();
  const nextPath = `${currentUrl.pathname}${nextQuery ? `?${nextQuery}` : ""}${currentUrl.hash}`;
  window.history.replaceState({}, "", nextPath);
}

function captureAuthLinkState() {
  const params = new URLSearchParams(window.location.search);
  const mode = (params.get("mode") || "").trim().toLowerCase();
  const token = (params.get("token") || "").trim();
  if (!mode || !token) {
    return;
  }

  authLinkMode = mode;
  authLinkToken = token;

  if (mode === "accept-invite") {
    sessionStorage.setItem(PENDING_INVITE_TOKEN_STORAGE_KEY, token);
  } else if (mode === "reset-password") {
    sessionStorage.setItem(PENDING_RESET_TOKEN_STORAGE_KEY, token);
  }

  clearAuthLinkQuery();
}

function getPendingResetToken() {
  return (sessionStorage.getItem(PENDING_RESET_TOKEN_STORAGE_KEY) || "").trim();
}

function clearPendingResetToken() {
  sessionStorage.removeItem(PENDING_RESET_TOKEN_STORAGE_KEY);
}

function setStatus(message) {
  if (authPageStatusEl) {
    authPageStatusEl.textContent = message;
  }
}

function clearStoredSession() {
  localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
  localStorage.removeItem(AUTH_USER_STORAGE_KEY);
  localStorage.removeItem(ACTIVE_HOUSEHOLD_STORAGE_KEY);
}

function persistSession() {
  if (!authUser) {
    clearStoredSession();
    return;
  }
  if (authToken) {
    localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, authToken);
  } else {
    localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
  }
  localStorage.setItem(AUTH_USER_STORAGE_KEY, JSON.stringify(authUser));
}

function applyUiState() {
  const signedIn = Boolean(authUser);

  if (authPageBadgeEl) {
    authPageBadgeEl.textContent = signedIn ? authUser.email || "Signed in" : "Guest";
  }
  if (authPageStateHintEl) {
    authPageStateHintEl.textContent = signedIn ? "Signed in" : "Not signed in";
  }
  if (authPageLoggedOutEl) {
    authPageLoggedOutEl.hidden = signedIn;
  }
  if (authPageLoggedInEl) {
    authPageLoggedInEl.hidden = !signedIn;
  }
  if (authPageUserEmailEl) {
    authPageUserEmailEl.textContent = signedIn ? authUser.email || "account" : "-";
  }
  if (authPageInventoryLinkEl) {
    authPageInventoryLinkEl.hidden = !signedIn;
  }
  if (authPageLogoutBtnEl) {
    authPageLogoutBtnEl.hidden = !signedIn;
  }
}

function setSession(token, user) {
  authToken = token || "";
  authUser = user || null;
  persistSession();
  applyUiState();
}

function restoreSessionFromStorage() {
  const token = localStorage.getItem(AUTH_TOKEN_STORAGE_KEY) || "";
  const rawUser = localStorage.getItem(AUTH_USER_STORAGE_KEY);
  let user = null;
  if (rawUser) {
    try {
      user = JSON.parse(rawUser);
    } catch {
      user = null;
    }
  }
  setSession(token, user);
}

async function fetchJson(path, options = {}) {
  const { skipAuth = false, headers: extraHeaders = {}, ...requestOptions } = options;
  const headers = {
    "Content-Type": "application/json",
    ...extraHeaders,
  };

  if (authToken && !skipAuth) {
    headers.Authorization = `Bearer ${authToken}`;
  }

  const response = await fetch(path, {
    headers,
    credentials: "same-origin",
    ...requestOptions,
  });

  const text = await response.text();
  const parsed = text ? JSON.parse(text) : null;
  const data =
    parsed && typeof parsed === "object" && "ok" in parsed
      ? parsed.ok
        ? parsed.data
        : parsed.error
      : parsed;

  if (!response.ok) {
    const message =
      data && typeof data.message === "string"
        ? data.message
        : data && typeof data.error === "string"
          ? data.error
          : `Request failed (${response.status})`;
    throw new Error(message);
  }

  return data;
}

async function hydrateSession() {
  try {
    const payload = await fetchJson("/auth/me", { skipAuth: !authToken });
    setSession(authToken, payload && payload.user ? payload.user : null);
  } catch {
    setSession("", null);
  }
}

async function handleLogout() {
  try {
    await fetchJson("/auth/logout", { method: "POST" });
  } catch {
    // ignore logout failures and clear local state
  } finally {
    setSession("", null);
    setStatus("Signed out.");
  }
}

async function handleAuthLinkMode() {
  const mode = authLinkMode;
  const token = authLinkToken;
  if (!mode || !token) {
    return;
  }

  if (mode === "reset-password") {
    const recoveryDetails = document.querySelector(".auth-recovery");
    if (recoveryDetails && "open" in recoveryDetails) {
      recoveryDetails.open = true;
    }
    setStatus("Reset link loaded. Enter a new password to continue.");
    return;
  }

  if (mode === "verify-email") {
    try {
      await fetchJson("/auth/verify-email/confirm", {
        method: "POST",
        skipAuth: true,
        body: JSON.stringify({ token }),
      });
      setStatus("Email verified. You can sign in.");
    } catch (error) {
      setStatus(error.message);
    }
  }

  if (mode === "accept-invite") {
    setStatus("Invitation loaded. Sign in to accept it.");
  }
}

function consumePendingInviteToken() {
  const token = (sessionStorage.getItem(PENDING_INVITE_TOKEN_STORAGE_KEY) || "").trim();
  if (!token) {
    return null;
  }
  sessionStorage.removeItem(PENDING_INVITE_TOKEN_STORAGE_KEY);
  return token;
}

if (loginForm) {
  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const email = loginEmailInput.value.trim();
    const password = loginPasswordInput.value;
    if (!email || !password) {
      setStatus("Email and password are required.");
      return;
    }

    try {
      const payload = await fetchJson("/auth/login", {
        method: "POST",
        skipAuth: true,
        body: JSON.stringify({ email, password }),
      });
      setSession(payload && typeof payload.token === "string" ? payload.token : "", payload.user);
      loginForm.reset();
      const inviteToken = consumePendingInviteToken();
      if (inviteToken) {
        sessionStorage.setItem(PENDING_INVITE_TOKEN_STORAGE_KEY, inviteToken);
        setStatus("Signed in. Redirecting to invitation...");
        window.location.href = "/manage-household";
      } else {
        setStatus("Signed in. Redirecting to inventory...");
        window.location.href = "/inventory";
      }
    } catch (error) {
      setStatus(error.message);
    }
  });
}

if (registerForm) {
  registerForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const email = registerEmailInput.value.trim();
    const password = registerPasswordInput.value;
    const displayName = registerDisplayNameInput.value.trim();
    if (!email || !password) {
      setStatus("Email and password are required.");
      return;
    }

    try {
      const payload = await fetchJson("/auth/register", {
        method: "POST",
        skipAuth: true,
        body: JSON.stringify({
          email,
          password,
          display_name: displayName || null,
        }),
      });
      setSession(payload && typeof payload.token === "string" ? payload.token : "", payload.user);
      registerForm.reset();
      const inviteToken = consumePendingInviteToken();
      if (inviteToken) {
        sessionStorage.setItem(PENDING_INVITE_TOKEN_STORAGE_KEY, inviteToken);
        setStatus("Account created. Redirecting to invitation...");
        window.location.href = "/manage-household";
      } else {
        setStatus("Account created. Redirecting to inventory...");
        window.location.href = "/inventory";
      }
    } catch (error) {
      setStatus(error.message);
    }
  });
}

if (forgotPasswordForm) {
  forgotPasswordForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const email = forgotEmailInput.value.trim();
    if (!email) {
      setStatus("Email is required.");
      return;
    }

    try {
      const payload = await fetchJson("/auth/forgot-password", {
        method: "POST",
        skipAuth: true,
        body: JSON.stringify({ email }),
      });
      void payload;
      forgotPasswordForm.reset();
      setStatus("If that account exists, a reset email was sent.");
    } catch (error) {
      setStatus(error.message);
    }
  });
}

if (resetPasswordForm) {
  resetPasswordForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const token = resetTokenInput.value.trim() || getPendingResetToken();
    const newPassword = resetNewPasswordInput.value;
    if (!token || !newPassword) {
      setStatus("Reset token (or reset link) and new password are required.");
      return;
    }

    try {
      await fetchJson("/auth/reset-password", {
        method: "POST",
        skipAuth: true,
        body: JSON.stringify({ token, new_password: newPassword }),
      });
      resetPasswordForm.reset();
      clearPendingResetToken();
      setStatus("Password reset successful. You can sign in now.");
    } catch (error) {
      setStatus(error.message);
    }
  });
}

if (authPageLogoutBtnEl) {
  authPageLogoutBtnEl.addEventListener("click", () => {
    void handleLogout();
  });
}

if (authPageLogoutBtnSecondaryEl) {
  authPageLogoutBtnSecondaryEl.addEventListener("click", () => {
    void handleLogout();
  });
}

captureAuthLinkState();

window.addEventListener("load", async () => {
  restoreSessionFromStorage();
  await hydrateSession();
  await handleAuthLinkMode();

  if (!authUser) {
    if (window.location.hash === "#signup" && registerEmailInput) {
      registerEmailInput.focus();
    } else if (loginEmailInput) {
      loginEmailInput.focus();
    }
    setStatus("Ready.");
    return;
  }

  setStatus("Signed in.");
});
