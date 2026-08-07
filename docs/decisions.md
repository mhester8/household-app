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

## Maintenance Guidelines

- Record only meaningful product or architectural decisions.
- Do not record bug fixes, styling tweaks, or small implementation details.
- Never rewrite history.
- If a decision changes, leave the old decision intact, mark its Status as "Superseded", and create a new numbered decision explaining the change.
- Number decisions sequentially (001, 002, 003...).
- Keep each decision concise.
