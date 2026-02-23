const queryInput = document.getElementById("query");
const searchModeSelect = document.getElementById("searchMode");
const searchBtn = document.getElementById("searchBtn");
const resultsEl = document.getElementById("results");
const chatQueryInput = document.getElementById("chatQuery");
const chatAskBtn = document.getElementById("chatAskBtn");
const chatClearBtn = document.getElementById("chatClearBtn");
const chatHistoryEl = document.getElementById("chatHistory");
const statusEl = document.getElementById("status");
const metaEl = document.getElementById("meta");
const authStateHintEl = document.getElementById("authStateHint");

const authLoggedOutEl = document.getElementById("authLoggedOut");
const authLoggedInEl = document.getElementById("authLoggedIn");
const authUserEmailEl = document.getElementById("authUserEmail");
const logoutBtn = document.getElementById("logoutBtn");
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

const householdPanelEl = document.getElementById("householdPanel");
const refreshHouseholdsBtn = document.getElementById("refreshHouseholdsBtn");
const householdSelect = document.getElementById("householdSelect");
const householdRoleHintEl = document.getElementById("householdRoleHint");
const createHouseholdForm = document.getElementById("createHouseholdForm");
const createHouseholdNameInput = document.getElementById("createHouseholdName");
const inviteMemberForm = document.getElementById("inviteMemberForm");
const inviteMemberBtn = document.getElementById("inviteMemberBtn");
const inviteEmailInput = document.getElementById("inviteEmail");
const inviteRoleSelect = document.getElementById("inviteRole");
const inviteTokenHintEl = document.getElementById("inviteTokenHint");
const householdMembersEl = document.getElementById("householdMembers");
const householdInvitationsEl = document.getElementById("householdInvitations");

const treeViewEl = document.getElementById("treeView");
const treeTextEl = document.getElementById("treeText");
const treeMetaEl = document.getElementById("treeMeta");
const refreshTreeBtn = document.getElementById("refreshTreeBtn");
const seedBtn = document.getElementById("seedBtn");
const openCreateActionsBtn = document.getElementById("openCreateActionsBtn");
const openEditBtn = document.getElementById("openEditBtn");
const selectionHintEl = document.getElementById("selectionHint");
const actionCreateLocationBtn = document.getElementById("actionCreateLocationBtn");
const actionCreateItemBtn = document.getElementById("actionCreateItemBtn");

const createActionsModal = document.getElementById("createActionsModal");
const createLocationModal = document.getElementById("createLocationModal");
const createItemModal = document.getElementById("createItemModal");
const editLocationModal = document.getElementById("editLocationModal");
const moveImpactModal = document.getElementById("moveImpactModal");
const editItemModal = document.getElementById("editItemModal");
const imageLightboxModal = document.getElementById("imageLightboxModal");
const imageLightboxImg = document.getElementById("imageLightboxImg");
const imageLightboxCaption = document.getElementById("imageLightboxCaption");

const createLocationForm = document.getElementById("createLocationForm");
const createItemForm = document.getElementById("createItemForm");
const editLocationForm = document.getElementById("editLocationForm");
const editItemForm = document.getElementById("editItemForm");

const locationEditorHint = document.getElementById("locationEditorHint");
const itemEditorHint = document.getElementById("itemEditorHint");
const locationBreadcrumbEl = document.getElementById("locationBreadcrumb");
const itemBreadcrumbEl = document.getElementById("itemBreadcrumb");

const locNameInput = document.getElementById("locName");
const locCodeInput = document.getElementById("locCode");
const locTypeInput = document.getElementById("locType");
const locImageUrlInput = document.getElementById("locImageUrl");
const locImageFileInput = document.getElementById("locImageFile");
const uploadLocImageBtn = document.getElementById("uploadLocImageBtn");
const locParentSelect = document.getElementById("locParentId");

const itemNameInput = document.getElementById("itemName");
const itemDescriptionInput = document.getElementById("itemDescription");
const itemKeywordsInput = document.getElementById("itemKeywords");
const itemImageUrlInput = document.getElementById("itemImageUrl");
const itemImageFileInput = document.getElementById("itemImageFile");
const uploadItemImageBtn = document.getElementById("uploadItemImageBtn");
const itemLocationSelect = document.getElementById("itemLocationId");

const editLocNameInput = document.getElementById("editLocName");
const editLocCodeInput = document.getElementById("editLocCode");
const editLocTypeInput = document.getElementById("editLocType");
const editLocDescriptionInput = document.getElementById("editLocDescription");
const editLocImageUrlInput = document.getElementById("editLocImageUrl");
const editLocImageFileInput = document.getElementById("editLocImageFile");
const uploadEditLocImageBtn = document.getElementById("uploadEditLocImageBtn");
const editLocParentSelect = document.getElementById("editLocParentId");
const deleteLocationBtn = document.getElementById("deleteLocationBtn");
const moveImpactSummaryEl = document.getElementById("moveImpactSummary");
const moveImpactSampleEl = document.getElementById("moveImpactSample");
const confirmMoveImpactBtn = document.getElementById("confirmMoveImpactBtn");
const cancelMoveImpactBtn = document.getElementById("cancelMoveImpactBtn");

const editItemNameInput = document.getElementById("editItemName");
const editItemDescriptionInput = document.getElementById("editItemDescription");
const editItemKeywordsInput = document.getElementById("editItemKeywords");
const editItemImageUrlInput = document.getElementById("editItemImageUrl");
const editItemImageFileInput = document.getElementById("editItemImageFile");
const uploadEditItemImageBtn = document.getElementById("uploadEditItemImageBtn");
const editItemLocationSelect = document.getElementById("editItemLocationId");
const deleteItemBtn = document.getElementById("deleteItemBtn");

let flatLocations = [];
let inventoryRoots = [];
let locationMap = new Map();
let itemMap = new Map();
let locationPathMap = new Map();
let itemPathMap = new Map();
let selectedLocationId = null;
let selectedItemId = null;
let authToken = "";
let authUser = null;
let households = [];
let householdMembers = [];
let householdInvitations = [];
let activeHouseholdId = "";
let activeHouseholdRole = "";
let refreshingHouseholds = false;
let pendingLocationMove = null;
let chatHistory = [];
const MAX_CHAT_HISTORY = 20;

const AUTH_TOKEN_STORAGE_KEY = "home_inventory_auth_token";
const AUTH_USER_STORAGE_KEY = "home_inventory_auth_user";
const ACTIVE_HOUSEHOLD_STORAGE_KEY = "home_inventory_active_household_id";
const SEARCH_MODE_STORAGE_KEY = "home_inventory_search_mode";
const allModals = [
  createActionsModal,
  createLocationModal,
  createItemModal,
  editLocationModal,
  moveImpactModal,
  editItemModal,
  imageLightboxModal,
];

function setStatus(message) {
  statusEl.textContent = message;
}

function setAuthStateHint(message) {
  authStateHintEl.textContent = message;
}

function persistAuthSession() {
  if (!authToken || !authUser) {
    localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
    localStorage.removeItem(AUTH_USER_STORAGE_KEY);
    return;
  }

  localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, authToken);
  localStorage.setItem(AUTH_USER_STORAGE_KEY, JSON.stringify(authUser));
}

function applyAuthUiState() {
  if (authUser && authToken) {
    authLoggedOutEl.hidden = true;
    authLoggedInEl.hidden = false;
    authUserEmailEl.textContent = authUser.email || "account";
    setAuthStateHint("Signed in");
    householdPanelEl.hidden = false;
    return;
  }

  authLoggedOutEl.hidden = false;
  authLoggedInEl.hidden = true;
  authUserEmailEl.textContent = "-";
  setAuthStateHint("Not signed in");
  householdPanelEl.hidden = true;
}

function setAuthSession(token, user) {
  authToken = token || "";
  authUser = user || null;
  if (authToken && authUser) {
    restoreActiveHousehold();
  } else {
    activeHouseholdId = "";
    activeHouseholdRole = "";
  }
  persistAuthSession();
  applyAuthUiState();
  renderHouseholdPanel();
}

function clearAuthSession() {
  setAuthSession("", null);
  households = [];
  householdMembers = [];
  householdInvitations = [];
  activeHouseholdId = "";
  activeHouseholdRole = "";
  localStorage.removeItem(ACTIVE_HOUSEHOLD_STORAGE_KEY);
  renderHouseholdPanel();
}

function restoreAuthSessionFromStorage() {
  try {
    const token = localStorage.getItem(AUTH_TOKEN_STORAGE_KEY) || "";
    const rawUser = localStorage.getItem(AUTH_USER_STORAGE_KEY);
    const user = rawUser ? JSON.parse(rawUser) : null;
    setAuthSession(token, user);
  } catch {
    clearAuthSession();
  }
}

async function hydrateSessionUser() {
  if (!authToken) {
    applyAuthUiState();
    return;
  }

  try {
    const me = await fetchJson("/auth/me");
    setAuthSession(authToken, me.user || null);
  } catch {
    clearAuthSession();
  }
}

function isViewerRoleActive() {
  return Boolean(authToken && activeHouseholdId && activeHouseholdRole === "viewer");
}

function activeHousehold() {
  return households.find((household) => household.id === activeHouseholdId) || null;
}

function persistActiveHousehold() {
  if (!activeHouseholdId) {
    localStorage.removeItem(ACTIVE_HOUSEHOLD_STORAGE_KEY);
    return;
  }
  localStorage.setItem(ACTIVE_HOUSEHOLD_STORAGE_KEY, activeHouseholdId);
}

function restoreActiveHousehold() {
  if (!authToken) {
    activeHouseholdId = "";
    return;
  }
  activeHouseholdId = localStorage.getItem(ACTIVE_HOUSEHOLD_STORAGE_KEY) || "";
}

function setActiveHousehold(id) {
  activeHouseholdId = id || "";
  const selected = activeHousehold();
  activeHouseholdRole = selected ? selected.role : "";
  persistActiveHousehold();
}

function renderManagementListEmpty(targetEl, message) {
  targetEl.innerHTML = `<li class="management-empty">${escapeHtml(message)}</li>`;
}

function renderHouseholdPanel() {
  if (!authToken || !authUser) {
    householdRoleHintEl.textContent = "Sign in to manage household sharing.";
    renderManagementListEmpty(householdMembersEl, "No household selected.");
    renderManagementListEmpty(householdInvitationsEl, "No household selected.");
    householdSelect.innerHTML = '<option value="">No household selected</option>';
    inviteTokenHintEl.textContent = "";
    updateActionState();
    return;
  }

  if (!households.length) {
    householdRoleHintEl.textContent = "No households yet. Create one to start sharing.";
    householdSelect.innerHTML = '<option value="">No household selected</option>';
    renderManagementListEmpty(householdMembersEl, "No members to show.");
    renderManagementListEmpty(householdInvitationsEl, "No invitations to show.");
    inviteTokenHintEl.textContent = "";
    updateActionState();
    return;
  }

  const options = households
    .map((household) => {
      const selected = household.id === activeHouseholdId ? " selected" : "";
      const label = `${household.name} (${household.role})`;
      return `<option value="${escapeAttr(household.id)}"${selected}>${escapeHtml(label)}</option>`;
    })
    .join("");
  householdSelect.innerHTML = options;

  const selectedHousehold = activeHousehold();
  if (!selectedHousehold) {
    householdRoleHintEl.textContent = "Select a household.";
    renderManagementListEmpty(householdMembersEl, "No members to show.");
    renderManagementListEmpty(householdInvitationsEl, "No invitations to show.");
    updateActionState();
    return;
  }

  householdRoleHintEl.textContent = `Role: ${selectedHousehold.role}`;

  if (!householdMembers.length) {
    renderManagementListEmpty(householdMembersEl, "No members to show.");
  } else {
    const ownerCount = householdMembers.filter((member) => member.role === "owner").length;
    const canManage = selectedHousehold.role === "owner";
    householdMembersEl.innerHTML = householdMembers
      .map((member) => {
        const displayName = member.display_name ? `${member.display_name} (${member.email})` : member.email;
        const isSelf = authUser && member.user_id === authUser.id;
        const roleOptions = ["owner", "editor", "viewer"]
          .map((role) => {
            const selected = role === member.role ? " selected" : "";
            return `<option value="${role}"${selected}>${role}</option>`;
          })
          .join("");
        const cannotRemoveLastOwner = member.role === "owner" && ownerCount <= 1;
        const cannotChangeLastOwner = member.role === "owner" && ownerCount <= 1;

        const controls = canManage
          ? `
            <div class="management-actions">
              <select data-member-role-id="${escapeAttr(member.user_id)}" ${
                cannotChangeLastOwner ? "disabled" : ""
              }>
                ${roleOptions}
              </select>
              <button
                type="button"
                class="member-role-save-btn"
                data-member-save-id="${escapeAttr(member.user_id)}"
                ${cannotChangeLastOwner ? "disabled" : ""}
              >
                Save
              </button>
              <button
                type="button"
                class="danger"
                data-member-remove-id="${escapeAttr(member.user_id)}"
                ${cannotRemoveLastOwner ? "disabled" : ""}
              >
                Remove
              </button>
            </div>
          `
          : "";

        return `
          <li class="management-item">
            <div class="management-main">
              <div class="management-title">${escapeHtml(displayName)}${isSelf ? " (you)" : ""}</div>
              <div class="management-subtle">Role: ${escapeHtml(member.role)}</div>
            </div>
            ${controls}
          </li>
        `;
      })
      .join("");
  }

  if (!householdInvitations.length) {
    renderManagementListEmpty(householdInvitationsEl, "No pending invitations.");
  } else {
    const canManageInvites = selectedHousehold.role === "owner";
    householdInvitationsEl.innerHTML = householdInvitations
      .map((invite) => {
        const expiresText = new Date(invite.expires_at).toLocaleString();
        return `
          <li class="management-item">
            <div class="management-main">
              <div class="management-title">${escapeHtml(invite.email)}</div>
              <div class="management-subtle">Role: ${escapeHtml(invite.role)} • Expires: ${escapeHtml(expiresText)}</div>
            </div>
            ${
              canManageInvites
                ? `<button type="button" class="danger" data-invite-revoke-id="${escapeAttr(invite.id)}">Revoke</button>`
                : ""
            }
          </li>
        `;
      })
      .join("");
  }

  inviteMemberBtn.disabled = selectedHousehold.role !== "owner";
  updateActionState();
}

async function refreshHouseholdMembersAndInvites() {
  if (!activeHouseholdId) {
    householdMembers = [];
    householdInvitations = [];
    renderHouseholdPanel();
    return;
  }

  const membersPayload = await fetchJson(`/households/${activeHouseholdId}/members`);
  householdMembers = membersPayload.members || [];
  activeHouseholdRole = membersPayload.requester_role || activeHouseholdRole;

  if (activeHouseholdRole === "owner") {
    const invitesPayload = await fetchJson(`/households/${activeHouseholdId}/invitations`);
    householdInvitations = invitesPayload.invitations || [];
  } else {
    householdInvitations = [];
  }

  renderHouseholdPanel();
}

async function refreshHouseholds(preferredHouseholdId = "") {
  if (!authToken) {
    households = [];
    householdMembers = [];
    householdInvitations = [];
    activeHouseholdId = "";
    activeHouseholdRole = "";
    renderHouseholdPanel();
    return;
  }

  if (refreshingHouseholds) {
    return;
  }

  refreshingHouseholds = true;
  try {
    const payload = await fetchJson("/households");
    households = payload.households || [];

    if (!households.length) {
      activeHouseholdId = "";
      activeHouseholdRole = "";
      householdMembers = [];
      householdInvitations = [];
      renderHouseholdPanel();
      return;
    }

    const availableIds = new Set(households.map((household) => household.id));
    const candidateId =
      preferredHouseholdId || activeHouseholdId || localStorage.getItem(ACTIVE_HOUSEHOLD_STORAGE_KEY) || "";
    if (!candidateId || !availableIds.has(candidateId)) {
      setActiveHousehold(households[0].id);
    } else {
      setActiveHousehold(candidateId);
    }

    await refreshHouseholdMembersAndInvites();
  } finally {
    refreshingHouseholds = false;
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll("`", "&#96;");
}

function normalizeSearchMode(value) {
  return value === "hybrid" || value === "semantic" || value === "lexical" ? value : "lexical";
}

function setSearchMode(mode) {
  const normalized = normalizeSearchMode(mode);
  if (searchModeSelect) {
    searchModeSelect.value = normalized;
  }
  localStorage.setItem(SEARCH_MODE_STORAGE_KEY, normalized);
  return normalized;
}

function restoreSearchMode() {
  const stored = localStorage.getItem(SEARCH_MODE_STORAGE_KEY);
  return setSearchMode(stored || (searchModeSelect ? searchModeSelect.value : "lexical"));
}

function formatScore(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  return value.toFixed(3);
}

function renderChatHistory() {
  if (!chatHistoryEl) {
    return;
  }

  if (!chatHistory.length) {
    chatHistoryEl.innerHTML = '<li class="management-empty">Ask about an item or location to start.</li>';
    return;
  }

  chatHistoryEl.innerHTML = chatHistory
    .map(
      (entry) => `
        <li class="chat-entry ${entry.role}">
          <div class="chat-role">${escapeHtml(entry.role)}</div>
          <div class="chat-text">${escapeHtml(entry.text)}</div>
          ${entry.meta ? `<div class="chat-meta">${escapeHtml(entry.meta)}</div>` : ""}
        </li>
      `
    )
    .join("");
}

function pushChatEntry(role, text, meta = "") {
  chatHistory.push({ role, text, meta });
  if (chatHistory.length > MAX_CHAT_HISTORY) {
    chatHistory = chatHistory.slice(chatHistory.length - MAX_CHAT_HISTORY);
  }
  renderChatHistory();
}

function updateActionState() {
  const hasSelection = Boolean(selectedLocationId || selectedItemId);
  const readOnly = isViewerRoleActive();
  openCreateActionsBtn.disabled = readOnly;
  openEditBtn.disabled = !hasSelection || readOnly;
  seedBtn.disabled = readOnly;

  if (selectedLocationId) {
    const location = locationMap.get(selectedLocationId);
    selectionHintEl.textContent = readOnly
      ? `Selected location: ${location ? location.name : "unknown"} (viewer access is read-only)`
      : location
        ? `Selected location: ${location.name}`
        : "Select a location or item in the tree to edit.";
    openEditBtn.textContent = "Edit Location";
    return;
  }

  if (selectedItemId) {
    const item = itemMap.get(selectedItemId);
    selectionHintEl.textContent = readOnly
      ? `Selected item: ${item ? item.name : "unknown"} (viewer access is read-only)`
      : item
        ? `Selected item: ${item.name}`
        : "Select a location or item in the tree to edit.";
    openEditBtn.textContent = "Edit Item";
    return;
  }

  selectionHintEl.textContent = readOnly
    ? "Viewer access is read-only for this household."
    : "Select a location or item in the tree to edit.";
  openEditBtn.textContent = "Edit Selected";
}

function openModal(modalEl) {
  if (!modalEl) {
    return;
  }
  modalEl.hidden = false;
  document.body.classList.add("modal-open");
}

function closeModal(modalEl) {
  if (!modalEl) {
    return;
  }
  if (modalEl === moveImpactModal) {
    pendingLocationMove = null;
  }
  modalEl.hidden = true;
  if (allModals.every((modal) => modal.hidden)) {
    document.body.classList.remove("modal-open");
  }
}

function closeAllModals() {
  allModals.forEach((modal) => {
    modal.hidden = true;
  });
  pendingLocationMove = null;
  document.body.classList.remove("modal-open");
}

function openImageLightbox(imageUrl, caption = "") {
  if (!imageUrl) {
    return;
  }
  imageLightboxImg.src = imageUrl;
  imageLightboxImg.alt = caption || "Image preview";
  imageLightboxCaption.textContent = caption;
  openModal(imageLightboxModal);
}

async function fetchJson(path, options = {}) {
  const { skipAuth = false, headers: extraHeaders = {}, ...requestOptions } = options;
  const headers = {
    "Content-Type": "application/json",
    ...extraHeaders,
  };

  if (authToken && !skipAuth) {
    headers.Authorization = `Bearer ${authToken}`;
    if (activeHouseholdId && !headers["x-household-id"]) {
      headers["x-household-id"] = activeHouseholdId;
    }
  }

  const response = await fetch(path, {
    headers,
    ...requestOptions,
  });

  const text = await response.text();
  const parsed = text ? JSON.parse(text) : null;
  const isEnvelope =
    parsed && typeof parsed === "object" && "ok" in parsed && typeof parsed.ok === "boolean";
  const data = isEnvelope ? (parsed.ok ? parsed.data : parsed.error) : parsed;

  if (!response.ok) {
    const message =
      data && typeof data.message === "string"
        ? data.message
        : data && typeof data.error === "string"
          ? data.error
          : `Request failed (${response.status})`;

    if (response.status === 401 && authToken && !skipAuth && !path.startsWith("/auth/")) {
      clearAuthSession();
      applyAuthUiState();
    }

    throw new Error(message);
  }

  return data;
}

async function uploadImageFile(file, scope) {
  if (!file) {
    throw new Error("Choose an image file first.");
  }

  if (!file.type.startsWith("image/")) {
    throw new Error("Only image files are supported.");
  }

  if (file.size > 10 * 1024 * 1024) {
    throw new Error("Image must be 10MB or smaller.");
  }

  const presigned = await fetchJson("/uploads/presign", {
    method: "POST",
    body: JSON.stringify({
      filename: file.name,
      content_type: file.type,
      scope,
    }),
  });

  const uploadResponse = await fetch(presigned.upload_url, {
    method: "PUT",
    headers: { "Content-Type": file.type },
    body: file,
  });

  if (!uploadResponse.ok) {
    throw new Error(`Upload failed (${uploadResponse.status})`);
  }

  try {
    await fetchJson("/uploads/finalize", {
      method: "POST",
      body: JSON.stringify({ image_url: presigned.image_url }),
    });
  } catch (error) {
    console.warn("Thumbnail generation skipped:", error);
  }

  return presigned.image_url;
}

async function uploadFromInput(fileInput, urlInput, scope, button) {
  try {
    const file = fileInput.files && fileInput.files[0] ? fileInput.files[0] : null;
    if (!file) {
      setStatus("Select an image file first.");
      return;
    }

    button.disabled = true;
    setStatus("Uploading image...");
    const imageUrl = await uploadImageFile(file, scope);
    urlInput.value = imageUrl;
    fileInput.value = "";
    setStatus("Image uploaded.");
  } catch (error) {
    setStatus(error.message);
  } finally {
    button.disabled = false;
  }
}

function flatten(nodes, prefix = "") {
  const out = [];
  for (const node of nodes) {
    const path = prefix ? `${prefix} > ${node.name}` : node.name;
    out.push({ id: node.id, name: node.name, path });
    if (Array.isArray(node.children) && node.children.length > 0) {
      out.push(...flatten(node.children, path));
    }
  }
  return out;
}

function parseKeywords(raw) {
  return raw
    .split(",")
    .map((k) => k.trim())
    .filter((k) => k.length > 0);
}

function renderLocationOptions(selectEl, options, placeholder, selectedValue = "") {
  const rows = [`<option value="">${escapeHtml(placeholder)}</option>`];
  for (const loc of options) {
    const selected = loc.id === selectedValue ? " selected" : "";
    rows.push(
      `<option value="${escapeAttr(loc.id)}"${selected}>${escapeHtml(loc.path)}</option>`
    );
  }
  selectEl.innerHTML = rows.join("");
}

function getDescendantIds(locationId) {
  const ids = new Set();

  function walk(node) {
    for (const child of node.children || []) {
      ids.add(child.id);
      walk(child);
    }
  }

  const root = locationMap.get(locationId);
  if (root) {
    walk(root);
  }

  return ids;
}

function syncLocationSelectors() {
  renderLocationOptions(locParentSelect, flatLocations, "No parent (root)");
  renderLocationOptions(itemLocationSelect, flatLocations, "Select location");
  renderLocationOptions(editItemLocationSelect, flatLocations, "Select location");

  if (selectedLocationId) {
    const descendants = getDescendantIds(selectedLocationId);
    const filtered = flatLocations.filter(
      (loc) => loc.id !== selectedLocationId && !descendants.has(loc.id)
    );
    const selectedParent = editLocParentSelect.dataset.current || "";
    renderLocationOptions(editLocParentSelect, filtered, "No parent (root)", selectedParent);
  } else {
    renderLocationOptions(editLocParentSelect, flatLocations, "No parent (root)");
  }
}

function buildTextTree() {
  if (!inventoryRoots.length) {
    return "(empty inventory tree)";
  }

  const lines = [];

  function appendNode(node, prefix, isLast) {
    const connector = isLast ? "`-- " : "|-- ";
    lines.push(`${prefix}${connector}${node.name}${node.code ? ` (${node.code})` : ""}/`);

    const nextPrefix = `${prefix}${isLast ? "    " : "|   "}`;
    const children = [...(node.children || []).map((child) => ({ kind: "location", data: child }))];
    for (const item of node.items || []) {
      children.push({ kind: "item", data: item });
    }

    children.forEach((entry, idx) => {
      const childLast = idx === children.length - 1;
      if (entry.kind === "location") {
        appendNode(entry.data, nextPrefix, childLast);
      } else {
        lines.push(`${nextPrefix}${childLast ? "`-- " : "|-- "}[item] ${entry.data.name}`);
      }
    });
  }

  inventoryRoots.forEach((root, idx) => {
    if (idx > 0) {
      lines.push("");
    }
    lines.push(`${root.name}${root.code ? ` (${root.code})` : ""}/`);

    const children = [...(root.children || []).map((child) => ({ kind: "location", data: child }))];
    for (const item of root.items || []) {
      children.push({ kind: "item", data: item });
    }

    children.forEach((entry, childIdx) => {
      const childLast = childIdx === children.length - 1;
      if (entry.kind === "location") {
        appendNode(entry.data, "", childLast);
      } else {
        lines.push(`${childLast ? "`-- " : "|-- "}[item] ${entry.data.name}`);
      }
    });
  });

  return lines.join("\n");
}

function buildTreeHtml(nodes) {
  if (!nodes.length) {
    return "<p class=\"hint\">No locations yet.</p>";
  }

  function renderNode(node) {
    const locationSelected = selectedLocationId === node.id ? " selected" : "";
    const safeLocationId = escapeAttr(node.id);
    const safeLocationName = escapeHtml(node.name);
    const safeLocationCode = node.code ? ` (${escapeHtml(node.code)})` : "";
    const children = [];

    for (const child of node.children || []) {
      children.push(renderNode(child));
    }

    for (const item of node.items || []) {
      const itemSelected = selectedItemId === item.id ? " selected" : "";
      const safeItemId = escapeAttr(item.id);
      const safeItemName = escapeHtml(item.name);
      const thumbUrl = item.thumbnail_url || item.image_url;
      const imageHtml =
        item.image_url && thumbUrl
          ? `<img class="tree-thumb" src="${escapeAttr(thumbUrl)}" data-full-image="${escapeAttr(item.image_url)}" alt="${escapeAttr(item.name)}" title="Click to enlarge">`
          : "";
      children.push(`
        <li class="tree-item">
          <span class="item-label${itemSelected}" data-item-id="${safeItemId}">
            ${imageHtml}
            <span class="item-tag">item</span>
            <span>${safeItemName}</span>
          </span>
        </li>
      `);
    }

    const childrenHtml = children.length
      ? `<ul class="tree-list">${children.join("")}</ul>`
      : "";

    return `
      <li class="tree-node">
        <details open>
          <summary>
            <span class="tree-label${locationSelected}" data-location-id="${safeLocationId}">
              ${safeLocationName}${safeLocationCode}
            </span>
          </summary>
          ${childrenHtml}
        </details>
      </li>
    `;
  }

  return `<ul class="tree-list">${nodes.map(renderNode).join("")}</ul>`;
}

function renderTree() {
  treeViewEl.innerHTML = buildTreeHtml(inventoryRoots);
  treeTextEl.textContent = buildTextTree();
}

function hideEditors() {
  selectedLocationId = null;
  selectedItemId = null;

  editLocationForm.hidden = true;
  editItemForm.hidden = true;
  locationEditorHint.textContent = "Select a location in the tree.";
  itemEditorHint.textContent = "Select an item in the tree.";
  locationBreadcrumbEl.textContent = "";
  itemBreadcrumbEl.textContent = "";
  updateActionState();

  renderTree();
}

function selectLocation(locationId) {
  const location = locationMap.get(locationId);
  if (!location) {
    return;
  }

  selectedLocationId = locationId;
  selectedItemId = null;

  editItemForm.hidden = true;
  itemEditorHint.textContent = "Select an item in the tree.";
  itemBreadcrumbEl.textContent = "";

  editLocationForm.hidden = false;
  locationEditorHint.textContent = `Editing location: ${location.name}`;
  locationBreadcrumbEl.textContent = `Path: ${locationPathMap.get(location.id) || location.name}`;

  editLocNameInput.value = location.name || "";
  editLocCodeInput.value = location.code || "";
  editLocTypeInput.value = location.type || "";
  editLocDescriptionInput.value = location.description || "";
  editLocImageUrlInput.value = location.image_url || "";

  editLocParentSelect.dataset.current = location.parent_id || "";
  syncLocationSelectors();
  updateActionState();

  renderTree();
}

function selectItem(itemId) {
  selectedItemId = itemId;
  selectedLocationId = null;

  editLocationForm.hidden = true;
  locationEditorHint.textContent = "Select a location in the tree.";
  locationBreadcrumbEl.textContent = "";

  editItemForm.hidden = false;

  const item = itemMap.get(itemId);
  if (!item) {
    itemEditorHint.textContent = "Item not found.";
    itemBreadcrumbEl.textContent = "";
    return;
  }

  itemEditorHint.textContent = `Editing item: ${item.name}`;
  itemBreadcrumbEl.textContent = `Path: ${itemPathMap.get(item.id) || item.name}`;

  editItemNameInput.value = item.name || "";
  editItemDescriptionInput.value = item.description || "";
  editItemKeywordsInput.value = (item.keywords || []).join(", ");
  editItemImageUrlInput.value = item.image_url || "";

  syncLocationSelectors();
  editItemLocationSelect.value = item.location_id || "";
  updateActionState();

  renderTree();
}

async function refreshInventoryTree() {
  const data = await fetchJson("/inventory/tree");
  inventoryRoots = data.roots || [];
  treeMetaEl.textContent = `${data.total_locations || 0} locations, ${data.total_items || 0} items`;

  locationMap = new Map();
  itemMap = new Map();
  locationPathMap = new Map();
  itemPathMap = new Map();

  function indexNode(node, parentPath = "") {
    const currentPath = parentPath ? `${parentPath} > ${node.name}` : node.name;
    locationPathMap.set(node.id, currentPath);
    locationMap.set(node.id, node);

    for (const child of node.children || []) {
      indexNode(child, currentPath);
    }

    for (const item of node.items || []) {
      itemMap.set(item.id, item);
      itemPathMap.set(item.id, `${currentPath} > ${item.name}`);
    }
  }

  for (const root of inventoryRoots) {
    indexNode(root);
  }

  if (selectedLocationId && locationMap.has(selectedLocationId)) {
    selectLocation(selectedLocationId);
    return;
  }

  if (selectedItemId && itemMap.has(selectedItemId)) {
    selectItem(selectedItemId);
    return;
  }

  if (selectedLocationId || selectedItemId) {
    hideEditors();
    return;
  }

  updateActionState();
  renderTree();
}

async function loadLocationTreeForForms() {
  const data = await fetchJson("/locations/tree");
  flatLocations = flatten(data.nodes || []);
  syncLocationSelectors();
}

function renderResults(results, total, limit, offset, mode = "lexical") {
  if (!results.length) {
    resultsEl.innerHTML = '<li class="result">No results</li>';
    metaEl.textContent = `mode: ${mode}, total: 0`;
    return;
  }

  metaEl.textContent = `mode: ${mode}, total: ${total}, showing ${results.length}, offset ${offset}, limit ${limit}`;

  const options = flatLocations
    .map(
      (loc) => `<option value="${escapeAttr(loc.id)}">${escapeHtml(loc.path)}</option>`
    )
    .join("");

  resultsEl.innerHTML = results
    .map(
      (item) => `
        <li class="result" data-item-id="${escapeAttr(item.id)}">
          <div class="result-main">
            ${
              item.image_url
                ? `<img class="thumb" src="${escapeAttr(item.thumbnail_url || item.image_url)}" data-full-image="${escapeAttr(item.image_url)}" alt="${escapeAttr(item.name)}" title="Click to enlarge">`
                : ""
            }
            <div>
              <div class="result-title">${escapeHtml(item.name)}</div>
              <div class="result-path">${escapeHtml(item.location_path)}</div>
              ${
                formatScore(item.score)
                  ? `<div class="result-scores">score ${formatScore(item.score)} | lexical ${formatScore(item.lexical_score) || "0.000"} | semantic ${formatScore(item.semantic_score) || "0.000"}</div>`
                  : ""
              }
            </div>
          </div>
          <div class="move-row">
            <select class="location-select">
              <option value="">Choose destination...</option>
              ${options}
            </select>
            <button class="move-btn">Move</button>
          </div>
        </li>
      `
    )
    .join("");
}

async function search() {
  const q = queryInput.value.trim();
  if (!q) {
    setStatus("Enter a search query.");
    return;
  }

  const mode = setSearchMode(searchModeSelect ? searchModeSelect.value : "lexical");
  setStatus("Searching...");

  try {
    await loadLocationTreeForForms();
    const endpoint =
      mode === "lexical"
        ? `/items/search?q=${encodeURIComponent(q)}&limit=20&offset=0`
        : `/items/search/semantic?q=${encodeURIComponent(q)}&mode=${encodeURIComponent(mode)}&limit=20&offset=0`;

    const data = await fetchJson(endpoint);
    const responseMode = normalizeSearchMode(data && data.mode ? data.mode : mode);
    const results = data && Array.isArray(data.results) ? data.results : [];
    renderResults(
      results,
      data && typeof data.total === "number" ? data.total : 0,
      data && typeof data.limit === "number" ? data.limit : 20,
      data && typeof data.offset === "number" ? data.offset : 0,
      responseMode
    );
    setStatus(`Done (${responseMode}).`);
  } catch (error) {
    setStatus(error.message);
  }
}

async function askAssistant() {
  const q = chatQueryInput ? chatQueryInput.value.trim() : "";
  if (!q) {
    setStatus("Enter a question for the assistant.");
    return;
  }

  pushChatEntry("user", q);
  if (chatQueryInput) {
    chatQueryInput.value = "";
  }

  setStatus("Asking assistant...");
  try {
    const payload = await fetchJson(`/api/items/lookup?q=${encodeURIComponent(q)}`);

    const isModernPayload =
      payload &&
      typeof payload === "object" &&
      typeof payload.intent === "string" &&
      typeof payload.answer === "string" &&
      typeof payload.confidence === "number" &&
      typeof payload.fallback === "boolean";

    if (!isModernPayload) {
      throw new Error(
        "Assistant API response is outdated. Redeploy the latest backend to use chat assistant."
      );
    }

    const answer =
      payload.answer.trim().length > 0
        ? payload.answer
        : typeof payload.notes === "string" && payload.notes.trim().length > 0
          ? payload.notes
          : "I could not generate a response.";
    const confirmation =
      typeof payload.requires_confirmation === "boolean"
        ? String(payload.requires_confirmation)
        : "false";

    pushChatEntry(
      "assistant",
      answer,
      `intent=${payload.intent} confidence=${payload.confidence.toFixed(2)} fallback=${String(payload.fallback)} requires_confirmation=${confirmation}`
    );
    setStatus("Assistant response ready.");
  } catch (error) {
    pushChatEntry("assistant", error.message, "intent=error");
    setStatus(error.message);
  }
}

async function refreshAll() {
  await Promise.all([loadLocationTreeForForms(), refreshInventoryTree()]);
}

function renderMoveImpactPreview(impact) {
  const affectedLocations = Number(impact.affected_locations || 0);
  const affectedItems = Number(impact.affected_items || 0);
  moveImpactSummaryEl.textContent = `This move affects ${affectedLocations} location(s) and ${affectedItems} item(s).`;

  const sample = Array.isArray(impact.sample) ? impact.sample : [];
  if (!sample.length) {
    moveImpactSampleEl.innerHTML =
      '<li class="management-empty">No items are currently under this location subtree.</li>';
    return;
  }

  moveImpactSampleEl.innerHTML = sample
    .map((entry) => {
      const beforePath = entry.before_path || "";
      const afterPath = entry.after_path || "";
      const itemName = entry.item_name || "Item";
      return `
        <li class="management-item">
          <div class="management-main">
            <div class="management-title">${escapeHtml(itemName)}</div>
            <div class="management-subtle">Before: ${escapeHtml(beforePath)}</div>
            <div class="management-subtle">After: ${escapeHtml(afterPath)}</div>
          </div>
        </li>
      `;
    })
    .join("");
}

async function applyLocationUpdate(locationId, payload) {
  await fetchJson(`/locations/${locationId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
  await refreshAll();
  selectLocation(locationId);
  closeModal(editLocationModal);
}

async function previewLocationMove(locationId, payload) {
  const impact = await fetchJson(`/locations/${locationId}/move-impact`, {
    method: "POST",
    body: JSON.stringify({ parent_id: payload.parent_id }),
  });
  pendingLocationMove = { locationId, payload };
  renderMoveImpactPreview(impact);
  openModal(moveImpactModal);
}

resultsEl.addEventListener("click", async (event) => {
  const image = event.target.closest(".thumb");
  if (image && image.src) {
    openImageLightbox(image.dataset.fullImage || image.src, image.alt || "Item image");
    return;
  }

  const btn = event.target.closest(".move-btn");
  if (!btn) {
    return;
  }

  const itemNode = event.target.closest(".result");
  if (!itemNode) {
    return;
  }

  const itemId = itemNode.dataset.itemId;
  const select = itemNode.querySelector(".location-select");
  const locationId = select ? select.value : null;

  if (!itemId || !locationId) {
    setStatus("Select a destination location first.");
    return;
  }

  btn.disabled = true;
  setStatus("Moving item...");

  try {
    await fetchJson(`/items/${itemId}`, {
      method: "PATCH",
      body: JSON.stringify({ location_id: locationId }),
    });
    await refreshAll();
    await search();
    setStatus("Item moved.");
  } catch (error) {
    setStatus(error.message);
  } finally {
    btn.disabled = false;
  }
});

treeViewEl.addEventListener("click", (event) => {
  const image = event.target.closest(".tree-thumb");
  if (image && image.src) {
    openImageLightbox(image.dataset.fullImage || image.src, image.alt || "Item image");
    return;
  }

  const locationTarget = event.target.closest("[data-location-id]");
  if (locationTarget) {
    selectLocation(locationTarget.dataset.locationId);
    return;
  }

  const itemTarget = event.target.closest("[data-item-id]");
  if (itemTarget) {
    selectItem(itemTarget.dataset.itemId);
  }
});

openCreateActionsBtn.addEventListener("click", () => {
  openModal(createActionsModal);
});

actionCreateLocationBtn.addEventListener("click", () => {
  closeModal(createActionsModal);
  openModal(createLocationModal);
});

actionCreateItemBtn.addEventListener("click", () => {
  closeModal(createActionsModal);
  openModal(createItemModal);
});

openEditBtn.addEventListener("click", () => {
  if (selectedLocationId) {
    openModal(editLocationModal);
    return;
  }
  if (selectedItemId) {
    openModal(editItemModal);
    return;
  }
  setStatus("Select a location or item in the tree first.");
});

document.querySelectorAll("[data-modal-close]").forEach((button) => {
  button.addEventListener("click", () => {
    const modalId = button.getAttribute("data-modal-close");
    const modal = modalId ? document.getElementById(modalId) : null;
    closeModal(modal);
  });
});

allModals.forEach((modal) => {
  modal.addEventListener("click", (event) => {
    if (event.target === modal) {
      closeModal(modal);
    }
  });
});

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeAllModals();
  }
});

confirmMoveImpactBtn.addEventListener("click", async () => {
  if (!pendingLocationMove) {
    closeModal(moveImpactModal);
    return;
  }

  confirmMoveImpactBtn.disabled = true;
  try {
    await applyLocationUpdate(pendingLocationMove.locationId, pendingLocationMove.payload);
    closeModal(moveImpactModal);
    setStatus("Location moved.");
  } catch (error) {
    setStatus(error.message);
  } finally {
    confirmMoveImpactBtn.disabled = false;
  }
});

cancelMoveImpactBtn.addEventListener("click", () => {
  closeModal(moveImpactModal);
  setStatus("Move canceled.");
});

createLocationForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const payload = {
    name: locNameInput.value.trim(),
    code: locCodeInput.value.trim() || null,
    type: locTypeInput.value.trim() || null,
    image_url: locImageUrlInput.value.trim() || null,
    parent_id: locParentSelect.value || null,
  };

  if (!payload.name) {
    setStatus("Location name is required.");
    return;
  }

  try {
    await fetchJson("/locations", {
      method: "POST",
      body: JSON.stringify(payload),
    });

    createLocationForm.reset();
    await refreshAll();
    closeModal(createLocationModal);
    setStatus("Location created.");
  } catch (error) {
    setStatus(error.message);
  }
});

createItemForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const payload = {
    name: itemNameInput.value.trim(),
    description: itemDescriptionInput.value.trim() || null,
    keywords: parseKeywords(itemKeywordsInput.value),
    image_url: itemImageUrlInput.value.trim() || null,
    location_id: itemLocationSelect.value,
  };

  if (!payload.name || !payload.location_id) {
    setStatus("Item name and location are required.");
    return;
  }

  try {
    await fetchJson("/items", {
      method: "POST",
      body: JSON.stringify(payload),
    });

    createItemForm.reset();
    await refreshAll();
    closeModal(createItemModal);
    setStatus("Item created.");
  } catch (error) {
    setStatus(error.message);
  }
});

editLocationForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!selectedLocationId) {
    setStatus("Select a location first.");
    return;
  }

  const payload = {
    name: editLocNameInput.value.trim(),
    code: editLocCodeInput.value.trim() || null,
    type: editLocTypeInput.value.trim() || null,
    description: editLocDescriptionInput.value.trim() || null,
    image_url: editLocImageUrlInput.value.trim() || null,
    parent_id: editLocParentSelect.value || null,
  };

  if (!payload.name) {
    setStatus("Location name is required.");
    return;
  }

  try {
    const currentLocation = locationMap.get(selectedLocationId);
    const currentParentId = currentLocation ? currentLocation.parent_id || null : null;
    const nextParentId = payload.parent_id || null;
    const isMove = currentParentId !== nextParentId;

    if (isMove) {
      await previewLocationMove(selectedLocationId, payload);
      setStatus("Review move impact and confirm.");
      return;
    }

    await applyLocationUpdate(selectedLocationId, payload);
    setStatus("Location updated.");
  } catch (error) {
    setStatus(error.message);
  }
});

editItemForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!selectedItemId) {
    setStatus("Select an item first.");
    return;
  }

  const payload = {
    name: editItemNameInput.value.trim(),
    description: editItemDescriptionInput.value.trim() || null,
    keywords: parseKeywords(editItemKeywordsInput.value),
    image_url: editItemImageUrlInput.value.trim() || null,
    location_id: editItemLocationSelect.value,
  };

  if (!payload.name || !payload.location_id) {
    setStatus("Item name and location are required.");
    return;
  }

  try {
    await fetchJson(`/items/${selectedItemId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
    await refreshAll();
    selectItem(selectedItemId);
    closeModal(editItemModal);
    setStatus("Item updated.");
  } catch (error) {
    setStatus(error.message);
  }
});

deleteLocationBtn.addEventListener("click", async () => {
  if (!selectedLocationId) {
    setStatus("Select a location first.");
    return;
  }

  const ok = window.confirm("Delete this location? It must have no children and no items.");
  if (!ok) {
    return;
  }

  try {
    await fetchJson(`/locations/${selectedLocationId}`, { method: "DELETE" });
    hideEditors();
    await refreshAll();
    closeModal(editLocationModal);
    setStatus("Location deleted.");
  } catch (error) {
    setStatus(error.message);
  }
});

deleteItemBtn.addEventListener("click", async () => {
  if (!selectedItemId) {
    setStatus("Select an item first.");
    return;
  }

  const ok = window.confirm("Delete this item?");
  if (!ok) {
    return;
  }

  try {
    await fetchJson(`/items/${selectedItemId}`, { method: "DELETE" });
    hideEditors();
    await refreshAll();
    closeModal(editItemModal);
    setStatus("Item deleted.");
  } catch (error) {
    setStatus(error.message);
  }
});

refreshTreeBtn.addEventListener("click", () => {
  void refreshInventoryTree();
});

refreshHouseholdsBtn.addEventListener("click", async () => {
  refreshHouseholdsBtn.disabled = true;
  setStatus("Refreshing households...");
  try {
    await refreshHouseholds();
    hideEditors();
    await refreshAll();
    setStatus("Households refreshed.");
  } catch (error) {
    setStatus(error.message);
  } finally {
    refreshHouseholdsBtn.disabled = false;
  }
});

householdSelect.addEventListener("change", async () => {
  const nextHouseholdId = householdSelect.value || "";
  setActiveHousehold(nextHouseholdId);

  if (!activeHouseholdId) {
    householdMembers = [];
    householdInvitations = [];
    renderHouseholdPanel();
    return;
  }

  setStatus("Switching household...");
  try {
    await refreshHouseholdMembersAndInvites();
    hideEditors();
    await refreshAll();
    resultsEl.innerHTML = "";
    metaEl.textContent = "";
    setStatus("Household switched.");
  } catch (error) {
    setStatus(error.message);
  }
});

createHouseholdForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const name = createHouseholdNameInput.value.trim();
  if (!name) {
    setStatus("Household name is required.");
    return;
  }

  try {
    const payload = await fetchJson("/households", {
      method: "POST",
      body: JSON.stringify({ name }),
    });
    createHouseholdForm.reset();
    await refreshHouseholds(payload.household?.id || "");
    hideEditors();
    await refreshAll();
    setStatus("Household created.");
  } catch (error) {
    setStatus(error.message);
  }
});

inviteMemberForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!activeHouseholdId) {
    setStatus("Select a household first.");
    return;
  }

  const email = inviteEmailInput.value.trim();
  const role = inviteRoleSelect.value;
  if (!email) {
    setStatus("Invite email is required.");
    return;
  }

  inviteMemberBtn.disabled = true;
  inviteTokenHintEl.textContent = "";
  try {
    const payload = await fetchJson(`/households/${activeHouseholdId}/invitations`, {
      method: "POST",
      body: JSON.stringify({ email, role }),
    });
    inviteMemberForm.reset();
    inviteTokenHintEl.textContent = `Invitation token (share securely): ${payload.invitation_token}`;
    await refreshHouseholdMembersAndInvites();
    setStatus(`Invitation created for ${email}.`);
  } catch (error) {
    setStatus(error.message);
  } finally {
    inviteMemberBtn.disabled = false;
  }
});

householdMembersEl.addEventListener("click", async (event) => {
  const saveBtn = event.target.closest("[data-member-save-id]");
  if (saveBtn) {
    const memberUserId = saveBtn.getAttribute("data-member-save-id");
    const roleSelect = householdMembersEl.querySelector(`[data-member-role-id="${memberUserId}"]`);
    const role = roleSelect ? roleSelect.value : "";
    if (!memberUserId || !role || !activeHouseholdId) {
      setStatus("Invalid member role update request.");
      return;
    }

    saveBtn.disabled = true;
    try {
      await fetchJson(`/households/${activeHouseholdId}/members/${memberUserId}`, {
        method: "PATCH",
        body: JSON.stringify({ role }),
      });
      await refreshHouseholds(activeHouseholdId);
      hideEditors();
      await refreshAll();
      setStatus("Member role updated.");
    } catch (error) {
      setStatus(error.message);
    } finally {
      saveBtn.disabled = false;
    }
    return;
  }

  const removeBtn = event.target.closest("[data-member-remove-id]");
  if (!removeBtn) {
    return;
  }

  const memberUserId = removeBtn.getAttribute("data-member-remove-id");
  if (!memberUserId || !activeHouseholdId) {
    setStatus("Invalid remove request.");
    return;
  }

  const ok = window.confirm("Remove this member from household?");
  if (!ok) {
    return;
  }

  removeBtn.disabled = true;
  try {
    await fetchJson(`/households/${activeHouseholdId}/members/${memberUserId}`, {
      method: "DELETE",
    });
    await refreshHouseholds(activeHouseholdId);
    hideEditors();
    await refreshAll();
    setStatus("Member removed.");
  } catch (error) {
    setStatus(error.message);
  } finally {
    removeBtn.disabled = false;
  }
});

householdInvitationsEl.addEventListener("click", async (event) => {
  const revokeBtn = event.target.closest("[data-invite-revoke-id]");
  if (!revokeBtn) {
    return;
  }

  const inviteId = revokeBtn.getAttribute("data-invite-revoke-id");
  if (!inviteId || !activeHouseholdId) {
    setStatus("Invalid revoke request.");
    return;
  }

  const ok = window.confirm("Revoke this invitation?");
  if (!ok) {
    return;
  }

  revokeBtn.disabled = true;
  try {
    await fetchJson(`/households/${activeHouseholdId}/invitations/${inviteId}`, {
      method: "DELETE",
    });
    await refreshHouseholdMembersAndInvites();
    setStatus("Invitation revoked.");
  } catch (error) {
    setStatus(error.message);
  } finally {
    revokeBtn.disabled = false;
  }
});

seedBtn.addEventListener("click", async () => {
  seedBtn.disabled = true;
  setStatus("Seeding demo data...");
  try {
    await fetchJson("/dev/seed", { method: "POST" });
    hideEditors();
    await refreshAll();
    setStatus("Seed complete.");
  } catch (error) {
    setStatus(error.message);
  } finally {
    seedBtn.disabled = false;
  }
});

uploadLocImageBtn.addEventListener("click", () => {
  void uploadFromInput(locImageFileInput, locImageUrlInput, "location", uploadLocImageBtn);
});

uploadItemImageBtn.addEventListener("click", () => {
  void uploadFromInput(itemImageFileInput, itemImageUrlInput, "item", uploadItemImageBtn);
});

uploadEditLocImageBtn.addEventListener("click", () => {
  void uploadFromInput(
    editLocImageFileInput,
    editLocImageUrlInput,
    "location",
    uploadEditLocImageBtn
  );
});

uploadEditItemImageBtn.addEventListener("click", () => {
  void uploadFromInput(
    editItemImageFileInput,
    editItemImageUrlInput,
    "item",
    uploadEditItemImageBtn
  );
});

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
    setAuthSession(payload.token, payload.user);
    loginForm.reset();
    await refreshHouseholds();
    hideEditors();
    await refreshAll();
    setStatus("Signed in.");
  } catch (error) {
    setStatus(error.message);
  }
});

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
    setAuthSession(payload.token, payload.user);
    registerForm.reset();
    await refreshHouseholds();
    hideEditors();
    await refreshAll();
    setStatus("Account created and signed in.");
  } catch (error) {
    setStatus(error.message);
  }
});

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
    if (payload.reset_token) {
      resetTokenInput.value = payload.reset_token;
      setStatus(`Reset token generated. Expires at: ${payload.expires_at}`);
    } else {
      setStatus("If that account exists, a reset token was issued.");
    }
    forgotPasswordForm.reset();
  } catch (error) {
    setStatus(error.message);
  }
});

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
    setStatus("Password reset successful. You can now sign in.");
  } catch (error) {
    setStatus(error.message);
  }
});

logoutBtn.addEventListener("click", async () => {
  try {
    await fetchJson("/auth/logout", { method: "POST" });
  } catch {
    // Ignore logout failure and clear local session anyway.
  } finally {
    clearAuthSession();
    hideEditors();
    resultsEl.innerHTML = "";
    metaEl.textContent = "";
    treeMetaEl.textContent = "";
    treeViewEl.innerHTML = "";
    treeTextEl.textContent = "";
    householdRoleHintEl.textContent = "";
    setStatus("Signed out.");
  }
});

searchBtn.addEventListener("click", () => {
  void search();
});

queryInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    void search();
  }
});

if (chatAskBtn) {
  chatAskBtn.addEventListener("click", () => {
    void askAssistant();
  });
}

if (chatClearBtn) {
  chatClearBtn.addEventListener("click", () => {
    chatHistory = [];
    renderChatHistory();
    setStatus("Assistant history cleared.");
  });
}

if (chatQueryInput) {
  chatQueryInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void askAssistant();
    }
  });
}

if (searchModeSelect) {
  searchModeSelect.addEventListener("change", () => {
    const mode = setSearchMode(searchModeSelect.value);
    if (queryInput.value.trim()) {
      void search();
      return;
    }
    setStatus(`Search mode set to ${mode}.`);
  });
}

window.addEventListener("load", async () => {
  try {
    renderChatHistory();
    restoreSearchMode();
    restoreAuthSessionFromStorage();
    await hydrateSessionUser();
    await refreshHouseholds();
    hideEditors();
    await refreshAll();
    updateActionState();
    setStatus("Ready.");
  } catch (error) {
    if (String(error.message || "").toLowerCase().includes("authentication")) {
      setStatus("Sign in to load inventory.");
    } else {
      setStatus(`Startup error: ${error.message}`);
    }
  }
});
