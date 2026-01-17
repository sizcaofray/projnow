// app/contents/navigation/page.tsx
// Navigation (Visit x Form Matrix)
// ✅ 요구사항
// 1) 초기 생성은 "Form 불러오기"가 기준 (템플릿 업로드는 초기 생성 절차에 포함 X)
// 2) 방문(Visit)은 사용자가 "방문 생성"으로 추가
// 3) 사용자별 저장/불러오기: /navigation/{uid}
// 4) CRF 저장 데이터 읽기: /crf_forms/{uid}
// 5) 엑셀 다운로드: 현재 저장된 표를 매트릭스 형태로 다운로드
// ✅ UI 원칙
// - 모드(다크/라이트)에 의존하지 않도록 dark: 사용 금지
// - 배경색 강제하지 않음
// - 창 크기 강제하지 않음 (레이아웃은 남는 영역에 맞춰 자연스럽게)
// - 불필요한 스크롤 방지: 표 영역만 overflow 처리

"use client";

import React, { useEffect, useMemo, useState } from "react"; // React
import { onAuthStateChanged } from "firebase/auth"; // Firebase Auth
import { doc, getDoc, setDoc } from "firebase/firestore"; // Firestore
import { getFirebaseAuth, getFirebaseDb } from "@/lib/firebase/client"; // 프로젝트 표준 client 유틸
import * as XLSX from "xlsx"; // Excel

/**
 * Firestore 구조
 * - CRF(읽기): /crf_forms/{uid}
 * - Navigation(저장/불러오기): /navigation/{uid}
 */

type CrfFormRow = {
  id: string;
  formName: string;
  formCode: string;
  repeat?: boolean;
  createdAt?: number;
};

type NavColumn = {
  formCode: string;
  formName: string;
  order: number;
};

type NavVisit = {
  id: string;
  visitCode: string;
  visitName: string;
  order: number;
};

type NavDoc = {
  columns: NavColumn[];
  visits: NavVisit[];
  // cells[visitId][formCode] = "V" | "" | 기타 텍스트
  cells: Record<string, Record<string, string>>;
  updatedAt?: number;
  source?: string;
};

const CRF_COL = "crf_forms";
const NAV_COL = "navigation";

function toStr(v: any) {
  return String(v ?? "").trim();
}

function newId(prefix = "v") {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

// ✅ formCode 정렬용(안정적인 표시)
function sortByFormCode(a: NavColumn, b: NavColumn) {
  const ac = toStr(a.formCode).toUpperCase();
  const bc = toStr(b.formCode).toUpperCase();
  if (ac === bc) return a.order - b.order;
  return ac < bc ? -1 : 1;
}

export default function NavigationPage() {
  // ✅ Firebase 인스턴스
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

  // ✅ 로그인 UID
  const [uid, setUid] = useState("");
  const [loadingUser, setLoadingUser] = useState(true);

  // ✅ Navigation 상태
  const [columns, setColumns] = useState<NavColumn[]>([]);
  const [visits, setVisits] = useState<NavVisit[]>([]);
  const [cells, setCells] = useState<Record<string, Record<string, string>>>({});

  // ✅ 방문 생성 입력값(간단 인라인)
  const [newVisitCode, setNewVisitCode] = useState("");
  const [newVisitName, setNewVisitName] = useState("");

  // ✅ UI 상태
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
   * ✅ 페이지 진입 시: navigation/{uid} 저장된 작업 로드
   */
  useEffect(() => {
    const run = async () => {
      setErrorMsg("");
      setInfoMsg("");

      if (!db) return;
      if (!uid) return;

      try {
        const ref = doc(db, NAV_COL, uid);
        const snap = await getDoc(ref);
        if (!snap.exists()) return;

        const data = snap.data() as any;

        const loadedColumns: NavColumn[] = Array.isArray(data?.columns)
          ? data.columns
              .map((c: any, idx: number) => ({
                formCode: toStr(c?.formCode),
                formName: toStr(c?.formName),
                order: Number(c?.order ?? idx),
              }))
              .filter((c: NavColumn) => !!c.formCode)
          : [];

        const loadedVisits: NavVisit[] = Array.isArray(data?.visits)
          ? data.visits
              .map((v: any, idx: number) => ({
                id: toStr(v?.id) || newId("v"),
                visitCode: toStr(v?.visitCode),
                visitName: toStr(v?.visitName),
                order: Number(v?.order ?? idx),
              }))
              .filter((v: NavVisit) => !!v.id)
          : [];

        const loadedCells: Record<string, Record<string, string>> =
          data?.cells && typeof data.cells === "object" ? data.cells : {};

        setColumns(loadedColumns.sort(sortByFormCode));
        setVisits([...loadedVisits].sort((a, b) => a.order - b.order));
        setCells(loadedCells);

        if (loadedColumns.length || loadedVisits.length) {
          setInfoMsg("저장된 Navigation 작업을 불러왔습니다.");
        }
      } catch (e: any) {
        setErrorMsg(e?.message ?? "Navigation 불러오기 실패");
      }
    };

    run();
  }, [db, uid]);

  const canUseButtons = !loading && !loadingUser;

  /**
   * ✅ 셀 값 변경
   * - visitId, formCode에 해당하는 셀 문자열을 갱신
   */
  const updateCell = (visitId: string, formCode: string, value: string) => {
    setCells((prev) => {
      const next = { ...prev };
      const row = { ...(next[visitId] ?? {}) };
      row[formCode] = value;
      next[visitId] = row;
      return next;
    });
  };

  /**
   * ✅ 방문 생성
   * - 사용자가 직접 Visit Code/Name 입력 후 생성
   */
  const onAddVisit = () => {
    setErrorMsg("");
    setInfoMsg("");

    const visitCode = toStr(newVisitCode);
    const visitName = toStr(newVisitName);

    if (!visitCode && !visitName) {
      setInfoMsg("Visit Code 또는 Visit Name을 입력해 주세요.");
      return;
    }

    const id = newId("v");

    setVisits((prev) => [
      ...prev,
      {
        id,
        visitCode,
        visitName,
        order: prev.length ? Math.max(...prev.map((p) => p.order)) + 1 : 0,
      },
    ]);

    // ✅ 새 방문의 cells 초기화
    setCells((prev) => ({ ...prev, [id]: { ...(prev[id] ?? {}) } }));

    // ✅ 입력값 초기화
    setNewVisitCode("");
    setNewVisitName("");
  };

  /**
   * ✅ 방문 삭제
   */
  const onRemoveVisit = (visitId: string) => {
    setVisits((prev) => prev.filter((v) => v.id !== visitId));
    setCells((prev) => {
      const next = { ...prev };
      delete next[visitId];
      return next;
    });
  };

  /**
   * ✅ 방문 정보 수정
   */
  const updateVisit = (visitId: string, patch: Partial<NavVisit>) => {
    setVisits((prev) => prev.map((v) => (v.id === visitId ? { ...v, ...patch } : v)));
  };

  /**
   * ✅ Form 불러오기 (CRF에서 사용자 폼 목록 읽기)
   * - CRF의 rows에서 formCode/formName 추출
   * - 기존 columns가 있으면 formCode 기준 merge
   *   - 같은 formCode: formName 최신화
   *   - 없는 formCode: 추가
   * - 기존 visits/cells는 유지
   * - 새로 추가된 formCode에 대해 각 visit row는 기본값 ""로 접근(저장 시 자동 반영)
   */
  const onLoadFormsFromCrf = async () => {
    setErrorMsg("");
    setInfoMsg("");

    if (!db) return setErrorMsg("Firestore 초기화 실패");
    if (!uid) return setErrorMsg("로그인이 필요합니다.");

    setLoading(true);
    try {
      const crfRef = doc(db, CRF_COL, uid);
      const crfSnap = await getDoc(crfRef);

      if (!crfSnap.exists()) {
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

      // ✅ CRF 폼을 columns로 변환
      const incoming: NavColumn[] = loadedForms
        .filter((f) => !!toStr(f.formCode))
        .map((f, idx) => ({
          formCode: toStr(f.formCode).toUpperCase(),
          formName: toStr(f.formName),
          order: idx,
        }));

      // ✅ merge: 기존 columns를 formCode 기준으로 갱신/추가
      setColumns((prev) => {
        const map = new Map<string, NavColumn>();
        const baseOrder = prev.length ? Math.max(...prev.map((p) => p.order)) + 1 : 0;

        // 기존 등록
        for (const c of prev) {
          map.set(toStr(c.formCode).toUpperCase(), {
            formCode: toStr(c.formCode).toUpperCase(),
            formName: toStr(c.formName),
            order: Number.isFinite(c.order) ? c.order : baseOrder,
          });
        }

        // CRF에서 들어온 것 반영
        let addCount = 0;
        for (const inc of incoming) {
          const key = toStr(inc.formCode).toUpperCase();
          if (!key) continue;

          if (map.has(key)) {
            // ✅ 동일 formCode면 폼명 최신화(빈값이면 유지)
            const cur = map.get(key)!;
            map.set(key, {
              ...cur,
              formName: toStr(inc.formName) || cur.formName,
            });
          } else {
            // ✅ 신규 formCode는 뒤에 추가
            map.set(key, {
              formCode: key,
              formName: toStr(inc.formName),
              order: baseOrder + addCount,
            });
            addCount += 1;
          }
        }

        return Array.from(map.values()).sort(sortByFormCode);
      });

      setInfoMsg("CRF Form을 불러와 Form 컬럼을 구성했습니다. 방문은 '방문 생성'으로 추가하세요.");
    } catch (e: any) {
      setErrorMsg(e?.message ?? "Form 불러오기 실패");
    } finally {
      setLoading(false);
    }
  };

  /**
   * ✅ Navigation 저장(사용자별)
   * - /navigation/{uid}에 덮어쓰기 저장
   */
  const onSave = async () => {
    setErrorMsg("");
    setInfoMsg("");

    if (!db) return setErrorMsg("Firestore 초기화 실패");
    if (!uid) return setErrorMsg("로그인이 필요합니다.");

    setLoading(true);
    try {
      const payload: NavDoc = {
        columns,
        visits,
        cells,
        updatedAt: Date.now(),
        source: "manual_edit",
      };

      await setDoc(doc(db, NAV_COL, uid), payload, { merge: false });
      setInfoMsg("Navigation이 저장되었습니다.");
    } catch (e: any) {
      setErrorMsg(e?.message ?? "저장 실패");
    } finally {
      setLoading(false);
    }
  };

  /**
   * ✅ 엑셀 다운로드
   * - 업로드 템플릿이 "초기 생성 절차"가 아니므로,
   *   여기서는 Navigation 매트릭스 표 형태로 고정 출력합니다.
   *
   * 출력 포맷(권장 고정):
   * Row 1: Visit Code | Visit Name | (Form Name...)...
   * Row 2: (빈칸)     | Form Code  | (Form Code...)...
   * Row 3~: visitCode | visitName  | cell...
   */
  const onDownloadExcel = () => {
    setErrorMsg("");
    setInfoMsg("");

    if (!columns.length) {
      setInfoMsg("다운로드할 Form 컬럼이 없습니다. 먼저 'Form 불러오기'를 실행하세요.");
      return;
    }

    try {
      // ✅ 헤더 구성
      const headerFormNames = columns.map((c) => toStr(c.formName) || toStr(c.formCode));
      const headerFormCodes = columns.map((c) => toStr(c.formCode));

      const aoa: any[][] = [];
      aoa.push(["Visit Code", "Visit Name", ...headerFormNames]);
      aoa.push(["", "Form Code", ...headerFormCodes]);

      // ✅ 방문 행 구성(visit order 유지)
      const visitRows = [...visits].sort((a, b) => a.order - b.order);

      for (const v of visitRows) {
        const rowCells = columns.map((c) => toStr(cells?.[v.id]?.[c.formCode] ?? ""));
        aoa.push([toStr(v.visitCode), toStr(v.visitName), ...rowCells]);
      }

      const ws = XLSX.utils.aoa_to_sheet(aoa);

      // ✅ 열 너비 대략 지정(가독성)
      const colsWidth = [
        { wch: 14 }, // Visit Code
        { wch: 26 }, // Visit Name
        ...columns.map(() => ({ wch: 14 })), // Form columns
      ];
      (ws as any)["!cols"] = colsWidth;

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Navigation");

      const filename = `navigation_${new Date().toISOString().slice(0, 10)}.xlsx`;
      XLSX.writeFile(wb, filename);

      setInfoMsg("엑셀 파일을 다운로드했습니다.");
    } catch (e: any) {
      setErrorMsg(e?.message ?? "엑셀 다운로드 실패");
    }
  };

  // ✅ 테이블 렌더용: 방문 정렬
  const sortedVisits = useMemo(() => {
    return [...visits].sort((a, b) => a.order - b.order);
  }, [visits]);

  // ✅ 표 wrapper: 가로/세로 overflow를 이 영역에만 제한
  const tableWrapCls = "overflow-auto rounded-xl border";
  const inputCls =
    "w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-0 focus:border-slate-400";
  const cellInputCls =
    "w-full min-w-[84px] rounded-md border px-2 py-1 text-sm outline-none focus:ring-0 focus:border-slate-400";

  const btnBase = "inline-flex items-center justify-center rounded-xl px-4 py-2 text-sm font-semibold transition";
  const btnPrimary = canUseButtons ? "border bg-slate-900 text-white hover:opacity-90" : "border bg-slate-200 text-slate-500 cursor-not-allowed";
  const btnOutline = canUseButtons ? "border bg-white text-slate-900 hover:bg-slate-50" : "border bg-slate-200 text-slate-500 cursor-not-allowed";

  return (
    <main className="px-6 pb-10">
      <div className="mx-auto max-w-6xl">
        {/* 상단 */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold">Navigation</h1>
            <div className="mt-2 text-xs opacity-75">
              ※ <span className="font-semibold">Form 불러오기</span>로 CRF의 Form 컬럼을 구성하고,
              방문은 <span className="font-semibold">방문 생성</span>으로 추가하세요.
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={onLoadFormsFromCrf}
              disabled={!canUseButtons}
              className={`${btnBase} ${btnPrimary}`}
              title={!uid ? "로그인이 필요합니다." : "CRF Form 불러오기"}
            >
              {loading ? "처리 중..." : "Form 불러오기"}
            </button>

            <button
              onClick={onSave}
              disabled={!canUseButtons}
              className={`${btnBase} ${btnOutline}`}
              title={!uid ? "로그인이 필요합니다." : "Navigation 저장"}
            >
              저장
            </button>

            <button
              onClick={onDownloadExcel}
              disabled={!canUseButtons}
              className={`${btnBase} ${btnOutline}`}
              title="엑셀 다운로드"
            >
              엑셀 다운로드
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

        {/* 방문 생성 */}
        <section className="mt-8 rounded-2xl border p-4">
          <div className="text-sm font-semibold">방문 생성</div>
          <div className="mt-1 text-xs opacity-75">
            Visit Code/Name을 입력하고 추가하세요. (빈 값도 허용되지만, 최소 1개는 입력 권장)
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <div>
              <div className="text-xs font-semibold opacity-75">Visit Code</div>
              <input
                value={newVisitCode}
                onChange={(e) => setNewVisitCode(e.target.value)}
                className={inputCls}
                placeholder="예: V1 / SCR / BASELINE"
              />
            </div>

            <div>
              <div className="text-xs font-semibold opacity-75">Visit Name</div>
              <input
                value={newVisitName}
                onChange={(e) => setNewVisitName(e.target.value)}
                className={inputCls}
                placeholder="예: Screening / Baseline"
              />
            </div>

            <div className="flex items-end">
              <button
                type="button"
                onClick={onAddVisit}
                disabled={!canUseButtons}
                className={`${btnBase} ${btnOutline} w-full`}
                title="방문 추가"
              >
                방문 생성
              </button>
            </div>
          </div>
        </section>

        {/* 매트릭스 표 */}
        <section className="mt-8 rounded-2xl border p-4">
          <div className="text-sm font-semibold">Visit × Form Matrix</div>
          <div className="mt-1 text-xs opacity-75">
            셀 값은 <span className="font-semibold">V</span> 또는 임의 텍스트를 입력할 수 있습니다.
            (예: V / N/A / Excluded / Memo 등)
          </div>

          <div className={`mt-4 ${tableWrapCls}`}>
            <table className="min-w-[980px] w-full border-separate border-spacing-0">
              <thead>
                <tr className="bg-slate-50">
                  <th className="sticky top-0 z-10 border-b px-3 py-2 text-left text-xs font-semibold">
                    Visit Code
                  </th>
                  <th className="sticky top-0 z-10 border-b px-3 py-2 text-left text-xs font-semibold">
                    Visit Name
                  </th>

                  {columns.map((c) => (
                    <th
                      key={c.formCode}
                      className="sticky top-0 z-10 border-b px-3 py-2 text-left text-xs font-semibold"
                      title={c.formCode}
                    >
                      <div className="text-xs font-semibold">{toStr(c.formName) || c.formCode}</div>
                      <div className="mt-0.5 text-[11px] opacity-70">{c.formCode}</div>
                    </th>
                  ))}

                  <th className="sticky top-0 z-10 border-b px-3 py-2 text-right text-xs font-semibold">
                    Actions
                  </th>
                </tr>
              </thead>

              <tbody>
                {sortedVisits.length === 0 ? (
                  <tr>
                    <td colSpan={3 + columns.length} className="px-3 py-10 text-center text-sm opacity-70">
                      방문이 없습니다. 상단의 <span className="font-semibold">방문 생성</span>으로 행을 추가하세요.
                    </td>
                  </tr>
                ) : (
                  sortedVisits.map((v) => (
                    <tr key={v.id} className="hover:bg-slate-50">
                      <td className="border-b px-3 py-2 align-top">
                        <input
                          value={v.visitCode}
                          onChange={(e) => updateVisit(v.id, { visitCode: e.target.value })}
                          className={cellInputCls}
                          placeholder="V1"
                        />
                      </td>

                      <td className="border-b px-3 py-2 align-top">
                        <input
                          value={v.visitName}
                          onChange={(e) => updateVisit(v.id, { visitName: e.target.value })}
                          className={cellInputCls}
                          placeholder="Screening"
                        />
                      </td>

                      {columns.map((c) => (
                        <td key={`${v.id}_${c.formCode}`} className="border-b px-3 py-2 align-top">
                          <input
                            value={toStr(cells?.[v.id]?.[c.formCode] ?? "")}
                            onChange={(e) => updateCell(v.id, c.formCode, e.target.value)}
                            className={cellInputCls}
                            placeholder=""
                            title="예: V"
                          />
                        </td>
                      ))}

                      <td className="border-b px-3 py-2 text-right align-top">
                        <button
                          type="button"
                          onClick={() => onRemoveVisit(v.id)}
                          className="inline-flex items-center rounded-lg border bg-white px-3 py-2 text-xs font-semibold hover:bg-slate-50"
                          title="이 방문 행 삭제"
                        >
                          삭제
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="mt-3 text-xs opacity-75">
            ※ 수정 후 <span className="font-semibold">저장</span> 또는 <span className="font-semibold">엑셀 다운로드</span>를 사용하세요.
          </div>
        </section>
      </div>
    </main>
  );
}
