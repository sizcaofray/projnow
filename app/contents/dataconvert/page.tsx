// app/contents/dataconvert/page.tsx
// - 파일 업로드 + 입력/출력 포맷 선택 UI
// - ✅ 파일 업로드는 "드래그앤드롭" + "클릭 선택" 모두 지원합니다.
// - ✅ 여러 파일 업로드 지원
// - ✅ 여러 파일 업로드 + Excel 출력 시
//    - 기본: 한 개 엑셀파일로 생성(파일별 시트 생성)
//    - 옵션: 각각 파일 생성(개별 다운로드)
// - ✅ 셀렉트 박스는 다크/라이트 모드에서 자연스럽게 보이도록 색상 클래스 적용

"use client";

import { useMemo, useRef, useState } from "react";

type InputType = "auto" | "sas" | "xlsx" | "csv" | "json" | "xml" | "txt";
type OutputType = "xlsx" | "csv" | "json" | "xml" | "txt";

// ✅ 여러 파일 + Excel 출력 시 생성 방식
type ExcelMultiMode = "singleWorkbook" | "separateFiles"; // 한 파일(시트 분리) | 각각 파일

export default function DataConvertPage() {
  // ✅ 여러 파일 상태
  const [files, setFiles] = useState<File[]>([]);

  // 입력/출력 포맷 상태
  const [inputType, setInputType] = useState<InputType>("auto");
  const [outputType, setOutputType] = useState<OutputType>("xlsx");

  // ✅ 여러 파일 Excel 생성 방식 (기본: 한 파일에 시트 분리)
  const [excelMultiMode, setExcelMultiMode] =
    useState<ExcelMultiMode>("singleWorkbook");

  // 진행 상태
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string>("");

  // 드래그앤드롭 UI 상태
  const [isDragging, setIsDragging] = useState(false);

  // 파일 input ref
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // ✅ 셀렉트/인풋 공통 클래스 (다크/라이트 자연스럽게)
  const selectClassName =
    "w-full border rounded px-3 py-2 " +
    "bg-white dark:bg-zinc-900 " +
    "text-zinc-900 dark:text-zinc-100 " +
    "border-zinc-300 dark:border-zinc-700";

  // 파일 목록 힌트(자동 인식)
  const autoHint = useMemo(() => {
    if (!files.length) return "";

    // 파일이 1개면 상세 힌트, 여러개면 간단 표기
    if (files.length === 1) {
      const file = files[0];
      const ext = file.name.split(".").pop()?.toLowerCase() || "";
      if (ext === "sas7bdat") return "auto 인식: SAS(.sas7bdat)";
      if (ext === "xlsx" || ext === "xls") return "auto 인식: Excel";
      if (ext === "csv") return "auto 인식: CSV";
      if (ext === "json") return "auto 인식: JSON";
      if (ext === "xml") return "auto 인식: XML";
      return "auto 인식: TXT(또는 기타)";
    }

    return `auto 인식: 파일 ${files.length}개 (확장자별 자동 처리)`;
  }, [files]);

  // ✅ 공통: 파일 적용
  function applyFiles(nextFiles: File[]) {
    // 빈 배열도 허용(초기화)
    setFiles(nextFiles);
    if (nextFiles.length > 0) setMessage("");

    // 여러 파일 업로드 상태에서 Excel 출력이면 기본 모드를 한 파일(시트)로 유지
    // (사용자가 이미 선택한 모드는 그대로 두되, 기본값은 singleWorkbook)
  }

  // ✅ 파일 input 변경
  function onFilePick(e: React.ChangeEvent<HTMLInputElement>) {
    const list = e.target.files;
    if (!list) return;
    applyFiles(Array.from(list));
  }

  // ✅ 드롭 이벤트 핸들러
  function onDragEnter(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }

  function onDragOver(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }

  function onDragLeave(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const dropped = Array.from(e.dataTransfer.files || []);
    if (dropped.length === 0) return;

    applyFiles(dropped);
  }

  // ✅ 공통 다운로드 유틸
  async function downloadFromResponse(res: Response, fallbackName: string) {
    const blob = await res.blob();

    const cd = res.headers.get("Content-Disposition") || "";
    const match = cd.match(/filename="(.+?)"/);
    const filename = match?.[1] ? decodeURIComponent(match[1]) : fallbackName;

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  // ✅ 단일/개별 변환 요청
  async function requestConvertSingle(file: File) {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("inputType", inputType);
    fd.append("outputType", outputType);

    // API 라우트: app/api/dataconvert/route.ts -> /api/dataconvert
    const res = await fetch("/api/dataconvert", {
      method: "POST",
      body: fd,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => null);
      throw new Error(err?.message || "변환 실패");
    }

    // fallback 파일명
    const fallback = `converted.${outputType}`;
    await downloadFromResponse(res, fallback);
  }

  // ✅ 여러 파일을 한 엑셀(시트)로 변환 요청
  async function requestConvertMultiToSingleWorkbook(files: File[]) {
    const fd = new FormData();

    // ✅ 서버는 files[]를 받도록 구현 (여러 개 첨부)
    files.forEach((f) => fd.append("files", f));

    fd.append("inputType", inputType);
    fd.append("outputType", "xlsx"); // 한 파일(시트) 모드는 Excel만 의미가 있음
    fd.append("excelMultiMode", "singleWorkbook");

    const res = await fetch("/api/dataconvert", {
      method: "POST",
      body: fd,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => null);
      throw new Error(err?.message || "변환 실패");
    }

    // fallback 파일명
    const fallback = `converted.xlsx`;
    await downloadFromResponse(res, fallback);
  }

  // 변환 실행
  async function onConvert() {
    if (!files.length) {
      setMessage("파일을 선택해 주세요.");
      return;
    }

    setLoading(true);
    setMessage("");

    try {
      // ✅ 여러 파일 + Excel 출력일 때만 옵션 활성화
      const isMulti = files.length > 1;
      const isExcel = outputType === "xlsx";

      if (isMulti && isExcel && excelMultiMode === "singleWorkbook") {
        // ✅ 한 파일(시트 분리)로 생성
        await requestConvertMultiToSingleWorkbook(files);
        setMessage("변환이 완료되었습니다. (한 파일/시트 분리)");
      } else if (isMulti && isExcel && excelMultiMode === "separateFiles") {
        // ✅ 각각 파일 생성(개별 다운로드) - 서버 zip 없이 클라이언트에서 순차 다운로드
        for (let i = 0; i < files.length; i++) {
          setMessage(`변환 중... (${i + 1}/${files.length})`);
          await requestConvertSingle(files[i]);
        }
        setMessage("변환이 완료되었습니다. (각각 파일 다운로드)");
      } else if (isMulti && !isExcel) {
        // ✅ 여러 파일 + Excel 이외 출력은 “각각 파일” 방식으로 순차 다운로드 (현 단계 안전)
        for (let i = 0; i < files.length; i++) {
          setMessage(`변환 중... (${i + 1}/${files.length})`);
          await requestConvertSingle(files[i]);
        }
        setMessage("변환이 완료되었습니다. (각각 파일 다운로드)");
      } else {
        // 단일 파일
        await requestConvertSingle(files[0]);
        setMessage("변환이 완료되었습니다.");
      }
    } catch (e: any) {
      setMessage(e?.message || "오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  }

  // ✅ Excel 옵션 노출 여부
  const showExcelMultiOptions = files.length > 1 && outputType === "xlsx";

  return (
    <main className="p-6">
      <h1 className="text-2xl font-bold mb-4">Data Convert</h1>

      <div className="space-y-4 max-w-2xl">
        {/* 1) 파일 업로드 (드래그앤드롭 + 다중 업로드) */}
        <div className="border rounded p-4">
          <div className="font-semibold mb-2">1) 파일 업로드</div>

          {/* Dropzone */}
          <div
            onClick={() => fileInputRef.current?.click()}
            onDragEnter={onDragEnter}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
            className={[
              "w-full rounded border px-3 py-6 cursor-pointer select-none",
              "bg-transparent",
              isDragging ? "border-blue-500" : "border-zinc-300 dark:border-zinc-700",
            ].join(" ")}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                fileInputRef.current?.click();
              }
            }}
          >
            <div className="text-sm opacity-90">
              {isDragging
                ? "여기에 파일을 놓아 업로드하세요."
                : "파일을 드래그해서 놓거나, 클릭하여 파일을 선택하세요. (여러 파일 가능)"}
            </div>

            {/* 파일 목록 표시 */}
            {files.length > 0 && (
              <div className="text-sm opacity-80 mt-2 space-y-1">
                <div>
                  선택됨: {files.length}개 / {autoHint}
                </div>
                <ul className="list-disc pl-5">
                  {files.slice(0, 10).map((f) => (
                    <li key={`${f.name}-${f.size}-${f.lastModified}`}>
                      {f.name} ({Math.round(f.size / 1024)} KB)
                    </li>
                  ))}
                  {files.length > 10 && <li>... 외 {files.length - 10}개</li>}
                </ul>
              </div>
            )}
          </div>

          {/* 실제 input */}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={onFilePick}
          />
        </div>

        {/* 2) 입력/출력 포맷 */}
        <div className="border rounded p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <div className="font-semibold mb-2">2) 입력 포맷</div>
            <select
              value={inputType}
              onChange={(e) => setInputType(e.target.value as InputType)}
              className={selectClassName}
            >
              <option value="auto">자동 인식(auto)</option>
              <option value="sas">SAS (.sas7bdat)</option>
              <option value="xlsx">Excel (.xlsx)</option>
              <option value="csv">CSV (.csv)</option>
              <option value="json">JSON (.json)</option>
              <option value="xml">XML (.xml)</option>
              <option value="txt">TXT (.txt)</option>
            </select>
          </div>

          <div>
            <div className="font-semibold mb-2">3) 출력 포맷</div>
            <select
              value={outputType}
              onChange={(e) => setOutputType(e.target.value as OutputType)}
              className={selectClassName}
            >
              <option value="xlsx">Excel (.xlsx)</option>
              <option value="csv">CSV (.csv)</option>
              <option value="json">JSON (.json)</option>
              <option value="xml">XML (.xml)</option>
              <option value="txt">TXT (.txt)</option>
            </select>
          </div>
        </div>

        {/* ✅ 3-1) 여러 파일 + Excel일 때 생성 방식 옵션 */}
        {showExcelMultiOptions && (
          <div className="border rounded p-4">
            <div className="font-semibold mb-2">4) 여러 파일 Excel 생성 방식</div>
            <select
              value={excelMultiMode}
              onChange={(e) => setExcelMultiMode(e.target.value as ExcelMultiMode)}
              className={selectClassName}
            >
              <option value="singleWorkbook">
                한 파일로 생성 (파일별 시트 생성) - 기본
              </option>
              <option value="separateFiles">각각 파일로 생성 (개별 다운로드)</option>
            </select>
          </div>
        )}

        {/* 실행 */}
        <div className="flex items-center gap-3">
          <button
            onClick={onConvert}
            disabled={loading}
            className="px-4 py-2 rounded bg-blue-600 text-white disabled:opacity-50"
          >
            {loading ? "변환 중..." : "변환 & 다운로드"}
          </button>

          {message && <div className="text-sm opacity-90">{message}</div>}
        </div>

        {/* 안내 */}
        <div className="text-sm opacity-80 leading-relaxed">
          - SAS(.sas7bdat)는 “읽기” 변환을 기본으로 제공합니다.
          <br />
          - Excel은 약 104만 행 제한이 있으니 초대용량은 CSV 출력도 권장드립니다.
        </div>
      </div>
    </main>
  );
}
