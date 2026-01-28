"use client";

/**
 * 📄 app/contents/visit/page.tsx
 * - Visit(Stage) 테이블 관리 페이지
 * - 최초 기본행: "서면동의", "스크리닝" 2개만 생성
 * - 나머지는 "행 추가" 버튼으로 입력
 * - Excel 다운로드 / 업로드 지원
 * - Firestore에 사용자(uid)별 저장
 *
 * ⚠️ 주의:
 * - Firebase 초기화 파일 경로는 프로젝트마다 다를 수 있습니다.
 *   아래 import 경로(@/lib/firebase)는 프로젝트에 맞게 수정하세요.
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

// ✅ 프로젝트에 맞게 경로 수정 필요
import { auth, db } from "@/lib/firebase";

import { onAuthStateChanged, User } from "firebase/auth";
import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";

type VisitRow = {
  no: number; // 표시용 번호(자동)
  visit: string; // Visit 명
  stage: number; // Stage 코드
};

type VisitDoc = {
  rows: VisitRow[];
  updatedAt?: unknown;
};

// ✅ 요구사항 반영: 기본값은 2개만 생성
const DEFAULT_ROWS: VisitRow[] = [
  { no: 1, visit: "서면동의", stage: 100 },
  { no: 2, visit: "스크리닝", stage: 110 },
];

export default function VisitPage() {
  const router = useRouter();

  // ✅ 로그인 사용자
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  // ✅ 데이터
  const [rows, setRows] = useState<VisitRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // ✅ 메시지
  const [message, setMessage] = useState<string>("");

  // ✅ 업로드 input ref
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // ✅ Firestore 문서 경로 (사용자별)
  const docRef = useMemo(() => {
    if (!user?.uid) return null;
    // users/{uid}/configs/visit
    return doc(db, "users", user.uid, "configs", "visit");
  }, [user?.uid]);

  // ------------------------------------------------------------
  // 1) Auth 상태 구독
  // ------------------------------------------------------------
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u ?? null);
      setAuthLoading(false);

      // ✅ 비로그인 시 '/'로 리디렉트
      if (!u) router.replace("/");
    });

    return () => unsub();
  }, [router]);

  // ------------------------------------------------------------
  // 유틸: No 재정렬 및 타입 정리
  // ------------------------------------------------------------
  function normalizeRows(input: VisitRow[]): VisitRow[] {
    const cleaned = (input ?? [])
      .map((r, idx) => {
        const stageNum = Number((r as any)?.stage);
        return {
          // ✅ no는 항상 화면상 1..n 자동 부여
          no: idx + 1,
          visit: String((r as any)?.visit ?? ""),
          stage: Number.isFinite(stageNum) ? stageNum : 0,
        };
      })
      .filter((r) => r.no > 0);

    return cleaned.map((r, i) => ({ ...r, no: i + 1 }));
  }

  // ------------------------------------------------------------
  // 2) 초기 로드: Firestore에서 rows 읽기 (없으면 기본 2행 생성)
  // ------------------------------------------------------------
  useEffect(() => {
    const run = async () => {
      if (authLoading) return;
      if (!docRef) return;

      try {
        setLoading(true);
        setMessage("");

        const snap = await getDoc(docRef);

        if (!snap.exists()) {
          // ✅ 최초 진입: 기본 2행만 생성
          const payload: VisitDoc = {
            rows: normalizeRows(DEFAULT_ROWS),
            updatedAt: serverTimestamp(),
          };
          await setDoc(docRef, payload, { merge: true });
          setRows(payload.rows);
          return;
        }

        const data = snap.data() as VisitDoc;
        const loadedRows =
          Array.isArray(data?.rows) && data.rows.length > 0
            ? normalizeRows(data.rows)
            : normalizeRows(DEFAULT_ROWS);

        setRows(loadedRows);
      } catch (e) {
        console.error(e);
        setMessage("데이터 로드 중 오류가 발생했습니다.");
        setRows(normalizeRows(DEFAULT_ROWS));
      } finally {
        setLoading(false);
      }
    };

    void run();
  }, [authLoading, docRef]);

  // ------------------------------------------------------------
  // 저장
  // ------------------------------------------------------------
  const handleSave = async () => {
    if (!docRef) return;

    try {
      setSaving(true);
      setMessage("");

      const payload: VisitDoc = {
        rows: normalizeRows(rows),
        updatedAt: serverTimestamp(),
      };

      await setDoc(docRef, payload, { merge: true });
      setRows(payload.rows);
      setMessage("저장되었습니다.");
    } catch (e) {
      console.error(e);
      setMessage("저장 중 오류가 발생했습니다.");
    } finally {
      setSaving(false);
    }
  };

  // ------------------------------------------------------------
  // 행 추가/삭제
  // ------------------------------------------------------------
  const handleAddRow = () => {
    setRows((prev) => normalizeRows([...prev, { no: prev.length + 1, visit: "", stage: 0 }]));
  };

  const handleDeleteRow = (no: number) => {
    setRows((prev) => normalizeRows(prev.filter((r) => r.no !== no)));
  };

  // ------------------------------------------------------------
  // 셀 편집
  // ------------------------------------------------------------
  const handleChangeVisit = (no: number, value: string) => {
    setRows((prev) => prev.map((r) => (r.no === no ? { ...r, visit: value } : r)));
  };

  const handleChangeStage = (no: number, value: string) => {
    const n = Number(value);
    setRows((prev) =>
      prev.map((r) =>
        r.no === no ? { ...r, stage: Number.isFinite(n) ? n : 0 } : r
      )
    );
  };

  // ------------------------------------------------------------
  // Excel 다운로드
  // ------------------------------------------------------------
  const handleDownloadExcel = async () => {
    try {
      setMessage("");

      // ✅ xlsx 필요: npm i xlsx
      const XLSX = await import("xlsx");

      // ✅ 엑셀 컬럼명: No., Visit, Stage
      const exportRows = normalizeRows(rows).map((r) => ({
        "No.": r.no,
        "Visit": r.visit,
        "Stage": r.stage,
      }));

      const ws = XLSX.utils.json_to_sheet(exportRows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Visit");

      XLSX.writeFile(wb, "visit_table.xlsx");
      setMessage("Excel 다운로드가 완료되었습니다.");
    } catch (e) {
      console.error(e);
      setMessage("Excel 다운로드 중 오류가 발생했습니다. (xlsx 설치 여부 확인)");
    }
  };

  // ------------------------------------------------------------
  // Excel 업로드 (업로드 시 화면 데이터 교체)
  // - 업로드 즉시 저장하지 않고 "저장" 버튼으로 확정
  // ------------------------------------------------------------
  const handleClickUpload = () => {
    fileInputRef.current?.click();
  };

  const handleUploadFile = async (file: File) => {
    try {
      setMessage("");

      const XLSX = await import("xlsx");
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer, { type: "array" });

      // ✅ 첫 시트 사용
      const sheetName = wb.SheetNames[0];
      const ws = wb.Sheets[sheetName];

      // ✅ 헤더 기반 파싱
      const json = XLSX.utils.sheet_to_json<Record<string, any>>(ws, { defval: "" });

      // ✅ 다양한 헤더 케이스 허용 (No., No, no 등)
      const parsed: VisitRow[] = json.map((r, idx) => {
        const noRaw = r["No."] ?? r["No"] ?? r["no"] ?? r["NO"] ?? (idx + 1);
        const visitRaw = r["Visit"] ?? r["visit"] ?? r["VISIT"] ?? "";
        const stageRaw = r["Stage"] ?? r["stage"] ?? r["STAGE"] ?? 0;

        const stageNum = Number(stageRaw);

        return {
          no: Number(noRaw) || idx + 1,
          visit: String(visitRaw ?? ""),
          stage: Number.isFinite(stageNum) ? stageNum : 0,
        };
      });

      const next = normalizeRows(parsed);

      // ✅ 업로드 파일이 비어있다면 기본 2행으로 복구
      setRows(next.length > 0 ? next : normalizeRows(DEFAULT_ROWS));

      setMessage("업로드 완료: 화면에 반영되었습니다. 저장 버튼을 눌러 확정하세요.");
    } catch (e) {
      console.error(e);
      setMessage("Excel 업로드 중 오류가 발생했습니다. 파일 형식/헤더를 확인하세요.");
    }
  };

  // ------------------------------------------------------------
  // 렌더링
  // ------------------------------------------------------------
  if (authLoading || loading) {
    return (
      <main className="p-6">
        <div className="text-sm opacity-70">로딩 중...</div>
      </main>
    );
  }

  return (
    <main className="p-6 space-y-4">
      {/* 타이틀 */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold">Visit 관리</h1>
          <p className="text-sm opacity-70 mt-1">
            기본으로 “서면동의/스크리닝” 2개만 생성되며, 나머지는 행 추가로 입력합니다. (업로드 시 화면 데이터는 교체됩니다)
          </p>
        </div>

        {/* 액션 버튼 */}
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={handleDownloadExcel}
            className="px-3 py-2 rounded border text-sm hover:opacity-90"
            type="button"
          >
            Excel 다운로드
          </button>

          <button
            onClick={handleClickUpload}
            className="px-3 py-2 rounded border text-sm hover:opacity-90"
            type="button"
          >
            Excel 업로드
          </button>

          <button
            onClick={handleAddRow}
            className="px-3 py-2 rounded border text-sm hover:opacity-90"
            type="button"
          >
            행 추가
          </button>

          <button
            onClick={handleSave}
            disabled={saving}
            className="px-3 py-2 rounded border text-sm hover:opacity-90 disabled:opacity-50"
            type="button"
          >
            {saving ? "저장 중..." : "저장"}
          </button>
        </div>
      </div>

      {/* 업로드 input (숨김) */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx,.xls"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (!f) return;

          void handleUploadFile(f);

          // ✅ 같은 파일 재업로드 가능하도록 value 초기화
          e.currentTarget.value = "";
        }}
      />

      {/* 메시지 */}
      {message ? (
        <div className="text-sm px-3 py-2 rounded border">{message}</div>
      ) : null}

      {/* 테이블 */}
      <div className="border rounded overflow-auto">
        <table className="min-w-[720px] w-full text-sm">
          <thead className="border-b">
            <tr>
              <th className="p-2 text-left w-[80px]">No.</th>
              <th className="p-2 text-left">Visit</th>
              <th className="p-2 text-left w-[140px]">Stage</th>
              <th className="p-2 text-left w-[110px]">Action</th>
            </tr>
          </thead>

          <tbody>
            {rows.map((r) => (
              <tr key={r.no} className="border-b last:border-b-0">
                <td className="p-2 align-middle">{r.no}</td>

                <td className="p-2">
                  <input
                    value={r.visit}
                    onChange={(e) => handleChangeVisit(r.no, e.target.value)}
                    className="w-full px-2 py-1 rounded border bg-transparent"
                    placeholder="예) 서면동의, 스크리닝..."
                  />
                </td>

                <td className="p-2">
                  <input
                    value={String(r.stage)}
                    onChange={(e) => handleChangeStage(r.no, e.target.value)}
                    className="w-full px-2 py-1 rounded border bg-transparent"
                    inputMode="numeric"
                    placeholder="예) 100"
                  />
                </td>

                <td className="p-2">
                  <button
                    onClick={() => handleDeleteRow(r.no)}
                    className="px-2 py-1 rounded border text-xs hover:opacity-90"
                    type="button"
                  >
                    삭제
                  </button>
                </td>
              </tr>
            ))}

            {rows.length === 0 ? (
              <tr>
                <td className="p-4 text-sm opacity-70" colSpan={4}>
                  데이터가 없습니다. (행 추가 또는 Excel 업로드)
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </main>
  );
}
