"use client";

import React, { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { getFirebaseAuth, getFirebaseDb } from "@/lib/firebase/client";

/**
 * app/contents/econtents/page.tsx
 *
 * ✅ 요구사항 반영
 * 1) 불러오기 버튼으로 CRF에서 저장된 Form Name/Form Code 로드
 * 2) Form별 콘텐츠 자동 구성(예: 인구학적정보 → AGE/HEIGHT/WEIGHT 등)
 * 3) 콘텐츠 1행=1콘텐츠, 같은 Form 내에서는 Form Code 셀 병합(rowSpan)
 *
 * ✅ 중요: "CRF와 같은 DB 테이블 사용 금지"
 * - CRF는 "읽기"만: crf_forms/{uid}
 * - eContents 작업 저장/불러오기는 별도 컬렉션: econtents/{uid}
 * - 즉, eContents 결과를 crf_forms에 저장하지 않습니다.
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
  contentName: string; // 표시명(예: 나이)
  contentCode: string; // 코드(예: AGE)
  note: string; // 비고
};

const CRF_COL = "crf_forms"; // ✅ CRF 원본(읽기 전용으로 사용)
const ECONTENTS_COL = "econtents"; // ✅ eContents 전용 테이블(저장/불러오기)

function toStr(v: any) {
  return String(v ?? "").trim();
}

function newId(prefix = "r") {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

/** ✅ 폼명/코드 기반으로 "기본 콘텐츠" 자동 구성 */
function buildDefaultContents(formName: string, formCode: string): Omit<ContentRow, "id">[] {
  const name = (formName ?? "").toLowerCase();
  const code = (formCode ?? "").toLowerCase();

  // ✅ 인구학/DM
  const isDemog =
    name.includes("인구") ||
    name.includes("demog") ||
    name.includes("demographic") ||
    code === "dm" ||
    name === "dm";

  if (isDemog) {
    return [
      { formCode, formName, contentName: "성별", contentCode: "SEX", note: "" },
      { formCode, formName, contentName: "생년월일", contentCode: "BRTHDTC", note: "" },
      { formCode, formName, contentName: "나이", contentCode: "AGE", note: "" },
      { formCode, formName, contentName: "키", contentCode: "HEIGHT", note: "" },
      { formCode, formName, contentName: "체중", contentCode: "WEIGHT", note: "" },
      { formCode, formName, contentName: "인종", contentCode: "RACE", note: "" },
    ];
  }

  // ✅ Vital Signs
  const isVs =
    name.includes("활력") ||
    name.includes("vital") ||
    name.includes("v/s") ||
    code === "vs" ||
    name === "vs";

  if (isVs) {
    return [
      { formCode, formName, contentName: "수축기혈압", contentCode: "SYSBP", note: "" },
      { formCode, formName, contentName: "이완기혈압", contentCode: "DIABP", note: "" },
      { formCode, formName, contentName: "맥박", contentCode: "PULSE", note: "" },
      { formCode, formName, contentName: "체온", contentCode: "TEMP", note: "" },
      { formCode, formName, contentName: "호흡수", contentCode: "RESP", note: "" },
    ];
  }

  // ✅ AE
  const isAe = name.includes("이상") || name.includes("adverse") || code === "ae" || name === "ae";
  if (isAe) {
    return [
      { formCode, formName, contentName: "이상반응명", contentCode: "AETERM", note: "" },
      { formCode, formName, contentName: "발현일", contentCode: "AESTDTC", note: "" },
      { formCode, formName, contentName: "해소일", contentCode: "AEENDTC", note: "" },
      { formCode, formName, contentName: "중증도", contentCode: "AESEV", note: "" },
      { formCode, formName, contentName: "인과성", contentCode: "AEREL", note: "" },
    ];
  }

  // ✅ Concomitant Medications
  const isCm =
    name.includes("병용") ||
    name.includes("concom") ||
    name.includes("med") ||
    code === "cm" ||
    name === "cm";
  if (isCm) {
    return [
      { formCode, formName, contentName: "약물명", contentCode: "CMTRT", note: "" },
      { formCode, formName, contentName: "투여 시작일", contentCode: "CMSTDTC", note: "" },
      { formCode, formName, contentName: "투여 종료일", contentCode: "CMENDTC", note: "" },
      { formCode, formName, contentName: "용량", contentCode: "CMDOSE", note: "" },
      { formCode, formName, contentName: "단위", contentCode: "CMDOSU", note: "" },
    ];
  }

  // ✅ 기본(알 수 없음): 빈 1행 제공
  return [{ formCode, formName, contentName: "", contentCode: "", note: "" }];
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

  const [uid, setUid] = useState<string>("");
  const [loadingUser, setLoadingUser] = useState(true);

  // ✅ eContents 작업 데이터 (econtents/{uid})
  const [forms, setForms] = useState<CrfFormRow[]>([]);
  const [rows, setRows] = useState<ContentRow[]>([]);

  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [infoMsg, setInfoMsg] = useState<string>("");

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
   * ✅ 페이지 진입 시: econtents/{uid} 저장된 작업이 있으면 먼저 로드
   * - CRF 테이블이 아니라 econtents 테이블에서 불러옵니다.
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
   * ✅ 불러오기 버튼:
   * - CRF에서 저장한 Form을 "읽기"로 가져오고
   * - eContents 기본 콘텐츠를 생성한 뒤
   * - 결과는 반드시 econtents/{uid}에 저장(덮어쓰기)
   */
  const onLoadFromCrf = async () => {
    setErrorMsg("");
    setInfoMsg("");

    if (!db) return setErrorMsg("Firestore 초기화 실패");
    if (!uid) return setErrorMsg("로그인이 필요합니다.");

    setLoading(true);
    try {
      // 1) CRF 원본(읽기)
      const crfRef = doc(db, CRF_COL, uid);
      const crfSnap = await getDoc(crfRef);

      if (!crfSnap.exists()) {
        setForms([]);
        setRows([]);
        setInfoMsg("CRF 저장 데이터가 없습니다. (/contents/crf에서 먼저 저장해 주세요)");
        return;
      }

      const crfData = crfSnap.data() as any;
      const loaded: CrfFormRow[] = Array.isArray(crfData?.rows)
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

      // 2) Form별 기본 콘텐츠 생성
      const nextRows: ContentRow[] = loaded.flatMap((f) => {
        const defaults = buildDefaultContents(f.formName, f.formCode);
        return defaults.map((d) => ({
          id: newId("c"),
          formCode: d.formCode,
          formName: d.formName,
          contentName: d.contentName,
          contentCode: d.contentCode,
          note: d.note,
        }));
      });

      // 3) ✅ eContents 전용 테이블에 저장(중요)
      await setDoc(
        doc(db, ECONTENTS_COL, uid),
        {
          forms: loaded,
          rows: nextRows,
          updatedAt: Date.now(),
          source: "crf_forms", // ✅ 추적용(기능상 필수는 아님)
        },
        { merge: false }
      );

      // 4) 화면 반영
      setForms(loaded);
      setRows(nextRows);
      setInfoMsg("CRF Form을 불러와 eContents를 생성했고, eContents 테이블에 저장했습니다.");
    } catch (e: any) {
      setErrorMsg(e?.message ?? "불러오기 실패");
    } finally {
      setLoading(false);
    }
  };

  /** ✅ 특정 Form 아래 콘텐츠 1행 추가 */
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

  /** ✅ 렌더링용: FormCode 단위 그룹핑(병합 rowSpan 계산용) */
  const grouped = useMemo(() => {
    const map = new Map<string, ContentRow[]>();
    for (const r of rows) {
      const key = toStr(r.formCode);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(r);
    }

    // forms 순서를 우선 유지
    const order = forms.map((f) => toStr(f.formCode)).filter(Boolean);
    const restKeys = Array.from(map.keys()).filter((k) => !order.includes(k));
    const keys = [...order, ...restKeys].filter((k, i, a) => k && a.indexOf(k) === i);

    return keys.map((k) => ({
      formCode: k,
      formName: (forms.find((f) => toStr(f.formCode) === k)?.formName ?? map.get(k)?.[0]?.formName ?? "").trim(),
      items: map.get(k) ?? [],
    }));
  }, [rows, forms]);

  const canLoad = useMemo(() => !loading && !loadingUser, [loading, loadingUser]);

  return (
    <main className="px-6 pb-10">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">eContents 구성</h1>
            <div className="mt-2 text-sm text-white/70">
              <span className="text-white/60">CRF 저장 Form을 불러와</span>{" "}
              <span className="text-white/80 font-medium">Form별 콘텐츠를 구성</span>합니다.
            </div>

            {/* ✅ 불러오기 안내(덮어쓰기) */}
            <div className="mt-2 text-xs text-white/55">
              ※ <span className="text-white/70 font-medium">불러오기</span>를 누르면 현재 화면 구성은{" "}
              <span className="text-white/70 font-medium">CRF 기반으로 다시 생성</span>되며, 결과는{" "}
              <span className="text-white/70 font-medium">econtents 테이블</span>에 저장됩니다.
            </div>
          </div>

          <button
            onClick={onLoadFromCrf}
            disabled={!canLoad}
            className={`mt-4 sm:mt-0 inline-flex items-center justify-center rounded-xl px-5 py-2.5 text-sm font-semibold transition ${
              canLoad ? "bg-white text-black hover:bg-white/90" : "bg-white/20 text-white/50 cursor-not-allowed"
            }`}
            title={!uid ? "로그인이 필요합니다." : "CRF 저장 Form 불러오기"}
          >
            {loading ? "불러오는 중..." : "불러오기"}
          </button>
        </div>

        {/* 메시지 */}
        {errorMsg ? (
          <div className="mt-6 rounded-xl border border-red-400/30 bg-red-500/10 p-4 text-sm text-red-200">
            {errorMsg}
          </div>
        ) : null}
        {infoMsg ? (
          <div className="mt-6 rounded-xl border border-emerald-400/30 bg-emerald-500/10 p-4 text-sm text-emerald-100">
            {infoMsg}
          </div>
        ) : null}

        {/* 상단 요약 */}
        <div className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-3">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="text-xs text-white/60">Forms</div>
            <div className="mt-1 text-sm font-semibold text-white">{forms.length}개</div>
            <div className="mt-1 text-xs text-white/60">eContents에 로드된 Form 수</div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="text-xs text-white/60">Contents Rows</div>
            <div className="mt-1 text-sm font-semibold text-white">{rows.length}행</div>
            <div className="mt-1 text-xs text-white/60">콘텐츠(행 단위) 총합</div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="text-xs text-white/60">Merge</div>
            <div className="mt-1 text-sm font-semibold text-white">Form Code 병합</div>
            <div className="mt-1 text-xs text-white/60">같은 Form은 rowSpan으로 표시</div>
          </div>
        </div>

        {/* 테이블 */}
        <section className="mt-8 rounded-2xl border border-white/10 bg-white/5 p-4">
          <div className="text-sm font-semibold text-white">eContents 테이블</div>
          <div className="mt-1 text-xs text-white/60">
            1행 = 1콘텐츠 / 같은 Form 내 콘텐츠는 Form Code 셀 병합(rowSpan)
          </div>

          <div className="mt-4 overflow-auto rounded-xl border border-white/10">
            <table className="min-w-[980px] w-full border-separate border-spacing-0">
              <thead>
                <tr className="bg-black/20">
                  <th className="sticky top-0 z-10 border-b border-white/10 px-3 py-2 text-left text-xs font-semibold text-white/80">
                    Form Code
                  </th>
                  <th className="sticky top-0 z-10 border-b border-white/10 px-3 py-2 text-left text-xs font-semibold text-white/80">
                    Form Name
                  </th>
                  <th className="sticky top-0 z-10 border-b border-white/10 px-3 py-2 text-left text-xs font-semibold text-white/80">
                    Content Name
                  </th>
                  <th className="sticky top-0 z-10 border-b border-white/10 px-3 py-2 text-left text-xs font-semibold text-white/80">
                    Content Code
                  </th>
                  <th className="sticky top-0 z-10 border-b border-white/10 px-3 py-2 text-left text-xs font-semibold text-white/80">
                    Note
                  </th>
                  <th className="sticky top-0 z-10 border-b border-white/10 px-3 py-2 text-right text-xs font-semibold text-white/80">
                    Actions
                  </th>
                </tr>
              </thead>

              <tbody>
                {grouped.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-10 text-center text-sm text-white/60">
                      아직 데이터가 없습니다. 우측 상단의 <span className="text-white/80 font-semibold">불러오기</span>를 눌러
                      CRF Form을 가져오세요.
                    </td>
                  </tr>
                ) : (
                  grouped.map((g) =>
                    g.items.map((r, idx) => {
                      const span = g.items.length || 1;
                      const showMerged = idx === 0;

                      return (
                        <tr key={r.id} className="hover:bg-white/5">
                          {/* ✅ Form Code 병합 */}
                          {showMerged ? (
                            <td
                              rowSpan={span}
                              className="align-top border-b border-white/10 px-3 py-3 text-sm text-white/85"
                            >
                              <div className="font-semibold">{g.formCode}</div>

                              {/* ✅ 같은 Form 아래 콘텐츠 추가 */}
                              <button
                                type="button"
                                onClick={() => addContentRow(g.formCode, g.formName)}
                                className="mt-2 inline-flex items-center rounded-lg border border-white/15 bg-white/5 px-2.5 py-1 text-xs text-white/80 hover:bg-white/10"
                                title="이 Form에 콘텐츠 행 추가"
                              >
                                + 콘텐츠 추가
                              </button>
                            </td>
                          ) : null}

                          {/* ✅ Form Name도 같이 병합(가독성) */}
                          {showMerged ? (
                            <td
                              rowSpan={span}
                              className="align-top border-b border-white/10 px-3 py-3 text-sm text-white/80"
                            >
                              {g.formName || <span className="text-white/40">-</span>}
                            </td>
                          ) : null}

                          {/* Content Name */}
                          <td className="border-b border-white/10 px-3 py-2">
                            <input
                              value={r.contentName}
                              onChange={(e) => updateRow(r.id, { contentName: e.target.value })}
                              className="w-full rounded-lg border border-white/15 bg-black/20 px-3 py-2 text-sm text-white/90 outline-none focus:border-white/30"
                              placeholder="예: 나이"
                            />
                          </td>

                          {/* Content Code */}
                          <td className="border-b border-white/10 px-3 py-2">
                            <input
                              value={r.contentCode}
                              onChange={(e) => updateRow(r.id, { contentCode: e.target.value })}
                              className="w-full rounded-lg border border-white/15 bg-black/20 px-3 py-2 text-sm text-white/90 outline-none focus:border-white/30"
                              placeholder="예: AGE"
                            />
                          </td>

                          {/* Note */}
                          <td className="border-b border-white/10 px-3 py-2">
                            <input
                              value={r.note}
                              onChange={(e) => updateRow(r.id, { note: e.target.value })}
                              className="w-full rounded-lg border border-white/15 bg-black/20 px-3 py-2 text-sm text-white/90 outline-none focus:border-white/30"
                              placeholder="비고"
                            />
                          </td>

                          {/* Actions */}
                          <td className="border-b border-white/10 px-3 py-2 text-right">
                            <button
                              type="button"
                              onClick={() => removeRow(r.id)}
                              className="inline-flex items-center rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-xs text-white/80 hover:bg-white/10"
                              title="이 행 삭제"
                            >
                              삭제
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )
                )}
              </tbody>
            </table>
          </div>

          <div className="mt-3 text-xs text-white/50">
            ※ eContents 작업 데이터는 <span className="text-white/70 font-medium">econtents</span> 테이블에 저장됩니다.
            (CRF 테이블에 저장하지 않음)
          </div>
        </section>
      </div>
    </main>
  );
}
