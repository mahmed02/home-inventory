const AUTH_TOKEN_STORAGE_KEY = "home_inventory_auth_token";
const AUTH_USER_STORAGE_KEY = "home_inventory_auth_user";
const ACTIVE_HOUSEHOLD_STORAGE_KEY = "home_inventory_active_household_id";
const PENDING_INVITE_TOKEN_STORAGE_KEY = "home_inventory_pending_invite_token";

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

function clearAuthLinkQuery() {
  if (window.location.search.length === 0) {
    return;
  }
  window.history.replaceState({}, "", "/auth");
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
  if (!authToken || !authUser) {
    clearStoredSession();
    return;
  }
  localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, authToken);
  localStorage.setItem(AUTH_USER_STORAGE_KEY, JSON.stringify(authUser));
}

function applyUiState() {
  const signedIn = Boolean(authToken && authUser);

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
  if (!authToken) {
    applyUiState();
    return;
  }

  try {
    const payload = await fetchJson("/auth/me");
    setSession(authToken, payload.user || null);
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
  const params = new URLSearchParams(window.location.search);
  const mode = (params.get("mode") || "").trim().toLowerCase();
  const token = (params.get("token") || "").trim();
  if (!mode || !token) {
    return;
  }

  if (mode === "reset-password") {
    if (resetTokenInput) {
      resetTokenInput.value = token;
    }
    const recoveryDetails = document.querySelector(".auth-recovery");
    if (recoveryDetails && "open" in recoveryDetails) {
      recoveryDetails.open = true;
    }
    setStatus("Reset token loaded from link. Enter a new password to continue.");
    clearAuthLinkQuery();
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
    } finally {
      clearAuthLinkQuery();
    }
  }

  if (mode === "accept-invite") {
    sessionStorage.setItem(PENDING_INVITE_TOKEN_STORAGE_KEY, token);
    setStatus("Invitation token loaded. Sign in to accept it.");
    clearAuthLinkQuery();
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
      setSession(payload.token, payload.user);
      loginForm.reset();
      const inviteToken = consumePendingInviteToken();
      if (inviteToken) {
        setStatus("Signed in. Redirecting to invitation...");
        window.location.href = `/manage-household?mode=accept-invite&token=${encodeURIComponent(inviteToken)}`;
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
      setSession(payload.token, payload.user);
      registerForm.reset();
      const inviteToken = consumePendingInviteToken();
      if (inviteToken) {
        setStatus("Account created. Redirecting to invitation...");
        window.location.href = `/manage-household?mode=accept-invite&token=${encodeURIComponent(inviteToken)}`;
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
      if (payload && payload.reset_token && resetTokenInput) {
        resetTokenInput.value = payload.reset_token;
      }
      forgotPasswordForm.reset();
      setStatus(
        payload && payload.reset_token && payload.expires_at
          ? `Reset token generated (email disabled mode). Expires at: ${payload.expires_at}`
          : payload && payload.expires_at
            ? "If that account exists, a reset email was sent."
          : "If that account exists, a reset token was issued."
      );
    } catch (error) {
      setStatus(error.message);
    }
  });
}

if (resetPasswordForm) {
  resetPasswordForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const token = resetTokenInput.value.trim();
    const newPassword = resetNewPasswordInput.value;
    if (!token || !newPassword) {
      setStatus("Reset token and new password are required.");
      return;
    }

    try {
      await fetchJson("/auth/reset-password", {
        method: "POST",
        skipAuth: true,
        body: JSON.stringify({ token, new_password: newPassword }),
      });
      resetPasswordForm.reset();
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

window.addEventListener("load", async () => {
  restoreSessionFromStorage();
  await hydrateSession();
  await handleAuthLinkMode();

  if (!authToken || !authUser) {
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
