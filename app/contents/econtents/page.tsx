"use client";

import React, { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { getFirebaseAuth, getFirebaseDb } from "@/lib/firebase/client";
import * as XLSX from "xlsx";

/**
 * app/contents/econtents/page.tsx
 *
 * ✅ 요구사항 반영
 * 1) Form 목록은 별도 표로 보여주지 않음 (Contents 테이블만)
 * 2) Contents 테이블만 유지 (FormCode 병합 rowSpan)
 * 3) 불러오기 시: CRF 폼정보를 읽어 Form별 "기본 컨텐츠 + SDTM 준하는 변수명" 자동 생성
 * 4) 저장된 내용을 Excel로 다운로드 구현 (xlsx 사용)
 *
 * ✅ Firestore 구조
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
  contentName: string; // 표시 콘텐츠명
  contentCode: string; // SDTM 준 변수명/코드
  note: string; // 비고 (필요시 domain 힌트 등)
};

const CRF_COL = "crf_forms";
const ECONTENTS_COL = "econtents";

function toStr(v: any) {
  return String(v ?? "").trim();
}

function newId(prefix = "r") {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

/**
 * ✅ Form별 기본 콘텐츠 템플릿
 * - contentCode는 "SDTM에 준하는 변수명/코드"를 우선 사용
 * - 일부는 SDTM Domain 변수(AETERM 등), 일부는 흔히 쓰는 TESTCD(SYSBP 등)를 사용
 * - note에는 도메인/힌트를 넣어 확장 시 도움되게 구성
 */
function buildDefaultContents(formCodeRaw: string, formNameRaw: string): Array<Omit<ContentRow, "id">> {
  const formCode = toStr(formCodeRaw).toUpperCase();
  const formName = toStr(formNameRaw);
  const nameLower = formName.toLowerCase();

  // ✅ 템플릿 정의 (대표 도메인 기준)
  const templates: Record<string, Array<{ contentName: string; contentCode: string; note?: string }>> = {
    // Demographics
    DM: [
      { contentName: "성별", contentCode: "SEX", note: "DM.SEX" },
      { contentName: "생년월일", contentCode: "BRTHDTC", note: "DM.BRTHDTC" },
      { contentName: "나이", contentCode: "AGE", note: "DM.AGE" },
      { contentName: "인종", contentCode: "RACE", note: "DM.RACE" },
      { contentName: "민족(해당 시)", contentCode: "ETHNIC", note: "DM.ETHNIC(또는 SUPP)" },
      { contentName: "국가", contentCode: "COUNTRY", note: "DM.COUNTRY" },
    ],

    // Subject Visits (방문/등록/스크리닝 등)
    SV: [
      { contentName: "방문명", contentCode: "VISIT", note: "SV.VISIT" },
      { contentName: "방문번호", contentCode: "VISITNUM", note: "SV.VISITNUM" },
      { contentName: "방문일", contentCode: "SVSTDTC", note: "SV.SVSTDTC" },
      { contentName: "방문종료일(해당 시)", contentCode: "SVENDTC", note: "SV.SVENDTC" },
    ],

    // Informed Consent
    IC: [
      { contentName: "동의서 서명일", contentCode: "ICDTC", note: "SC(또는 SUPP) / 관행 변수" },
      { contentName: "동의 여부", contentCode: "ICYN", note: "관행 변수(기관/EDC마다 상이)" },
    ],

    // Inclusion/Exclusion
    IE: [
      { contentName: "기준구분(포함/제외)", contentCode: "IETEST", note: "IE.IETEST" },
      { contentName: "기준코드", contentCode: "IETESTCD", note: "IE.IETESTCD" },
      { contentName: "충족여부", contentCode: "IEORRES", note: "IE.IEORRES" },
      { contentName: "판정(Yes/No)", contentCode: "IESTRESC", note: "IE.IESTRESC" },
      { contentName: "평가일", contentCode: "IEDTC", note: "IE.IEDTC" },
    ],

    // Vital Signs
    VS: [
      { contentName: "수축기혈압", contentCode: "SYSBP", note: "VS.VSTESTCD=SYSBP" },
      { contentName: "이완기혈압", contentCode: "DIABP", note: "VS.VSTESTCD=DIABP" },
      { contentName: "맥박", contentCode: "PULSE", note: "VS.VSTESTCD=PULSE" },
      { contentName: "체온", contentCode: "TEMP", note: "VS.VSTESTCD=TEMP" },
      { contentName: "호흡수", contentCode: "RESP", note: "VS.VSTESTCD=RESP" },
      { contentName: "측정일시", contentCode: "VSDTC", note: "VS.VSDTC" },
    ],

    // Physical Exam
    PE: [
      { contentName: "검사 항목", contentCode: "PETESTCD", note: "PE.PETESTCD" },
      { contentName: "검사명", contentCode: "PETEST", note: "PE.PETEST" },
      { contentName: "결과", contentCode: "PEORRES", note: "PE.PEORRES" },
      { contentName: "정상여부", contentCode: "PESTRESC", note: "PE.PESTRESC" },
      { contentName: "검사일", contentCode: "PEDTC", note: "PE.PEDTC" },
    ],

    // ECG
    EG: [
      { contentName: "측정항목", contentCode: "EGTESTCD", note: "EG.EGTESTCD" },
      { contentName: "측정명", contentCode: "EGTEST", note: "EG.EGTEST" },
      { contentName: "결과", contentCode: "EGORRES", note: "EG.EGORRES" },
      { contentName: "단위", contentCode: "EGORRESU", note: "EG.EGORRESU" },
      { contentName: "측정일시", contentCode: "EGDTC", note: "EG.EGDTC" },
    ],

    // Laboratory
    LB: [
      { contentName: "검사항목", contentCode: "LBTESTCD", note: "LB.LBTESTCD" },
      { contentName: "검사명", contentCode: "LBTEST", note: "LB.LBTEST" },
      { contentName: "결과", contentCode: "LBORRES", note: "LB.LBORRES" },
      { contentName: "단위", contentCode: "LBORRESU", note: "LB.LBORRESU" },
      { contentName: "정상범위하한", contentCode: "LBSTNRLO", note: "LB.LBSTNRLO" },
      { contentName: "정상범위상한", contentCode: "LBSTNRHI", note: "LB.LBSTNRHI" },
      { contentName: "검사일시", contentCode: "LBDTC", note: "LB.LBDTC" },
    ],

    // Adverse Events
    AE: [
      { contentName: "이상반응명", contentCode: "AETERM", note: "AE.AETERM" },
      { contentName: "MedDRA PT(해당 시)", contentCode: "AEDECOD", note: "AE.AEDECOD" },
      { contentName: "발현일", contentCode: "AESTDTC", note: "AE.AESTDTC" },
      { contentName: "해소일", contentCode: "AEENDTC", note: "AE.AEENDTC" },
      { contentName: "중증도", contentCode: "AESEV", note: "AE.AESEV" },
      { contentName: "인과성", contentCode: "AEREL", note: "AE.AEREL" },
      { contentName: "조치", contentCode: "AEACN", note: "AE.AEACN" },
      { contentName: "중대성(SAE)", contentCode: "AESER", note: "AE.AESER" },
    ],

    // Concomitant Medications
    CM: [
      { contentName: "약물명", contentCode: "CMTRT", note: "CM.CMTRT" },
      { contentName: "투여 시작일", contentCode: "CMSTDTC", note: "CM.CMSTDTC" },
      { contentName: "투여 종료일", contentCode: "CMENDTC", note: "CM.CMENDTC" },
      { contentName: "용량", contentCode: "CMDOSE", note: "CM.CMDOSE" },
      { contentName: "단위", contentCode: "CMDOSU", note: "CM.CMDOSU" },
      { contentName: "투여경로", contentCode: "CMROUTE", note: "CM.CMROUTE" },
      { contentName: "투여빈도", contentCode: "CMFREQ", note: "CM.CMFREQ" },
    ],

    // Medical History
    MH: [
      { contentName: "병력명", contentCode: "MHTERM", note: "MH.MHTERM" },
      { contentName: "시작일", contentCode: "MHSTDTC", note: "MH.MHSTDTC" },
      { contentName: "종료일", contentCode: "MHENDTC", note: "MH.MHENDTC" },
      { contentName: "지속여부(해당 시)", contentCode: "MHONGO", note: "MH.MHONGO (관행/프로토콜 기준)" },
    ],

    // Exposure / Dosing
    EX: [
      { contentName: "투여명", contentCode: "EXTRT", note: "EX.EXTRT" },
      { contentName: "투여 시작일시", contentCode: "EXSTDTC", note: "EX.EXSTDTC" },
      { contentName: "투여 종료일시", contentCode: "EXENDTC", note: "EX.EXENDTC" },
      { contentName: "투여량", contentCode: "EXDOSE", note: "EX.EXDOSE" },
      { contentName: "단위", contentCode: "EXDOSU", note: "EX.EXDOSU" },
      { contentName: "투여경로", contentCode: "EXROUTE", note: "EX.EXROUTE" },
    ],

    // Disposition
    DS: [
      { contentName: "상태구분", contentCode: "DSCAT", note: "DS.DSCAT" },
      { contentName: "상태항목", contentCode: "DSTERM", note: "DS.DSTERM" },
      { contentName: "일자", contentCode: "DSDTC", note: "DS.DSDTC" },
      { contentName: "사유(해당 시)", contentCode: "DSREASND", note: "DS.DSREASND" },
    ],
  };

  // 1) formCode 직접 매칭 우선
  if (templates[formCode]) {
    return templates[formCode].map((t) => ({
      formCode,
      formName,
      contentName: t.contentName,
      contentCode: t.contentCode,
      note: toStr(t.note),
    }));
  }

  // 2) 폼명 키워드 기반 추정 (현장에서 흔함)
  const guess = (code: string) =>
    (templates[code] ?? []).map((t) => ({
      formCode,
      formName,
      contentName: t.contentName,
      contentCode: t.contentCode,
      note: toStr(t.note),
    }));

  if (nameLower.includes("인구") || nameLower.includes("demog")) return guess("DM");
  if (nameLower.includes("활력") || nameLower.includes("vital")) return guess("VS");
  if (nameLower.includes("검사") || nameLower.includes("lab")) return guess("LB");
  if (nameLower.includes("심전") || nameLower.includes("ecg")) return guess("EG");
  if (nameLower.includes("신체") || nameLower.includes("physical")) return guess("PE");
  if (nameLower.includes("이상") || nameLower.includes("adverse")) return guess("AE");
  if (nameLower.includes("병용") || nameLower.includes("concom")) return guess("CM");
  if (nameLower.includes("병력") || nameLower.includes("history")) return guess("MH");
  if (nameLower.includes("투여") || nameLower.includes("dose") || nameLower.includes("exposure")) return guess("EX");
  if (nameLower.includes("스크리닝") || nameLower.includes("방문") || nameLower.includes("visit")) return guess("SV");
  if (nameLower.includes("탈락") || nameLower.includes("종료") || nameLower.includes("disposition")) return guess("DS");
  if (nameLower.includes("선정") || nameLower.includes("제외") || nameLower.includes("inclusion") || nameLower.includes("exclusion"))
    return guess("IE");

  // 3) 최후: 빈 1행
  return [
    {
      formCode,
      formName,
      contentName: "",
      contentCode: "",
      note: "",
    },
  ];
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
   * ✅ 불러오기:
   * - CRF에서 Form 목록을 읽고
   * - Form별 기본 콘텐츠(통상 항목 + SDTM 준 변수명) 자동 생성
   * - 결과를 econtents/{uid}에 저장(덮어쓰기)
   */
  const onLoadFromCrfAndGenerate = async () => {
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

      // ✅ Form별 기본 콘텐츠 자동 생성
      const generatedRows: ContentRow[] = loadedForms.flatMap((f) => {
        const base = buildDefaultContents(f.formCode, f.formName);
        return base.map((b) => ({
          id: newId("c"),
          formCode: b.formCode,
          formName: b.formName,
          contentName: b.contentName,
          contentCode: b.contentCode,
          note: b.note,
        }));
      });

      await setDoc(
        doc(db, ECONTENTS_COL, uid),
        {
          forms: loadedForms,
          rows: generatedRows,
          updatedAt: Date.now(),
          source: "crf_forms+template",
        },
        { merge: false }
      );

      setForms(loadedForms);
      setRows(generatedRows);
      setInfoMsg("CRF Form을 기준으로 기본 콘텐츠를 생성했습니다. 수정 후 저장/엑셀다운로드 하세요.");
    } catch (e: any) {
      setErrorMsg(e?.message ?? "불러오기/생성 실패");
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

  /**
   * ✅ Excel 다운로드 (현재 화면 rows 기준)
   * - Sheet: eContents
   * - Columns: Form Code, Form Name, Content Name, Variable(SDTM), Note
   */
  const onDownloadExcel = () => {
    setErrorMsg("");
    setInfoMsg("");

    if (!rows.length) {
      setInfoMsg("다운로드할 데이터가 없습니다.");
      return;
    }

    try {
      // ✅ 엑셀에 들어갈 2D 배열 구성
      const aoa: any[][] = [];
      aoa.push(["Form Code", "Form Name", "Content Name", "Variable", "Note"]);

      // ✅ FormCode로 정렬(가독성) + 원본 순서 최대 유지
      const sorted = [...rows].sort((a, b) => {
        const ac = toStr(a.formCode).toUpperCase();
        const bc = toStr(b.formCode).toUpperCase();
        if (ac === bc) return 0;
        return ac < bc ? -1 : 1;
      });

      for (const r of sorted) {
        aoa.push([r.formCode, r.formName, r.contentName, r.contentCode, r.note]);
      }

      const ws = XLSX.utils.aoa_to_sheet(aoa);

      // ✅ 열 너비(대략) 지정
      ws["!cols"] = [{ wch: 12 }, { wch: 28 }, { wch: 26 }, { wch: 18 }, { wch: 34 }];

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "eContents");

      const filename = `econtents_${new Date().toISOString().slice(0, 10)}.xlsx`;
      XLSX.writeFile(wb, filename);
      setInfoMsg("엑셀 파일을 다운로드했습니다.");
    } catch (e: any) {
      setErrorMsg(e?.message ?? "엑셀 다운로드 실패");
    }
  };

  /** ✅ 콘텐츠 값 변경 */
  const updateRow = (id: string, patch: Partial<ContentRow>) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };

  /** ✅ 콘텐츠 행 삭제 */
  const removeRow = (id: string) => {
    setRows((prev) => prev.filter((r) => r.id !== id));
  };

  /** ✅ 폼별로 콘텐츠 행 추가(테이블에서 버튼 제공) */
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

  /**
   * ✅ 표 렌더용 그룹(rowSpan)
   * - forms 기반 순서를 우선 유지
   * - rows만 있고 forms가 비어있을 때도 동작하도록 fallback
   */
  const grouped = useMemo(() => {
    const map = new Map<string, ContentRow[]>();
    for (const r of rows) {
      const key = toStr(r.formCode);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(r);
    }

    const orderFromForms = forms.map((f) => toStr(f.formCode)).filter(Boolean);
    const restKeys = Array.from(map.keys()).filter((k) => !orderFromForms.includes(k));
    const keys = [...orderFromForms, ...restKeys].filter((k, i, a) => k && a.indexOf(k) === i);

    return keys.map((k) => ({
      formCode: k,
      formName: (forms.find((f) => toStr(f.formCode) === k)?.formName ?? map.get(k)?.[0]?.formName ?? "").trim(),
      items: map.get(k) ?? [],
    }));
  }, [rows, forms]);

  const canUseButtons = !loading && !loadingUser;

  // ✅ 다크/라이트 전환 시 반전되도록 dark: 사용 (일부만 고정되는 문제 방지)
  const cardCls =
    "rounded-2xl border border-slate-200 bg-white text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100";
  const smallTextCls = "text-slate-600 dark:text-slate-400";
  const tableWrapCls = "overflow-auto rounded-xl border border-slate-200 dark:border-slate-700";
  const theadCls = "bg-slate-50 dark:bg-slate-800";
  const tdBorderCls = "border-b border-slate-200 dark:border-slate-700";
  const hoverRowCls = "hover:bg-slate-50 dark:hover:bg-slate-800/60";
  const inputCls =
    "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-slate-500";

  const btnBase = "inline-flex items-center justify-center rounded-xl px-4 py-2 text-sm font-semibold transition";
  const btnPrimary = canUseButtons
    ? "bg-slate-900 text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
    : "bg-slate-200 text-slate-500 cursor-not-allowed dark:bg-slate-800 dark:text-slate-400 cursor-not-allowed";
  const btnOutline = canUseButtons
    ? "bg-white text-slate-900 border border-slate-300 hover:bg-slate-50 dark:bg-slate-900 dark:text-slate-100 dark:border-slate-600 dark:hover:bg-slate-800"
    : "bg-slate-200 text-slate-500 cursor-not-allowed dark:bg-slate-800 dark:text-slate-400 cursor-not-allowed";

  return (
    <main className="px-6 pb-10">
      <div className="mx-auto max-w-6xl">
        {/* 상단 */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">eContents</h1>
            <div className={`mt-2 text-xs ${smallTextCls}`}>
              ※ <span className="font-semibold">불러오기</span>는 CRF Form을 기준으로 “기본 콘텐츠 + SDTM 준 변수명”을 생성합니다.
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={onLoadFromCrfAndGenerate}
              disabled={!canUseButtons}
              className={`${btnBase} ${btnPrimary}`}
              title={!uid ? "로그인이 필요합니다." : "CRF 불러오기 + 기본 콘텐츠 생성"}
            >
              {loading ? "처리 중..." : "불러오기"}
            </button>

            <button
              onClick={onSave}
              disabled={!canUseButtons}
              className={`${btnBase} ${btnOutline}`}
              title={!uid ? "로그인이 필요합니다." : "eContents 저장"}
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
          <div className="mt-6 rounded-xl border border-rose-300 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-900/40 dark:bg-rose-900/20 dark:text-rose-200">
            {errorMsg}
          </div>
        ) : null}
        {infoMsg ? (
          <div className="mt-6 rounded-xl border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-900/20 dark:text-emerald-200">
            {infoMsg}
          </div>
        ) : null}

        {/* Contents 테이블만 */}
        <section className={`mt-8 p-4 ${cardCls}`}>
          <div className="text-sm font-semibold">Contents</div>
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
                    Variable (SDTM-like)
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
                      데이터가 없습니다. 상단의 <span className="font-semibold">불러오기</span>로 CRF 기반 기본 콘텐츠를 생성하세요.
                    </td>
                  </tr>
                ) : (
                  grouped.flatMap((g) => {
                    const span = g.items.length || 1;

                    return g.items.map((r, idx) => {
                      const showMerged = idx === 0;

                      return (
                        <tr key={r.id} className={hoverRowCls}>
                          {/* Form Code 병합 */}
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

                          {/* Form Name 병합 */}
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
                              placeholder="예: 수축기혈압"
                            />
                          </td>

                          <td className={`${tdBorderCls} px-3 py-2`}>
                            <input
                              value={r.contentCode}
                              onChange={(e) => updateRow(r.id, { contentCode: e.target.value })}
                              className={inputCls}
                              placeholder="예: SYSBP / AETERM / LBTESTCD ..."
                            />
                          </td>

                          <td className={`${tdBorderCls} px-3 py-2`}>
                            <input
                              value={r.note}
                              onChange={(e) => updateRow(r.id, { note: e.target.value })}
                              className={inputCls}
                              placeholder="예: VS.VSTESTCD=SYSBP"
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
            ※ 수정 후 <span className="font-semibold">저장</span> 또는 <span className="font-semibold">엑셀 다운로드</span>를 사용하세요.
          </div>
        </section>
      </div>
    </main>
  );
}
