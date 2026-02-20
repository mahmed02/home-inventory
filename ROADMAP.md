# Home Inventory System — Phased Implementation Roadmap

This document converts the original build specification into actionable implementation phases and tickets.

Each phase builds on the previous one and delivers usable value.

---

# Phase 0 — Foundation Setup

## Goal

Establish project scaffolding and infrastructure.

### Tickets

* [ ] Initialize repository
* [ ] Configure database (Postgres)
* [ ] Set up migration system
* [ ] Configure object storage (for images)
* [ ] Establish basic project structure (frontend + API)
* [ ] Configure environment variables
* [ ] Set up linting and formatting

Definition of Done:

* App runs locally
* Database connected
* Migrations operational

---

# Phase 1 — Core Data Model (MVP Backend)

## Goal

Implement flexible hierarchical location tree and items.

---

## 1.1 Locations Table

### Tickets

* [ ] Create `locations` table

  * id (uuid, PK)
  * name (text)
  * code (text, optional)
  * type (text, optional)
  * parent_id (uuid, FK self-reference)
  * description (text)
  * image_url (text)
  * created_at
  * updated_at

* [ ] Add index on `parent_id`

* [ ] Add index on `code`

* [ ] Create migration

Definition of Done:

* Locations can be inserted manually
* Parent-child relationships work

---

## 1.2 Items Table

### Tickets

* [ ] Create `items` table

  * id (uuid, PK)
  * name (text)
  * brand (text)
  * description (text)
  * keywords (text[] or json)
  * location_id (uuid FK)
  * low_churn (boolean default true)
  * image_url (text)
  * created_at
  * updated_at

* [ ] Add index on `location_id`

* [ ] Add GIN index on `keywords`

Definition of Done:

* Items can be inserted and linked to locations

---

# Phase 2 — Core API Layer

## Goal

Enable CRUD operations for locations and items.

---

## 2.1 Location Endpoints

### Tickets

* [ ] POST /locations (create)
* [ ] GET /locations/tree (recursive retrieval)
* [ ] PATCH /locations/:id (rename / move)
* [ ] DELETE /locations/:id (validation required)

Validation Rules:

* Cannot delete location with children or items

Definition of Done:

* Tree can be fetched and rendered
* Parent can be updated (container move supported)

---

## 2.2 Item Endpoints

### Tickets

* [ ] POST /items
* [ ] GET /items/:id
* [ ] PATCH /items/:id
* [ ] DELETE /items/:id

Definition of Done:

* Items can be created, edited, moved, deleted

---

# Phase 3 — Basic Search (MVP Complete)

## Goal

Instantly find items via keyword search.

---

### Tickets

* [ ] Implement search endpoint: GET /items/search?q=
* [ ] Use ILIKE on:

  * name
  * brand
  * description
  * keywords
* [ ] Return item + full location path

Optional Enhancement:

* Add PostgreSQL full-text search

Definition of Done:

* Searching "winter" returns relevant items
* Results display full breadcrumb path

MVP COMPLETE at end of Phase 3

---

# Phase 4 — Frontend MVP UI

## Goal

Deliver usable interface.

---

## 4.1 Dashboard

### Tickets

* [ ] Global search bar
* [ ] Quick add item button
* [ ] Quick add location button

---

## 4.2 Location Explorer

### Tickets

* [ ] Recursive tree component
* [ ] Expand/collapse nodes
* [ ] Display items in selected node
* [ ] Breadcrumb navigation

---

## 4.3 Item Detail Page

### Tickets

* [ ] View item metadata
* [ ] Display location path
* [ ] Move item dropdown
* [ ] Edit metadata

Definition of Done:

* User can search and locate items visually
* User can move items easily

---

# Phase 5 — Photo Support

## Goal

Add visual reinforcement to system.

---

### Tickets

* [ ] Enable image upload for items
* [ ] Enable image upload for locations
* [ ] Generate thumbnails
* [ ] Store URL in DB

Definition of Done:

* Items and locations can display photos

---

# Phase 6 — Container Movement Optimization

## Goal

Efficiently move boxes without touching items.

---

### Tickets

* [ ] Ensure moving a location updates only parent_id
* [ ] Confirm items inherit new effective path
* [ ] Add confirmation modal for location move

Definition of Done:

* Moving a box updates all contained items logically

---

# Phase 7 — Semantic Search (LLM-Ready Layer)

## Goal

Allow natural language item discovery.

---

### Tickets

* [ ] Add embedding column to items table
* [ ] Generate embeddings on item create/update
* [ ] Store vector in DB
* [ ] Create similarity search query
* [ ] Rank results by cosine similarity

Definition of Done:

* Query "green tire inflator" returns correct compressor

---

# Phase 8 — Natural Language Query Interface

## Goal

Conversational lookup experience.

---

### Tickets

* [ ] Add chat-style input component
* [ ] Embed user query
* [ ] Retrieve top N similar items
* [ ] Return ranked suggestions
* [ ] Optional: LLM response formatting

Definition of Done:

* User can type conversational query
* System returns likely matches

---

# Phase 9 — Movement History (Optional Advanced)

## Goal

Track item relocation events.

---

### Tickets

* [ ] Create movement_history table
* [ ] Log item moves
* [ ] Add "view history" button

Definition of Done:

* Past locations are visible per item

---

# Phase 10 — Physical-Digital Sync (Optional Advanced)

## Goal

Reduce entropy in real-world organization.

---

### Tickets

* [ ] Generate QR codes for locations
* [ ] Add scan-to-view functionality
* [ ] Display expected inventory per location
* [ ] Add verification mode

Definition of Done:

* Scanning a zone shows its contents

---

# Final Milestones Summary

Milestone 1: Backend Complete (Phase 1–3)
Milestone 2: Usable App (Phase 4)
Milestone 3: Visual + Efficient Movement (Phase 5–6)
Milestone 4: Intelligent Search (Phase 7–8)
Milestone 5: Advanced Control System (Phase 9–10)

---

# Recommended Build Order

If building solo:

1. Phase 0
2. Phase 1
3. Phase 2
4. Phase 3  → STOP and test with real items
5. Phase 4
6. Phase 5
7. Phase 6
8. Phase 7+

Test with real household data early to validate friction.

---

End of Roadmap
