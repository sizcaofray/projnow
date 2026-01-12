"use client";

/**
 * CRF Form Builder (새 기능 버전)
 *
 * 요구사항 구현:
 * 1) 사용자별 개별 작업 저장(Firestore: crf_forms/{uid})
 * 2) 열 구성: No.(자동), Form Name, Form Code, Repeat
 * 3) Form Name/Form Code/Repeat 모두 수정 가능, Repeat는 체크박스
 * 4) + / - 버튼으로 행 추가/삭제
 * 5) Form Name, Form Code, Repeat 형식 Excel 업로드로 테이블 채우기
 *
 * 주의:
 * - No.는 index+1로 자동 표시 (DB 저장 X)
 * - Excel 업로드 시 기본 동작: "덮어쓰기"
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { getFirebaseAuth, getFirebaseDb } from "@/lib/firebase/client";

type FormRow = {
  id: string; // row 고유키
  formName: string;
  formCode: string;
  repeat: boolean;
  createdAt: number; // 정렬/추적용
};

const COL = "crf_forms";

/** 문자열 안전 변환 */
function toStr(v: any) {
  return String(v ?? "").trim();
}

/** Repeat 파싱: 체크/TRUE/Y/1 등 허용 */
function toBoolRepeat(v: any) {
  const s = String(v ?? "").trim().toLowerCase();
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  return s === "y" || s === "yes" || s === "true" || s === "1" || s === "o" || s === "ok" || s === "checked";
}

/** row id 생성 */
function newRowId() {
  return `r_${Date.now()}_${Math.random().toString(16).slice(2)}`;
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

  // ✅ (A) 로그인 사용자 식별
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

  // ✅ (B) 사용자별 데이터 로드
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
          // 최초 진입: 기본 1행 생성
          setRows([
            {
              id: newRowId(),
              formName: "",
              formCode: "",
              repeat: false,
              createdAt: Date.now(),
            },
          ]);
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
            : [
                {
                  id: newRowId(),
                  formName: "",
                  formCode: "",
                  repeat: false,
                  createdAt: Date.now(),
                },
              ]
        );
      } catch (e: any) {
        setError(e?.message ?? "데이터 로드 실패");
      } finally {
        setLoading(false);
      }
    };

    run();
  }, [db, uid]);

  // ✅ 저장 함수(수동 저장 버튼)
  const saveNow = async (nextRows?: FormRow[]) => {
    setError("");
    setInfo("");

    if (!db) return setError("Firestore 초기화 실패");
    if (!uid) return setError("로그인이 필요합니다.");

    setSaving(true);
    try {
      const ref = doc(db, COL, uid);

      // 저장할 데이터 구성
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

  // ✅ 행 추가(+)
  const addRow = () => {
    setRows((prev) => [
      ...prev,
      {
        id: newRowId(),
        formName: "",
        formCode: "",
        repeat: false,
        createdAt: Date.now(),
      },
    ]);
    setInfo("");
  };

  // ✅ 행 삭제(-)
  const removeRow = (rowId: string) => {
    setRows((prev) => {
      const next = prev.filter((r) => r.id !== rowId);
      // 최소 1행 유지(원하시면 0행 허용으로 바꿔드릴 수 있습니다)
      if (next.length === 0) {
        return [
          {
            id: newRowId(),
            formName: "",
            formCode: "",
            repeat: false,
            createdAt: Date.now(),
          },
        ];
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

  // ✅ Excel 업로드로 채워넣기(덮어쓰기)
  const applyExcelFile = async (file: File) => {
    setError("");
    setInfo("");

    // xlsx/xls만 허용
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

      // ✅ 1행 헤더 기반으로 JSON 변환
      const json = XLSX.utils.sheet_to_json<Record<string, any>>(ws, {
        defval: "",
      });

      // 헤더 매핑(대소문자/공백 차이 대응)
      // 기대 헤더: "Form Name", "Form Code", "Repeat"
      // (대체 허용: "FormName", "FormCode", "Repeat", "REPEAT" 등)
      const normalizeKey = (k: string) => k.replace(/\s+/g, "").toLowerCase();

      // 첫 행을 기준으로 키 후보 수집
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

      // 엄격 모드: 정확히 못 찾으면 에러
      if (!keyMap.formName || !keyMap.formCode || !keyMap.repeat) {
        setError('엑셀 헤더가 필요합니다: "Form Name", "Form Code", "Repeat"');
        return;
      }

      const nextRows: FormRow[] = json
        .map((r) => {
          const formName = toStr(r[keyMap.formName as string]);
          const formCode = toStr(r[keyMap.formCode as string]);
          const repeat = toBoolRepeat(r[keyMap.repeat as string]);

          // 완전 빈 행은 제외
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

      // ✅ 덮어쓰기
      setRows(nextRows);
      setInfo(`엑셀(${file.name})로 ${nextRows.length}건을 채웠습니다. 저장 버튼을 눌러 반영하세요.`);
    } catch (e: any) {
      setError(e?.message ?? "엑셀 읽기 실패");
    } finally {
      setLoading(false);
    }
  };

  // ✅ 기존 스타일(모드 의존 최소) 유지: CSS 변수 기반
  const themeCss = `
    .crf-wrap{
      --bg: #ffffff;
      --text: #0b0f19;
      --muted: rgba(11,15,25,0.7);
      --card-bg: rgba(255,255,255,0.78);
      --card-border: rgba(11,15,25,0.14);
      --surface: rgba(255,255,255,0.70);
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
        --bg: #0b0f19;
        --text: #e8eefc;
        --muted: rgba(232,238,252,0.72);
        --card-bg: rgba(255,255,255,0.06);
        --card-border: rgba(232,238,252,0.14);
        --surface: rgba(255,255,255,0.06);
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

  // ✅ 로그인 필요 안내
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

      {/* 상단 컨트롤 */}
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
                  // 같은 파일 연속 업로드 가능하게 초기화
                  if (e.currentTarget) e.currentTarget.value = "";
                }}
              />

              <button type="button" style={btnStyle} onClick={() => inputExcelRef.current?.click()} disabled={loading}>
                Excel 업로드(채우기)
              </button>

              <button type="button" style={btnStyle} onClick={addRow} disabled={loading}>
                + 추가
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

        <div style={subtleText}>
          엑셀 헤더는 반드시 <b style={{ color: "var(--text)" }}>Form Name / Form Code / Repeat</b> 이어야 합니다.
          (Repeat는 TRUE/Y/1 등도 인식)
        </div>

        {info && (
          <div style={{ marginTop: 10, color: "var(--ok)", fontWeight: 800 }}>
            {info}
          </div>
        )}

        {error && (
          <div style={{ marginTop: 10, color: "var(--danger)", fontWeight: 800 }}>
            오류: <span style={{ fontWeight: 500 }}>{error}</span>
          </div>
        )}
      </div>

      {/* 테이블 */}
      <div style={cardStyle}>
        <SectionHeader title="Forms" />

        <div style={{ overflowX: "auto", borderRadius: 12, border: "1px solid var(--border-soft)" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 780 }}>
            <thead>
              <tr>
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
                <th style={{ width: 90, textAlign: "center", padding: 10, borderBottom: "1px solid var(--border)" }}>
                  삭제
                </th>
              </tr>
            </thead>

            <tbody>
              {rows.map((r, idx) => (
                <tr key={r.id}>
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

                  <td style={{ textAlign: "center", padding: 10, borderBottom: "1px solid var(--border-soft)" }}>
                    <button
                      type="button"
                      onClick={() => removeRow(r.id)}
                      style={{ ...btnStyle, padding: "6px 10px" }}
                      disabled={loading}
                    >
                      -
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={{ ...subtleText, marginTop: 10 }}>
          ※ 수정 후 <b style={{ color: "var(--text)" }}>저장</b> 버튼을 눌러 Firestore에 반영하세요.
        </div>
      </div>
    </div>
  );
}
