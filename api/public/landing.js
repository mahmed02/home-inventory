const AUTH_TOKEN_STORAGE_KEY = "home_inventory_auth_token";
const AUTH_USER_STORAGE_KEY = "home_inventory_auth_user";
const ACTIVE_HOUSEHOLD_STORAGE_KEY = "home_inventory_active_household_id";

const landingAuthBadgeEl = document.getElementById("landingAuthBadge");
const landingSignInLinkEl = document.getElementById("landingSignInLink");
const landingOpenInventoryLinkEl = document.getElementById("landingOpenInventoryLink");
const landingLogoutBtnEl = document.getElementById("landingLogoutBtn");
const landingHeroSignInLinkEl = document.getElementById("landingHeroSignInLink");
const landingHeroCreateAccountLinkEl = document.getElementById("landingHeroCreateAccountLink");
const landingHeroInventoryLinkEl = document.getElementById("landingHeroInventoryLink");
const landingStatusEl = document.getElementById("landingStatus");

function setStatus(message) {
  if (landingStatusEl) {
    landingStatusEl.textContent = message;
  }
}

function readStoredSession() {
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
  return { token, user };
}

function clearStoredSession() {
  localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
  localStorage.removeItem(AUTH_USER_STORAGE_KEY);
  localStorage.removeItem(ACTIVE_HOUSEHOLD_STORAGE_KEY);
}

function applySignedInUi(user) {
  if (landingAuthBadgeEl) {
    landingAuthBadgeEl.textContent = user && user.email ? user.email : "Signed in";
  }
  if (landingSignInLinkEl) {
    landingSignInLinkEl.hidden = true;
  }
  if (landingOpenInventoryLinkEl) {
    landingOpenInventoryLinkEl.hidden = false;
  }
  if (landingLogoutBtnEl) {
    landingLogoutBtnEl.hidden = false;
  }
  if (landingHeroSignInLinkEl) {
    landingHeroSignInLinkEl.hidden = true;
  }
  if (landingHeroCreateAccountLinkEl) {
    landingHeroCreateAccountLinkEl.hidden = true;
  }
  if (landingHeroInventoryLinkEl) {
    landingHeroInventoryLinkEl.hidden = false;
  }
}

function applySignedOutUi() {
  if (landingAuthBadgeEl) {
    landingAuthBadgeEl.textContent = "Guest";
  }
  if (landingSignInLinkEl) {
    landingSignInLinkEl.hidden = false;
  }
  if (landingOpenInventoryLinkEl) {
    landingOpenInventoryLinkEl.hidden = true;
  }
  if (landingLogoutBtnEl) {
    landingLogoutBtnEl.hidden = true;
  }
  if (landingHeroSignInLinkEl) {
    landingHeroSignInLinkEl.hidden = false;
  }
  if (landingHeroCreateAccountLinkEl) {
    landingHeroCreateAccountLinkEl.hidden = false;
  }
  if (landingHeroInventoryLinkEl) {
    landingHeroInventoryLinkEl.hidden = true;
  }
}

async function handleLandingLogout() {
  const { token } = readStoredSession();
  const headers = {
    "Content-Type": "application/json",
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  try {
    await fetch("/auth/logout", {
      method: "POST",
      headers,
      credentials: "same-origin",
    });
  } catch {
    // Ignore logout failure and clear local session anyway.
  }

  clearStoredSession();
  applySignedOutUi();
  setStatus("Signed out.");
}

async function fetchMe(token) {
  const headers = {
    "Content-Type": "application/json",
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch("/auth/me", {
    headers,
    credentials: "same-origin",
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
    const message = data && typeof data.message === "string" ? data.message : `Request failed (${response.status})`;
    throw new Error(message);
  }

  return data;
}

window.addEventListener("load", async () => {
  const { token, user } = readStoredSession();
  const hadStoredSession = Boolean(token || user);

  try {
    const payload = await fetchMe(token);
    if (!payload || !payload.user) {
      throw new Error("Session missing user payload.");
    }
    localStorage.setItem(AUTH_USER_STORAGE_KEY, JSON.stringify(payload.user));
    applySignedInUi(payload.user);
    setStatus("Signed in.");
  } catch {
    clearStoredSession();
    applySignedOutUi();
    setStatus(hadStoredSession ? "Session expired. Sign in again." : "Ready.");
  }
});

if (landingLogoutBtnEl) {
  landingLogoutBtnEl.addEventListener("click", () => {
    void handleLandingLogout();
  });
}
