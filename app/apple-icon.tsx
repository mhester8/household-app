import { ImageResponse } from "next/og";

// iOS home screen icon (rel="apple-touch-icon"). 180x180 is Apple's
// recommended size for the iPhone Retina home screen slot. Must be fully
// opaque — iOS fills any transparent pixels in with black.
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#55643a",
        }}
      >
        {/* Same mark and proportions as components/LeafIcon.tsx */}
        <svg
          width="112"
          height="112"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#f7faf0"
          strokeWidth={1.75}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M4 15c0-6 4.5-11 15-11 0 10.5-5 15-11 15-2.5 0-4-1-4-4Z" />
          <path d="M5 19c3-3 6-6 12-11" />
        </svg>
      </div>
    ),
    { ...size }
  );
}
