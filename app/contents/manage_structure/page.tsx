"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
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

/**
 * ✅ 프로젝트에 맞게 아래 import 경로만 맞춰주시면 됩니다.
 * - 기존 프로젝트에서 사용 중인 firebase client 초기화 모듈을 그대로 사용하세요.
 */
import { getFirebaseAuth, getFirebaseDb } from "@/lib/firebase/client"; // TODO: 프로젝트 경로에 맞게 필요시 수정

/**
 * =========================
 * [핵심 컬렉션]
 * =========================
 *
 * 1) SDTM DB 관리에서 FormCode를 읽어오는 소스 컬렉션
 *    - 프로젝트마다 다르므로 아래 상수만 맞추시면 됩니다.
 *
 * 2) manage_structure 템플릿 저장 컬렉션 (서비스 공용 마스터)
 *    - 여기 데이터가 eContents의 "CRF 가져오기"에서 사용됩니다.
 */
const SDTM_FORMS_COLLECTION = "sdtm_forms"; // TODO: 실제 SDTM DB 관리에서 저장되는 컬렉션명으로 수정
const MANAGE_TEMPLATES_COLLECTION = "manage_structure_templates"; // ✅ 고정(요청하신 템플릿 DB)

/**
 * SDTM 문서에서 FormCode를 찾기 위한 필드 후보
 * - 스키마가 확실하면 1개만 남기셔도 됩니다.
 */
const FORM_CODE_FIELD_CANDIDATES = ["formCode", "FORMCODE", "domain", "DOMAIN", "code", "CODE"] as const;

type TemplateItem = {
  id: string; // UI용 row id (저장 시에도 같이 저장해도 무방)
  contentName: string;
  contentCode: string;
  note: string;
};

type TemplateDoc = {
  formCode: string;
  formName?: string;
  items: Array<{
    contentName: string;
    contentCode: string;
    note: string;
  }>;
  updatedAt?: any;
  updatedBy?: string;
};

function toStr(v: any) {
  return String(v ?? "").trim();
}

function newId(prefix = "r") {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function normalizeFormCode(v: string) {
  return toStr(v).toUpperCase();
}

/**
 * SDTM 컬렉션에서 FormCode 리스트를 로드합니다.
 * - 후보 필드 중 문자열이 있으면 우선 사용
 * - 없으면 문서ID를 FormCode로 fallback
 */
async function fetchSdtmFormCodes(db: any): Promise<string[]> {
  const snap = await getDocs(collection(db, SDTM_FORMS_COLLECTION));

  const codes: string[] = [];

  snap.forEach((d) => {
    const data = d.data() as Record<string, any>;

    const found = FORM_CODE_FIELD_CANDIDATES
      .map((k) => data[k])
      .find((v) => typeof v === "string" && v.trim().length > 0);

    if (typeof found === "string") {
      codes.push(normalizeFormCode(found));
      return;
    }

    // 문서ID 자체가 코드인 경우도 많음
    if (typeof d.id === "string" && d.id.trim().length > 0) {
      codes.push(normalizeFormCode(d.id));
    }
  });

  return Array.from(new Set(codes)).sort((a, b) => a.localeCompare(b));
}

/**
 * 템플릿 문서 로드
 */
async function loadTemplateDoc(db: any, formCode: string): Promise<TemplateDoc | null> {
  const code = normalizeFormCode(formCode);
  if (!code) return null;

  const ref = doc(db, MANAGE_TEMPLATES_COLLECTION, code);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;

  const data = snap.data() as any;

  // items 필드는 배열이어야 함
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

/**
 * 템플릿 문서 저장
 * - 코드에 기본값이 없어야 하므로, 현재 UI 상태 그대로 저장합니다.
 */
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

/**
 * 템플릿 문서 삭제(해당 FormCode 템플릿 초기화)
 */
async function deleteTemplateDoc(db: any, formCode: string) {
  const code = normalizeFormCode(formCode);
  await deleteDoc(doc(db, MANAGE_TEMPLATES_COLLECTION, code));
}

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

  const [uid, setUid] = useState("");
  const [loadingAuth, setLoadingAuth] = useState(true);

  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [infoMsg, setInfoMsg] = useState("");

  // SDTM에서 가져온 FormCode 목록
  const [formCodes, setFormCodes] = useState<string[]>([]);

  // 선택된 FormCode
  const [selectedFormCode, setSelectedFormCode] = useState<string>("");

  // 현재 편집 중인 템플릿(코드 고정값 없음)
  const [formName, setFormName] = useState<string>("");
  const [items, setItems] = useState<TemplateItem[]>([]);

  // 현재 편집 상태가 "저장 전 변경됨"인지 추적
  const [dirty, setDirty] = useState(false);

  /**
   * 로그인 상태
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
   * SDTM에서 FormCode 목록 로드
   */
  const loadFormCodeList = useCallback(
    async (withConfirmIfDirty: boolean) => {
      setErrorMsg("");
      setInfoMsg("");

      if (!db) return setErrorMsg("Firestore 초기화 실패");
      if (!uid) return setErrorMsg("로그인이 필요합니다.");

      if (withConfirmIfDirty && dirty) {
        const ok = window.confirm(
          "다시 가져오기를 진행하면 현재 편집 중인 내용(저장 전 변경사항)이 초기화됩니다.\n계속 진행하시겠습니까?"
        );
        if (!ok) {
          setInfoMsg("취소되었습니다.");
          return;
        }
      }

      setLoading(true);
      try {
        const codes = await fetchSdtmFormCodes(db);
        setFormCodes(codes);

        // 선택 코드가 비어있거나 목록에 없으면 첫 값으로 세팅(단, 자동 편집 내용은 비우기)
        if (!selectedFormCode || !codes.includes(selectedFormCode)) {
          const first = codes[0] ?? "";
          setSelectedFormCode(first);
          setFormName("");
          setItems([]);
          setDirty(false);
        }

        setInfoMsg(`SDTM에서 FormCode ${codes.length}개를 불러왔습니다.`);
      } catch (e: any) {
        setErrorMsg(e?.message ?? "FormCode 불러오기 실패");
      } finally {
        setLoading(false);
      }
    },
    [db, uid, dirty, selectedFormCode]
  );

  // 최초 1회 로드
  useEffect(() => {
    if (!db) return;
    if (!uid) return;
    loadFormCodeList(false);
  }, [db, uid, loadFormCodeList]);

  /**
   * 선택된 FormCode의 템플릿 로드
   * - 템플릿이 없으면 "빈 상태"로 시작 (하드코딩 없음)
   */
  const loadSelectedTemplate = useCallback(
    async (code: string, withConfirmIfDirty: boolean) => {
      setErrorMsg("");
      setInfoMsg("");

      if (!db) return setErrorMsg("Firestore 초기화 실패");
      if (!uid) return setErrorMsg("로그인이 필요합니다.");

      const nextCode = normalizeFormCode(code);
      if (!nextCode) return;

      if (withConfirmIfDirty && dirty) {
        const ok = window.confirm(
          "FormCode를 변경하면 현재 편집 중인 내용(저장 전 변경사항)이 초기화됩니다.\n계속 진행하시겠습니까?"
        );
        if (!ok) return;
      }

      setLoading(true);
      try {
        const tpl = await loadTemplateDoc(db, nextCode);

        setSelectedFormCode(nextCode);

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
          setInfoMsg(`템플릿을 불러왔습니다. (${nextCode})`);
        } else {
          // ✅ 템플릿이 없으면 완전 빈 상태 (하드코딩 없음)
          setFormName("");
          setItems([]);
          setInfoMsg(`저장된 템플릿이 없습니다. (${nextCode}) 빈 상태로 시작합니다.`);
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

  // 선택값 바뀔 때 로드
  useEffect(() => {
    if (!db) return;
    if (!uid) return;
    if (!selectedFormCode) return;
    loadSelectedTemplate(selectedFormCode, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, uid]);

  /**
   * 아이템 조작
   */
  const addItem = () => {
    setItems((prev) => [
      ...prev,
      { id: newId("it"), contentName: "", contentCode: "", note: "" }, // ✅ 빈 행만 추가(하드코딩 없음)
    ]);
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
   * 저장
   */
  const onSave = async () => {
    setErrorMsg("");
    setInfoMsg("");

    if (!db) return setErrorMsg("Firestore 초기화 실패");
    if (!uid) return setErrorMsg("로그인이 필요합니다.");
    if (!selectedFormCode) return setErrorMsg("FormCode를 선택해 주세요.");

    setLoading(true);
    try {
      await saveTemplateDoc(db, uid, selectedFormCode, formName, items);
      setDirty(false);
      setInfoMsg(`저장되었습니다. (${selectedFormCode})`);
    } catch (e: any) {
      setErrorMsg(e?.message ?? "저장 실패");
    } finally {
      setLoading(false);
    }
  };

  /**
   * 템플릿 초기화(문서 삭제)
   */
  const onResetTemplate = async () => {
    setErrorMsg("");
    setInfoMsg("");

    if (!db) return setErrorMsg("Firestore 초기화 실패");
    if (!uid) return setErrorMsg("로그인이 필요합니다.");
    if (!selectedFormCode) return setErrorMsg("FormCode를 선택해 주세요.");

    const ok = window.confirm(
      "이 FormCode의 템플릿을 초기화(삭제)합니다.\n삭제 후에는 eContents에서 가져오기 시 생성할 템플릿이 없습니다.\n계속 진행하시겠습니까?"
    );
    if (!ok) return;

    setLoading(true);
    try {
      await deleteTemplateDoc(db, selectedFormCode);
      setFormName("");
      setItems([]);
      setDirty(false);
      setInfoMsg(`템플릿을 삭제했습니다. (${selectedFormCode})`);
    } catch (e: any) {
      setErrorMsg(e?.message ?? "삭제 실패");
    } finally {
      setLoading(false);
    }
  };

  /**
   * 다시 가져오기: SDTM에서 FormCode 목록 재로딩 + 현재 편집 상태 초기화 경고
   */
  const onReimportCodes = async () => {
    await loadFormCodeList(true);
  };

  const canUse = !loading && !loadingAuth && !!uid;

  // ✅ UI 클래스(기존 스타일과 충돌 최소)
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
              ※ 이 메뉴는 <span className="font-semibold">eContents의 “CRF 가져오기”</span>에서 사용되는
              <span className="font-mono"> {MANAGE_TEMPLATES_COLLECTION}</span> 템플릿(DB)을 관리합니다.
              <br />
              ※ <span className="font-semibold">코드에 기본 콘텐츠/변수는 고정하지 않습니다.</span> (템플릿은 오직 DB로 관리)
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button onClick={onReimportCodes} disabled={!canUse} className={`${btnBase} ${btnOutline}`}>
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

        {/* 선택/편집 영역 */}
        <section className={`mt-8 p-4 ${card}`}>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {/* FormCode 선택 */}
            <div>
              <div className="text-sm font-semibold">Form Code</div>
              <div className={`mt-1 text-xs ${subText}`}>
                SDTM Source: <span className="font-mono">{SDTM_FORMS_COLLECTION}</span>
              </div>

              <select
                className={`${input} mt-3`}
                value={selectedFormCode}
                onChange={(e) => loadSelectedTemplate(e.target.value, true)}
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
                템플릿 저장 위치: <span className="font-mono">{MANAGE_TEMPLATES_COLLECTION}/{selectedFormCode || "-"}</span>
              </div>
            </div>

            {/* Form Name */}
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

          {/* Items Table */}
          <div className="mt-6">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold">Template Items</div>
                <div className={`mt-1 text-xs ${subText}`}>
                  ※ 여기에 입력한 콘텐츠/변수 구성이 eContents의 자동 생성 소스가 됩니다.
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
                        저장된 항목이 없습니다. <span className="font-semibold">+ 행 추가</span>로 템플릿을 구성하세요.
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
                            placeholder="예: 이상반응명"
                            disabled={!canUse}
                          />
                        </td>
                        <td className="border-b border-slate-200 px-3 py-2 dark:border-slate-700">
                          <input
                            className={input}
                            value={it.contentCode}
                            onChange={(e) => updateItem(it.id, { contentCode: e.target.value })}
                            placeholder="예: AETERM"
                            disabled={!canUse}
                          />
                        </td>
                        <td className="border-b border-slate-200 px-3 py-2 dark:border-slate-700">
                          <input
                            className={input}
                            value={it.note}
                            onChange={(e) => updateItem(it.id, { note: e.target.value })}
                            placeholder="예: AE.AETERM"
                            disabled={!canUse}
                          />
                        </td>
                        <td className="border-b border-slate-200 px-3 py-2 text-right dark:border-slate-700">
                          <div className="inline-flex gap-2">
                            <button
                              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
                              onClick={() => moveItem(it.id, "up")}
                              disabled={!canUse || idx === 0}
                              title="위로"
                            >
                              ↑
                            </button>
                            <button
                              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
                              onClick={() => moveItem(it.id, "down")}
                              disabled={!canUse || idx === items.length - 1}
                              title="아래로"
                            >
                              ↓
                            </button>
                            <button
                              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
                              onClick={() => removeItem(it.id)}
                              disabled={!canUse}
                              title="삭제"
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
              ※ 이 페이지에는 “기본 템플릿(하드코딩)”이 없습니다. 템플릿 내용은 모두 DB에 저장/관리됩니다.
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
