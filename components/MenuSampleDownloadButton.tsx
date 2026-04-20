"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, getDocs, limit, query, where } from "firebase/firestore";
import { getDownloadURL, ref } from "firebase/storage";
import { getFirebaseDb, getFirebaseStorage } from "@/lib/firebase/client";

type MenuSampleMeta = {
  enabled: boolean;
  label: string;
  fileName: string;
  downloadUrl: string;
  storagePath: string;
};

type Props = {
  menuPath: string;
  className?: string;
  fallbackLabel?: string;
};

const COL = "menus";

export default function MenuSampleDownloadButton({
  menuPath,
  className = "px-3 py-2 rounded border text-sm hover:opacity-90",
  fallbackLabel = "샘플 다운로드",
}: Props) {
  const db = useMemo(() => {
    try {
      return getFirebaseDb();
    } catch {
      return null;
    }
  }, []);

  const storage = useMemo(() => {
    try {
      return getFirebaseStorage();
    } catch {
      return null;
    }
  }, []);

  const [meta, setMeta] = useState<MenuSampleMeta | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const run = async () => {
      if (!db) {
        setLoading(false);
        return;
      }

      try {
        const q = query(collection(db, COL), where("path", "==", menuPath), limit(1));
        const snap = await getDocs(q);

        if (snap.empty) {
          setMeta(null);
          return;
        }

        const v = snap.docs[0].data() as any;
        const enabled = Boolean(v?.sampleEnabled);
        const fileName = String(v?.sampleFileName ?? "").trim();
        const label = String(v?.sampleDownloadLabel ?? "").trim() || fallbackLabel;
        const storagePath = String(v?.sampleStoragePath ?? "").trim();
        let downloadUrl = String(v?.sampleDownloadUrl ?? "").trim();

        if (!downloadUrl && storage && storagePath) {
          try {
            downloadUrl = await getDownloadURL(ref(storage, storagePath));
          } catch {
            downloadUrl = "";
          }
        }

        if (!enabled || !downloadUrl) {
          setMeta(null);
          return;
        }

        setMeta({
          enabled,
          label,
          fileName,
          downloadUrl,
          storagePath,
        });
      } finally {
        setLoading(false);
      }
    };

    void run();
  }, [db, storage, menuPath, fallbackLabel]);

  if (loading || !meta) return null;

  return (
    <a
      href={meta.downloadUrl}
      download={meta.fileName || true}
      target="_blank"
      rel="noreferrer"
      className={className}
      title={meta.fileName || meta.label}
    >
      {meta.label}
    </a>
  );
}