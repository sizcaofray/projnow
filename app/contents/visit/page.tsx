"use client";

/**
 * 📄 app/contents/visit/page.tsx
 * - econtents 페이지의 Firebase 패턴을 그대로 따름:
 *   import { getFirebaseAuth, getFirebaseDb } from "@/lib/firebase/client";
 * - 저장 위치(권장): /visit/{uid}
 * - 최초 기본행: 서면동의(100), 스크리닝(110) 2개만 생성
 * - 나머지는 행 추가로 입력
 * - Excel 다운로드/업로드(xlsx)
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { getFirebaseAuth, getFirebaseDb } from "@/lib/firebase/client";
import * as XLSX from "xlsx";

type VisitRow = {
  id: string; // 안정적인 key (엑셀 업/다운에도 사용 가능)
  no: number; // 화면 표시용(자동 1..n)
  visit: string;
  stage: number;
};

const VISIT_COL = "visit"; // ✅ Firestore: /visit/{uid}

function toStr(v: any) {
  return String(v ?? "").trim();
}

function newId(prefix = "v") {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

// ✅ 요구사항: 기본 2행만 생성
const DEFAULT_ROWS: VisitRow[] = [
  { id: newId("v"), no: 1, visit: "서면동의", stage: 100 },
  { id: newId("v"), no: 2, visit: "스크리닝", stage: 110 },
];

export default function VisitPage() {
  const router = useRouter();

  // ✅ econtents와 동일 패턴: try/catch로 안전 초기화
  const auth = useMemo(() => {
    try {
      return getFirebaseAuth();
    } catch {
      return null;
    }
  }, []);

  const db = useMemo(() => {
    try {
      return getFirebaseDb();
    } catch {
      return null;
    }
  }, []);

  const [uid, setUid] = useState("");
  const [loadingUser, setLoadingUser] = useState(true);

  const [rows, setRows] = useState<VisitRow[]>([]);
  const [loading, setLoading] = useState(false);

  const [errorMsg, setErrorMsg] = useState("");
  const [infoMsg, setInfoMsg] = useState("");

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // ------------------------------------------------------------
  // 1) 로그인 사용자 식별 (econtents 동일)
  // ------------------------------------------------------------
  useEffect(() => {
    if (!auth) {
      setErrorMsg("Firebase Auth 초기화 실패");
      setLoadingUser(false);
      return;
    }

    const unsub = onAuthStateChanged(auth, (user) => {
      setUid(user?.uid ?? "");
      setLoadingUser(false);
    });

    return () => unsub();
  }, [auth]);

  // ✅ 요구사항: 비로그인/로그아웃 시 '/' 리디렉트
  useEffect(() => {
    if (loadingUser) return;
    if (!uid) router.replace("/");
  }, [loadingUser, uid, router]);

  // ------------------------------------------------------------
  // 유틸: no 1..n 자동 재부여 + 타입 정리
  // ------------------------------------------------------------
  function normalizeRows(input: VisitRow[]): VisitRow[] {
    const cleaned = (input ?? [])
      .map((r: any, idx: number) => {
        const stageNum = Number(r?.stage);
        return {
          id: toStr(r?.id) || newId("v"),
          no: idx + 1,
          visit: toStr(r?.visit),
          stage: Number.isFinite(stageNum) ? stageNum : 0,
        } as VisitRow;
      })
      // (선택) 완전 빈 행도 허용할지 여부: 현재는 허용(visit/stage 비어도 유지)
      .filter((r) => r.no > 0);

    return cleaned.map((r, i) => ({ ...r, no: i + 1 }));
  }

  // ------------------------------------------------------------
  // 2) 페이지 진입 시: /visit/{uid} 로드 (없으면 기본 2행 생성 후 저장)
  // ------------------------------------------------------------
  useEffect(() => {
    const run = async () => {
      setErrorMsg("");
      setInfoMsg("");

      if (!db) return;
      if (!uid) return;

      setLoading(true);
      try {
        const ref = doc(db, VISIT_COL, uid);
        const snap = await getDoc(ref);

        if (!snap.exists()) {
          const initRows = normalizeRows(DEFAULT_ROWS);

          await setDoc(
            ref,
            {
              rows: initRows,
              updatedAt: Date.now(),
              source: "init_default_2rows",
            },
            { merge: false }
          );

          setRows(initRows);
          setInfoMsg("기본 방문(서면동의/스크리닝) 2개를 생성했습니다.");
          return;
        }

        const data = snap.data() as any;
        const loadedRows: VisitRow[] = Array.isArray(data?.rows)
          ? normalizeRows(
              data.rows.map((r: any) => ({
                id: toStr(r?.id) || newId("v"),
                no: Number(r?.no ?? 0),
                visit: toStr(r?.visit),
                stage: Number(r?.stage ?? 0),
              }))
            )
          : [];

        // ✅ 저장 데이터가 비어있으면 기본 2행으로 복구(화면만)
        setRows(loadedRows.length ? loadedRows : normalizeRows(DEFAULT_ROWS));
      } catch (e: any) {
        setErrorMsg(e?.message ?? "Visit 불러오기 실패");
        setRows(normalizeRows(DEFAULT_ROWS));
      } finally {
        setLoading(false);
      }
    };

    void run();
  }, [db, uid]);

  // ------------------------------------------------------------
  // 저장
  // ------------------------------------------------------------
  const onSave = async () => {
    setErrorMsg("");
    setInfoMsg("");

    if (!db) return setErrorMsg("Firestore 초기화 실패");
    if (!uid) return setErrorMsg("로그인이 필요합니다.");

    setLoading(true);
    try {
      const ref = doc(db, VISIT_COL, uid);
      const payload = {
        rows: normalizeRows(rows),
        updatedAt: Date.now(),
        source: "manual_edit",
      };

      await setDoc(ref, payload, { merge: false });
      setRows(payload.rows);
      setInfoMsg("Visit가 저장되었습니다.");
    } catch (e: any) {
      setErrorMsg(e?.message ?? "저장 실패");
    } finally {
      setLoading(false);
    }
  };

  // ------------------------------------------------------------
  // 행 추가/삭제
  // ------------------------------------------------------------
  const onAddRow = () => {
    setRows((prev) => normalizeRows([...prev, { id: newId("v"), no: prev.length + 1, visit: "", stage: 0 }]));
  };

  const onDeleteRow = (id: string) => {
    setRows((prev) => normalizeRows(prev.filter((r) => r.id !== id)));
  };

  // ------------------------------------------------------------
  // 셀 편집
  // ------------------------------------------------------------
  const onChangeVisit = (id: string, value: string) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, visit: value } : r)));
  };

  const onChangeStage = (id: string, value: string) => {
    const n = Number(value);
    setRows((prev) =>
      prev.map((r) => (r.id === id ? { ...r, stage: Number.isFinite(n) ? n : 0 } : r))
    );
  };

  // ------------------------------------------------------------
  // Excel 다운로드
  // - 컬럼: No., Visit, Stage (요청 이미지와 동일)
  // ------------------------------------------------------------
  const onDownloadExcel = () => {
    setErrorMsg("");
    setInfoMsg("");

    const data = normalizeRows(rows);
    if (!data.length) {
      setInfoMsg("다운로드할 데이터가 없습니다.");
      return;
    }

    try {
      const aoa: any[][] = [];
      aoa.push(["No.", "Visit", "Stage"]);

      for (const r of data) {
        aoa.push([r.no, r.visit, r.stage]);
      }

      const ws = XLSX.utils.aoa_to_sheet(aoa);
      ws["!cols"] = [{ wch: 6 }, { wch: 28 }, { wch: 10 }];

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Visit");

      XLSX.writeFile(wb, `visit_${new Date().toISOString().slice(0, 10)}.xlsx`);
      setInfoMsg("엑셀 파일을 다운로드했습니다.");
    } catch (e: any) {
      setErrorMsg(e?.message ?? "엑셀 다운로드 실패");
    }
  };

  // ------------------------------------------------------------
  // Excel 업로드
  // - 업로드 시 화면 데이터를 교체(덮어쓰기)
  // - 저장 확정은 '저장' 버튼으로
  // ------------------------------------------------------------
  const onClickUpload = () => fileInputRef.current?.click();

  const onUploadFile = async (file: File) => {
    setErrorMsg("");
    setInfoMsg("");

    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });

      const sheetName = wb.SheetNames[0];
      const ws = wb.Sheets[sheetName];

      // 헤더 기반 json
      const json = XLSX.utils.sheet_to_json<Record<string, any>>(ws, { defval: "" });

      const parsed: VisitRow[] = json.map((r, idx) => {
        const noRaw = r["No."] ?? r["No"] ?? r["no"] ?? r["NO"] ?? idx + 1;
        const visitRaw = r["Visit"] ?? r["visit"] ?? r["VISIT"] ?? "";
        const stageRaw = r["Stage"] ?? r["stage"] ?? r["STAGE"] ?? 0;

        const stageNum = Number(stageRaw);

        return {
          id: newId("v"),
          no: Number(noRaw) || idx + 1,
          visit: toStr(visitRaw),
          stage: Number.isFinite(stageNum) ? stageNum : 0,
        };
      });

      const next = normalizeRows(parsed);

      // 업로드가 비었으면 기본 2행으로 복구
      setRows(next.length ? next : normalizeRows(DEFAULT_ROWS));
      setInfoMsg("업로드 완료: 화면에 반영되었습니다. 저장 버튼으로 확정하세요.");
    } catch (e: any) {
      setErrorMsg(e?.message ?? "엑셀 업로드 실패 (파일/헤더 확인)");
    }
  };

  const canUseButtons = !loading && !loadingUser;

  if (loadingUser) {
    return (
      <main className="p-6">
        <div className="text-sm opacity-70">로딩 중...</div>
      </main>
    );
  }

  return (
    <main className="p-6 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold">Visit 관리</h1>
          <p className="text-sm opacity-70 mt-1">
            기본으로 “서면동의/스크리닝” 2개만 생성되며, 나머지는 행 추가로 입력합니다. (업로드는 화면 데이터를 교체합니다)
          </p>
        </div>

        <div className="flex gap-2 flex-wrap">
          <button
            onClick={onDownloadExcel}
            disabled={!canUseButtons}
            className="px-3 py-2 rounded border text-sm hover:opacity-90 disabled:opacity-50"
            type="button"
          >
            Excel 다운로드
          </button>

          <button
            onClick={onClickUpload}
            disabled={!canUseButtons}
            className="px-3 py-2 rounded border text-sm hover:opacity-90 disabled:opacity-50"
            type="button"
          >
            Excel 업로드
          </button>

          <button
            onClick={onAddRow}
            disabled={!canUseButtons}
            className="px-3 py-2 rounded border text-sm hover:opacity-90 disabled:opacity-50"
            type="button"
          >
            행 추가
          </button>

          <button
            onClick={onSave}
            disabled={!canUseButtons}
            className="px-3 py-2 rounded border text-sm hover:opacity-90 disabled:opacity-50"
            type="button"
          >
            저장
          </button>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx,.xls"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          void onUploadFile(f);

          // 같은 파일 재업로드 가능하도록 초기화
          e.currentTarget.value = "";
        }}
      />

      {errorMsg ? (
        <div className="text-sm px-3 py-2 rounded border border-rose-300 bg-rose-50 text-rose-700">
          {errorMsg}
        </div>
      ) : null}
      {infoMsg ? (
        <div className="text-sm px-3 py-2 rounded border border-emerald-300 bg-emerald-50 text-emerald-700">
          {infoMsg}
        </div>
      ) : null}

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
              <tr key={r.id} className="border-b last:border-b-0">
                <td className="p-2 align-middle">{r.no}</td>

                <td className="p-2">
                  <input
                    value={r.visit}
                    onChange={(e) => onChangeVisit(r.id, e.target.value)}
                    className="w-full px-2 py-1 rounded border bg-transparent"
                    placeholder="예) 서면동의, 스크리닝..."
                  />
                </td>

                <td className="p-2">
                  <input
                    value={String(r.stage)}
                    onChange={(e) => onChangeStage(r.id, e.target.value)}
                    className="w-full px-2 py-1 rounded border bg-transparent"
                    inputMode="numeric"
                    placeholder="예) 100"
                  />
                </td>

                <td className="p-2">
                  <button
                    onClick={() => onDeleteRow(r.id)}
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
