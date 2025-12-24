"use client";

import React, { useMemo, useRef, useState } from "react";

/**
 * app/contents/econtents/page.tsx
 *
 * ✅ 기능
 * - Protocol DOCX 우선(없으면 PDF)
 * - eContents 템플릿 XLSX 업로드
 * - /api/econtents/generate 호출 후 XLSX 다운로드
 *
 * ✅ 주의
 * - 이 파일은 "예시 UI"가 아니라 실제 화면으로 쓸 수 있도록 정리된 버전입니다.
 * - 디자인은 프로젝트 톤(다크/보더/라운드) 기준으로 깔끔하게 구성했습니다.
 */

export default function EContentsPage() {
  // 업로드 파일 상태
  const [docx, setDocx] = useState<File | null>(null);
  const [pdf, setPdf] = useState<File | null>(null);
  const [template, setTemplate] = useState<File | null>(null);

  // UI 상태
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string>("");

  // ✅ 같은 파일 재선택 시 change가 안 뜨는 경우를 방지하기 위한 ref
  const docxInputRef = useRef<HTMLInputElement | null>(null);
  const pdfInputRef = useRef<HTMLInputElement | null>(null);
  const templateInputRef = useRef<HTMLInputElement | null>(null);

  const activeInputLabel = useMemo(() => {
    if (docx) return `DOCX: ${docx.name}`;
    if (pdf) return `PDF: ${pdf.name}`;
    return "입력 파일 없음";
  }, [docx, pdf]);

  /** DOCX 선택(우선) */
  const onPickDocx = (f: File | null) => {
    setErrorMsg("");
    setDocx(f);

    // ✅ 혼동 방지: DOCX 선택 시 PDF는 자동 초기화
    if (f) setPdf(null);

    // ✅ 같은 파일 재선택 대비
    if (docxInputRef.current) docxInputRef.current.value = "";
    if (pdfInputRef.current) pdfInputRef.current.value = "";
  };

  /** PDF 선택(fallback) */
  const onPickPdf = (f: File | null) => {
    setErrorMsg("");
    setPdf(f);

    // ✅ 같은 파일 재선택 대비
    if (pdfInputRef.current) pdfInputRef.current.value = "";
  };

  /** 템플릿 선택 */
  const onPickTemplate = (f: File | null) => {
    setErrorMsg("");
    setTemplate(f);

    // ✅ 같은 파일 재선택 대비
    if (templateInputRef.current) templateInputRef.current.value = "";
  };

  /** 생성 실행 */
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

  return (
    <main className="px-6 pb-10">
      <div className="mx-auto max-w-6xl">
        <h1 className="text-2xl font-bold">eContents</h1>

        <div className="mt-2 text-sm text-gray-600 dark:text-gray-300">
          선택된 입력: <span className="font-medium">{activeInputLabel}</span>
        </div>

        {errorMsg ? (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
            {errorMsg}
          </div>
        ) : null}

        <section className="mt-8 rounded-2xl border p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold">파일 업로드</h2>

            <button
              onClick={onGenerate}
              disabled={isLoading}
              className="rounded-xl bg-gray-900 px-4 py-2 text-sm text-white disabled:opacity-60 dark:bg-white dark:text-gray-900"
              title="템플릿+프로토콜을 업로드한 뒤 생성 버튼을 눌러주세요."
            >
              {isLoading ? "생성 중..." : "eContents 생성"}
            </button>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {/* DOCX */}
            <div className="rounded-xl border p-4">
              <div className="text-sm font-semibold">Protocol DOCX (우선)</div>
              <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
                DOCX가 있으면 PDF는 무시됩니다.
              </div>
              <input
                ref={docxInputRef}
                className="mt-3 block w-full text-sm"
                type="file"
                accept=".docx"
                onChange={(e) => onPickDocx(e.target.files?.[0] ?? null)}
              />
              <div className="mt-2 text-xs text-gray-600 dark:text-gray-300">
                선택: {docx ? docx.name : "없음"}
              </div>
            </div>

            {/* PDF */}
            <div className="rounded-xl border p-4">
              <div className="text-sm font-semibold">Protocol PDF (DOCX 없을 때)</div>
              <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
                DOCX가 없을 때만 사용됩니다.
              </div>
              <input
                ref={pdfInputRef}
                className="mt-3 block w-full text-sm"
                type="file"
                accept=".pdf"
                onChange={(e) => onPickPdf(e.target.files?.[0] ?? null)}
              />
              <div className="mt-2 text-xs text-gray-600 dark:text-gray-300">
                선택: {pdf ? pdf.name : "없음"}
              </div>
            </div>

            {/* TEMPLATE */}
            <div className="rounded-xl border p-4">
              <div className="text-sm font-semibold">eContents 템플릿 XLSX</div>
              <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
                예시로 올려주신 eContents 파일 형식입니다.
              </div>
              <input
                ref={templateInputRef}
                className="mt-3 block w-full text-sm"
                type="file"
                accept=".xlsx"
                onChange={(e) => onPickTemplate(e.target.files?.[0] ?? null)}
              />
              <div className="mt-2 text-xs text-gray-600 dark:text-gray-300">
                선택: {template ? template.name : "없음"}
              </div>
            </div>
          </div>

          <div className="mt-4 text-xs text-gray-600 dark:text-gray-300">
            ※ 생성이 안 되면 대부분 <span className="font-medium">/api/econtents/generate</span> API 라우트가 없거나
            서버 에러입니다.
          </div>
        </section>
      </div>
    </main>
  );
}
