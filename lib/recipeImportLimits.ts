// Shared between the photo import page and its API route so the client-side
// checks (fast, friendly errors) and the server-side checks (the real
// enforcement) can never drift apart.

// Conservative cap for one extraction request. Chosen to comfortably cover
// the "recipe too long for one screenshot" fallback case (2-4 images) while
// leaving headroom under the 4.5MB Vercel serverless function body limit
// even if individual photos compress larger than a typical screenshot.
export const MAX_IMPORT_IMAGES = 5;

// This app's route handlers run as Vercel serverless functions, which cap
// the incoming request body at 4.5MB regardless of anything the app does —
// a batch over that limit gets rejected by the platform before the route
// handler even runs, surfacing as an opaque network failure rather than a
// clean error message. Checking against this smaller threshold on the
// client (and again on the server as a backstop) means an oversized batch
// fails with a readable message instead of that opaque one.
export const MAX_TOTAL_IMPORT_IMAGE_BYTES = 4 * 1024 * 1024;
