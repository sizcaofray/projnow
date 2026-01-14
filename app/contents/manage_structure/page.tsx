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
 * ✅ 프로젝트에 맞게 import 경로만 맞춰주세요.
 * - 기존에 쓰시는 firebase client 초기화 모듈을 그대로 사용하시면 됩니다.
 */
import { getFirebaseAuth, getFirebaseDb } from "@/lib/firebase/client"; // TODO: 경로 필요 시 수정

/**
 * =========================
 * [컬렉션 설정]
 * =========================
 */
// ✅ SDTM DB 관리에서 FormCode를 읽어오는 소스 컬렉션명(프로젝트에 맞게 수정)
const SDTM_FORMS_COLLECTION = "sdtm_forms"; // TODO: 실제 컬렉션명으로 변경

// ✅ 관리용 템플릿 테이블(서비스 공용)
const MANAGE_TEMPLATES_COLLECTION = "manage_structure_templates";

/**
 * SDTM 문서에서 FormCode를 찾기 위한 필드 후보
 * - SDTM 스키마가 확실하면 1개만 두셔도 됩니다.
 */
const FORM_CODE_FIELD_CANDIDATES = ["formCode", "FORMCODE", "domain", "DOMAIN", "code", "CODE"] as const;

/**
 * =========================
 * [타입]
 * =========================
 */
type TemplateItem = {
  id: string; // UI용 row id
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

/**
 * =========================
 * [유틸]
 * =========================
 */
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
 * - 코드에 기본값은 없고, 현재 UI 입력 그대로 저장합니다.
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

/**
 * =========================
 * [Excel I/O 스펙]
 * =========================
 * 업로드/다운로드 공통 스펙:
 * - Sheet "templates"
 *   columns: formCode, formName, contentName, contentCode, note
 *
 * 참고 Sheet(템플릿 다운로드에만 포함):
 * - Sheet "sdtm_formcodes"
 *   columns: formCode
 */
type ExcelTemplateRow = {
  formCode: string;
  formName: string;
  contentName: string;
  contentCode: string;
  note: string;
};

/**
 * 엑셀 파일 -> 템플릿 rows 파싱
 */
function parseExcelTemplates(file: File): Promise<ExcelTemplateRow[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    // ✅ 파일 읽기 성공
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: "array" });

        // ✅ "templates" 시트가 우선, 없으면 첫 시트 사용
        const sheetName = wb.SheetNames.includes("templates") ? "templates" : wb.SheetNames[0];
        const ws = wb.Sheets[sheetName];
        if (!ws) return resolve([]);

        // ✅ JSON 변환
        const json = XLSX.utils.sheet_to_json<Record<string, any>>(ws, { defval: "" });

        const rows: ExcelTemplateRow[] = json.map((r) => ({
          formCode: normalizeFormCode(toStr(r.formCode ?? r.FormCode ?? r["Form Code"] ?? r["FORM CODE"])),
          formName: toStr(r.formName ?? r.FormName ?? r["Form Name"] ?? r["FORM NAME"]),
          contentName: toStr(r.contentName ?? r.ContentName ?? r["Content Name"] ?? r["CONTENT NAME"]),
          contentCode: toStr(r.contentCode ?? r.ContentCode ?? r["Content Code"] ?? r["Variable"] ?? r["VARIABLE"]),
          note: toStr(r.note ?? r.Note ?? r["Note"] ?? r["NOTE"]),
        }));

        // ✅ 유효한 row만
        const filtered = rows.filter((x) => x.formCode && (x.contentName || x.contentCode || x.note || x.formName));
        resolve(filtered);
      } catch (err) {
        reject(err);
      }
    };

    // ✅ 파일 읽기 실패
    reader.onerror = () => reject(new Error("엑셀 파일을 읽는 중 오류가 발생했습니다."));

    reader.readAsArrayBuffer(file);
  });
}

/**
 * DB 템플릿 전체 -> 엑셀 다운로드 (기본 내용 포함: DB에 저장된 것)
 */
function downloadTemplatesExcel(allRows: ExcelTemplateRow[], filename: string, sdtmCodes?: string[]) {
  // ✅ templates 시트 구성
  const aoa: any[][] = [];
  aoa.push(["formCode", "formName", "contentName", "contentCode", "note"]);
  for (const r of allRows) {
    aoa.push([r.formCode, r.formName, r.contentName, r.contentCode, r.note]);
  }

  const ws1 = XLSX.utils.aoa_to_sheet(aoa);
  ws1["!cols"] = [{ wch: 12 }, { wch: 28 }, { wch: 26 }, { wch: 18 }, { wch: 34 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws1, "templates");

  // ✅ 참고용 SDTM formcodes 시트(옵션)
  if (Array.isArray(sdtmCodes) && sdtmCodes.length > 0) {
    const aoa2: any[][] = [];
    aoa2.push(["formCode"]);
    for (const c of sdtmCodes) aoa2.push([c]);
    const ws2 = XLSX.utils.aoa_to_sheet(aoa2);
    ws2["!cols"] = [{ wch: 12 }];
    XLSX.utils.book_append_sheet(wb, ws2, "sdtm_formcodes");
  }

  XLSX.writeFile(wb, filename);
}

/**
 * DB의 모든 템플릿 문서를 가져와 ExcelTemplateRow 형태로 펼침
 */
async function fetchAllTemplatesAsRows(db: any): Promise<ExcelTemplateRow[]> {
  const snap = await getDocs(collection(db, MANAGE_TEMPLATES_COLLECTION));
  const out: ExcelTemplateRow[] = [];

  snap.forEach((d) => {
    const data = d.data() as any;
    const formCode = normalizeFormCode(toStr(data?.formCode || d.id));
    const formName = toStr(data?.formName);

    const rawItems = Array.isArray(data?.items) ? data.items : [];
    rawItems.forEach((it: any) => {
      out.push({
        formCode,
        formName,
        contentName: toStr(it?.contentName),
        contentCode: toStr(it?.contentCode),
        note: toStr(it?.note),
      });
    });

    // ✅ items가 없어도 문서가 존재할 수 있으니 최소 1행을 만들지 않습니다(하드코딩 금지/빈값 생성 금지).
  });

  // ✅ 정렬
  out.sort((a, b) => {
    if (a.formCode === b.formCode) return a.contentCode.localeCompare(b.contentCode);
    return a.formCode.localeCompare(b.formCode);
  });

  return out;
}

/**
 * 엑셀 업로드 rows -> formCode별로 묶어 DB에 upsert
 */
async function upsertTemplatesFromRows(db: any, uid: string, rows: ExcelTemplateRow[]) {
  // ✅ formCode 기준 그룹핑
  const map = new Map<string, { formName: string; items: TemplateItem[] }>();

  for (const r of rows) {
    const code = normalizeFormCode(r.formCode);
    if (!code) continue;

    if (!map.has(code)) {
      map.set(code, { formName: toStr(r.formName), items: [] });
    }
    const g = map.get(code)!;

    // formName이 비어있다면 뒤에 온 값으로라도 채움(엑셀에 섞여있을 수 있음)
    if (!g.formName && r.formName) g.formName = toStr(r.formName);

    g.items.push({
      id: newId("it"),
      contentName: toStr(r.contentName),
      contentCode: toStr(r.contentCode),
      note: toStr(r.note),
    });
  }

  // ✅ upsert
  for (const [code, v] of map.entries()) {
    await saveTemplateDoc(db, uid, code, v.formName, v.items);
  }

  return map.size;
}

/**
 * =========================
 * [페이지 컴포넌트]
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

  // SDTM에서 가져온 FormCode 목록
  const [formCodes, setFormCodes] = useState<string[]>([]);

  // 선택된 FormCode
  const [selectedFormCode, setSelectedFormCode] = useState<string>("");

  // 현재 편집 중 템플릿
  const [formName, setFormName] = useState<string>("");
  const [items, setItems] = useState<TemplateItem[]>([]);

  // 저장 전 변경 여부
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

        // ✅ 선택 코드 정리
        if (!selectedFormCode || !codes.includes(selectedFormCode)) {
          const first = codes[0] ?? "";
          setSelectedFormCode(first);
          setFormName("");
          setItems([]);
          setDirty(false);

          // ✅ 첫 코드 템플릿 자동 로드
          if (first) {
            const tpl = await loadTemplateDoc(db, first);
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
            }
          }
        }

        setInfoMsg(`SDTM에서 FormCode ${codes.length}개를 불러왔습니다.`);
      } catch (e: any) {
        // ✅ 권한 오류 메시지 친절히 안내
        const msg = e?.message ?? "FormCode 불러오기 실패";
        setErrorMsg(
          msg.includes("permission") || msg.includes("Missing or insufficient permissions")
            ? "권한이 없습니다. Firestore Rules에서 sdtm_forms(read) 권한을 허용해 주세요."
            : msg
        );
      } finally {
        setLoading(false);
      }
    },
    [db, uid, dirty, selectedFormCode]
  );

  // 최초 로드
  useEffect(() => {
    if (!db) return;
    if (!uid) return;
    loadFormCodeList(false);
  }, [db, uid, loadFormCodeList]);

  /**
   * 선택된 FormCode의 템플릿 로드
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
          // ✅ 템플릿 없으면 빈 상태 (하드코딩 없음)
          setFormName("");
          setItems([]);
          setInfoMsg(`저장된 템플릿이 없습니다. (${nextCode}) 빈 상태로 시작합니다.`);
        }

        setDirty(false);
      } catch (e: any) {
        const msg = e?.message ?? "템플릿 불러오기 실패";
        setErrorMsg(
          msg.includes("permission") || msg.includes("Missing or insufficient permissions")
            ? "권한이 없습니다. Firestore Rules에서 manage_structure_templates(read) 권한을 허용해 주세요."
            : msg
        );
      } finally {
        setLoading(false);
      }
    },
    [db, uid, dirty]
  );

  /**
   * 아이템 조작
   */
  const addItem = () => {
    setItems((prev) => [
      ...prev,
      { id: newId("it"), contentName: "", contentCode: "", note: "" }, // ✅ 빈 행(하드코딩 없음)
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
      const msg = e?.message ?? "저장 실패";
      setErrorMsg(
        msg.includes("permission") || msg.includes("Missing or insufficient permissions")
          ? "권한이 없습니다. Firestore Rules에서 manage_structure_templates(write) 권한을 admin에게 허용해 주세요."
          : msg
      );
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
      "이 FormCode의 템플릿을 초기화(삭제)합니다.\n계속 진행하시겠습니까?"
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
      const msg = e?.message ?? "삭제 실패";
      setErrorMsg(
        msg.includes("permission") || msg.includes("Missing or insufficient permissions")
          ? "권한이 없습니다. Firestore Rules에서 manage_structure_templates(delete/write) 권한을 admin에게 허용해 주세요."
          : msg
      );
    } finally {
      setLoading(false);
    }
  };

  /**
   * 다시 가져오기(SDTM FormCode 목록 재로딩)
   */
  const onReimportCodes = async () => {
    await loadFormCodeList(true);
  };

  /**
   * =========================
   * [엑셀 다운로드] - DB 템플릿 전체(기본 내용 포함)
   * =========================
   */
  const onDownloadAllTemplates = async () => {
    setErrorMsg("");
    setInfoMsg("");

    if (!db) return setErrorMsg("Firestore 초기화 실패");
    if (!uid) return setErrorMsg("로그인이 필요합니다.");

    setLoading(true);
    try {
      const allRows = await fetchAllTemplatesAsRows(db);

      const filename = `manage_structure_templates_${new Date().toISOString().slice(0, 10)}.xlsx`;
      // ✅ sdtm_formcodes 시트도 같이 넣어줌(참고용)
      downloadTemplatesExcel(allRows, filename, formCodes);

      setInfoMsg("DB에 저장된 템플릿 전체를 엑셀로 다운로드했습니다.");
    } catch (e: any) {
      const msg = e?.message ?? "다운로드 실패";
      setErrorMsg(
        msg.includes("permission") || msg.includes("Missing or insufficient permissions")
          ? "권한이 없습니다. Firestore Rules에서 manage_structure_templates(read) 권한을 허용해 주세요."
          : msg
      );
    } finally {
      setLoading(false);
    }
  };

  /**
   * =========================
   * [업로드용 엑셀 템플릿 다운로드]
   * - headers + 참고용 SDTM formcodes 시트
   * - 기본 콘텐츠를 코드에 하드코딩하지 않습니다.
   * =========================
   */
  const onDownloadUploadTemplate = async () => {
    setErrorMsg("");
    setInfoMsg("");

    // ✅ 업로드용은 빈 templates 시트(헤더만) + sdtm_formcodes 시트(참고용)
    const filename = `manage_structure_upload_template_${new Date().toISOString().slice(0, 10)}.xlsx`;
    downloadTemplatesExcel([], filename, formCodes);
    setInfoMsg("업로드용 엑셀 템플릿을 다운로드했습니다. (templates 시트에 내용을 입력 후 업로드)");
  };

  /**
   * =========================
   * [엑셀 업로드]
   * - templates 시트를 읽어 formCode별로 manage_structure_templates에 저장(upsert)
   * =========================
   */
  const onClickUpload = () => {
    if (!uid) {
      setErrorMsg("로그인이 필요합니다.");
      return;
    }
    uploadRef.current?.click();
  };

  const onUploadExcel = async (file: File) => {
    setErrorMsg("");
    setInfoMsg("");

    if (!db) return setErrorMsg("Firestore 초기화 실패");
    if (!uid) return setErrorMsg("로그인이 필요합니다.");

    // ✅ 업로드는 편집 중 내용이 영향을 받을 수 있으므로 confirm
    if (dirty || items.length > 0 || formName) {
      const ok = window.confirm(
        "엑셀 업로드를 진행하면 현재 편집 중인 내용과 DB 템플릿이 변경될 수 있습니다.\n계속 진행하시겠습니까?"
      );
      if (!ok) {
        setInfoMsg("취소되었습니다.");
        return;
      }
    }

    setLoading(true);
    try {
      const rows = await parseExcelTemplates(file);
      if (rows.length === 0) {
        setInfoMsg("업로드한 엑셀에서 유효한 데이터가 없습니다. (templates 시트/컬럼명을 확인하세요)");
        return;
      }

      const count = await upsertTemplatesFromRows(db, uid, rows);

      // ✅ 현재 선택된 코드가 업로드로 변경되었을 수 있으니 재로딩
      if (selectedFormCode) {
        await loadSelectedTemplate(selectedFormCode, false);
      }

      setInfoMsg(`엑셀 업로드 완료: ${count}개 FormCode 템플릿이 저장(업데이트)되었습니다.`);
      setDirty(false);
    } catch (e: any) {
      const msg = e?.message ?? "엑셀 업로드 실패";
      setErrorMsg(
        msg.includes("permission") || msg.includes("Missing or insufficient permissions")
          ? "권한이 없습니다. Firestore Rules에서 manage_structure_templates(write) 권한을 admin에게 허용해 주세요."
          : msg
      );
    } finally {
      setLoading(false);
    }
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
              ※ eContents의 “CRF 가져오기”가 참조하는 템플릿 DB:
              <span className="font-mono"> {MANAGE_TEMPLATES_COLLECTION}</span>
              <br />
              ※ 코드에 기본 콘텐츠를 고정하지 않습니다. <span className="font-semibold">기본 내용</span>은 DB에 저장된 템플릿을 내려받는 방식입니다.
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

        {/* 엑셀 버튼 영역 */}
        <div className="mt-4 flex flex-wrap gap-2">
          <button onClick={onDownloadAllTemplates} disabled={!canUse} className={`${btnBase} ${btnOutline}`}>
            템플릿 전체 다운로드
          </button>
          <button onClick={onDownloadUploadTemplate} disabled={!canUse} className={`${btnBase} ${btnOutline}`}>
            업로드용 템플릿 다운로드
          </button>
          <button onClick={onClickUpload} disabled={!canUse} className={`${btnBase} ${btnOutline}`}>
            엑셀 업로드
          </button>

          {/* ✅ 숨김 파일 업로드 input */}
          <input
            ref={uploadRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              // ✅ 같은 파일 재업로드 가능하도록 value 초기화
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
                템플릿 저장 위치:{" "}
                <span className="font-mono">
                  {MANAGE_TEMPLATES_COLLECTION}/{selectedFormCode || "-"}
                </span>
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
                  ※ 이 항목들이 eContents “CRF 가져오기”의 자동 생성 소스가 됩니다.
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
                              type="button"
                            >
                              ↑
                            </button>
                            <button
                              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
                              onClick={() => moveItem(it.id, "down")}
                              disabled={!canUse || idx === items.length - 1}
                              title="아래로"
                              type="button"
                            >
                              ↓
                            </button>
                            <button
                              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
                              onClick={() => removeItem(it.id)}
                              disabled={!canUse}
                              title="삭제"
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
              ※ 엑셀 업로드/다운로드 스펙: <span className="font-mono">templates</span> 시트에
              <span className="font-mono"> formCode, formName, contentName, contentCode, note</span> 컬럼을 사용합니다.
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
