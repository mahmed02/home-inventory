# Home Inventory System — Free Tier Hosting Architecture & Best-Value Setup

This document provides two hosting architecture diagrams for the MVP and an optimized free-tier setup.

---

# 1️⃣ AWS Free Tier Hosting Architecture (MVP Focus)

**Goal:** Host your home inventory MVP on AWS Free Tier with minimal operational overhead.

## Components

| Component     | AWS Service                     | Notes                                                                 |
| ------------- | ------------------------------- | --------------------------------------------------------------------- |
| Frontend      | EC2 t2.micro or AWS Amplify     | Host Next.js frontend; t2.micro fits free tier usage                  |
| Backend API   | Same EC2 / Amplify              | REST endpoints: /locations, /items, /items/search                     |
| Database      | Amazon RDS Free Tier (Postgres) | 750 hours / month, 20 GB storage; indexes on location_id and keywords |
| Image Storage | Amazon S3 Free Tier             | 5 GB free; store item/location photos                                 |
| SSL           | Amazon Certificate Manager      | Provides HTTPS for Siri Shortcut integration                          |

### Data Flow

1. User opens frontend (Next.js) → hosted on EC2/Amplify
2. Frontend queries API → REST endpoints on EC2
3. API queries RDS Postgres → returns JSON
4. Optional images pulled from S3
5. Siri Shortcuts query publicly accessible API endpoint → receives JSON → speaks location

### Advantages

* Fully AWS Free Tier compatible
* HTTPS available
* Supports MVP features: CRUD, search, move, rename, basic photos

### Limitations

* Manual SSL configuration for EC2 without Amplify
* Limited storage; compress photos
* t2.micro can handle only small concurrent usage

---

# 2️⃣ Best-Value Free-Tier Setup (Not limited to AWS)

**Goal:** Optimize for minimal maintenance, free hosting, and easy integration with Siri Shortcuts.

## Components

| Component                 | Service                                 | Notes                                                                                    |
| ------------------------- | --------------------------------------- | ---------------------------------------------------------------------------------------- |
| Frontend                  | Vercel / Netlify                        | Free static hosting; auto-deploy Next.js frontend; HTTPS out of the box                  |
| Backend API & Database    | Supabase Free Tier                      | Hosted Postgres + RESTful API; 500k rows free; supports tree structure, search, keywords |
| Image Storage             | Supabase Storage / Cloudinary Free Tier | 10 GB free (Cloudinary) or use Supabase buckets; thumbnails recommended                  |
| Siri Shortcut Integration | Public HTTPS API                        | Supabase provides HTTPS endpoints automatically                                          |

### Data Flow

1. User accesses frontend on Vercel/Netlify → React/Next.js app
2. Frontend calls Supabase API endpoints → locations/items CRUD + search
3. Supabase returns JSON results
4. Siri Shortcuts call Supabase API endpoint → receives location path
5. Optional: Images loaded from Supabase Storage or Cloudinary

### Advantages

* Minimal setup; no server maintenance
* HTTPS handled automatically → immediate Siri Shortcut compatibility
* Free tier generous for a small household
* No AWS learning curve

### MVP Features Supported

* Create/edit/delete locations and items
* Flexible tree hierarchy
* Search by name/keywords
* Move items or containers
* Optional photos
* Siri Shortcut integration

### Optional Upgrades

* Semantic search (embeddings) → Supabase supports pgvector on free tier
* Multi-user support (future)
* Movement history logging (future)

---

# Recommendations

* **For AWS:** Use EC2 + RDS + S3 if you want full AWS stack experience. Ideal if you already use AWS.
* **Best value for free-tier simplicity:** Use Vercel + Supabase + Cloudinary/Supabase Storage. Fully managed, HTTPS-ready, and low maintenance.

---

# Conclusion

Both architectures support your MVP and Siri Shortcut integration. For minimal friction and faster deployment, the Vercel + Supabase stack is the most practical free-tier solution. AWS is viable but requires more setup and maintenance.

---

End of Free Tier Hosting Architecture Document
