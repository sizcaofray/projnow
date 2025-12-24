"use client";

import React, { useMemo, useRef, useState } from "react";

/**
 * app/contents/econtents/page.tsx
 *
 * ✅ 기능
 * - DOCX 우선, 없으면 PDF
 * - 템플릿 XLSX 함께 업로드
 * - API 호출 후 생성된 XLSX 다운로드
 *
 * ✅ 보강(로직만)
 * 1) DOCX 선택 시 PDF 자동 초기화(혼동 방지)
 * 2) 같은 파일 재선택 시에도 onChange가 동작하도록 input value 초기화(ref)
 * 3) 서버가 Content-Disposition으로 파일명을 주면 그 파일명으로 다운로드
 */
export default function EContentsPage() {
  // 업로드 파일 상태
  const [docx, setDocx] = useState<File | null>(null);
  const [pdf, setPdf] = useState<File | null>(null);
  const [template, setTemplate] = useState<File | null>(null);

  // UI 상태
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string>("");

  // ✅ input ref (같은 파일 재선택 가능하도록 value reset)
  const docxInputRef = useRef<HTMLInputElement | null>(null);
  const pdfInputRef = useRef<HTMLInputElement | null>(null);
  const templateInputRef = useRef<HTMLInputElement | null>(null);

  // DOCX 우선 규칙에 따른 실제 입력 파일 표시용
  const activeInputLabel = useMemo(() => {
    if (docx) return `DOCX: ${docx.name}`;
    if (pdf) return `PDF: ${pdf.name}`;
    return "입력 파일 없음";
  }, [docx, pdf]);

  /**
   * DOCX 파일 선택 핸들러
   * - ✅ DOCX 선택 시 PDF는 자동 초기화(혼동 방지)
   * - ✅ 같은 파일 재선택 가능하도록 input value 비움
   */
  const onPickDocx = (f: File | null) => {
    setErrorMsg("");
    setDocx(f);

    // ✅ DOCX가 우선이므로, PDF는 자동 초기화
    if (f) setPdf(null);

    // ✅ 같은 파일을 다시 선택할 때 change가 안 뜨는 문제 방지
    if (docxInputRef.current) docxInputRef.current.value = "";
    if (pdfInputRef.current) pdfInputRef.current.value = "";
  };

  /**
   * PDF 파일 선택 핸들러
   * - DOCX가 없을 때만 사용되는 fallback
   * - ✅ PDF 선택 시 DOCX가 이미 있으면 그대로 두되, 안내 라벨은 DOCX가 우선
   */
  const onPickPdf = (f: File | null) => {
    setErrorMsg("");
    setPdf(f);

    if (pdfInputRef.current) pdfInputRef.current.value = "";
  };

  /**
   * eContents 템플릿 XLSX 선택 핸들러
   */
  const onPickTemplate = (f: File | null) => {
    setErrorMsg("");
    setTemplate(f);

    if (templateInputRef.current) templateInputRef.current.value = "";
  };

  /**
   * Content-Disposition에서 파일명 파싱
   */
  const getFilenameFromDisposition = (disposition: string | null) => {
    if (!disposition) return null;

    // 예: attachment; filename="xxx.xlsx"
    const m1 = disposition.match(/filename="([^"]+)"/i);
    if (m1?.[1]) return m1[1];

    // 예: attachment; filename=xxx.xlsx
    const m2 = disposition.match(/filename=([^;]+)/i);
    if (m2?.[1]) return m2[1].trim();

    return null;
  };

  /**
   * 생성 실행
   * - 템플릿 XLSX 필수
   * - 입력은 DOCX 우선, 없으면 PDF
   * - API 응답(blob)을 다운로드
   */
  const onGenerate = async () => {
    try {
      setErrorMsg("");

      if (!template) {
        setErrorMsg("eContents 템플릿 XLSX 파일을 업로드해 주세요.");
        return;
      }
      if (!docx && !pdf) {
        setErrorMsg("프로토콜 DOCX 또는 PDF 중 하나를 업로드해 주세요. (DOCX 우선)");
        return;
      }

      setIsLoading(true);

      const fd = new FormData();
      fd.append("template", template);

      // ✅ DOCX 우선
      if (docx) fd.append("docx", docx);
      else if (pdf) fd.append("pdf", pdf);

      const res = await fetch("/api/econtents/generate", {
        method: "POST",
        body: fd,
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.message ?? "생성 요청에 실패했습니다.");
      }

      // ✅ 서버가 내려주는 파일명 우선 적용
      const dispo = res.headers.get("content-disposition");
      const serverFilename = getFilenameFromDisposition(dispo);

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);

      const a = document.createElement("a");
      a.href = url;
      a.download = serverFilename || "econtents_generated.xlsx";
      document.body.appendChild(a);
      a.click();
      a.remove();

      window.URL.revokeObjectURL(url);
    } catch (e: any) {
      setErrorMsg(e?.message ?? "알 수 없는 오류가 발생했습니다.");
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * ✅ 아래 return 영역은 사용자님 기존 마크업을 유지하셔야 합니다.
   * 현재 return은 예시이므로, 실제 UI 컴포넌트에 ref/onChange/onClick만 연결하세요.
   */
  return (
    <div>
      <div style={{ marginBottom: 8 }}>선택된 입력: {activeInputLabel}</div>
      {errorMsg && <div style={{ color: "red", marginBottom: 8 }}>{errorMsg}</div>}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input
          ref={docxInputRef}
          type="file"
          accept=".docx"
          onChange={(e) => onPickDocx(e.target.files?.[0] ?? null)}
        />
        <input
          ref={pdfInputRef}
          type="file"
          accept=".pdf"
          onChange={(e) => onPickPdf(e.target.files?.[0] ?? null)}
        />
        <input
          ref={templateInputRef}
          type="file"
          accept=".xlsx"
          onChange={(e) => onPickTemplate(e.target.files?.[0] ?? null)}
        />
        <button onClick={onGenerate} disabled={isLoading}>
          {isLoading ? "생성 중..." : "eContents 생성"}
        </button>
      </div>
    </div>
  );
}
