"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { Upload } from "lucide-react";
import { Alert } from "@/components/ui";

export function Uploader({ folders }: { folders: string[] }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [folder, setFolder] = useState("");
  const [tags, setTags] = useState("");
  const [errors, setErrors] = useState<string[]>([]);

  function upload(files: FileList | File[]) {
    const list = Array.from(files);
    if (list.length === 0) return;
    const form = new FormData();
    list.forEach((f) => form.append("files", f));
    form.append("folder", folder);
    form.append("tags", tags);
    setErrors([]);
    setProgress(0);
    // XHR for upload progress on slow connections.
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/media");
    xhr.upload.onprogress = (e) => e.lengthComputable && setProgress(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => {
      setProgress(null);
      try {
        const body = JSON.parse(xhr.responseText);
        if (xhr.status >= 400) setErrors([body.error ?? "Upload failed"]);
        else setErrors((body.results as { filename: string; error?: string }[]).filter((r) => r.error).map((r) => `${r.filename}: ${r.error}`));
      } catch {
        setErrors(["Upload failed"]);
      }
      router.refresh();
    };
    xhr.onerror = () => {
      setProgress(null);
      setErrors(["Network error — check your connection and try again."]);
    };
    xhr.send(form);
  }

  return (
    <div className="space-y-3">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          upload(e.dataTransfer.files);
        }}
        onClick={() => input.current?.click()}
        className={clsx(
          "card flex cursor-pointer flex-col items-center justify-center border-2 border-dashed px-6 py-10 text-center",
          drag ? "border-brand bg-brand-soft" : "border-border",
        )}
      >
        <Upload className="mb-2 text-muted" />
        <p className="font-medium">{progress !== null ? `Uploading… ${progress}%` : "Drop files here or click to upload"}</p>
        <p className="text-sm text-muted">Bulk upload supported</p>
        <input
          ref={input}
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime"
          className="hidden"
          onChange={(e) => e.target.files && upload(e.target.files)}
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <input className="field max-w-[12rem]" placeholder="Folder (optional)" list="folders" value={folder} onChange={(e) => setFolder(e.target.value)} />
        <datalist id="folders">
          {folders.map((f) => (
            <option key={f} value={f} />
          ))}
        </datalist>
        <input className="field max-w-xs" placeholder="Tags, comma separated" value={tags} onChange={(e) => setTags(e.target.value)} />
      </div>
      {errors.map((e) => (
        <Alert key={e} tone="danger">{e}</Alert>
      ))}
    </div>
  );
}
