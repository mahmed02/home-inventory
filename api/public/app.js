const queryInput = document.getElementById("query");
const searchBtn = document.getElementById("searchBtn");
const resultsEl = document.getElementById("results");
const statusEl = document.getElementById("status");
const metaEl = document.getElementById("meta");

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
const allModals = [
  createActionsModal,
  createLocationModal,
  createItemModal,
  editLocationModal,
  editItemModal,
  imageLightboxModal,
];

function setStatus(message) {
  statusEl.textContent = message;
}

function updateActionState() {
  const hasSelection = Boolean(selectedLocationId || selectedItemId);
  openEditBtn.disabled = !hasSelection;

  if (selectedLocationId) {
    const location = locationMap.get(selectedLocationId);
    selectionHintEl.textContent = location
      ? `Selected location: ${location.name}`
      : "Select a location or item in the tree to edit.";
    openEditBtn.textContent = "Edit Location";
    return;
  }

  if (selectedItemId) {
    const item = itemMap.get(selectedItemId);
    selectionHintEl.textContent = item
      ? `Selected item: ${item.name}`
      : "Select a location or item in the tree to edit.";
    openEditBtn.textContent = "Edit Item";
    return;
  }

  selectionHintEl.textContent = "Select a location or item in the tree to edit.";
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
  modalEl.hidden = true;
  if (allModals.every((modal) => modal.hidden)) {
    document.body.classList.remove("modal-open");
  }
}

function closeAllModals() {
  allModals.forEach((modal) => {
    modal.hidden = true;
  });
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

async function fetchJson(path, options) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
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
  const rows = [`<option value="">${placeholder}</option>`];
  for (const loc of options) {
    const selected = loc.id === selectedValue ? " selected" : "";
    rows.push(`<option value="${loc.id}"${selected}>${loc.path}</option>`);
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
    const children = [];

    for (const child of node.children || []) {
      children.push(renderNode(child));
    }

    for (const item of node.items || []) {
      const itemSelected = selectedItemId === item.id ? " selected" : "";
      children.push(`
        <li class="tree-item">
          <span class="item-label${itemSelected}" data-item-id="${item.id}">
            ${
              item.image_url
                ? `<img class="tree-thumb" src="${item.image_url}" alt="${item.name}" title="Click to enlarge">`
                : ""
            }
            <span class="item-tag">item</span>
            <span>${item.name}</span>
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
            <span class="tree-label${locationSelected}" data-location-id="${node.id}">
              ${node.name}${node.code ? ` (${node.code})` : ""}
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

function renderResults(results, total, limit, offset) {
  if (!results.length) {
    resultsEl.innerHTML = '<li class="result">No results</li>';
    metaEl.textContent = "total: 0";
    return;
  }

  metaEl.textContent = `total: ${total}, showing ${results.length}, offset ${offset}, limit ${limit}`;

  const options = flatLocations
    .map((loc) => `<option value="${loc.id}">${loc.path}</option>`)
    .join("");

  resultsEl.innerHTML = results
    .map(
      (item) => `
        <li class="result" data-item-id="${item.id}">
          <div class="result-main">
            ${
              item.image_url
                ? `<img class="thumb" src="${item.image_url}" alt="${item.name}" title="Click to enlarge">`
                : ""
            }
            <div>
              <div class="result-title">${item.name}</div>
              <div class="result-path">${item.location_path}</div>
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

  setStatus("Searching...");

  try {
    await loadLocationTreeForForms();
    const data = await fetchJson(`/items/search?q=${encodeURIComponent(q)}&limit=20&offset=0`);
    renderResults(data.results || [], data.total || 0, data.limit || 20, data.offset || 0);
    setStatus("Done.");
  } catch (error) {
    setStatus(error.message);
  }
}

async function refreshAll() {
  await Promise.all([loadLocationTreeForForms(), refreshInventoryTree()]);
}

resultsEl.addEventListener("click", async (event) => {
  const image = event.target.closest(".thumb");
  if (image && image.src) {
    openImageLightbox(image.src, image.alt || "Item image");
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
    openImageLightbox(image.src, image.alt || "Item image");
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
    await fetchJson(`/locations/${selectedLocationId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
    await refreshAll();
    selectLocation(selectedLocationId);
    closeModal(editLocationModal);
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

searchBtn.addEventListener("click", () => {
  void search();
});

queryInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    void search();
  }
});

window.addEventListener("load", async () => {
  try {
    hideEditors();
    await refreshAll();
    updateActionState();
    setStatus("Ready.");
  } catch (error) {
    setStatus(`Startup error: ${error.message}`);
  }
});
