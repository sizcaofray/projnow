"use client";

import React, { useMemo, useRef, useState } from "react";

/**
 * app/contents/econtents/page.tsx
 *
 * ✅ 변경 목표(사용자 요구 반영)
 * - 결과 서식(XLSX)은 서비스에서 "고정" (템플릿 업로드 제거)
 * - 업로드 대상은 Protocol DOCX(우선) 또는 PDF만
 * - 업로드 → /api/econtents/generate 호출 → XLSX 다운로드
 *
 * ✅ 유지
 * - 기존 UI 톤/카드 구조 유지(가능한 최소 변경)
 * - 드래그앤드롭 / 상태 메시지 / 다운로드 로직 유지
 */

type DropKind = "docx" | "pdf";

export default function EContentsPage() {
  // 업로드 파일 상태
  const [docx, setDocx] = useState<File | null>(null);
  const [pdf, setPdf] = useState<File | null>(null);

  // UI 상태
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [infoMsg, setInfoMsg] = useState<string>("");

  // ✅ 같은 파일 재선택 시 change가 안 뜨는 경우를 방지하기 위한 ref
  const docxInputRef = useRef<HTMLInputElement | null>(null);
  const pdfInputRef = useRef<HTMLInputElement | null>(null);

  // ✅ 드래그 상태(카드 하이라이트)
  const [dragOver, setDragOver] = useState<DropKind | null>(null);

  const activeInputLabel = useMemo(() => {
    if (docx) return `DOCX 사용 중: ${docx.name}`;
    if (pdf) return `PDF 사용 중: ${pdf.name}`;
    return "입력 파일 없음";
  }, [docx, pdf]);

  const canGenerate = useMemo(() => {
    return Boolean((docx || pdf) && !isLoading);
  }, [docx, pdf, isLoading]);

  /** 파일 선택 공통 핸들러 */
  const pickFile = (kind: DropKind, f: File | null) => {
    setErrorMsg("");
    setInfoMsg("");

    if (kind === "docx") {
      setDocx(f);

      // ✅ DOCX 우선이므로 DOCX 선택 시 PDF 자동 초기화
      if (f) {
        setPdf(null);
        setInfoMsg("DOCX가 업로드되어 PDF는 자동으로 해제되었습니다.(DOCX 우선)");
      }

      // ✅ 같은 파일 재선택 대비
      if (docxInputRef.current) docxInputRef.current.value = "";
      if (pdfInputRef.current) pdfInputRef.current.value = "";
      return;
    }

    if (kind === "pdf") {
      setPdf(f);

      // ✅ 같은 파일 재선택 대비
      if (pdfInputRef.current) pdfInputRef.current.value = "";
      return;
    }
  };

  /** 파일 제거 공통 */
  const clearFile = (kind: DropKind) => {
    setErrorMsg("");
    setInfoMsg("");

    if (kind === "docx") {
      setDocx(null);
      if (docxInputRef.current) docxInputRef.current.value = "";
      return;
    }
    if (kind === "pdf") {
      setPdf(null);
      if (pdfInputRef.current) pdfInputRef.current.value = "";
      return;
    }
  };

  /** 드래그 이벤트 공통 (브라우저 기본 동작 방지 필수) */
  const onDragEnter = (kind: DropKind, e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(kind);
  };
  const onDragOver = (kind: DropKind, e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(kind);
  };
  const onDragLeave = (kind: DropKind, e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // ✅ 현재 카드에서 나갈 때만 해제
    setDragOver((prev) => (prev === kind ? null : prev));
  };
  const onDrop = (kind: DropKind, e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(null);

    const f = e.dataTransfer.files?.[0] ?? null;
    if (!f) return;

    // ✅ 확장자 최소 검증 (엄격 검증은 서버에서)
    if (kind === "docx" && !f.name.toLowerCase().endsWith(".docx")) {
      setErrorMsg("DOCX 영역에는 .docx 파일만 드롭해 주세요.");
      return;
    }
    if (kind === "pdf" && !f.name.toLowerCase().endsWith(".pdf")) {
      setErrorMsg("PDF 영역에는 .pdf 파일만 드롭해 주세요.");
      return;
    }

    pickFile(kind, f);
  };

  /** 생성 실행 */
  const onGenerate = async () => {
    try {
      setErrorMsg("");
      setInfoMsg("");

      if (!docx && !pdf) {
        setErrorMsg("프로토콜 DOCX 또는 PDF 중 하나를 업로드해 주세요. (DOCX 우선)");
        return;
      }

      setIsLoading(true);

      const fd = new FormData();

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
      // ✅ 서버에서 Content-Disposition을 주더라도 안전하게 기본 파일명 지정
      a.download = "econtents_generated.xlsx";
      document.body.appendChild(a);
      a.click();
      a.remove();

      window.URL.revokeObjectURL(url);

      setInfoMsg("생성이 완료되었습니다. 다운로드를 확인해 주세요.");
    } catch (e: any) {
      setErrorMsg(e?.message ?? "알 수 없는 오류가 발생했습니다.");
    } finally {
      setIsLoading(false);
    }
  };

  /** 카드 공통 컴포넌트(파일 input + 드롭존) */
  const DropCard = (props: {
    kind: DropKind;
    title: string;
    subtitle: string;
    accept: string;
    inputRef: React.RefObject<HTMLInputElement | null>;
    file: File | null;
    badge?: string;
  }) => {
    const { kind, title, subtitle, accept, inputRef, file, badge } = props;

    const isActive = dragOver === kind;
    const borderClass = isActive
      ? "border-white/70 ring-2 ring-white/30"
      : "border-white/15 hover:border-white/25";

    const hint =
      kind === "docx" ? "또는 여기로 .docx 드래그" : "또는 여기로 .pdf 드래그";

    return (
      <div
        className={`relative rounded-2xl border ${borderClass} bg-white/5 p-4 transition`}
        onDragEnter={(e) => onDragEnter(kind, e)}
        onDragOver={(e) => onDragOver(kind, e)}
        onDragLeave={(e) => onDragLeave(kind, e)}
        onDrop={(e) => onDrop(kind, e)}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-white">{title}</h3>
              {badge ? (
                <span className="rounded-full border border-white/20 bg-white/10 px-2 py-0.5 text-[11px] text-white/90">
                  {badge}
                </span>
              ) : null}
            </div>
            <p className="mt-1 text-xs text-white/60">{subtitle}</p>
          </div>

          {/* 파일 제거 버튼 */}
          {file ? (
            <button
              type="button"
              onClick={() => clearFile(kind)}
              className="shrink-0 rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-xs text-white/80 hover:bg-white/10"
              title="선택 해제"
            >
              선택해제
            </button>
          ) : null}
        </div>

        {/* Dropzone 본체 */}
        <label
          className={`mt-4 block cursor-pointer rounded-xl border border-dashed ${
            isActive
              ? "border-white/60 bg-white/10"
              : "border-white/20 bg-black/10 hover:bg-white/5"
          } p-4 transition`}
          title="클릭하여 파일 선택 또는 드래그 앤 드롭"
        >
          <input
            ref={inputRef as any}
            type="file"
            accept={accept}
            className="hidden"
            onChange={(e) => pickFile(kind, e.target.files?.[0] ?? null)}
          />

          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm text-white/90">
                {file ? (
                  <span className="font-medium">{file.name}</span>
                ) : (
                  <span className="font-medium">클릭해서 파일 선택</span>
                )}
              </div>
              <div className="mt-1 text-xs text-white/55">
                {file ? "선택됨" : hint}
              </div>
            </div>

            <span className="rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-xs text-white/80">
              Browse
            </span>
          </div>

          {/* 파일 칩 */}
          {file ? (
            <div className="mt-3 flex flex-wrap gap-2">
              <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs text-white/80">
                <span className="max-w-[240px] truncate">{file.name}</span>
                <span className="text-white/40">•</span>
                <span className="text-white/60">
                  {Math.ceil(file.size / 1024)} KB
                </span>
              </span>
            </div>
          ) : null}
        </label>
      </div>
    );
  };

  return (
    <main className="px-6 pb-10">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">eContents 생성</h1>
            <div className="mt-2 text-sm text-white/70">
              {activeInputLabel}
              <span className="ml-2 text-white/40">|</span>
              <span className="ml-2 text-white/60">DOCX 우선, 없으면 PDF</span>
            </div>

            {/* ✅ 고정 서식 안내(오해 방지) */}
            <div className="mt-2 text-xs text-white/55">
              ※ 결과 XLSX 서식은 서비스에서 고정되어 있으며, 별도 템플릿 업로드는 필요하지 않습니다.
            </div>
          </div>

          <button
            onClick={onGenerate}
            disabled={!canGenerate}
            className={`mt-4 sm:mt-0 inline-flex items-center justify-center rounded-xl px-5 py-2.5 text-sm font-semibold transition ${
              canGenerate
                ? "bg-white text-black hover:bg-white/90"
                : "bg-white/20 text-white/50 cursor-not-allowed"
            }`}
            title={!canGenerate ? "DOCX 또는 PDF를 업로드해 주세요." : "eContents 생성"}
          >
            {isLoading ? "생성 중..." : "eContents 생성"}
          </button>
        </div>

        {/* 단계 안내 */}
        <div className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-3">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="text-xs text-white/60">Step 1</div>
            <div className="mt-1 text-sm font-semibold text-white">Protocol 업로드</div>
            <div className="mt-1 text-xs text-white/60">DOCX가 있으면 DOCX만으로 충분합니다.</div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="text-xs text-white/60">Step 2</div>
            <div className="mt-1 text-sm font-semibold text-white">서식 자동 적용</div>
            <div className="mt-1 text-xs text-white/60">서비스 고정 XLSX 서식으로 자동 생성됩니다.</div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="text-xs text-white/60">Step 3</div>
            <div className="mt-1 text-sm font-semibold text-white">생성 & 다운로드</div>
            <div className="mt-1 text-xs text-white/60">완성된 XLSX가 내려받기 됩니다.</div>
          </div>
        </div>

        {/* 메시지 영역 */}
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

        {/* 업로드 카드 */}
        <section className="mt-8 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <DropCard
            kind="docx"
            title="Protocol DOCX"
            subtitle="권장. 텍스트 추출 정확도가 더 높습니다."
            accept=".docx"
            inputRef={docxInputRef}
            file={docx}
            badge="우선"
          />
          <DropCard
            kind="pdf"
            title="Protocol PDF"
            subtitle="DOCX가 없을 때만 사용됩니다."
            accept=".pdf"
            inputRef={pdfInputRef}
            file={pdf}
          />
        </section>

        {/* 하단 안내 */}
        <div className="mt-6 text-xs text-white/50">
          ※ 생성이 실패하면 대부분{" "}
          <span className="text-white/70 font-medium">/api/econtents/generate</span>{" "}
          서버 라우트 문제입니다.
        </div>
      </div>
    </main>
  );
}
