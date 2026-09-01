# AI Marketing Planner — Backend (Modular Monolith)

Lightweight, secure, and production-ready Node.js + Express backend for the **AI Marketing Planner** platform.

---

## 📋 Features & Architecture

* **Modular Monolith Structure:** Clean layered architecture:
  * `src/config/`: Environment validation (Zod) and singleton database clients.
  * `src/middleware/`: Symmetric JWT Authentication (`jose`), Zod Request Validation, CORS, and unified Error Handler.
  * `src/repositories/`: Scoped Supabase data access layer with strict `user_id` ownership isolation (`plans`, `brands`, `jobs`, `exports`).
  * `src/services/ai/`: Unified Google Gemini client using official `@google/genai` SDK, 3-stage AI orchestrator, prompts, and output schemas.
  * `src/services/integrations/`: Google Sheets API v4 & Google Drive API v3 direct export service with independent error isolation.
  * `src/controllers/`: Thin request-response controllers with fire-and-forget background safety backstops.
  * `src/routes/`: Route declarations and aggregation.
* **Official Google GenAI SDK (`@google/genai`):**
  * Modern unified client interface with `responseMimeType: "application/json"`.
  * Exponential retry backoff on transient errors (`429`, `503`, timeouts).
  * Strict client error bail-out (no retries on `400`, `401`, `403`).
* **3-Stage AI Generation Pipeline:**
  * **Stage 1 (Strategy & Diagnosis):** Analyzes business, audience, positioning, pain points, and Instagram fit score (1–10).
  * **Stage 2 (Pillars & Distribution):** Generates 3–5 content pillars and 7-part marketing objective distribution.
  * **Stage 3 (30-Day Content Calendar):** Generates 30 detailed Instagram posts (reels, carousels, static posts, stories) with captions, design copy, visual references, and CTAs.
* **Google Sheets & Drive Export Service (Phase 4):**
  * **Owner Account Quota Model:** Directly generates spreadsheets under platform owner quota using `GOOGLE_SHEETS_OWNER_REFRESH_TOKEN`.
  * **Non-Blocking Plan Resilience:** Step-level error isolation ensures that a Google Sheets or Drive failure *never* marks the generated plan or job as failed.
  * **Drive Permission Sharing:** Automatically shares spreadsheet with user's email with `writer` role.
  * **Dedicated Export Retry Endpoint:** Allows retrying failed Google Sheets exports independently without re-running AI generation.
* **Asynchronous Execution + Polling:** `POST /api/v1/plans` responds in `< 500ms` with `{ planId, jobId }`, orchestrating generation in background and updating job progress steps for real-time polling.
* **Retry Failed Generations:** `POST /api/v1/plans/:id/retry` allows re-running failed plan generations cleanly, creating a fresh `generation_jobs` record while preserving full job history.
* **Single Post Regeneration:** Unified Gemini-powered single post regeneration with in-memory sliding window rate limiting (10 requests/hour per user).
* **Atomic Database RPC:** Calls PostgreSQL stored procedure `complete_marketing_plan` to atomically save strategy, pillars, objective mix, and batch-insert 30 content items in a single ACID transaction.

---

## 🚦 API Endpoints Status Matrix

| Method | Endpoint | Auth Required | Status | Description |
| :--- | :--- | :---: | :---: | :--- |
| `GET` | `/health` | No | 🟢 **Live** | Service status and Render keepalive warm-up ping |
| `GET` | `/api/v1/brands` | Yes | 🟢 **Live** | Lists all brand profiles owned by authenticated user |
| `POST` | `/api/v1/brands` | Yes | 🟢 **Live** | Creates a new brand profile (validated via Zod) |
| `GET` | `/api/v1/brands/:id` | Yes | 🟢 **Live** | Retrieves single brand profile (scoped to owner) |
| `PUT` | `/api/v1/brands/:id` | Yes | 🟢 **Live** | Updates brand profile (validated via Zod) |
| `DELETE`| `/api/v1/brands/:id` | Yes | 🟢 **Live** | Deletes brand profile (scoped to owner) |
| `GET` | `/api/v1/plans` | Yes | 🟢 **Live** | Lists marketing plans for authenticated user |
| `POST` | `/api/v1/plans` | Yes | 🟢 **Live** | **Async 3-Stage Plan Generation & Sheets Export Trigger** |
| `GET` | `/api/v1/plans/:id` | Yes | 🟢 **Live** | Retrieves single marketing plan with content & jobs info |
| `GET` | `/api/v1/plans/:id/status` | Yes | 🟢 **Live** | **Real-time generation progress & export polling endpoint** |
| `POST` | `/api/v1/plans/:id/retry` | Yes | 🟢 **Live** | **Retries failed plan generation with fresh job record** |
| `POST` | `/api/v1/plans/:id/retry-export` | Yes | 🟢 **Live** | **Retries failed Google Sheets export for completed plan** |
| `POST` | `/api/v1/plans/:id/content/:day/regenerate` | Yes | 🟢 **Live** | **Gemini single-post regeneration with rate limiting** |
| `DELETE`| `/api/v1/plans/:id` | Yes | 🟢 **Live** | Cascading delete of plan, content items, jobs, and exports |

---

## 🚀 Quickstart Guide

### 1. Installation
Navigate into the `backend/` directory and install dependencies:
```bash
cd backend
npm install
```

### 2. Environment Configuration
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```

| Variable | Required? | Description |
| :--- | :--- | :--- |
| `PORT` | Optional (`5000`) | Server HTTP port |
| `NODE_ENV` | Optional (`development`) | Runtime environment (`development`, `production`, `test`) |
| `FRONTEND_URL` | Optional (`http://localhost:3000`) | Allowed CORS origin |
| `SUPABASE_URL` | **Required** | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | **Required** | Supabase Service Role key (bypasses RLS for backend) |
| `AUTH_SECRET` | **Required** | Symmetric secret for NextAuth JWT verification |
| `GEMINI_API_KEY` | **Required** | Google Gemini API key |
| `GEMINI_MODEL` | Optional (`gemini-2.5-flash`) | Gemini model identifier |
| `GOOGLE_CLIENT_ID` | **Required** | Google Cloud OAuth Client ID |
| `GOOGLE_CLIENT_SECRET` | **Required** | Google Cloud OAuth Client Secret |
| `GOOGLE_SHEETS_OWNER_REFRESH_TOKEN` | Optional | Refresh token from `npm run auth:google` |

---

### 3. One-Time Google OAuth Authorization Helper
To grant spreadsheet creation and sharing privileges under your personal Google account:
```bash
npm run auth:google
```

---

### 4. Running the Server

#### Development Mode (Nodemon):
```bash
npm run dev
```

#### Production Mode:
```bash
npm start
```

---

### 5. Automated Test Suite

Run the full Vitest integration suite:
```bash
npm test
```

Test results summary:
```text
 ✓ tests/health.test.js (2 tests)
 ✓ tests/auth.middleware.test.js (5 tests)
 ✓ tests/brands.validation.test.js (6 tests)
 ✓ tests/ownership.isolation.test.js (12 tests)
 ✓ tests/plans.generation.test.js (9 tests)
 ✓ tests/exports.service.test.js (6 tests)

 Test Files  6 passed (6)
      Tests  40 passed (40)
```
