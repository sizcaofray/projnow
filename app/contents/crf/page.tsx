"use client";

/**
 * CRF Form Builder
 *
 * 변경 사항(요청 반영):
 * 1) 행 사이에 있던 "Form 추가" 버튼 전부 제거
 * 2) 각 form 행의 - 버튼 오른쪽에 + 버튼 추가 (해당 행 아래에 삽입)
 * 3) + 버튼 마우스 오버 시 하단에 "Form 추가" 툴팁 표시
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { getFirebaseAuth, getFirebaseDb } from "@/lib/firebase/client";

type FormRow = {
  id: string;
  formName: string;
  formCode: string;
  repeat: boolean;
  createdAt: number;
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

  const [rows, setRows] = useState<FormRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [error, setError] = useState<string>("");
  const [info, setInfo] = useState<string>("");

  // Drag & Drop 상태
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  // ✅ 툴팁 표시 상태(+ 버튼 hover)
  const [hoverPlusId, setHoverPlusId] = useState<string | null>(null);

  // ✅ 로그인 사용자 식별
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

  // ✅ 사용자별 데이터 로드
  useEffect(() => {
    const run = async () => {
      setError("");
      setInfo("");

      if (!db) return;
      if (!uid) {
        setRows([]);
        return;
      }

      setLoading(true);
      try {
        const ref = doc(db, COL, uid);
        const snap = await getDoc(ref);

        if (!snap.exists()) {
          setRows([{ id: newRowId(), formName: "", formCode: "", repeat: false, createdAt: Date.now() }]);
          return;
        }

        const data = snap.data() as any;
        const loaded: FormRow[] = Array.isArray(data?.rows)
          ? data.rows
              .map((r: any) => ({
                id: toStr(r?.id) || newRowId(),
                formName: toStr(r?.formName),
                formCode: toStr(r?.formCode),
                repeat: Boolean(r?.repeat),
                createdAt: Number(r?.createdAt ?? Date.now()),
              }))
              .filter((r: FormRow) => !!r.id)
          : [];

        setRows(
          loaded.length > 0
            ? loaded
            : [{ id: newRowId(), formName: "", formCode: "", repeat: false, createdAt: Date.now() }]
        );
      } catch (e: any) {
        setError(e?.message ?? "데이터 로드 실패");
      } finally {
        setLoading(false);
      }
    };

    run();
  }, [db, uid]);

  // ✅ 저장
  const saveNow = async (nextRows?: FormRow[]) => {
    setError("");
    setInfo("");

    if (!db) return setError("Firestore 초기화 실패");
    if (!uid) return setError("로그인이 필요합니다.");

    setSaving(true);
    try {
      const ref = doc(db, COL, uid);

      const payload = {
        rows: (nextRows ?? rows).map((r) => ({
          id: r.id,
          formName: r.formName ?? "",
          formCode: r.formCode ?? "",
          repeat: !!r.repeat,
          createdAt: Number(r.createdAt ?? Date.now()),
        })),
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

  // ✅ 마지막에 Form 추가(상단 버튼용)
  const addRow = () => {
    setRows((prev) => [
      ...prev,
      { id: newRowId(), formName: "", formCode: "", repeat: false, createdAt: Date.now() },
    ]);
    setInfo("");
  };

  // ✅ 특정 행 아래에 삽입(+ 버튼용)
  const insertRowAfter = (afterId: string) => {
    setRows((prev) => {
      const idx = prev.findIndex((r) => r.id === afterId);
      if (idx < 0) return prev;

      const next = [...prev];
      next.splice(idx + 1, 0, {
        id: newRowId(),
        formName: "",
        formCode: "",
        repeat: false,
        createdAt: Date.now(),
      });
      return next;
    });
    setInfo("");
  };

  // ✅ 행 삭제
  const removeRow = (rowId: string) => {
    setRows((prev) => {
      const next = prev.filter((r) => r.id !== rowId);
      if (next.length === 0) {
        return [{ id: newRowId(), formName: "", formCode: "", repeat: false, createdAt: Date.now() }];
      }
      return next;
    });
    setInfo("");
  };

  // ✅ 셀 수정
  const updateRow = (rowId: string, patch: Partial<FormRow>) => {
    setRows((prev) => prev.map((r) => (r.id === rowId ? { ...r, ...patch } : r)));
    setInfo("");
  };

  // ✅ Excel 업로드(덮어쓰기)
  const applyExcelFile = async (file: File) => {
    setError("");
    setInfo("");

    if (!/\.(xlsx|xls)$/i.test(file.name)) {
      setError("엑셀 파일(.xlsx/.xls)만 업로드할 수 있습니다.");
      return;
    }

    try {
      setLoading(true);

      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });

      const sheetName = wb.SheetNames?.[0];
      if (!sheetName) {
        setError("엑셀 시트를 찾을 수 없습니다.");
        return;
      }

      const ws = wb.Sheets[sheetName];
      const json = XLSX.utils.sheet_to_json<Record<string, any>>(ws, { defval: "" });

      const normalizeKey = (k: string) => k.replace(/\s+/g, "").toLowerCase();
      const keys = Object.keys(json?.[0] ?? {});

      const keyMap: Record<"formName" | "formCode" | "repeat", string | null> = {
        formName: null,
        formCode: null,
        repeat: null,
      };

      for (const k of keys) {
        const nk = normalizeKey(k);
        if (!keyMap.formName && (nk === "formname" || nk === "form_name" || nk === "name")) keyMap.formName = k;
        if (!keyMap.formCode && (nk === "formcode" || nk === "form_code" || nk === "code")) keyMap.formCode = k;
        if (!keyMap.repeat && nk === "repeat") keyMap.repeat = k;
      }

      if (!keyMap.formName || !keyMap.formCode || !keyMap.repeat) {
        setError('엑셀 헤더가 필요합니다: "Form Name", "Form Code", "Repeat"');
        return;
      }

      const nextRows: FormRow[] = json
        .map((r) => {
          const formName = toStr(r[keyMap.formName as string]);
          const formCode = toStr(r[keyMap.formCode as string]);
          const repeat = toBoolRepeat(r[keyMap.repeat as string]);
          if (!formName && !formCode) return null;

          return {
            id: newRowId(),
            formName,
            formCode,
            repeat,
            createdAt: Date.now(),
          } as FormRow;
        })
        .filter(Boolean) as FormRow[];

      if (nextRows.length === 0) {
        setError("엑셀에서 유효한 데이터 행을 찾지 못했습니다. (Form Name/Form Code 확인)");
        return;
      }

      setRows(nextRows);
      setInfo(`엑셀(${file.name})로 ${nextRows.length}건을 채웠습니다. 저장 버튼을 눌러 반영하세요.`);
    } catch (e: any) {
      setError(e?.message ?? "엑셀 읽기 실패");
    } finally {
      setLoading(false);
    }
  };

  // ✅ Drag & Drop 핸들러
  const onDragStartRow = (rowId: string) => (e: React.DragEvent<HTMLTableRowElement>) => {
    setDraggingId(rowId);
    setOverId(rowId);
    setInfo("");
    e.dataTransfer.setData("text/plain", rowId);
    e.dataTransfer.effectAllowed = "move";
  };

  const onDragOverRow = (rowId: string) => (e: React.DragEvent<HTMLTableRowElement>) => {
    e.preventDefault();
    setOverId(rowId);
    e.dataTransfer.dropEffect = "move";
  };

  const onDropRow = (rowId: string) => (e: React.DragEvent<HTMLTableRowElement>) => {
    e.preventDefault();
    const activeId = e.dataTransfer.getData("text/plain") || draggingId;
    if (!activeId) return;

    setRows((prev) => reorderById(prev, activeId, rowId));
    setDraggingId(null);
    setOverId(null);
    setInfo("행 순서를 변경했습니다. 저장 버튼을 눌러 반영하세요.");
  };

  const onDragEndRow = () => {
    setDraggingId(null);
    setOverId(null);
  };

  // ✅ 스타일
  const themeCss = `
    .crf-wrap{
      --text: #0b0f19;
      --muted: rgba(11,15,25,0.7);
      --card-bg: rgba(255,255,255,0.78);
      --card-border: rgba(11,15,25,0.14);
      --border: rgba(11,15,25,0.14);
      --border-soft: rgba(11,15,25,0.10);
      --btn-bg: rgba(255,255,255,0.90);
      --btn-border: rgba(11,15,25,0.18);
      --input-bg: rgba(255,255,255,0.92);
      --input-border: rgba(11,15,25,0.18);
      --danger: #c31919;
      --ok: #0a7a2f;
      --warn: #a36a00;
    }
    @media (prefers-color-scheme: dark){
      .crf-wrap{
        --text: #e8eefc;
        --muted: rgba(232,238,252,0.72);
        --card-bg: rgba(255,255,255,0.06);
        --card-border: rgba(232,238,252,0.14);
        --border: rgba(232,238,252,0.16);
        --border-soft: rgba(232,238,252,0.10);
        --btn-bg: rgba(255,255,255,0.08);
        --btn-border: rgba(232,238,252,0.16);
        --input-bg: rgba(255,255,255,0.08);
        --input-border: rgba(232,238,252,0.18);
        --danger: #ff6b6b;
        --ok: #41d17a;
        --warn: #ffb020;
      }
    }

    /* ✅ 툴팁(하단 표시) */
    .plus-wrap{ position: relative; display: inline-flex; }
    .plus-tip{
      position: absolute;
      left: 50%;
      transform: translateX(-50%);
      top: calc(100% + 6px);
      white-space: nowrap;
      padding: 6px 10px;
      border-radius: 10px;
      border: 1px solid var(--border);
      background: var(--card-bg);
      color: var(--text);
      font-size: 12px;
      font-weight: 900;
      box-shadow: 0 6px 18px rgba(0,0,0,0.14);
      z-index: 50;
      pointer-events: none;
    }
  `;

  const cardStyle: React.CSSProperties = {
    border: "1px solid var(--card-border)",
    borderRadius: 12,
    padding: 14,
    background: "var(--card-bg)",
    backdropFilter: "blur(6px)",
    color: "var(--text)",
  };

  const btnStyle: React.CSSProperties = {
    padding: "8px 12px",
    borderRadius: 10,
    border: "1px solid var(--btn-border)",
    background: "var(--btn-bg)",
    color: "var(--text)",
    cursor: "pointer",
    fontWeight: 800,
  };

  const subtleText: React.CSSProperties = { fontSize: 12, opacity: 0.85, color: "var(--muted)" };

  const SectionHeader = ({ title, right }: { title: string; right?: React.ReactNode }) => (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 10 }}>
      <div style={{ fontWeight: 900, color: "var(--text)" }}>{title}</div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>{right}</div>
    </div>
  );

  if (loadingUser) {
    return (
      <div className="crf-wrap" style={{ padding: 18, maxWidth: 1100, margin: "0 auto" }}>
        <style>{themeCss}</style>
        <div style={cardStyle}>로딩 중...</div>
      </div>
    );
  }

  if (!uid) {
    return (
      <div className="crf-wrap" style={{ padding: 18, maxWidth: 1100, margin: "0 auto" }}>
        <style>{themeCss}</style>
        <div style={cardStyle}>
          <div style={{ fontWeight: 900, marginBottom: 6 }}>로그인이 필요합니다.</div>
          <div style={subtleText}>Google 로그인 후 사용하실 수 있습니다.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="crf-wrap" style={{ padding: 18, maxWidth: 1300, margin: "0 auto" }}>
      <style>{themeCss}</style>

      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 12 }}>
        <h1 style={{ fontSize: 22, fontWeight: 900, margin: 0, color: "var(--text)" }}>CRF Form Builder</h1>
        <span style={subtleText}>/contents/crf</span>
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

              <span style={{ ...subtleText, color: "var(--warn)", fontWeight: 900 }}>
                파일 업로드 시 기존 내용은 사라집니다.
              </span>

              <button type="button" style={btnStyle} onClick={() => inputExcelRef.current?.click()} disabled={loading}>
                Excel 업로드(채우기)
              </button>

              {/* 상단 Form 추가는 유지(원하시면 이것도 제거 가능) */}
              <button type="button" style={btnStyle} onClick={addRow} disabled={loading}>
                Form 추가
              </button>

              <button
                type="button"
                style={{
                  ...btnStyle,
                  opacity: saving ? 0.7 : 1,
                  cursor: saving ? "not-allowed" : "pointer",
                }}
                onClick={() => saveNow()}
                disabled={saving || loading}
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
              {rows.map((r, idx) => {
                const isDragging = draggingId === r.id;
                const isOver = overId === r.id && draggingId && draggingId !== r.id;

                return (
                  <tr
                    key={r.id}
                    draggable
                    onDragStart={onDragStartRow(r.id)}
                    onDragOver={onDragOverRow(r.id)}
                    onDrop={onDropRow(r.id)}
                    onDragEnd={onDragEndRow}
                    style={{
                      opacity: isDragging ? 0.6 : 1,
                      outline: isOver ? "2px dashed var(--warn)" : "none",
                      outlineOffset: -2,
                      cursor: "grab",
                    }}
                    title="드래그해서 순서를 변경할 수 있습니다."
                  >
                    <td style={{ textAlign: "center", padding: 10, borderBottom: "1px solid var(--border-soft)" }}>
                      <span style={{ opacity: 0.75 }}>⋮⋮</span>
                    </td>

                    <td style={{ textAlign: "center", padding: 10, borderBottom: "1px solid var(--border-soft)" }}>
                      {idx + 1}
                    </td>

                    <td style={{ padding: 10, borderBottom: "1px solid var(--border-soft)" }}>
                      <input
                        value={r.formName}
                        onChange={(e) => updateRow(r.id, { formName: e.target.value })}
                        style={{
                          width: "100%",
                          padding: "8px 10px",
                          borderRadius: 10,
                          border: "1px solid var(--input-border)",
                          background: "var(--input-bg)",
                          color: "var(--text)",
                          outline: "none",
                        }}
                        placeholder="e.g., Demographics"
                      />
                    </td>

                    <td style={{ padding: 10, borderBottom: "1px solid var(--border-soft)" }}>
                      <input
                        value={r.formCode}
                        onChange={(e) => updateRow(r.id, { formCode: e.target.value })}
                        style={{
                          width: "100%",
                          padding: "8px 10px",
                          borderRadius: 10,
                          border: "1px solid var(--input-border)",
                          background: "var(--input-bg)",
                          color: "var(--text)",
                          outline: "none",
                        }}
                        placeholder="e.g., DM"
                      />
                    </td>

                    <td style={{ textAlign: "center", padding: 10, borderBottom: "1px solid var(--border-soft)" }}>
                      <input
                        type="checkbox"
                        checked={!!r.repeat}
                        onChange={(e) => updateRow(r.id, { repeat: e.target.checked })}
                        style={{ width: 18, height: 18 }}
                      />
                    </td>

                    {/* ✅ - 버튼 오른쪽에 + 버튼 배치 + hover 툴팁 */}
                    <td style={{ textAlign: "center", padding: 10, borderBottom: "1px solid var(--border-soft)" }}>
                      <div style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
                        <button
                          type="button"
                          onClick={() => removeRow(r.id)}
                          style={{ ...btnStyle, padding: "6px 10px" }}
                          disabled={loading}
                          title="삭제"
                        >
                          -
                        </button>

                        <span
                          className="plus-wrap"
                          onMouseEnter={() => setHoverPlusId(r.id)}
                          onMouseLeave={() => setHoverPlusId(null)}
                        >
                          <button
                            type="button"
                            onClick={() => insertRowAfter(r.id)}
                            style={{ ...btnStyle, padding: "6px 10px" }}
                            disabled={loading}
                            title="Form 추가"
                          >
                            +
                          </button>

                          {hoverPlusId === r.id ? <span className="plus-tip">Form 추가</span> : null}
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              })}
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
