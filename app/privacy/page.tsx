import type { Metadata } from "next";
import { LeafIcon } from "@/components/LeafIcon";

export const metadata: Metadata = {
  title: "Privacy Policy — Hester House",
  description: "Privacy policy for the Hester House household web application.",
};

const LAST_UPDATED = "August 14, 2026";

export default function PrivacyPolicyPage() {
  return (
    <div className="flex flex-1 flex-col items-center bg-page px-3 py-3 sm:px-6 sm:py-8">
      <main className="flex w-full max-w-md flex-col gap-1.5 sm:gap-3">
        <div className="flex items-center gap-1 text-muted-foreground">
          <LeafIcon className="h-3 w-3" />
          <p className="text-xs font-semibold uppercase tracking-[0.2em]">
            Hester House
          </p>
        </div>

        <div className="flex flex-col gap-4 rounded-xl bg-surface p-4 text-sm leading-relaxed text-foreground sm:gap-5 sm:rounded-3xl sm:border sm:border-border sm:p-6 sm:shadow-sm">
          <div>
            <h1 className="text-xl font-semibold">Privacy Policy</h1>
            <p className="mt-1 text-xs text-muted-foreground">Last updated: {LAST_UPDATED}</p>
          </div>

          <p>
            Hester House is a private household web application built and used by one household.
            It is not a public commercial service, and it is not intended for use by the general
            public. This page explains, in plain language, what information the app handles and
            how it is used.
          </p>

          <section className="flex flex-col gap-1.5">
            <h2 className="font-semibold">Information the app stores</h2>
            <p>
              Hester House stores the information a signed-in household member intentionally
              enters into it — for example grocery list items, saved recipes (including recipes
              imported from a photo, a web link, or, in the future, Pinterest), and workout
              templates and session history. This data is used only to provide the app&apos;s
              features to the household.
            </p>
          </section>

          <section className="flex flex-col gap-1.5">
            <h2 className="font-semibold">Account and sign-in information</h2>
            <p>
              Hester House uses Supabase for authentication and data storage. Sign-in is
              login-only (email and password) with accounts created manually by the household —
              there is no public self-service sign-up. Your email address and authentication
              details are processed by Supabase on the app&apos;s behalf in order to sign you in
              and identify which data belongs to you.
            </p>
          </section>

          <section className="flex flex-col gap-1.5">
            <h2 className="font-semibold">Pinterest integration (planned)</h2>
            <p>
              Hester House plans to let an authorized household member connect their Pinterest
              account so the app can access the Pinterest information needed to display that
              user&apos;s boards and Pins and let them select saved recipes to import. Board and
              Pin information will be retrieved from Pinterest as needed to show that
              recipe-import experience, not stored as a permanent local copy. Pinterest
              information will be used only to provide this user-requested feature — it will not
              be used for any other purpose.
            </p>
            <p>
              Selecting a Pinterest recipe to import may cause Hester House to access the
              recipe&apos;s linked source website, using the app&apos;s existing recipe-import
              functionality, in order to read the recipe content from that page.
            </p>
            <p>
              You can stop using the Pinterest integration at any time, and you can revoke
              Hester House&apos;s access to your Pinterest account directly through Pinterest.
            </p>
          </section>

          <section className="flex flex-col gap-1.5">
            <h2 className="font-semibold">Third-party services</h2>
            <p>
              Hester House currently relies on the following third-party services to operate:
            </p>
            <ul className="list-disc pl-5">
              <li>
                <span className="font-medium">Supabase</span> — authentication and data storage.
              </li>
              <li>
                <span className="font-medium">OpenAI</span> — used server-side to read recipe
                text out of photos when importing a recipe from an image.
              </li>
            </ul>
            <p>
              When importing a recipe from a web link (or, once available, from Pinterest),
              Hester House also fetches the recipe content directly from that page&apos;s source
              website.
            </p>
          </section>

          <section className="flex flex-col gap-1.5">
            <h2 className="font-semibold">What we don&apos;t do</h2>
            <p>
              Hester House does not sell Pinterest information or any other personal information,
              and does not share it beyond what is needed to provide the features described
              above.
            </p>
          </section>

          <section className="flex flex-col gap-1.5">
            <h2 className="font-semibold">Questions</h2>
            <p>
              This app is developed and maintained by its household owner. If you have questions
              about this policy, please contact the household member who provided you access.
            </p>
          </section>
        </div>
      </main>
    </div>
  );
}
