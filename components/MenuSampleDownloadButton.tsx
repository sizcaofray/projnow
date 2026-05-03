"use client";

import React, { useEffect, useMemo, useState } from "react";
import { collection, getDocs, limit, query, where } from "firebase/firestore";
import { getFirebaseDb } from "@/lib/firebase/client";

type MenuSampleMeta = {
  enabled: boolean;
  label: string;
  fileName: string;
  downloadUrl: string;
};

type Props = {
  menuPath: string;
  className?: string;
  fallbackLabel?: string;
  style?: React.CSSProperties;
};

const COL = "menus";

export default function MenuSampleDownloadButton({
  menuPath,
  className,
  fallbackLabel = "샘플 다운로드",
  style,
}: Props) {
  const db = useMemo(() => {
    try {
      return getFirebaseDb();
    } catch {
      return null;
    }
  }, []);

  const [meta, setMeta] = useState<MenuSampleMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [reason, setReason] = useState("");

  useEffect(() => {
    const run = async () => {
      setLoading(true);
      setMeta(null);
      setReason("");

      if (!db) {
        setReason("Firestore 초기화 실패");
        setLoading(false);
        return;
      }

      try {
        const q = query(collection(db, COL), where("path", "==", menuPath), limit(1));
        const snap = await getDocs(q);

        if (snap.empty) {
          setReason(`menus.path = "${menuPath}" 문서를 찾지 못했습니다.`);
          setLoading(false);
          return;
        }

        const v = snap.docs[0].data() as any;

        const enabled = Boolean(v?.sampleEnabled);
        const label = String(v?.sampleDownloadLabel ?? "").trim() || fallbackLabel;
        const downloadUrl = String(v?.sampleDownloadUrl ?? "").trim();
        const fileName =
          String(v?.sampleFileName ?? "").trim() ||
          downloadUrl.split("/").pop() ||
          "";

        if (!enabled) {
          setReason("sampleEnabled=false");
          setLoading(false);
          return;
        }

        if (!downloadUrl) {
          setReason("sampleDownloadUrl 없음");
          setLoading(false);
          return;
        }

        setMeta({
          enabled,
          label,
          fileName,
          downloadUrl,
        });
      } catch (e: any) {
        setReason(e?.message ?? "샘플 조회 실패");
      } finally {
        setLoading(false);
      }
    };

    void run();
  }, [db, menuPath, fallbackLabel]);

  if (loading) {
    return (
      <button
        type="button"
        className={className}
        style={style}
        disabled
        title="샘플 정보를 불러오는 중입니다."
      >
        {fallbackLabel}
      </button>
    );
  }

  if (!meta) {
    return (
      <button
        type="button"
        className={className}
        style={style}
        disabled
        title={reason || "연결된 샘플 파일이 없습니다."}
      >
        {fallbackLabel}
      </button>
    );
  }

  return (
    <a
      href={meta.downloadUrl}
      download={meta.fileName || undefined}
      target="_blank"
      rel="noreferrer"
      className={className}
      style={style}
      title={meta.fileName || meta.label}
    >
      {meta.label}
    </a>
  );
}