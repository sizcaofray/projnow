"use client";

import React, { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { getFirebaseAuth, getFirebaseDb } from "@/lib/firebase/client";

/**
 * ✅ 반영사항
 * 1) 다크/라이트 전환 시 모든 영역이 반전되도록 dark: 색상 대응 추가
 * 2) 불러오기 = CRF의 Form Name/Form Code만 로드 (자동 콘텐츠 생성 X)
 * 3) eContents는 별도 테이블(/econtents/{uid})에 저장/수정 저장
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
   * ✅ 페이지 진입 시: econtents/{uid} 저장된 작업 로드
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
   * - 결과는 econtents/{uid}에 forms만 저장 + rows는 빈 배열로 초기화
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

      const nextRows: ContentRow[] = []; // ✅ 자동 생성 제거

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
      setInfoMsg("CRF Form 정보를 불러왔습니다. 폼별로 콘텐츠를 추가해 구성하세요.");
    } catch (e: any) {
      setErrorMsg(e?.message ?? "불러오기 실패");
    } finally {
      setLoading(false);
    }
  };

  /**
   * ✅ eContents 저장(수정 저장)
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

  const updateRow = (id: string, patch: Partial<ContentRow>) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };

  const removeRow = (id: string) => {
    setRows((prev) => prev.filter((r) => r.id !== id));
  };

  // ✅ 그룹(rowSpan) 계산
  const grouped = useMemo(() => {
    const map = new Map<string, ContentRow[]>();
    for (const r of rows) {
      const key = toStr(r.formCode);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(r);
    }

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

  // ✅ 공통 색상(라이트/다크 반전)
  const cardCls =
    "rounded-2xl border border-slate-200 bg-white text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100";
  const subTextCls = "text-slate-700 dark:text-slate-300";
  const smallTextCls = "text-slate-600 dark:text-slate-400";
  const tableWrapCls = "overflow-auto rounded-xl border border-slate-200 dark:border-slate-700";
  const theadCls = "bg-slate-50 dark:bg-slate-800";
  const tdBorderCls = "border-b border-slate-200 dark:border-slate-700";
  const hoverRowCls = "hover:bg-slate-50 dark:hover:bg-slate-800/60";
  const inputCls =
    "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-slate-500";
  const btnLightCls =
    "inline-flex items-center justify-center rounded-xl px-4 py-2 text-sm font-semibold transition";
  const btnPrimaryCls = canLoad
    ? "bg-slate-900 text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
    : "bg-slate-200 text-slate-500 cursor-not-allowed dark:bg-slate-800 dark:text-slate-400 cursor-not-allowed";
  const btnOutlineCls = canLoad
    ? "bg-white text-slate-900 border border-slate-300 hover:bg-slate-50 dark:bg-slate-900 dark:text-slate-100 dark:border-slate-600 dark:hover:bg-slate-800"
    : "bg-slate-200 text-slate-500 cursor-not-allowed dark:bg-slate-800 dark:text-slate-400 cursor-not-allowed";

  return (
    <main className="px-6 pb-10">
      <div className="mx-auto max-w-6xl">
        {/* 상단 */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">eContents 구성</h1>
            <div className={`mt-2 text-sm ${subTextCls}`}>
              CRF에서 저장한 <span className="font-semibold">Form Name/Form Code</span>를 불러와 폼별 콘텐츠를 구성합니다.
            </div>
            <div className={`mt-2 text-xs ${smallTextCls}`}>
              ※ 불러오기는 <span className="font-semibold">폼 정보만</span> 가져옵니다. (자동 콘텐츠 생성 없음)
            </div>
          </div>

          <div className="flex gap-2">
            <button
              onClick={onLoadFromCrf}
              disabled={!canLoad}
              className={`${btnLightCls} ${btnPrimaryCls}`}
              title={!uid ? "로그인이 필요합니다." : "CRF 폼 불러오기"}
            >
              {loading ? "처리 중..." : "불러오기"}
            </button>

            <button
              onClick={onSave}
              disabled={!canLoad}
              className={`${btnLightCls} ${btnOutlineCls}`}
              title={!uid ? "로그인이 필요합니다." : "eContents 저장"}
            >
              저장
            </button>
          </div>
        </div>

        {/* 메시지 */}
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

        {/* Form 목록 */}
        <section className={`mt-8 p-4 ${cardCls}`}>
          <div className="flex items-end justify-between gap-3">
            <div>
              <div className="text-sm font-semibold">Form 목록</div>
              <div className={`mt-1 text-xs ${smallTextCls}`}>CRF에서 불러온 폼 정보를 표시합니다.</div>
            </div>
            <div className={`text-xs ${smallTextCls}`}>
              총 <span className="font-semibold">{forms.length}</span>개
            </div>
          </div>

          <div className={`mt-4 ${tableWrapCls}`}>
            <table className="min-w-[720px] w-full border-separate border-spacing-0">
              <thead>
                <tr className={theadCls}>
                  <th className={`${tdBorderCls} px-3 py-2 text-left text-xs font-semibold ${smallTextCls}`}>Form Code</th>
                  <th className={`${tdBorderCls} px-3 py-2 text-left text-xs font-semibold ${smallTextCls}`}>Form Name</th>
                  <th className={`${tdBorderCls} px-3 py-2 text-right text-xs font-semibold ${smallTextCls}`}>Action</th>
                </tr>
              </thead>
              <tbody>
                {forms.length === 0 ? (
                  <tr>
                    <td colSpan={3} className={`px-3 py-8 text-center text-sm ${smallTextCls}`}>
                      폼 정보가 없습니다. <span className="font-semibold">불러오기</span>로 CRF 폼을 가져오세요.
                    </td>
                  </tr>
                ) : (
                  forms.map((f) => (
                    <tr key={f.id} className={hoverRowCls}>
                      <td className={`${tdBorderCls} px-3 py-2 text-sm font-semibold`}>{f.formCode || "-"}</td>
                      <td className={`${tdBorderCls} px-3 py-2 text-sm`}>{f.formName || "-"}</td>
                      <td className={`${tdBorderCls} px-3 py-2 text-right`}>
                        <button
                          type="button"
                          onClick={() => addContentRow(f.formCode, f.formName)}
                          className="inline-flex items-center rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
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
        <section className={`mt-8 p-4 ${cardCls}`}>
          <div className="text-sm font-semibold">eContents 테이블</div>
          <div className={`mt-1 text-xs ${smallTextCls}`}>
            1행 = 1콘텐츠 / 같은 Form 내 콘텐츠는 Form Code가 병합됩니다.
          </div>

          <div className={`mt-4 ${tableWrapCls}`}>
            <table className="min-w-[980px] w-full border-separate border-spacing-0">
              <thead>
                <tr className={theadCls}>
                  <th className={`sticky top-0 z-10 ${tdBorderCls} px-3 py-2 text-left text-xs font-semibold ${smallTextCls}`}>
                    Form Code
                  </th>
                  <th className={`sticky top-0 z-10 ${tdBorderCls} px-3 py-2 text-left text-xs font-semibold ${smallTextCls}`}>
                    Form Name
                  </th>
                  <th className={`sticky top-0 z-10 ${tdBorderCls} px-3 py-2 text-left text-xs font-semibold ${smallTextCls}`}>
                    Content Name
                  </th>
                  <th className={`sticky top-0 z-10 ${tdBorderCls} px-3 py-2 text-left text-xs font-semibold ${smallTextCls}`}>
                    Content Code
                  </th>
                  <th className={`sticky top-0 z-10 ${tdBorderCls} px-3 py-2 text-left text-xs font-semibold ${smallTextCls}`}>
                    Note
                  </th>
                  <th className={`sticky top-0 z-10 ${tdBorderCls} px-3 py-2 text-right text-xs font-semibold ${smallTextCls}`}>
                    Actions
                  </th>
                </tr>
              </thead>

              <tbody>
                {grouped.length === 0 ? (
                  <tr>
                    <td colSpan={6} className={`px-3 py-10 text-center text-sm ${smallTextCls}`}>
                      콘텐츠가 없습니다. 위 Form 목록에서 <span className="font-semibold">+ 콘텐츠 추가</span>로 행을 만드세요.
                    </td>
                  </tr>
                ) : (
                  grouped.flatMap((g) => {
                    const span = g.items.length || 1;

                    return g.items.map((r, idx) => {
                      const showMerged = idx === 0;

                      return (
                        <tr key={r.id} className={hoverRowCls}>
                          {showMerged ? (
                            <td rowSpan={span} className={`align-top ${tdBorderCls} px-3 py-3 text-sm`}>
                              <div className="font-semibold">{g.formCode}</div>
                              <button
                                type="button"
                                onClick={() => addContentRow(g.formCode, g.formName)}
                                className="mt-2 inline-flex items-center rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-800 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
                                title="이 Form에 콘텐츠 행 추가"
                              >
                                + 콘텐츠 추가
                              </button>
                            </td>
                          ) : null}

                          {showMerged ? (
                            <td rowSpan={span} className={`align-top ${tdBorderCls} px-3 py-3 text-sm`}>
                              {g.formName || <span className={smallTextCls}>-</span>}
                            </td>
                          ) : null}

                          <td className={`${tdBorderCls} px-3 py-2`}>
                            <input
                              value={r.contentName}
                              onChange={(e) => updateRow(r.id, { contentName: e.target.value })}
                              className={inputCls}
                              placeholder="예: 나이"
                            />
                          </td>

                          <td className={`${tdBorderCls} px-3 py-2`}>
                            <input
                              value={r.contentCode}
                              onChange={(e) => updateRow(r.id, { contentCode: e.target.value })}
                              className={inputCls}
                              placeholder="예: AGE"
                            />
                          </td>

                          <td className={`${tdBorderCls} px-3 py-2`}>
                            <input
                              value={r.note}
                              onChange={(e) => updateRow(r.id, { note: e.target.value })}
                              className={inputCls}
                              placeholder="비고"
                            />
                          </td>

                          <td className={`${tdBorderCls} px-3 py-2 text-right`}>
                            <button
                              type="button"
                              onClick={() => removeRow(r.id)}
                              className="inline-flex items-center rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
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

          <div className={`mt-3 text-xs ${smallTextCls}`}>
            ※ 수정 후 상단의 <span className="font-semibold">저장</span>을 눌러 eContents에 저장하세요.
          </div>
        </section>
      </div>
    </main>
  );
}
