"use client";

import { useParams } from "next/navigation";
import { NoteEditor } from "@/components/NoteEditor";

export default function EditNotePage() {
  const params = useParams<{ id: string }>();
  return <NoteEditor noteId={params.id} />;
}
