"use client";

/**
 * 📄 app/contents/visit/page.tsx
 * - 기존 visit 페이지 구조 유지
 * - 프로젝트 선택 UI 추가
 * - 저장 위치를 사용자+프로젝트 기준으로 분리
 *   -> /visit/{uid}__{projectId}
 * - 레거시 호환:
 *   -> 프로젝트 저장본이 없고 /visit/{uid} 기존 데이터가 있으면 우선 불러와서 화면 표시
 * - 프로젝트 목록은 owner/member 모두 보이도록 최대한 유연하게 파싱
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { onAuthStateChanged } from "firebase/auth";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
} from "firebase/firestore";
import { getFirebaseAuth, getFirebaseDb } from "@/lib/firebase/client";
import * as XLSX from "xlsx";

type VisitRow = {
  id: string;
  no: number;
  visit: string;
  stage: number;
};

type ProjectItem = {
  id: string;
  name: string;
};

const VISIT_COL = "visit";
const PROJECTS_COL = "projects";

function toStr(v: any) {
  return String(v ?? "").trim();
}

function newId(prefix = "v") {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

const DEFAULT_ROWS: VisitRow[] = [
  { id: newId("v"), no: 1, visit: "서면동의", stage: 100 },
  { id: newId("v"), no: 2, visit: "스크리닝", stage: 110 },
];

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
    .filter((r) => r.no > 0);

  return cleaned.map((r, i) => ({ ...r, no: i + 1 }));
}

function getVisitDocId(uid: string, projectId: string) {
  return `${uid}__${projectId}`;
}

function extractProjectName(data: any, fallbackId: string) {
  return (
    toStr(data?.name) ||
    toStr(data?.projectName) ||
    toStr(data?.title) ||
    toStr(data?.project_title) ||
    fallbackId
  );
}

function isOwnerProject(data: any, uid: string) {
  return (
    toStr(data?.ownerId) === uid ||
    toStr(data?.ownerUid) === uid ||
    toStr(data?.createdBy) === uid ||
    toStr(data?.uid) === uid
  );
}

function hasMemberUid(members: any, uid: string): boolean {
  if (!Array.isArray(members)) return false;

  return members.some((m) => {
    if (typeof m === "string") return m === uid;
    if (m && typeof m === "object") {
      return (
        toStr(m.uid) === uid ||
        toStr(m.userId) === uid ||
        toStr(m.id) === uid ||
        toStr(m.memberId) === uid
      );
    }
    return false;
  });
}

export default function VisitPage() {
  const router = useRouter();

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

  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState("");

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // ------------------------------------------------------------
  // 1) 로그인 사용자 식별
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

  useEffect(() => {
    if (loadingUser) return;
    if (!uid) router.replace("/");
  }, [loadingUser, uid, router]);

  // ------------------------------------------------------------
  // 2) 프로젝트 목록 로드 (owner + member)
  // ------------------------------------------------------------
  useEffect(() => {
    const run = async () => {
      setErrorMsg("");
      setInfoMsg("");

      if (!db || !uid) return;

      try {
        const q = query(collection(db, PROJECTS_COL));
        const snap = await getDocs(q);

        const list: ProjectItem[] = [];

        snap.forEach((d) => {
          const data = d.data() as any;
          const isMine = isOwnerProject(data, uid);
          const isMember = hasMemberUid(data?.members, uid);

          if (isMine || isMember) {
            list.push({
              id: d.id,
              name: extractProjectName(data, d.id),
            });
          }
        });

        list.sort((a, b) => a.name.localeCompare(b.name, "ko"));

        setProjects(list);

        setSelectedProjectId((prev) => {
          if (prev && list.some((p) => p.id === prev)) return prev;
          return list[0]?.id ?? "";
        });
      } catch (e: any) {
        setProjects([]);
        setSelectedProjectId("");
        setErrorMsg(e?.message ?? "프로젝트 목록 불러오기 실패");
      }
    };

    void run();
  }, [db, uid]);

  // ------------------------------------------------------------
  // 3) 선택 프로젝트 기준 Visit 로드
  // 저장 우선순위:
  //   (1) /visit/{uid}__{projectId}
  //   (2) 레거시 /visit/{uid}
  //   (3) 기본 2행
  // ------------------------------------------------------------
  useEffect(() => {
    const run = async () => {
      setErrorMsg("");
      setInfoMsg("");

      if (!db || !uid) return;

      // 프로젝트가 없으면 기본행만 표시
      if (!selectedProjectId) {
        setRows(normalizeRows(DEFAULT_ROWS));
        return;
      }

      setLoading(true);
      try {
        const projectDocId = getVisitDocId(uid, selectedProjectId);
        const projectRef = doc(db, VISIT_COL, projectDocId);
        const projectSnap = await getDoc(projectRef);

        if (projectSnap.exists()) {
          const data = projectSnap.data() as any;
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

          setRows(loadedRows.length ? loadedRows : normalizeRows(DEFAULT_ROWS));
          return;
        }

        // 레거시 호환: /visit/{uid}
        const legacyRef = doc(db, VISIT_COL, uid);
        const legacySnap = await getDoc(legacyRef);

        if (legacySnap.exists()) {
          const legacyData = legacySnap.data() as any;
          const legacyRows: VisitRow[] = Array.isArray(legacyData?.rows)
            ? normalizeRows(
                legacyData.rows.map((r: any) => ({
                  id: toStr(r?.id) || newId("v"),
                  no: Number(r?.no ?? 0),
                  visit: toStr(r?.visit),
                  stage: Number(r?.stage ?? 0),
                }))
              )
            : [];

          if (legacyRows.length) {
            setRows(legacyRows);
            setInfoMsg("기존 Visit 데이터를 불러왔습니다. 저장하면 현재 프로젝트 기준으로 분리 저장됩니다.");
            return;
          }
        }

        const initRows = normalizeRows(DEFAULT_ROWS);
        setRows(initRows);
        setInfoMsg("선택한 프로젝트에 대한 기본 Visit 2개를 표시했습니다. 저장 버튼으로 확정하세요.");
      } catch (e: any) {
        setErrorMsg(e?.message ?? "Visit 불러오기 실패");
        setRows(normalizeRows(DEFAULT_ROWS));
      } finally {
        setLoading(false);
      }
    };

    void run();
  }, [db, uid, selectedProjectId]);

  // ------------------------------------------------------------
  // 저장
  // ------------------------------------------------------------
  const onSave = async () => {
    setErrorMsg("");
    setInfoMsg("");

    if (!db) return setErrorMsg("Firestore 초기화 실패");
    if (!uid) return setErrorMsg("로그인이 필요합니다.");
    if (!selectedProjectId) return setErrorMsg("프로젝트를 선택하세요.");

    setLoading(true);
    try {
      const ref = doc(db, VISIT_COL, getVisitDocId(uid, selectedProjectId));
      const selectedProject = projects.find((p) => p.id === selectedProjectId);

      const payload = {
        uid,
        projectId: selectedProjectId,
        projectName: selectedProject?.name ?? "",
        rows: normalizeRows(rows),
        updatedAt: Date.now(),
        source: "manual_edit",
      };

      await setDoc(ref, payload, { merge: false });
      setRows(payload.rows);
      setInfoMsg("프로젝트 기준으로 Visit가 저장되었습니다.");
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
    setRows((prev) =>
      normalizeRows([
        ...prev,
        { id: newId("v"), no: prev.length + 1, visit: "", stage: 0 },
      ])
    );
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

      const suffix = selectedProjectId ? `_${selectedProjectId}` : "";
      XLSX.writeFile(
        wb,
        `visit${suffix}_${new Date().toISOString().slice(0, 10)}.xlsx`
      );

      setInfoMsg("엑셀 파일을 다운로드했습니다.");
    } catch (e: any) {
      setErrorMsg(e?.message ?? "엑셀 다운로드 실패");
    }
  };

  // ------------------------------------------------------------
  // Excel 업로드
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
      setRows(next.length ? next : normalizeRows(DEFAULT_ROWS));
      setInfoMsg("업로드 완료: 화면에 반영되었습니다. 저장 버튼으로 확정하세요.");
    } catch (e: any) {
      setErrorMsg(e?.message ?? "엑셀 업로드 실패 (파일/헤더 확인)");
    }
  };

  const canUseButtons =
    !loading && !loadingUser && !!selectedProjectId && projects.length > 0;

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
            프로젝트를 선택한 뒤 Visit를 관리합니다. 기본으로 “서면동의/스크리닝” 2개만 생성되며,
            나머지는 행 추가로 입력합니다.
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

      <div className="border rounded p-4">
        <div className="grid gap-2 md:grid-cols-[180px_minmax(0,1fr)] items-center">
          <label className="text-sm font-medium">Project</label>
          <select
            value={selectedProjectId}
            onChange={(e) => setSelectedProjectId(e.target.value)}
            className="w-full px-3 py-2 rounded border bg-white text-black dark:bg-zinc-900 dark:text-white"
          >
            {projects.length === 0 ? (
              <option value="">선택 가능한 프로젝트가 없습니다.</option>
            ) : (
              projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))
            )}
          </select>
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
          e.currentTarget.value = "";
        }}
      />

      {errorMsg ? (
        <div className="text-sm px-3 py-2 rounded border border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-200">
          {errorMsg}
        </div>
      ) : null}

      {infoMsg ? (
        <div className="text-sm px-3 py-2 rounded border border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200">
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