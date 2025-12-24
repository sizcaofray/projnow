"use client";

import React, { useMemo, useState } from "react";

/**
 * eContents 생성 UI 로직(삽입용)
 * - DOCX 우선, 없으면 PDF
 * - 템플릿 XLSX를 함께 업로드
 * - API 호출 후 생성된 XLSX 다운로드
 *
 * 주의:
 * - 사용자님 요청대로 "마크업/디자인 변경 없이" 로직만 추가하도록 구성합니다.
 * - 실제 input/button은 기존 UI 컴포넌트를 그대로 사용하고, onChange/onClick만 연결하세요.
 */
export default function EContentsPage() {
  // 업로드 파일 상태
  const [docx, setDocx] = useState<File | null>(null);
  const [pdf, setPdf] = useState<File | null>(null);
  const [template, setTemplate] = useState<File | null>(null);

  // UI 상태
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string>("");

  // DOCX 우선 규칙에 따른 실제 입력 파일 표시용(선택)
  const activeInputLabel = useMemo(() => {
    if (docx) return `DOCX: ${docx.name}`;
    if (pdf) return `PDF: ${pdf.name}`;
    return "입력 파일 없음";
  }, [docx, pdf]);

  /**
   * DOCX 파일 선택 핸들러
   * - DOCX가 선택되면 PDF는 보조 입력이므로 그대로 둬도 되지만,
   *   혼동 방지를 위해 PDF를 비우고 싶으면 setPdf(null)을 추가하세요.
   */
  const onPickDocx = (f: File | null) => {
    setErrorMsg("");
    setDocx(f);
    // 필요 시: docx 선택 시 pdf는 무시되므로 초기화
    // setPdf(null);
  };

  /**
   * PDF 파일 선택 핸들러
   * - DOCX가 없을 때만 사용되는 fallback
   */
  const onPickPdf = (f: File | null) => {
    setErrorMsg("");
    setPdf(f);
  };

  /**
   * eContents 템플릿 XLSX 선택 핸들러
   */
  const onPickTemplate = (f: File | null) => {
    setErrorMsg("");
    setTemplate(f);
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
      // 템플릿은 항상 포함
      fd.append("template", template);

      // DOCX 우선
      if (docx) fd.append("docx", docx);
      else if (pdf) fd.append("pdf", pdf);

      const res = await fetch("/api/econtents/generate", {
        method: "POST",
        body: fd,
      });

      if (!res.ok) {
        // 서버 에러 메시지 표시
        const data = await res.json().catch(() => null);
        throw new Error(data?.message ?? "생성 요청에 실패했습니다.");
      }

      // 응답 XLSX 다운로드
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);

      const a = document.createElement("a");
      a.href = url;
      a.download = "econtents_generated.xlsx";
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
   * 아래 return 영역은 "기존 마크업"을 유지해야 하므로,
   * 현재 파일의 UI에 맞춰 input/button에 핸들러만 연결하세요.
   *
   * 예)
   * <input type="file" accept=".docx" onChange={(e)=>onPickDocx(e.target.files?.[0] ?? null)} />
   * <button onClick={onGenerate} disabled={isLoading}>생성</button>
   */
  return (
    <div>
      {/* ⚠️ 이 return은 예시입니다. 사용자님 기존 마크업을 유지하셔야 합니다. */}
      <div style={{ marginBottom: 8 }}>선택된 입력: {activeInputLabel}</div>
      {errorMsg && <div style={{ color: "red", marginBottom: 8 }}>{errorMsg}</div>}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input
          type="file"
          accept=".docx"
          onChange={(e) => onPickDocx(e.target.files?.[0] ?? null)}
        />
        <input
          type="file"
          accept=".pdf"
          onChange={(e) => onPickPdf(e.target.files?.[0] ?? null)}
        />
        <input
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
