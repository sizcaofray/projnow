// app/contents/dataconvert/page.tsx
// - 파일 업로드 + 입력/출력 포맷 선택 UI
// - 선택한 옵션대로 API(/api/dataconvert/convert)에 전송하고 결과를 다운로드합니다.

"use client";

import { useMemo, useState } from "react";

type InputType = "auto" | "sas" | "xlsx" | "csv" | "json" | "xml" | "txt";
type OutputType = "xlsx" | "csv" | "json" | "xml" | "txt";

export default function DataConvertPage() {
  // 선택된 파일 상태
  const [file, setFile] = useState<File | null>(null);

  // 입력/출력 포맷 상태
  const [inputType, setInputType] = useState<InputType>("auto");
  const [outputType, setOutputType] = useState<OutputType>("xlsx");

  // 진행 상태
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string>("");

  // 파일 확장자를 기반으로 “auto”일 때 어떤 타입인지 UI 힌트 제공
  const autoHint = useMemo(() => {
    if (!file) return "";
    const ext = file.name.split(".").pop()?.toLowerCase() || "";
    if (ext === "sas7bdat") return "auto 인식: SAS(.sas7bdat)";
    if (ext === "xlsx" || ext === "xls") return "auto 인식: Excel";
    if (ext === "csv") return "auto 인식: CSV";
    if (ext === "json") return "auto 인식: JSON";
    if (ext === "xml") return "auto 인식: XML";
    return "auto 인식: TXT(또는 기타)";
  }, [file]);

  async function onConvert() {
    // 파일 체크
    if (!file) {
      setMessage("파일을 선택해 주세요.");
      return;
    }

    setLoading(true);
    setMessage("");

    try {
      // FormData 구성
      const fd = new FormData();
      fd.append("file", file);
      fd.append("inputType", inputType);
      fd.append("outputType", outputType);

      // 변환 API 호출
      const res = await fetch("/api/dataconvert/convert", {
        method: "POST",
        body: fd,
      });

      if (!res.ok) {
        // 에러 메시지 처리
        const err = await res.json().catch(() => null);
        throw new Error(err?.message || "변환 실패");
      }

      // 파일 다운로드 처리
      const blob = await res.blob();

      // Content-Disposition에서 filename을 가져오는 시도
      const cd = res.headers.get("Content-Disposition") || "";
      const match = cd.match(/filename="(.+?)"/);
      const filename = match?.[1] ? decodeURIComponent(match[1]) : `converted.${outputType}`;

      // 브라우저 다운로드 트리거
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      setMessage("변환이 완료되었습니다.");
    } catch (e: any) {
      setMessage(e?.message || "오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="p-6">
      <h1 className="text-2xl font-bold mb-4">Data Convert</h1>

      <div className="space-y-4 max-w-2xl">
        {/* 파일 선택 */}
        <div className="border rounded p-4">
          <div className="font-semibold mb-2">1) 파일 업로드</div>
          <input
            type="file"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
            className="block w-full"
          />
          {file && (
            <div className="text-sm opacity-80 mt-2">
              선택됨: {file.name} ({Math.round(file.size / 1024)} KB) / {autoHint}
            </div>
          )}
        </div>

        {/* 입력/출력 포맷 */}
        <div className="border rounded p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <div className="font-semibold mb-2">2) 입력 포맷</div>
            <select
              value={inputType}
              onChange={(e) => setInputType(e.target.value as InputType)}
              className="w-full border rounded px-3 py-2 bg-transparent"
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
              className="w-full border rounded px-3 py-2 bg-transparent"
            >
              <option value="xlsx">Excel (.xlsx)</option>
              <option value="csv">CSV (.csv)</option>
              <option value="json">JSON (.json)</option>
              <option value="xml">XML (.xml)</option>
              <option value="txt">TXT (.txt)</option>
            </select>
          </div>
        </div>

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
          - SAS(.sas7bdat) 파서는 “읽기” 중심이며, 엑셀로 내보내는 변환을 기본으로 구성했습니다. :contentReference[oaicite:9]{index=9}
          <br />
          - Excel은 행 제한(약 104만 행)이 있으니 초대용량 데이터는 CSV 출력도 함께 제공하는 것을 권장드립니다.
        </div>
      </div>
    </main>
  );
}
