# Project Decisions

This file records important project decisions and the reasoning behind them. It is intentionally lightweight.

---

## 001 - Start with a single grocery list

**Date:** 2026-08-05

**Status:** Active

### Decision
Build one shared grocery list before adding other household features.

### Why
The goal is to create a working application quickly while learning modern web development through small, incremental steps.

### Alternatives considered
- Build multiple household features immediately.
- Design a generalized household management system from the beginning.

### Revisit when
The grocery list is stable and real usage suggests additional household features are needed.

---

## 002 - Use Supabase for shared household data

**Date:** 2026-08-05

**Status:** Active

### Decision
Use Supabase as the backend for shared grocery-list data.

### Why
The app needs persistent data that can be accessed from more than one device, with a straightforward path to near-real-time updates later.

### Alternatives considered
- Continue using localStorage
- Firebase
- Build a custom backend

### Revisit when
Supabase no longer meets the app's needs, or offline-first behavior becomes a major requirement.

---

## 003 - Use a single grocery_items table

**Date:** 2026-08-05

**Status:** Active

### Decision
Store each grocery item as one row in a single grocery_items table with id, name, completed, and created_at fields.

### Why
This directly matches the current grocery-list feature and avoids designing a generalized household data model before it is needed.

### Alternatives considered
- Multiple list and household tables immediately
- A generalized tasks table
- Storing the whole list as one JSON value

### Revisit when
We add multiple lists, multiple households, categories, quantities, or other features that require a broader schema.

---

## 004 - Deploy on Vercel with login-only Supabase Auth

**Date:** 2026-08-07

**Status:** Active

### Decision
Deploy Hester House on Vercel at the custom domain hesterhouse.app. Add Supabase Auth (email/password, login-only, no self-registration) as simple access control, replacing the previous anonymous prototype access. User accounts are created manually in the Supabase dashboard, not through self-service sign-up. Both authenticated users share the same grocery_items data with no per-user ownership.

### Why
Now that the app is deployed at a public domain, anonymous database access is no longer appropriate. The household only has two members, so a simple login-only gate with manually created accounts and a single shared list is enough — building out household membership, roles, or invitations now would be solving a problem that doesn't exist yet.

### Alternatives considered
- Continue with anonymous/public access now that the app is publicly reachable.
- Build full household membership with per-user roles, ownership, and invitations immediately.
- Allow self-service sign-up, or add OAuth/social login.

### Revisit when
The app needs to support multiple households, sharing beyond these two people, or per-user permissions/ownership.

---

## 005 - Workout tracker: per-user data, snapshot sessions, one active session

**Date:** 2026-08-11

**Status:** Active

### Decision
Workout templates and sessions belong to the individual signed-in user (`user_id`, RLS-scoped), unlike the shared grocery list. A workout session copies (snapshots) its exercises' name/sets/rest from the template at start time into `session_exercises`, rather than referencing `template_exercises` directly, so later template edits/deletes never corrupt past session history. A database-level unique index allows at most one incomplete (`completed_at IS NULL`) session per user at a time; starting a new workout while one is already in progress resumes it instead of creating a second one.

### Why
A workout log is normally personal even within a two-person household, so shared/no-ownership (as used for groceries) doesn't fit. Snapshotting is the minimum needed to keep "record what actually happened" durable without a generalized exercise-library data model. A single active session keeps the UI (and the data) simple for this first slice — no session picker, no merge/cleanup logic for abandoned duplicates.

### Alternatives considered
- Shared workout data across both accounts, matching decision 004.
- Sessions referencing `template_exercises` directly instead of snapshotting.
- Allowing multiple simultaneous in-progress sessions per user.

### Revisit when
The household wants to see or compare each other's workouts, templates need an edit/versioning UI, or real usage shows a need for multiple concurrent sessions (e.g. supersetting two templates).

---

## 006 - Saved Recipe Library is the canonical destination for recipes

**Date:** 2026-08-12

**Status:** Active

### Decision
Treat the saved Recipe Library as the canonical destination for recipes, with multiple future import/discovery methods feeding the same recipe structure.

### Why
This prevents manual recipes, URL imports, Pinterest imports, and possible future web recipe discovery from becoming separate feature silos. They should ultimately produce the same kind of saved recipe and use the same downstream recipe/ingredient/grocery-list workflows.

### Alternatives considered
- Creating separate recipe types or storage/workflows for manual recipes, website imports, Pinterest recipes, etc.

### Revisit when
We discover that an external recipe source contains important information that genuinely cannot be represented reasonably in the existing recipe model.

---

## 007 - Import sources normalize into the existing recipe draft/review flow

**Date:** 2026-08-12

**Status:** Active

### Decision
Import sources normalize into the existing recipe draft/review flow rather than saving directly to the database.

### Why
This preserves a human review checkpoint, keeps imports consistent regardless of source, and avoids duplicating recipe persistence logic.

### Alternatives considered
- Letting each importer write directly to recipe tables or giving URL/Pinterest imports their own save flows.

### Revisit when
A future import source genuinely cannot be represented or reviewed reasonably through the existing recipe draft structure.

---

## 008 - Notes: flat, shared household notebook with last-write-wins collaboration

**Date:** 2026-08-14

**Status:** Active

### Decision
Build Notes as a flat, shared household notebook, not a task-management system. Notes use shared authenticated access (no per-user ownership), matching the grocery-list pattern rather than the per-user workout pattern. V1 organization is limited to pinned/recent ordering, search (across title and body, including archived notes), and archive/restore — no folders, tags, or other filing structure. New-note capture is inline and mobile-first (built specifically around iOS's keyboard-focus constraints), and both creating and editing autosave with no explicit Save action. When the same note is open on two devices, updates are reconciled with simple last-write-wins semantics — a local device with unsaved changes keeps its own draft and is only notified, never silently overwritten — rather than building any document-merging infrastructure.

### Why
Notes exists to reduce cognitive load and capture household information (people's names, meal ideas, app feedback, miscellany) that doesn't deserve its own specialized system. Organization should not require upfront filing — pinning and search are enough until real usage proves otherwise. The app is currently a private two-person household app, so simple shared access is sufficient and per-user ownership would solve a problem that doesn't exist. Simplicity and low-friction daily use matter more than speculative extensibility.

### Alternatives considered
- Folders/collections or tags for organization.
- Task-management features (due dates, reminders, priorities, statuses).
- Per-user (private) notes instead of shared.
- Spaces or other multi-household ownership model.
- A rich-text editor instead of plain text.
- AI-assisted organization/categorization.
- Collaborative editing/merging infrastructure (real-time co-editing, conflict resolution beyond last-write-wins).

### Revisit when
Real usage creates organization problems that pinned/recent/search/archive don't solve; personal/private notes become a real need; Spaces becomes an actual product requirement; or concurrent-editing conflicts become common enough that last-write-wins causes real data loss or friction.

---

## Maintenance Guidelines

- Record only meaningful product or architectural decisions.
- Do not record bug fixes, styling tweaks, or small implementation details.
- Never rewrite history.
- If a decision changes, leave the old decision intact, mark its Status as "Superseded", and create a new numbered decision explaining the change.
- Number decisions sequentially (001, 002, 003...).
- Keep each decision concise.
