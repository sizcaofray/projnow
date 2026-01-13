"use client";

import React, { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { getFirebaseAuth, getFirebaseDb } from "@/lib/firebase/client";

/**
 * app/contents/econtents/page.tsx
 *
 * ✅ 반영사항
 * 1) 라이트/다크모드에서 특정 색이 강제되어 안보이는 문제 제거
 *    - text-white, bg-black/... 제거
 *    - dark: 분기 없이 "모드 무관" 중립 색상 사용
 *
 * 2) 불러오기 시 자동 콘텐츠 생성 제거
 *    - 불러오기는 CRF Form 목록(이름/코드)만 로드
 *    - 콘텐츠는 사용자가 폼별 "+ 콘텐츠 추가"로 직접 구성
 *
 * ✅ 저장 구조
 * - CRF(읽기): /crf_forms/{uid}
 * - eContents(저장/불러오기): /econtents/{uid}
 */

type CrfFormRow = {
  id: string;
  formName: string;
  formCode: string;
  repeat?: boolean;
  createdAt?: number;
};

type ContentRow = {
  id: string;
  formCode: string;
  formName: string;
  contentName: string;
  contentCode: string;
  note: string;
};

const CRF_COL = "crf_forms";
const ECONTENTS_COL = "econtents";

function toStr(v: any) {
  return String(v ?? "").trim();
}

function newId(prefix = "r") {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

export default function EContentsPage() {
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

  // ✅ eContents 작업 데이터
  const [forms, setForms] = useState<CrfFormRow[]>([]);
  const [rows, setRows] = useState<ContentRow[]>([]);

  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [infoMsg, setInfoMsg] = useState("");

  // ✅ 로그인 사용자 식별
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

  /**
   * ✅ 페이지 진입 시: econtents/{uid}에 저장된 작업이 있으면 로드
   */
  useEffect(() => {
    const run = async () => {
      setErrorMsg("");
      setInfoMsg("");

      if (!db) return;
      if (!uid) return;

      try {
        const ref = doc(db, ECONTENTS_COL, uid);
        const snap = await getDoc(ref);
        if (!snap.exists()) return;

        const data = snap.data() as any;

        const loadedForms: CrfFormRow[] = Array.isArray(data?.forms)
          ? data.forms
              .map((r: any) => ({
                id: toStr(r?.id) || newId("f"),
                formName: toStr(r?.formName),
                formCode: toStr(r?.formCode),
                repeat: Boolean(r?.repeat),
                createdAt: Number(r?.createdAt ?? Date.now()),
              }))
              .filter((r: CrfFormRow) => !!r.formCode || !!r.formName)
          : [];

        const loadedRows: ContentRow[] = Array.isArray(data?.rows)
          ? data.rows.map((r: any) => ({
              id: toStr(r?.id) || newId("c"),
              formCode: toStr(r?.formCode),
              formName: toStr(r?.formName),
              contentName: toStr(r?.contentName),
              contentCode: toStr(r?.contentCode),
              note: toStr(r?.note),
            }))
          : [];

        setForms(loadedForms);
        setRows(loadedRows);

        if (loadedForms.length || loadedRows.length) {
          setInfoMsg("저장된 eContents 작업을 불러왔습니다.");
        }
      } catch (e: any) {
        setErrorMsg(e?.message ?? "eContents 불러오기 실패");
      }
    };

    run();
  }, [db, uid]);

  /**
   * ✅ 불러오기: CRF에서 Form 목록만 로드 (자동 콘텐츠 생성 X)
   * - 로드 후 econtents/{uid}에 forms만 저장하고 rows는 비움(또는 기존 유지 선택 가능)
   * - 여기서는 요구대로 '폼정보만 불러오기'이므로 rows는 빈 배열로 초기화합니다.
   */
  const onLoadFromCrf = async () => {
    setErrorMsg("");
    setInfoMsg("");

    if (!db) return setErrorMsg("Firestore 초기화 실패");
    if (!uid) return setErrorMsg("로그인이 필요합니다.");

    setLoading(true);
    try {
      const crfRef = doc(db, CRF_COL, uid);
      const crfSnap = await getDoc(crfRef);

      if (!crfSnap.exists()) {
        setForms([]);
        setRows([]);
        setInfoMsg("CRF 저장 데이터가 없습니다. (/contents/crf에서 먼저 저장해 주세요)");
        return;
      }

      const crfData = crfSnap.data() as any;
      const loadedForms: CrfFormRow[] = Array.isArray(crfData?.rows)
        ? crfData.rows
            .map((r: any) => ({
              id: toStr(r?.id) || newId("f"),
              formName: toStr(r?.formName),
              formCode: toStr(r?.formCode),
              repeat: Boolean(r?.repeat),
              createdAt: Number(r?.createdAt ?? Date.now()),
            }))
            .filter((r: CrfFormRow) => !!r.formCode || !!r.formName)
        : [];

      // ✅ rows 자동생성 제거: 폼만 반영, rows는 비움
      const nextRows: ContentRow[] = [];

      await setDoc(
        doc(db, ECONTENTS_COL, uid),
        {
          forms: loadedForms,
          rows: nextRows,
          updatedAt: Date.now(),
          source: "crf_forms",
        },
        { merge: false }
      );

      setForms(loadedForms);
      setRows(nextRows);
      setInfoMsg("CRF Form 정보를 불러왔습니다. 이제 폼별로 콘텐츠를 추가해 구성하세요.");
    } catch (e: any) {
      setErrorMsg(e?.message ?? "불러오기 실패");
    } finally {
      setLoading(false);
    }
  };

  /**
   * ✅ eContents 저장(수정 저장)
   * - 사용자가 콘텐츠를 편집한 뒤 저장할 수 있도록 제공
   */
  const onSave = async () => {
    setErrorMsg("");
    setInfoMsg("");

    if (!db) return setErrorMsg("Firestore 초기화 실패");
    if (!uid) return setErrorMsg("로그인이 필요합니다.");

    setLoading(true);
    try {
      await setDoc(
        doc(db, ECONTENTS_COL, uid),
        {
          forms,
          rows,
          updatedAt: Date.now(),
          source: "manual_edit",
        },
        { merge: false }
      );
      setInfoMsg("eContents가 저장되었습니다.");
    } catch (e: any) {
      setErrorMsg(e?.message ?? "저장 실패");
    } finally {
      setLoading(false);
    }
  };

  /** ✅ 폼별로 콘텐츠 1행 추가 */
  const addContentRow = (formCode: string, formName: string) => {
    setRows((prev) => [
      ...prev,
      {
        id: newId("c"),
        formCode,
        formName,
        contentName: "",
        contentCode: "",
        note: "",
      },
    ]);
  };

  /** ✅ 콘텐츠 값 변경 */
  const updateRow = (id: string, patch: Partial<ContentRow>) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };

  /** ✅ 콘텐츠 행 삭제 */
  const removeRow = (id: string) => {
    setRows((prev) => prev.filter((r) => r.id !== id));
  };

  /**
   * ✅ 표 렌더용 그룹(폼코드 병합 rowSpan)
   * - rows가 없으면 표는 비어있음
   */
  const grouped = useMemo(() => {
    const map = new Map<string, ContentRow[]>();
    for (const r of rows) {
      const key = toStr(r.formCode);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(r);
    }

    // 폼 순서를 우선 유지
    const order = forms.map((f) => toStr(f.formCode)).filter(Boolean);
    const restKeys = Array.from(map.keys()).filter((k) => !order.includes(k));
    const keys = [...order, ...restKeys].filter((k, i, a) => k && a.indexOf(k) === i);

    return keys.map((k) => ({
      formCode: k,
      formName:
        (forms.find((f) => toStr(f.formCode) === k)?.formName ?? map.get(k)?.[0]?.formName ?? "").trim(),
      items: map.get(k) ?? [],
    }));
  }, [rows, forms]);

  const canLoad = !loading && !loadingUser;

  return (
    <main className="px-6 pb-10">
      <div className="mx-auto max-w-6xl">
        {/* 상단 */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">eContents 구성</h1>
            <div className="mt-2 text-sm text-slate-700">
              CRF에서 저장한 <span className="font-semibold">Form Name/Form Code</span>를 불러와 폼별 콘텐츠를 구성합니다.
            </div>
            <div className="mt-2 text-xs text-slate-600">
              ※ 불러오기는 <span className="font-semibold">폼 정보만</span> 가져옵니다. (자동 콘텐츠 생성 없음)
            </div>
          </div>

          <div className="flex gap-2">
            <button
              onClick={onLoadFromCrf}
              disabled={!canLoad}
              className={`inline-flex items-center justify-center rounded-xl px-4 py-2 text-sm font-semibold transition ${
                canLoad ? "bg-slate-900 text-white hover:bg-slate-800" : "bg-slate-200 text-slate-500 cursor-not-allowed"
              }`}
              title={!uid ? "로그인이 필요합니다." : "CRF 폼 불러오기"}
            >
              {loading ? "처리 중..." : "불러오기"}
            </button>

            <button
              onClick={onSave}
              disabled={!canLoad}
              className={`inline-flex items-center justify-center rounded-xl px-4 py-2 text-sm font-semibold transition ${
                canLoad ? "bg-white text-slate-900 border border-slate-300 hover:bg-slate-50" : "bg-slate-200 text-slate-500 cursor-not-allowed"
              }`}
              title={!uid ? "로그인이 필요합니다." : "eContents 저장"}
            >
              저장
            </button>
          </div>
        </div>

        {/* 메시지 */}
        {errorMsg ? (
          <div className="mt-6 rounded-xl border border-rose-300 bg-rose-50 p-4 text-sm text-rose-700">
            {errorMsg}
          </div>
        ) : null}
        {infoMsg ? (
          <div className="mt-6 rounded-xl border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-700">
            {infoMsg}
          </div>
        ) : null}

        {/* Form 목록(폼만 불러오기 요구 대응) */}
        <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-4">
          <div className="flex items-end justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-slate-900">Form 목록</div>
              <div className="mt-1 text-xs text-slate-600">CRF에서 불러온 폼 정보를 표시합니다.</div>
            </div>
            <div className="text-xs text-slate-600">
              총 <span className="font-semibold text-slate-900">{forms.length}</span>개
            </div>
          </div>

          <div className="mt-4 overflow-auto rounded-xl border border-slate-200">
            <table className="min-w-[720px] w-full border-separate border-spacing-0">
              <thead>
                <tr className="bg-slate-50">
                  <th className="border-b border-slate-200 px-3 py-2 text-left text-xs font-semibold text-slate-700">
                    Form Code
                  </th>
                  <th className="border-b border-slate-200 px-3 py-2 text-left text-xs font-semibold text-slate-700">
                    Form Name
                  </th>
                  <th className="border-b border-slate-200 px-3 py-2 text-right text-xs font-semibold text-slate-700">
                    Action
                  </th>
                </tr>
              </thead>
              <tbody>
                {forms.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="px-3 py-8 text-center text-sm text-slate-600">
                      폼 정보가 없습니다. <span className="font-semibold">불러오기</span>를 눌러 CRF 폼을 가져오세요.
                    </td>
                  </tr>
                ) : (
                  forms.map((f) => (
                    <tr key={f.id} className="hover:bg-slate-50">
                      <td className="border-b border-slate-200 px-3 py-2 text-sm text-slate-900 font-semibold">
                        {f.formCode || "-"}
                      </td>
                      <td className="border-b border-slate-200 px-3 py-2 text-sm text-slate-800">
                        {f.formName || "-"}
                      </td>
                      <td className="border-b border-slate-200 px-3 py-2 text-right">
                        <button
                          type="button"
                          onClick={() => addContentRow(f.formCode, f.formName)}
                          className="inline-flex items-center rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50"
                          title="이 Form에 콘텐츠 행 추가"
                        >
                          + 콘텐츠 추가
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* Contents 테이블 */}
        <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-4">
          <div className="text-sm font-semibold text-slate-900">eContents 테이블</div>
          <div className="mt-1 text-xs text-slate-600">
            1행 = 1콘텐츠 / 같은 Form 내 콘텐츠는 Form Code가 병합됩니다.
          </div>

          <div className="mt-4 overflow-auto rounded-xl border border-slate-200">
            <table className="min-w-[980px] w-full border-separate border-spacing-0">
              <thead>
                <tr className="bg-slate-50">
                  <th className="sticky top-0 z-10 border-b border-slate-200 px-3 py-2 text-left text-xs font-semibold text-slate-700">
                    Form Code
                  </th>
                  <th className="sticky top-0 z-10 border-b border-slate-200 px-3 py-2 text-left text-xs font-semibold text-slate-700">
                    Form Name
                  </th>
                  <th className="sticky top-0 z-10 border-b border-slate-200 px-3 py-2 text-left text-xs font-semibold text-slate-700">
                    Content Name
                  </th>
                  <th className="sticky top-0 z-10 border-b border-slate-200 px-3 py-2 text-left text-xs font-semibold text-slate-700">
                    Content Code
                  </th>
                  <th className="sticky top-0 z-10 border-b border-slate-200 px-3 py-2 text-left text-xs font-semibold text-slate-700">
                    Note
                  </th>
                  <th className="sticky top-0 z-10 border-b border-slate-200 px-3 py-2 text-right text-xs font-semibold text-slate-700">
                    Actions
                  </th>
                </tr>
              </thead>

              <tbody>
                {grouped.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-10 text-center text-sm text-slate-600">
                      콘텐츠가 없습니다. 위 Form 목록에서 <span className="font-semibold">+ 콘텐츠 추가</span>로 행을 만드세요.
                    </td>
                  </tr>
                ) : (
                  grouped.flatMap((g) => {
                    const span = g.items.length || 1;

                    return g.items.map((r, idx) => {
                      const showMerged = idx === 0;

                      return (
                        <tr key={r.id} className="hover:bg-slate-50">
                          {/* ✅ Form Code 병합 */}
                          {showMerged ? (
                            <td rowSpan={span} className="align-top border-b border-slate-200 px-3 py-3 text-sm text-slate-900">
                              <div className="font-semibold">{g.formCode}</div>
                              <button
                                type="button"
                                onClick={() => addContentRow(g.formCode, g.formName)}
                                className="mt-2 inline-flex items-center rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-800 hover:bg-slate-50"
                                title="이 Form에 콘텐츠 행 추가"
                              >
                                + 콘텐츠 추가
                              </button>
                            </td>
                          ) : null}

                          {/* ✅ Form Name 병합(가독성) */}
                          {showMerged ? (
                            <td rowSpan={span} className="align-top border-b border-slate-200 px-3 py-3 text-sm text-slate-800">
                              {g.formName || <span className="text-slate-500">-</span>}
                            </td>
                          ) : null}

                          <td className="border-b border-slate-200 px-3 py-2">
                            <input
                              value={r.contentName}
                              onChange={(e) => updateRow(r.id, { contentName: e.target.value })}
                              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
                              placeholder="예: 나이"
                            />
                          </td>

                          <td className="border-b border-slate-200 px-3 py-2">
                            <input
                              value={r.contentCode}
                              onChange={(e) => updateRow(r.id, { contentCode: e.target.value })}
                              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
                              placeholder="예: AGE"
                            />
                          </td>

                          <td className="border-b border-slate-200 px-3 py-2">
                            <input
                              value={r.note}
                              onChange={(e) => updateRow(r.id, { note: e.target.value })}
                              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
                              placeholder="비고"
                            />
                          </td>

                          <td className="border-b border-slate-200 px-3 py-2 text-right">
                            <button
                              type="button"
                              onClick={() => removeRow(r.id)}
                              className="inline-flex items-center rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50"
                              title="이 행 삭제"
                            >
                              삭제
                            </button>
                          </td>
                        </tr>
                      );
                    });
                  })
                )}
              </tbody>
            </table>
          </div>

          <div className="mt-3 text-xs text-slate-600">
            ※ 수정 후 상단의 <span className="font-semibold text-slate-900">저장</span>을 눌러 eContents에 저장하세요.
          </div>
        </section>
      </div>
    </main>
  );
}
