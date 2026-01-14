"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import * as XLSX from "xlsx";

/**
 * ✅ 프로젝트에 맞게 import 경로만 유지/수정하세요.
 */
import { getFirebaseAuth, getFirebaseDb } from "@/lib/firebase/client";

/**
 * ✅ 이 메뉴는 "manage_structure_templates"만 사용합니다.
 * - 다른 메뉴/DB에서 가져오지 않습니다.
 */
const MANAGE_TEMPLATES_COLLECTION = "manage_structure_templates";

/**
 * =========================
 * Types
 * =========================
 */
type TemplateItem = {
  id: string; // UI row id
  contentName: string;
  contentCode: string;
  note: string;
};

type TemplateDoc = {
  formCode: string;
  formName?: string;
  items: Array<{ contentName: string; contentCode: string; note: string }>;
  updatedAt?: any;
  updatedBy?: string;
};

type ExcelTemplateRow = {
  formCode: string;
  formName: string;
  contentName: string;
  contentCode: string;
  note: string;
};

/**
 * =========================
 * Utils
 * =========================
 */
function toStr(v: any) {
  return String(v ?? "").trim();
}

function normalizeFormCode(v: string) {
  return toStr(v).toUpperCase();
}

function newId(prefix = "r") {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

/**
 * =========================
 * Firestore Helpers
 * =========================
 */

// ✅ 템플릿 문서 목록(formCode 목록) 로드: 템플릿 DB에서만 가져옵니다.
async function fetchTemplateFormCodes(db: any): Promise<string[]> {
  const snap = await getDocs(collection(db, MANAGE_TEMPLATES_COLLECTION));
  const codes = snap.docs.map((d) => normalizeFormCode(d.id)).filter(Boolean);
  return Array.from(new Set(codes)).sort((a, b) => a.localeCompare(b));
}

// ✅ 선택된 템플릿 로드
async function loadTemplateDoc(db: any, formCode: string): Promise<TemplateDoc | null> {
  const code = normalizeFormCode(formCode);
  if (!code) return null;

  const ref = doc(db, MANAGE_TEMPLATES_COLLECTION, code);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;

  const data = snap.data() as any;

  const rawItems = Array.isArray(data?.items) ? data.items : [];
  const items = rawItems
    .map((it: any) => ({
      contentName: toStr(it?.contentName),
      contentCode: toStr(it?.contentCode),
      note: toStr(it?.note),
    }))
    .filter((x: any) => x.contentName || x.contentCode || x.note);

  return {
    formCode: code,
    formName: toStr(data?.formName),
    items,
    updatedAt: data?.updatedAt,
    updatedBy: toStr(data?.updatedBy),
  };
}

// ✅ 저장(upsert)
async function saveTemplateDoc(db: any, uid: string, formCode: string, formName: string, uiItems: TemplateItem[]) {
  const code = normalizeFormCode(formCode);

  const payload: TemplateDoc = {
    formCode: code,
    formName: toStr(formName),
    items: uiItems.map((it) => ({
      contentName: toStr(it.contentName),
      contentCode: toStr(it.contentCode),
      note: toStr(it.note),
    })),
    updatedAt: serverTimestamp(),
    updatedBy: uid,
  };

  await setDoc(doc(db, MANAGE_TEMPLATES_COLLECTION, code), payload, { merge: true });
}

// ✅ 삭제(초기화)
async function deleteTemplateDoc(db: any, formCode: string) {
  const code = normalizeFormCode(formCode);
  await deleteDoc(doc(db, MANAGE_TEMPLATES_COLLECTION, code));
}

/**
 * =========================
 * Excel Parse / Upload
 * =========================
 */

// ✅ 업로드 엑셀 파싱: templates 시트 우선
function parseExcelTemplates(file: File): Promise<ExcelTemplateRow[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: "array" });

        const sheetName = wb.SheetNames.includes("templates") ? "templates" : wb.SheetNames[0];
        const ws = wb.Sheets[sheetName];
        if (!ws) return resolve([]);

        const json = XLSX.utils.sheet_to_json<Record<string, any>>(ws, { defval: "" });

        // ✅ 컬럼명은 formCode/formName/contentName/contentCode/note 기준
        const rows: ExcelTemplateRow[] = json.map((r) => ({
          formCode: normalizeFormCode(toStr(r.formCode ?? r.FormCode ?? r["Form Code"] ?? r["FORM CODE"])),
          formName: toStr(r.formName ?? r.FormName ?? r["Form Name"] ?? r["FORM NAME"]),
          contentName: toStr(r.contentName ?? r.ContentName ?? r["Content Name"] ?? r["CONTENT NAME"]),
          contentCode: toStr(r.contentCode ?? r.ContentCode ?? r["Content Code"] ?? r["VARIABLE"] ?? r["Variable"]),
          note: toStr(r.note ?? r.Note ?? r["NOTE"] ?? r["Note"]),
        }));

        // ✅ 유효 row만
        const filtered = rows.filter(
          (x) => x.formCode && (x.formName || x.contentName || x.contentCode || x.note)
        );
        resolve(filtered);
      } catch (err) {
        reject(err);
      }
    };

    reader.onerror = () => reject(new Error("엑셀 파일 읽기 실패"));
    reader.readAsArrayBuffer(file);
  });
}

// ✅ rows -> formCode별 그룹핑(즉시 UI 반영용)
function groupRowsToUi(rows: ExcelTemplateRow[]) {
  const map = new Map<string, { formName: string; items: TemplateItem[] }>();

  for (const r of rows) {
    const code = normalizeFormCode(r.formCode);
    if (!code) continue;

    if (!map.has(code)) {
      map.set(code, { formName: toStr(r.formName), items: [] });
    }

    const g = map.get(code)!;

    // formName이 비어있다면 뒤에 나오는 값으로 채움
    if (!g.formName && r.formName) g.formName = toStr(r.formName);

    // ✅ 빈 아이템만 들어가는 걸 방지(그래도 업로드 row는 유효 row만 이미 걸렀음)
    g.items.push({
      id: newId("it"),
      contentName: toStr(r.contentName),
      contentCode: toStr(r.contentCode),
      note: toStr(r.note),
    });
  }

  const codes = Array.from(map.keys()).sort((a, b) => a.localeCompare(b));
  return { map, codes };
}

// ✅ DB upsert
async function upsertGroupedToDb(db: any, uid: string, grouped: Map<string, { formName: string; items: TemplateItem[] }>) {
  for (const [code, v] of grouped.entries()) {
    await saveTemplateDoc(db, uid, code, v.formName, v.items);
  }
  return grouped.size;
}

/**
 * =========================
 * Page
 * =========================
 */
export default function ManageStructurePage() {
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

  const uploadRef = useRef<HTMLInputElement | null>(null);

  const [uid, setUid] = useState("");
  const [loadingAuth, setLoadingAuth] = useState(true);

  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [infoMsg, setInfoMsg] = useState("");

  // ✅ 이 메뉴는 템플릿 DB에서 formCode 목록을 구성
  const [formCodes, setFormCodes] = useState<string[]>([]);
  const [selectedFormCode, setSelectedFormCode] = useState<string>("");

  // 현재 편집 상태
  const [formName, setFormName] = useState<string>("");
  const [items, setItems] = useState<TemplateItem[]>([]);
  const [dirty, setDirty] = useState(false);

  /**
   * Auth
   */
  useEffect(() => {
    if (!auth) {
      setErrorMsg("Firebase Auth 초기화 실패");
      setLoadingAuth(false);
      return;
    }

    const unsub = onAuthStateChanged(auth, (user) => {
      setUid(user?.uid ?? "");
      setLoadingAuth(false);
    });

    return () => unsub();
  }, [auth]);

  /**
   * ✅ 목록 다시 가져오기(템플릿 DB에서)
   * - 경고(confirm) 포함
   */
  const reloadFromTemplateDb = useCallback(
    async (withConfirmIfDirty: boolean) => {
      setErrorMsg("");
      setInfoMsg("");

      if (!db) return setErrorMsg("Firestore 초기화 실패");
      if (!uid) return setErrorMsg("로그인이 필요합니다.");

      if (withConfirmIfDirty && dirty) {
        const ok = window.confirm(
          "다시 가져오기를 진행하면 현재 화면의 편집 내용(저장 전 변경사항)이 초기화됩니다.\n계속 진행하시겠습니까?"
        );
        if (!ok) return;
      }

      setLoading(true);
      try {
        const codes = await fetchTemplateFormCodes(db);
        setFormCodes(codes);

        if (!codes.length) {
          // 템플릿 DB가 비어있으면 화면도 빈 상태
          setSelectedFormCode("");
          setFormName("");
          setItems([]);
          setDirty(false);
          setInfoMsg("템플릿 DB에 데이터가 없습니다. 엑셀 업로드 또는 +행 추가 후 저장하세요.");
          return;
        }

        const next = codes.includes(selectedFormCode) ? selectedFormCode : codes[0];
        setSelectedFormCode(next);

        const tpl = await loadTemplateDoc(db, next);
        if (tpl) {
          setFormName(tpl.formName ?? "");
          setItems(
            (tpl.items ?? []).map((it) => ({
              id: newId("it"),
              contentName: it.contentName,
              contentCode: it.contentCode,
              note: it.note,
            }))
          );
        } else {
          setFormName("");
          setItems([]);
        }

        setDirty(false);
        setInfoMsg(`템플릿 DB에서 ${codes.length}개 FormCode를 불러왔습니다.`);
      } catch (e: any) {
        setErrorMsg(e?.message ?? "템플릿 목록 불러오기 실패");
      } finally {
        setLoading(false);
      }
    },
    [db, uid, dirty, selectedFormCode]
  );

  // 최초 진입 시 템플릿 DB에서 목록 구성
  useEffect(() => {
    if (!db) return;
    if (!uid) return;
    reloadFromTemplateDb(false);
  }, [db, uid, reloadFromTemplateDb]);

  /**
   * ✅ FormCode 선택 시 템플릿 로드
   */
  const onSelectFormCode = useCallback(
    async (code: string) => {
      setErrorMsg("");
      setInfoMsg("");

      if (!db) return setErrorMsg("Firestore 초기화 실패");
      if (!uid) return setErrorMsg("로그인이 필요합니다.");

      const next = normalizeFormCode(code);
      if (!next) return;

      if (dirty) {
        const ok = window.confirm(
          "FormCode를 변경하면 현재 화면의 편집 내용(저장 전 변경사항)이 초기화됩니다.\n계속 진행하시겠습니까?"
        );
        if (!ok) return;
      }

      setLoading(true);
      try {
        const tpl = await loadTemplateDoc(db, next);
        setSelectedFormCode(next);

        if (tpl) {
          setFormName(tpl.formName ?? "");
          setItems(
            (tpl.items ?? []).map((it) => ({
              id: newId("it"),
              contentName: it.contentName,
              contentCode: it.contentCode,
              note: it.note,
            }))
          );
          setInfoMsg(`템플릿을 불러왔습니다. (${next})`);
        } else {
          setFormName("");
          setItems([]);
          setInfoMsg(`저장된 템플릿이 없습니다. (${next})`);
        }

        setDirty(false);
      } catch (e: any) {
        setErrorMsg(e?.message ?? "템플릿 불러오기 실패");
      } finally {
        setLoading(false);
      }
    },
    [db, uid, dirty]
  );

  /**
   * UI actions
   */
  const addItem = () => {
    setItems((prev) => [...prev, { id: newId("it"), contentName: "", contentCode: "", note: "" }]);
    setDirty(true);
  };

  const updateItem = (id: string, patch: Partial<TemplateItem>) => {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
    setDirty(true);
  };

  const removeItem = (id: string) => {
    setItems((prev) => prev.filter((it) => it.id !== id));
    setDirty(true);
  };

  const moveItem = (id: string, dir: "up" | "down") => {
    setItems((prev) => {
      const idx = prev.findIndex((x) => x.id === id);
      if (idx < 0) return prev;
      const nextIdx = dir === "up" ? idx - 1 : idx + 1;
      if (nextIdx < 0 || nextIdx >= prev.length) return prev;

      const copy = [...prev];
      const [picked] = copy.splice(idx, 1);
      copy.splice(nextIdx, 0, picked);
      return copy;
    });
    setDirty(true);
  };

  /**
   * Save
   */
  const onSave = async () => {
    setErrorMsg("");
    setInfoMsg("");

    if (!db) return setErrorMsg("Firestore 초기화 실패");
    if (!uid) return setErrorMsg("로그인이 필요합니다.");
    if (!selectedFormCode) return setErrorMsg("FormCode를 먼저 선택하거나 업로드하세요.");

    setLoading(true);
    try {
      await saveTemplateDoc(db, uid, selectedFormCode, formName, items);
      setDirty(false);
      setInfoMsg(`저장되었습니다. (${selectedFormCode})`);

      // ✅ 저장 후 목록 갱신 (이 메뉴 내부에서만)
      await reloadFromTemplateDb(false);
    } catch (e: any) {
      setErrorMsg(e?.message ?? "저장 실패");
    } finally {
      setLoading(false);
    }
  };

  /**
   * Reset template doc
   */
  const onResetTemplate = async () => {
    setErrorMsg("");
    setInfoMsg("");

    if (!db) return setErrorMsg("Firestore 초기화 실패");
    if (!uid) return setErrorMsg("로그인이 필요합니다.");
    if (!selectedFormCode) return setErrorMsg("FormCode를 선택해 주세요.");

    const ok = window.confirm("이 FormCode의 템플릿을 초기화(삭제)합니다.\n계속 진행하시겠습니까?");
    if (!ok) return;

    setLoading(true);
    try {
      await deleteTemplateDoc(db, selectedFormCode);
      setFormName("");
      setItems([]);
      setDirty(false);
      setInfoMsg(`템플릿을 삭제했습니다. (${selectedFormCode})`);

      await reloadFromTemplateDb(false);
    } catch (e: any) {
      setErrorMsg(e?.message ?? "삭제 실패");
    } finally {
      setLoading(false);
    }
  };

  /**
   * Excel upload
   * ✅ 업로드 즉시 화면에 "참고용 컨텐츠"가 생성되어야 함
   */
  const onClickUpload = () => uploadRef.current?.click();

  const onUploadExcel = async (file: File) => {
    setErrorMsg("");
    setInfoMsg("");

    if (!db) return setErrorMsg("Firestore 초기화 실패");
    if (!uid) return setErrorMsg("로그인이 필요합니다.");

    if (dirty) {
      const ok = window.confirm(
        "엑셀 업로드를 진행하면 현재 화면의 편집 내용(저장 전 변경사항)이 초기화될 수 있습니다.\n계속 진행하시겠습니까?"
      );
      if (!ok) return;
    }

    setLoading(true);
    try {
      const rows = await parseExcelTemplates(file);
      if (!rows.length) {
        setInfoMsg("엑셀에서 유효 데이터가 없습니다. (templates 시트/헤더를 확인하세요)");
        return;
      }

      // ✅ 1) 업로드 데이터로 즉시 화면 생성(참고용 컨텐츠 표시)
      const { map, codes } = groupRowsToUi(rows);
      const first = codes[0] || "";

      if (first) {
        const firstGroup = map.get(first)!;
        setSelectedFormCode(first);
        setFormName(firstGroup.formName ?? "");
        setItems(firstGroup.items ?? []);
        setDirty(false);
        setInfoMsg(`엑셀을 읽어 화면에 반영했습니다. (첫 폼: ${first})`);
      } else {
        setSelectedFormCode("");
        setFormName("");
        setItems([]);
        setDirty(false);
        setInfoMsg("엑셀은 읽었지만 formCode가 없습니다.");
      }

      // ✅ 2) 동시에 DB 저장(upsert)
      const savedCount = await upsertGroupedToDb(db, uid, map);

      // ✅ 3) 템플릿 DB 기준 목록 갱신 + 첫 코드 유지
      await reloadFromTemplateDb(false);
      if (first) {
        // 갱신 후에도 첫 코드로 로드해서 "DB 저장 반영"을 확인할 수 있게 함
        await onSelectFormCode(first);
      }

      setInfoMsg(`업로드 완료: ${savedCount}개 템플릿 저장 및 화면 반영 완료 (첫 폼: ${first || "-"})`);
    } catch (e: any) {
      setErrorMsg(e?.message ?? "엑셀 업로드 실패");
    } finally {
      setLoading(false);
    }
  };

  const canUse = !loading && !loadingAuth && !!uid;

  // UI class (기존 스타일 유지)
  const card =
    "rounded-2xl border border-slate-200 bg-white text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100";
  const subText = "text-slate-600 dark:text-slate-400";
  const input =
    "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-slate-500";
  const btnBase = "inline-flex items-center justify-center rounded-xl px-4 py-2 text-sm font-semibold transition";
  const btnPrimary = canUse
    ? "bg-slate-900 text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
    : "bg-slate-200 text-slate-500 cursor-not-allowed dark:bg-slate-800 dark:text-slate-400 cursor-not-allowed";
  const btnOutline = canUse
    ? "bg-white text-slate-900 border border-slate-300 hover:bg-slate-50 dark:bg-slate-900 dark:text-slate-100 dark:border-slate-600 dark:hover:bg-slate-800"
    : "bg-slate-200 text-slate-500 cursor-not-allowed dark:bg-slate-800 dark:text-slate-400 cursor-not-allowed";

  return (
    <main className="px-6 pb-10">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Manage Structure Templates</h1>
            <div className={`mt-2 text-xs ${subText}`}>
              ※ 이 메뉴는 <span className="font-mono">{MANAGE_TEMPLATES_COLLECTION}</span>만 사용합니다.
              <br />
              ※ 엑셀 업로드 시 이 화면(표)에 즉시 반영되며, 동시에 DB에도 저장됩니다.
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button onClick={() => reloadFromTemplateDb(true)} disabled={!canUse} className={`${btnBase} ${btnOutline}`}>
              다시 가져오기
            </button>
            <button onClick={onResetTemplate} disabled={!canUse} className={`${btnBase} ${btnOutline}`}>
              템플릿 초기화
            </button>
            <button onClick={onSave} disabled={!canUse} className={`${btnBase} ${btnPrimary}`}>
              저장
            </button>
          </div>
        </div>

        {/* Upload */}
        <div className="mt-4 flex flex-wrap gap-2">
          <button onClick={onClickUpload} disabled={!canUse} className={`${btnBase} ${btnOutline}`}>
            엑셀 업로드
          </button>
          <input
            ref={uploadRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.currentTarget.value = "";
              if (!f) return;
              onUploadExcel(f);
            }}
          />
        </div>

        {loadingAuth && (
          <div className="mt-6 rounded-xl border border-slate-200 p-4 text-sm dark:border-slate-700">
            로그인 상태 확인 중...
          </div>
        )}

        {!loadingAuth && !uid && (
          <div className="mt-6 rounded-xl border border-slate-200 p-4 text-sm dark:border-slate-700">로그인이 필요합니다.</div>
        )}

        {errorMsg ? (
          <div className="mt-6 rounded-xl border border-rose-300 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-900/40 dark:bg-rose-900/20 dark:text-rose-200">
            {errorMsg}
          </div>
        ) : null}

        {infoMsg ? (
          <div className="mt-6 rounded-xl border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-900/20 dark:text-emerald-200">
            {infoMsg}
          </div>
        ) : null}

        <section className={`mt-8 p-4 ${card}`}>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div>
              <div className="text-sm font-semibold">Form Code</div>
              <div className={`mt-1 text-xs ${subText}`}>
                Source: <span className="font-mono">{MANAGE_TEMPLATES_COLLECTION}</span>
              </div>

              <select
                className={`${input} mt-3`}
                value={selectedFormCode}
                onChange={(e) => onSelectFormCode(e.target.value)}
                disabled={!canUse}
              >
                {formCodes.length === 0 ? <option value="">(없음)</option> : null}
                {formCodes.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>

              <div className={`mt-2 text-xs ${subText}`}>
                문서:{" "}
                <span className="font-mono">
                  {MANAGE_TEMPLATES_COLLECTION}/{selectedFormCode || "-"}
                </span>
              </div>
            </div>

            <div className="md:col-span-2">
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold">Form Name (optional)</div>
                {dirty ? <span className="text-xs font-semibold text-amber-600 dark:text-amber-300">저장 전 변경됨</span> : null}
              </div>

              <input
                className={`${input} mt-3`}
                value={formName}
                onChange={(e) => {
                  setFormName(e.target.value);
                  setDirty(true);
                }}
                placeholder="예: Adverse Events (선택)"
                disabled={!canUse}
              />
            </div>
          </div>

          <div className="mt-6">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold">Reference Contents (Template Items)</div>
                <div className={`mt-1 text-xs ${subText}`}>
                  ※ 엑셀 업로드 후 여기 표에 즉시 반영되어야 정상입니다.
                </div>
              </div>
              <button onClick={addItem} disabled={!canUse} className={`${btnBase} ${btnOutline}`}>
                + 행 추가
              </button>
            </div>

            <div className="mt-4 overflow-auto rounded-xl border border-slate-200 dark:border-slate-700">
              <table className="min-w-[980px] w-full border-separate border-spacing-0">
                <thead className="bg-slate-50 dark:bg-slate-800">
                  <tr>
                    <th className={`sticky top-0 z-10 border-b border-slate-200 px-3 py-2 text-left text-xs font-semibold ${subText} dark:border-slate-700`}>
                      Content Name
                    </th>
                    <th className={`sticky top-0 z-10 border-b border-slate-200 px-3 py-2 text-left text-xs font-semibold ${subText} dark:border-slate-700`}>
                      Variable Code
                    </th>
                    <th className={`sticky top-0 z-10 border-b border-slate-200 px-3 py-2 text-left text-xs font-semibold ${subText} dark:border-slate-700`}>
                      Note
                    </th>
                    <th className={`sticky top-0 z-10 border-b border-slate-200 px-3 py-2 text-right text-xs font-semibold ${subText} dark:border-slate-700`}>
                      Actions
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {items.length === 0 ? (
                    <tr>
                      <td colSpan={4} className={`px-3 py-10 text-center text-sm ${subText}`}>
                        참고용 컨텐츠가 없습니다. 엑셀 업로드 또는 +행 추가 후 저장하세요.
                      </td>
                    </tr>
                  ) : (
                    items.map((it, idx) => (
                      <tr key={it.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/60">
                        <td className="border-b border-slate-200 px-3 py-2 dark:border-slate-700">
                          <input
                            className={input}
                            value={it.contentName}
                            onChange={(e) => updateItem(it.id, { contentName: e.target.value })}
                            disabled={!canUse}
                          />
                        </td>
                        <td className="border-b border-slate-200 px-3 py-2 dark:border-slate-700">
                          <input
                            className={input}
                            value={it.contentCode}
                            onChange={(e) => updateItem(it.id, { contentCode: e.target.value })}
                            disabled={!canUse}
                          />
                        </td>
                        <td className="border-b border-slate-200 px-3 py-2 dark:border-slate-700">
                          <input
                            className={input}
                            value={it.note}
                            onChange={(e) => updateItem(it.id, { note: e.target.value })}
                            disabled={!canUse}
                          />
                        </td>
                        <td className="border-b border-slate-200 px-3 py-2 text-right dark:border-slate-700">
                          <div className="inline-flex gap-2">
                            <button
                              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
                              onClick={() => moveItem(it.id, "up")}
                              disabled={!canUse || idx === 0}
                              type="button"
                            >
                              ↑
                            </button>
                            <button
                              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
                              onClick={() => moveItem(it.id, "down")}
                              disabled={!canUse || idx === items.length - 1}
                              type="button"
                            >
                              ↓
                            </button>
                            <button
                              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
                              onClick={() => removeItem(it.id)}
                              disabled={!canUse}
                              type="button"
                            >
                              삭제
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className={`mt-3 text-xs ${subText}`}>
              엑셀 컬럼: <span className="font-mono">formCode, formName, contentName, contentCode, note</span> (templates 시트)
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
