import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Hester House",
    short_name: "Hester House",
    description: "Hester House household app — groceries, workouts, recipes, and notes.",
    start_url: "/",
    display: "standalone",
    background_color: "#faf6ef",
    theme_color: "#55643a",
    icons: [
      {
        src: "/apple-icon",
        sizes: "180x180",
        type: "image/png",
      },
    ],
  };
}
