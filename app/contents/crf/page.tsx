"use client";

/**
 * CRF Form Builder
 *
 * 프로젝트 연동 반영:
 * 1) 상단에 프로젝트 선택 드롭다운 추가
 * 2) owner + member 기준 프로젝트 목록 조회
 * 3) 선택된 projectId 기준으로 CRF 로드/저장
 * 4) owner + member 모두 수정 가능
 *
 * 추가 수정:
 * - 프로젝트 select 박스는 다크모드 영향 없이 항상 밝은 배경/검정 글씨 고정
 * - snapshot 갱신 시 사용자가 선택한 프로젝트가 강제로 owner 프로젝트로 되돌아가는 문제 수정
 * - 작업 영역에 샘플 다운로드 버튼 추가
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import MenuSampleDownloadButton from "@/components/MenuSampleDownloadButton";
import { onAuthStateChanged } from "firebase/auth";
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  where,
} from "firebase/firestore";
import { getFirebaseAuth, getFirebaseDb } from "@/lib/firebase/client";

type FormRow = {
  id: string;
  formName: string;
  formCode: string;
  repeat: boolean;
  createdAt: number;
};

type ProjectDoc = {
  uid: string;
  name: string;
  ownerUid: string;
  ownerEmail?: string;
  members?: string[];
  createdAt?: any;
  updatedAt?: any;
};

const COL = "crf_forms";

function toStr(v: any) {
  return String(v ?? "").trim();
}

function toBoolRepeat(v: any) {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  const s = String(v ?? "").trim().toLowerCase();
  return s === "y" || s === "yes" || s === "true" || s === "1" || s === "o" || s === "ok" || s === "checked";
}

function newRowId() {
  return `r_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function reorderById<T extends { id: string }>(arr: T[], activeId: string, overId: string) {
  if (activeId === overId) return arr;

  const from = arr.findIndex((x) => x.id === activeId);
  const to = arr.findIndex((x) => x.id === overId);
  if (from < 0 || to < 0) return arr;

  const next = [...arr];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

function sanitizeProjectRows(rows: any[]): FormRow[] {
  return Array.isArray(rows)
    ? rows
        .map((r: any) => ({
          id: toStr(r?.id) || newRowId(),
          formName: toStr(r?.formName),
          formCode: toStr(r?.formCode),
          repeat: toBoolRepeat(r?.repeat),
          createdAt: Number(r?.createdAt ?? Date.now()),
        }))
        .filter((r: FormRow) => !!r.id)
    : [];
}

function makeEmptyRow(): FormRow {
  return {
    id: newRowId(),
    formName: "",
    formCode: "",
    repeat: false,
    createdAt: Date.now(),
  };
}

function sortProjects(rows: ProjectDoc[]) {
  return [...rows].sort((a, b) => {
    const at = a.createdAt?.toMillis?.() ?? 0;
    const bt = b.createdAt?.toMillis?.() ?? 0;
    return bt - at;
  });
}

export default function CRFPage() {
  const inputExcelRef = useRef<HTMLInputElement | null>(null);

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

  const [uid, setUid] = useState<string>("");
  const [loadingUser, setLoadingUser] = useState(true);

  const [projects, setProjects] = useState<ProjectDoc[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [selectedProject, setSelectedProject] = useState<ProjectDoc | null>(null);

  const [rows, setRows] = useState<FormRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [error, setError] = useState<string>("");
  const [info, setInfo] = useState<string>("");

  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [hoverPlusId, setHoverPlusId] = useState<string | null>(null);

  useEffect(() => {
    if (!auth) {
      setError("Firebase Auth 초기화 실패");
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
    if (!db || !uid) {
      setProjects([]);
      setSelectedProjectId("");
      setSelectedProject(null);
      return;
    }

    setLoadingProjects(true);

    const ownerQuery = query(collection(db, "projects"), where("ownerUid", "==", uid));
    const memberQuery = query(collection(db, "projects"), where("members", "array-contains", uid));

    let ownerRows: ProjectDoc[] = [];
    let memberRows: ProjectDoc[] = [];
    let ownerLoaded = false;
    let memberLoaded = false;

    const applyMerged = () => {
      const mergedMap = new Map<string, ProjectDoc>();

      [...ownerRows, ...memberRows].forEach((row) => {
        if (!row?.uid) return;
        mergedMap.set(row.uid, row);
      });

      const merged = sortProjects(Array.from(mergedMap.values()));
      setProjects(merged);

      setSelectedProjectId((prev) => {
        if (prev && merged.some((p) => p.uid === prev)) return prev;
        return merged[0]?.uid ?? "";
      });

      if (ownerLoaded && memberLoaded) {
        setLoadingProjects(false);
      }
    };

    const unsubOwner = onSnapshot(
      ownerQuery,
      (snap) => {
        ownerRows = snap.docs.map((d) => {
          const data = d.data() as Partial<ProjectDoc>;
          return {
            uid: toStr(data.uid) || d.id,
            name: toStr(data.name),
            ownerUid: toStr(data.ownerUid),
            ownerEmail: toStr(data.ownerEmail),
            members: Array.isArray(data.members) ? data.members : [],
            createdAt: data.createdAt,
            updatedAt: data.updatedAt,
          };
        });
        ownerLoaded = true;
        applyMerged();
      },
      (e: any) => {
        ownerLoaded = true;
        setError(e?.message ?? "프로젝트(owner) 조회 실패");
        applyMerged();
      }
    );

    const unsubMember = onSnapshot(
      memberQuery,
      (snap) => {
        memberRows = snap.docs.map((d) => {
          const data = d.data() as Partial<ProjectDoc>;
          return {
            uid: toStr(data.uid) || d.id,
            name: toStr(data.name),
            ownerUid: toStr(data.ownerUid),
            ownerEmail: toStr(data.ownerEmail),
            members: Array.isArray(data.members) ? data.members : [],
            createdAt: data.createdAt,
            updatedAt: data.updatedAt,
          };
        });
        memberLoaded = true;
        applyMerged();
      },
      (e: any) => {
        memberLoaded = true;
        setError(e?.message ?? "프로젝트(member) 조회 실패");
        applyMerged();
      }
    );

    return () => {
      unsubOwner();
      unsubMember();
    };
  }, [db, uid]);

  useEffect(() => {
    const found = projects.find((p) => p.uid === selectedProjectId) ?? null;
    setSelectedProject(found);
  }, [projects, selectedProjectId]);

  const isOwner = !!uid && !!selectedProject && selectedProject.ownerUid === uid;
  const isMember =
    !!uid &&
    !!selectedProject &&
    Array.isArray(selectedProject.members) &&
    selectedProject.members.includes(uid);

  const canEdit = !!selectedProjectId && (isOwner || isMember);

  useEffect(() => {
    const run = async () => {
      setError("");
      setInfo("");

      if (!db || !uid || !selectedProjectId) {
        setRows([]);
        return;
      }

      setLoading(true);

      try {
        const ref = doc(db, COL, selectedProjectId);
        const snap = await getDoc(ref);

        if (!snap.exists()) {
          setRows([makeEmptyRow()]);
          return;
        }

        const data = snap.data() as any;
        const loaded = sanitizeProjectRows(data?.rows);

        setRows(loaded.length > 0 ? loaded : [makeEmptyRow()]);
      } catch (e: any) {
        setRows([]);
        setError(e?.message ?? "CRF 데이터 로드 실패");
      } finally {
        setLoading(false);
      }
    };

    run();
  }, [db, uid, selectedProjectId]);

  const saveNow = async (nextRows?: FormRow[]) => {
    setError("");
    setInfo("");

    if (!db) return setError("Firestore 초기화 실패");
    if (!uid) return setError("로그인이 필요합니다.");
    if (!selectedProjectId) return setError("프로젝트를 선택해주세요.");
    if (!selectedProject) return setError("선택된 프로젝트 정보를 찾을 수 없습니다.");
    if (!canEdit) return setError("해당 프로젝트의 수정 권한이 없습니다.");

    setSaving(true);

    try {
      const ref = doc(db, COL, selectedProjectId);

      const payload = {
        projectId: selectedProjectId,
        projectName: selectedProject.name ?? "",
        ownerUid: selectedProject.ownerUid ?? "",
        rows: (nextRows ?? rows).map((r) => ({
          id: r.id,
          formName: r.formName ?? "",
          formCode: r.formCode ?? "",
          repeat: !!r.repeat,
          createdAt: Number(r.createdAt ?? Date.now()),
        })),
        updatedBy: uid,
        updatedAt: serverTimestamp(),
      };

      await setDoc(ref, payload, { merge: true });
      setInfo("저장되었습니다.");
    } catch (e: any) {
      setError(e?.message ?? "저장 실패");
    } finally {
      setSaving(false);
    }
  };

  const addRow = () => {
    if (!canEdit) return;
    setRows((prev) => [...prev, makeEmptyRow()]);
    setInfo("");
  };

  const insertRowAfter = (afterId: string) => {
    if (!canEdit) return;

    setRows((prev) => {
      const idx = prev.findIndex((r) => r.id === afterId);
      if (idx < 0) return prev;

      const next = [...prev];
      next.splice(idx + 1, 0, makeEmptyRow());
      return next;
    });

    setInfo("");
  };

  const removeRow = (rowId: string) => {
    if (!canEdit) return;

    setRows((prev) => {
      const next = prev.filter((r) => r.id !== rowId);
      return next.length > 0 ? next : [makeEmptyRow()];
    });

    setInfo("");
  };

  const updateRow = (rowId: string, patch: Partial<FormRow>) => {
    if (!canEdit) return;

    setRows((prev) =>
      prev.map((r) =>
        r.id === rowId
          ? {
              ...r,
              ...patch,
            }
          : r
      )
    );
    setInfo("");
  };

  const onDragStartRow = (id: string) => (e: React.DragEvent<HTMLTableRowElement>) => {
    if (!canEdit) return;
    setDraggingId(id);
    setOverId(null);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", id);
  };

  const onDragOverRow = (id: string) => (e: React.DragEvent<HTMLTableRowElement>) => {
    if (!canEdit) return;
    e.preventDefault();
    if (draggingId && draggingId !== id) {
      setOverId(id);
      e.dataTransfer.dropEffect = "move";
    }
  };

  const onDropRow = (id: string) => (e: React.DragEvent<HTMLTableRowElement>) => {
    if (!canEdit) return;
    e.preventDefault();

    const activeId = draggingId || e.dataTransfer.getData("text/plain");
    if (!activeId || activeId === id) {
      setDraggingId(null);
      setOverId(null);
      return;
    }

    setRows((prev) => reorderById(prev, activeId, id));
    setDraggingId(null);
    setOverId(null);
    setInfo("");
  };

  const onDragEndRow = () => {
    setDraggingId(null);
    setOverId(null);
  };

  const downloadExcel = () => {
    const body = rows.map((r) => ({
      FormName: r.formName ?? "",
      FormCode: r.formCode ?? "",
      Repeat: r.repeat ? "Y" : "",
    }));

    const ws = XLSX.utils.json_to_sheet(body, {
      header: ["FormName", "FormCode", "Repeat"],
    });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "CRF");
    XLSX.writeFile(wb, "crf_forms.xlsx");
  };

  const applyExcelFile = async (file: File) => {
    if (!canEdit) {
      setError("수정 권한이 있는 사용자만 업로드 가능합니다.");
      return;
    }

    setError("");
    setInfo("");

    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const first = wb.SheetNames?.[0];
      if (!first) throw new Error("시트를 찾을 수 없습니다.");

      const ws = wb.Sheets[first];
      const json = XLSX.utils.sheet_to_json<any>(ws, { defval: "" });

      const imported: FormRow[] = json.map((r: any) => ({
        id: newRowId(),
        formName: toStr(r.FormName ?? r["Form Name"] ?? r.formName ?? r.form_name),
        formCode: toStr(r.FormCode ?? r["Form Code"] ?? r.formCode ?? r.form_code),
        repeat: toBoolRepeat(r.Repeat ?? r.repeat),
        createdAt: Date.now(),
      }));

      const normalized = imported.filter((r) => r.formName || r.formCode);
      setRows(normalized.length > 0 ? normalized : [makeEmptyRow()]);
      setInfo("엑셀 내용을 화면에 반영했습니다. 저장 버튼으로 확정하세요.");
    } catch (e: any) {
      setError(e?.message ?? "엑셀 업로드 실패");
    }
  };

  const pageStyle: React.CSSProperties = {
    minHeight: "100vh",
    background: "var(--bg)",
    color: "var(--text)",
    padding: 16,
  };

  const cardStyle: React.CSSProperties = {
    background: "var(--panel)",
    border: "1px solid var(--border)",
    borderRadius: 16,
    padding: 14,
    boxShadow: "0 8px 24px rgba(0,0,0,.08)",
  };

  const titleStyle: React.CSSProperties = {
    fontSize: 22,
    fontWeight: 800,
    margin: 0,
  };

  const subtleText: React.CSSProperties = {
    fontSize: 13,
    color: "var(--muted)",
  };

  const sectionTitleStyle: React.CSSProperties = {
    fontSize: 16,
    fontWeight: 800,
    margin: 0,
  };

  const rowFlex: React.CSSProperties = {
    display: "flex",
    gap: 10,
    alignItems: "center",
    flexWrap: "wrap",
  };

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid var(--border)",
    background: "var(--panel-2)",
    color: "var(--text)",
    outline: "none",
  };

  const selectStyleAlwaysLight: React.CSSProperties = {
    width: "100%",
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid #cbd5e1",
    background: "#ffffff",
    color: "#111111",
    outline: "none",
  };

  const btnStyle: React.CSSProperties = {
    padding: "10px 14px",
    borderRadius: 10,
    border: "1px solid var(--border)",
    background: "var(--panel-2)",
    color: "var(--text)",
    cursor: "pointer",
    fontWeight: 700,
    textDecoration: "none",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
  };

  const SectionHeader = ({
    title,
    right,
  }: {
    title: string;
    right?: React.ReactNode;
  }) => (
    <div
      style={{
        ...rowFlex,
        justifyContent: "space-between",
        marginBottom: 10,
      }}
    >
      <h2 style={sectionTitleStyle}>{title}</h2>
      <div style={rowFlex}>{right}</div>
    </div>
  );

  if (loadingUser) {
    return (
      <div style={pageStyle}>
        <div style={cardStyle}>사용자 정보를 불러오는 중입니다...</div>
      </div>
    );
  }

  return (
    <div style={pageStyle}>
      <style jsx>{`
        :global(:root) {
          --bg: #f8fafc;
          --panel: #ffffff;
          --panel-2: #f8fafc;
          --text: #0f172a;
          --muted: #64748b;
          --border: #cbd5e1;
          --border-soft: #e2e8f0;
          --ok: #166534;
          --danger: #b91c1c;
          --warn: #a16207;
        }
        :global(.dark) {
          --bg: #0b1220;
          --panel: #0f172a;
          --panel-2: #111827;
          --text: #e5e7eb;
          --muted: #94a3b8;
          --border: #334155;
          --border-soft: #1f2937;
          --ok: #86efac;
          --danger: #fca5a5;
          --warn: #fde68a;
        }
        .plus-wrap {
          position: relative;
          display: inline-flex;
          align-items: center;
        }
        .plus-tip {
          position: absolute;
          left: 50%;
          transform: translateX(-50%);
          top: -34px;
          white-space: nowrap;
          background: rgba(15, 23, 42, 0.95);
          color: white;
          padding: 4px 8px;
          border-radius: 8px;
          font-size: 12px;
          line-height: 1;
          pointer-events: none;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
        }
      `}</style>

      <div style={{ ...cardStyle, marginBottom: 14 }}>
        <h1 style={titleStyle}>CRF Form Builder</h1>
        <div style={{ ...subtleText, marginTop: 6 }}>
          프로젝트를 선택한 뒤 해당 프로젝트의 CRF를 조회/저장합니다. owner + member 모두 수정 가능합니다.
        </div>
      </div>

      <div style={{ ...cardStyle, marginBottom: 14 }}>
        <SectionHeader
          title="프로젝트 선택"
          right={
            <div style={{ minWidth: 320, width: "100%", maxWidth: 520 }}>
              <select
                value={selectedProjectId}
                onChange={(e) => setSelectedProjectId(e.target.value)}
                style={selectStyleAlwaysLight}
                disabled={loadingProjects || projects.length === 0}
              >
                {projects.length === 0 ? (
                  <option value="">참여 중인 프로젝트 없음</option>
                ) : (
                  projects.map((p) => (
                    <option key={p.uid} value={p.uid}>
                      {p.name || p.uid}
                    </option>
                  ))
                )}
              </select>
            </div>
          }
        />

        <div style={{ ...subtleText, marginTop: 6 }}>
          {loadingProjects
            ? "프로젝트 목록을 불러오는 중입니다."
            : projects.length === 0
            ? "참여 중인 프로젝트가 없습니다."
            : "프로젝트를 선택하면 해당 프로젝트의 CRF를 조회합니다."}
        </div>
      </div>

      <div style={{ ...cardStyle, marginBottom: 14 }}>
        <SectionHeader
          title="작업"
          right={
            <>
              <input
                ref={inputExcelRef}
                type="file"
                accept=".xlsx,.xls"
                style={{ display: "none" }}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) applyExcelFile(f);
                  if (e.currentTarget) e.currentTarget.value = "";
                }}
              />

              <MenuSampleDownloadButton
                menuPath="/contents/crf"
                fallbackLabel="CRF 샘플 다운로드"
                className="inline-flex items-center justify-center rounded-[10px] border px-[14px] py-[10px] text-sm font-bold no-underline hover:opacity-90"
              />

              <span style={{ ...subtleText, color: "var(--warn)", fontWeight: 900 }}>
                파일 업로드 시 기존 내용은 사라집니다.
              </span>

              <button
                type="button"
                style={{ ...btnStyle, opacity: canEdit ? 1 : 0.6, cursor: canEdit ? "pointer" : "not-allowed" }}
                onClick={() => inputExcelRef.current?.click()}
                disabled={loading || !canEdit}
                title={!canEdit ? "수정 권한이 있는 사용자만 업로드 가능합니다." : "Excel 업로드"}
              >
                Excel 업로드(채우기)
              </button>

              <button
                type="button"
                style={{ ...btnStyle, opacity: canEdit ? 1 : 0.6, cursor: canEdit ? "pointer" : "not-allowed" }}
                onClick={addRow}
                disabled={loading || !canEdit}
                title={!canEdit ? "수정 권한이 있는 사용자만 추가 가능합니다." : "Form 추가"}
              >
                Form 추가
              </button>

              <button
                type="button"
                style={{
                  ...btnStyle,
                  opacity: saving || !canEdit ? 0.6 : 1,
                  cursor: saving || !canEdit ? "not-allowed" : "pointer",
                }}
                onClick={() => saveNow()}
                disabled={saving || loading || !canEdit}
                title={!canEdit ? "수정 권한이 있는 사용자만 저장 가능합니다." : "저장"}
              >
                {saving ? "저장 중..." : "저장"}
              </button>
            </>
          }
        />

        <div style={{ ...subtleText, marginTop: 6 }}>
          ※ 행 순서 변경: 원하는 행을 <b style={{ color: "var(--text)" }}>드래그</b>해서 다른 행 위에 놓으세요.
        </div>

        {info && <div style={{ marginTop: 10, color: "var(--ok)", fontWeight: 800 }}>{info}</div>}
        {error && (
          <div style={{ marginTop: 10, color: "var(--danger)", fontWeight: 800 }}>
            오류: <span style={{ fontWeight: 500 }}>{error}</span>
          </div>
        )}
      </div>

      <div style={cardStyle}>
        <SectionHeader title="Forms" />

        <div style={{ overflowX: "auto", borderRadius: 12, border: "1px solid var(--border-soft)" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 880 }}>
            <thead>
              <tr>
                <th style={{ width: 52, textAlign: "center", padding: 10, borderBottom: "1px solid var(--border)" }}>
                  ↕
                </th>
                <th style={{ width: 70, textAlign: "center", padding: 10, borderBottom: "1px solid var(--border)" }}>
                  No.
                </th>
                <th style={{ textAlign: "left", padding: 10, borderBottom: "1px solid var(--border)" }}>
                  Form Name
                </th>
                <th style={{ width: 220, textAlign: "left", padding: 10, borderBottom: "1px solid var(--border)" }}>
                  Form Code
                </th>
                <th style={{ width: 110, textAlign: "center", padding: 10, borderBottom: "1px solid var(--border)" }}>
                  Repeat
                </th>
                <th style={{ width: 150, textAlign: "center", padding: 10, borderBottom: "1px solid var(--border)" }}>
                  관리
                </th>
              </tr>
            </thead>

            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    style={{
                      textAlign: "center",
                      padding: 18,
                      borderBottom: "1px solid var(--border-soft)",
                      color: "var(--muted)",
                    }}
                  >
                    {selectedProjectId ? "데이터가 없습니다." : "프로젝트를 선택해주세요."}
                  </td>
                </tr>
              ) : (
                rows.map((r, idx) => {
                  const isDragging = draggingId === r.id;
                  const isOver = overId === r.id && draggingId && draggingId !== r.id;

                  return (
                    <tr
                      key={r.id}
                      draggable={canEdit}
                      onDragStart={onDragStartRow(r.id)}
                      onDragOver={onDragOverRow(r.id)}
                      onDrop={onDropRow(r.id)}
                      onDragEnd={onDragEndRow}
                      style={{
                        opacity: isDragging ? 0.6 : 1,
                        outline: isOver ? "2px dashed var(--warn)" : "none",
                        outlineOffset: -2,
                        cursor: canEdit ? "grab" : "default",
                      }}
                      title={canEdit ? "드래그해서 순서를 변경할 수 있습니다." : "조회 전용입니다."}
                    >
                      <td style={{ textAlign: "center", padding: 10, borderBottom: "1px solid var(--border-soft)" }}>
                        <span style={{ opacity: canEdit ? 0.75 : 0.35 }}>⋮⋮</span>
                      </td>

                      <td style={{ textAlign: "center", padding: 10, borderBottom: "1px solid var(--border-soft)" }}>
                        {idx + 1}
                      </td>

                      <td style={{ padding: 10, borderBottom: "1px solid var(--border-soft)" }}>
                        <input
                          value={r.formName}
                          onChange={(e) => updateRow(r.id, { formName: e.target.value })}
                          style={inputStyle}
                          placeholder="e.g., Demographics"
                          disabled={!canEdit}
                        />
                      </td>

                      <td style={{ padding: 10, borderBottom: "1px solid var(--border-soft)" }}>
                        <input
                          value={r.formCode}
                          onChange={(e) => updateRow(r.id, { formCode: e.target.value })}
                          style={inputStyle}
                          placeholder="e.g., DM"
                          disabled={!canEdit}
                        />
                      </td>

                      <td style={{ textAlign: "center", padding: 10, borderBottom: "1px solid var(--border-soft)" }}>
                        <input
                          type="checkbox"
                          checked={!!r.repeat}
                          onChange={(e) => updateRow(r.id, { repeat: e.target.checked })}
                          style={{ width: 18, height: 18 }}
                          disabled={!canEdit}
                        />
                      </td>

                      <td style={{ textAlign: "center", padding: 10, borderBottom: "1px solid var(--border-soft)" }}>
                        <div style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
                          <button
                            type="button"
                            onClick={() => removeRow(r.id)}
                            style={{
                              ...btnStyle,
                              padding: "6px 10px",
                              opacity: canEdit ? 1 : 0.6,
                              cursor: canEdit ? "pointer" : "not-allowed",
                            }}
                            disabled={loading || !canEdit}
                            title={!canEdit ? "수정 권한이 있는 사용자만 삭제 가능합니다." : "삭제"}
                          >
                            -
                          </button>

                          <span
                            className="plus-wrap"
                            onMouseEnter={() => canEdit && setHoverPlusId(r.id)}
                            onMouseLeave={() => setHoverPlusId(null)}
                          >
                            <button
                              type="button"
                              onClick={() => insertRowAfter(r.id)}
                              style={{
                                ...btnStyle,
                                padding: "6px 10px",
                                opacity: canEdit ? 1 : 0.6,
                                cursor: canEdit ? "pointer" : "not-allowed",
                              }}
                              disabled={loading || !canEdit}
                              title={!canEdit ? "수정 권한이 있는 사용자만 추가 가능합니다." : "Form 추가"}
                            >
                              +
                            </button>

                            {hoverPlusId === r.id ? <span className="plus-tip">Form 추가</span> : null}
                          </span>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div style={{ ...subtleText, marginTop: 10 }}>
          ※ 수정/순서변경/추가 후 <b style={{ color: "var(--text)" }}>저장</b> 버튼을 눌러 Firestore에 반영하세요.
        </div>
      </div>
    </div>
  );
}