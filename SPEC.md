# Home Inventory System — Build Specification

## 1. Objective

Design and implement a flexible, hierarchical home inventory system that allows:

* Stable physical location labeling
* Flexible location hierarchy (unenforced tree)
* Item indexing with keyword and semantic search
* Easy item and container movement
* Optional photo support
* Future LLM-powered natural language querying

Primary goal:

> Instantly locate low-churn physical items via search.

---

# 2. System Architecture Overview

## 2.1 Core Principles

* Locations form a recursive tree.
* Items attach to any location node.
* Hierarchy is flexible (no enforced levels).
* Internal IDs are stable; names and codes are editable.
* Movement updates a single parent reference.

---

# 3. Data Model

## 3.1 Locations Table

Represents any physical structure:
House, Room, Zone, Shelf, Box, Container, etc.

### Schema

* id (uuid, primary key)
* name (text, required)
* code (text, optional, e.g. "G1", "G1-S2")
* type (text, optional: house, room, zone, shelf, box, etc.)
* parent_id (uuid, nullable, FK to locations.id)
* description (text, optional)
* image_url (text, optional)
* created_at (timestamp)
* updated_at (timestamp)

### Notes

* Tree implemented using adjacency list pattern.
* No hard enforcement of structure depth.
* Root node example: "House".

---

## 3.2 Items Table

### Schema

* id (uuid, primary key)
* name (text, required)
* brand (text, optional)
* description (text, optional)
* keywords (text[] or JSON array)
* location_id (uuid, FK to locations.id)
* low_churn (boolean, default true)
* image_url (text, optional)
* created_at (timestamp)
* updated_at (timestamp)

### Searchable Fields

* name
* brand
* description
* keywords

---

## 3.3 Optional Future Tables

### Movement History (Phase 3+)

* id
* item_id
* from_location_id
* to_location_id
* moved_at

### Location Audit (Optional)

* location_id
* expected_item_count
* last_verified_at

---

# 4. Core Features (MVP)

## 4.1 Location Management

* Create location node
* Rename location
* Change parent location
* Delete location (if no children/items)
* View tree structure

### Tree Requirements

* Expand/collapse UI
* Breadcrumb navigation
* Recursive query support

---

## 4.2 Item Management

* Create item
* Edit item metadata
* Assign location
* Move item (change location_id)
* Delete item
* View items within location

---

## 4.3 Search

### MVP Search

* Case-insensitive partial match
* Match against:

  * name
  * brand
  * keywords
  * description

### Implementation Options

* PostgreSQL ILIKE
* Full-text search (tsvector)

Return:

* Item name
* Location path
* Thumbnail (if exists)

---

# 5. Physical Labeling System

## 5.1 Location Codes

* Short human-readable codes
* Example: G1, B2, S3
* Optional hierarchical formatting (G1-S2-B3)

## 5.2 Labeling Rules

* Rooms are permanent
* Zones are semi-permanent
* Shelves mostly permanent
* Boxes movable

If a box moves:

* Update parent_id of box
* Items inherit new effective location

---

# 6. API Design

## 6.1 Location Endpoints

* POST /locations
* GET /locations/tree
* PATCH /locations/:id
* DELETE /locations/:id

## 6.2 Item Endpoints

* POST /items
* GET /items/:id
* PATCH /items/:id
* DELETE /items/:id
* GET /items/search?q=

---

# 7. UI Specification

## 7.1 Pages

### 1. Dashboard

* Search bar
* Quick add item
* Quick add location

### 2. Location Explorer

* Tree view (left panel)
* Items in selected location (right panel)

### 3. Item Detail

* Metadata
* Location breadcrumb
* Move button
* Image display

---

# 8. Movement Logic

## 8.1 Move Item

* Update location_id
* Update updated_at

## 8.2 Move Location (Container Move)

* Update parent_id
* No item updates required

---

# 9. Photo Handling

## 9.1 Storage

* Store images in object storage
* Save URL in DB

## 9.2 Compression

* Auto-resize to thumbnail
* Maintain original copy

---

# 10. Phase 2 Enhancements

## 10.1 Semantic Search

Add vector embeddings for:

* name
* description
* keywords

Store in:

* embedding column (vector type)

Use cosine similarity search.

---

## 10.2 Natural Language Querying

Flow:

1. User input text
2. Embed query
3. Search items by vector similarity
4. Return ranked matches
5. Display location path

Optional:

* LLM summarization of results

---

# 11. Phase 3 Enhancements

* Movement history logging
* QR codes for locations
* Zone inventory verification
* Seasonal filtering
* "Low churn" filtering
* Drift detection alerts

---

# 12. Indexing Strategy

## 12.1 Database Indexes

* Index on location_id
* Index on parent_id
* GIN index on keywords
* Full-text index on searchable fields
* Vector index (if semantic search enabled)

---

# 13. Permissions (Optional Future)

* Single-user MVP
* Future: multi-user support
* Role-based access (admin/viewer)

---

# 14. Non-Functional Requirements

* Fast search response (<200ms target)
* Minimal friction for item movement
* Mobile-friendly UI
* Offline-tolerant design (optional future)

---

# 15. Deployment Considerations

* Postgres database
* Object storage for images
* REST or edge-function API
* Static frontend (SPA)

---

# 16. MVP Definition of Done

System is complete when:

* Locations can be created and nested
* Items can be added and assigned
* Items can be moved easily
* Search reliably returns correct location
* Physical labels match digital tree

At this point, 90% of practical value is achieved.

---

# 17. Future Vision

* Conversational interface
* Predictive grouping suggestions
* Automated organizational optimization
* Physical-digital synchronization via QR scanning

---

End of Build Specification
