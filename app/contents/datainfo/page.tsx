"use client";

import React, { useMemo, useState } from "react";

/**
 * 표 한 줄 데이터 모델
 */
type DataInfoRow = {
  no: number; // 순번
  name: string; // 파일명
  type: string; // 종류(확장자)
  size: string; // 파일 크기(문자열)
  columns: number | ""; // 변수(칼럼 수)
  rows: number | ""; // 데이터(행 수)
  date: string; // 파일 날짜(LastModified 기반)
  note: string; // 비고
};

/**
 * 확장자 추출
 */
function getExt(fileName: string) {
  const idx = fileName.lastIndexOf(".");
  if (idx < 0) return "";
  return fileName.slice(idx + 1).toLowerCase();
}

/**
 * 파일 크기 포맷
 */
function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes)) return "";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = bytes;
  let u = 0;
  while (size >= 1024 && u < units.length - 1) {
    size = size / 1024;
    u += 1;
  }
  return `${size.toFixed(u === 0 ? 0 : 2)} ${units[u]}`;
}

/**
 * 날짜 포맷 (File.lastModified 기반)
 */
function formatDate(ms: number) {
  try {
    return new Date(ms).toLocaleString();
  } catch {
    return "";
  }
}

/**
 * Excel에서 변수/데이터(행) 추출
 * - Sheet1 우선, 없으면 첫 시트
 * - 데이터 행 수는 "헤더 1행 제외" 기본 정책(총행-1)
 */
async function readExcelCounts(file: File): Promise<{ columns: number; rows: number }> {
  const XLSX = await import("xlsx");
  const ab = await file.arrayBuffer();
  const wb = XLSX.read(ab, { type: "array" });

  const sheetName = wb.Sheets["Sheet1"] ? "Sheet1" : wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];

  if (!ws) return { columns: 0, rows: 0 };

  const ref = ws["!ref"];
  if (!ref) return { columns: 0, rows: 0 };

  const range = XLSX.utils.decode_range(ref);
  const totalRows = range.e.r - range.s.r + 1;
  const totalCols = range.e.c - range.s.c + 1;

  const dataRows = Math.max(0, totalRows - 1);
  return { columns: totalCols, rows: dataRows };
}

export default function DataInfoPage() {
  const [rows, setRows] = useState<DataInfoRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [pickedFolderName, setPickedFolderName] = useState("");

  const hasRows = rows.length > 0;

  /**
   * 폴더 선택 → 파일 목록 수집 → 표 데이터 생성
   * - showDirectoryPicker 지원 브라우저에서만 동작(Chrome/Edge)
   */
  const handlePickFolder = async () => {
    if (typeof window === "undefined") return;

    const anyWin = window as any;

    // showDirectoryPicker 미지원 환경 방어
    if (typeof anyWin.showDirectoryPicker !== "function") {
      alert("현재 브라우저에서 폴더 선택 기능을 지원하지 않습니다. Chrome/Edge에서 시도해 주세요.");
      return;
    }

    setLoading(true);
    setRows([]);
    setPickedFolderName("");

    try {
      const dirHandle = (await anyWin.showDirectoryPicker()) as FileSystemDirectoryHandle;
      setPickedFolderName(dirHandle.name);

      const files: File[] = [];

      // 하위 폴더는 제외(필요 시 재귀 확장 가능)
      for await (const entry of (dirHandle as any).values()) {
        if (entry.kind === "file") {
          const file = await entry.getFile();
          files.push(file);
        }
      }

      // 보기 좋게 파일명 정렬
      files.sort((a, b) => a.name.localeCompare(b.name));

      const result: DataInfoRow[] = [];

      for (let i = 0; i < files.length; i += 1) {
        const file = files[i];
        const ext = getExt(file.name);

        let columns: number | "" = "";
        let dataRows: number | "" = "";
        let note = "";

        try {
          // Excel만 변수/데이터 채움
          if (["xlsx", "xlsm", "xltx", "xltm"].includes(ext)) {
            const c = await readExcelCounts(file);
            columns = c.columns;
            dataRows = c.rows;
          }

          // SAS는 우선 빈 값 유지(추후 서버 파싱 방식으로 안정적으로 구현 권장)
          if (ext === "sas7bdat") {
            note = "SAS 파싱은 서버 방식으로 구현 예정(현재는 빈 값 처리)";
            columns = "";
            dataRows = "";
          }
        } catch (e: any) {
          note = e?.message ? String(e.message) : "파싱 실패";
          columns = "";
          dataRows = "";
        }

        result.push({
          no: i + 1,
          name: file.name,
          type: ext ? ext.toUpperCase() : "",
          size: formatBytes(file.size),
          columns,
          rows: dataRows,
          date: formatDate(file.lastModified),
          note,
        });
      }

      setRows(result);
    } catch (e: any) {
      const msg = e?.message ? String(e.message) : "폴더 선택이 취소되었거나 오류가 발생했습니다.";
      alert(msg);
    } finally {
      setLoading(false);
    }
  };

  const table = useMemo(() => {
    return (
      <div className="w-full overflow-auto rounded-lg border border-neutral-200 dark:border-neutral-800">
        <table className="w-full min-w-[980px] text-sm">
          <thead className="sticky top-0 bg-white/90 backdrop-blur dark:bg-neutral-950/90">
            <tr className="border-b border-neutral-200 dark:border-neutral-800">
              <th className="px-3 py-2 text-left">No.</th>
              <th className="px-3 py-2 text-left">파일명</th>
              <th className="px-3 py-2 text-left">Type</th>
              <th className="px-3 py-2 text-left">파일사이즈</th>
              <th className="px-3 py-2 text-left">변수(칼럼)</th>
              <th className="px-3 py-2 text-left">데이터(데이터 수)</th>
              <th className="px-3 py-2 text-left">Date</th>
              <th className="px-3 py-2 text-left">비고</th>
            </tr>
          </thead>

          <tbody>
            {rows.map((r) => (
              <tr key={`${r.no}-${r.name}`} className="border-b border-neutral-100 dark:border-neutral-900">
                <td className="px-3 py-2">{r.no}</td>
                <td className="px-3 py-2">{r.name}</td>
                <td className="px-3 py-2">{r.type}</td>
                <td className="px-3 py-2">{r.size}</td>
                <td className="px-3 py-2">{r.columns === "" ? "" : r.columns}</td>
                <td className="px-3 py-2">{r.rows === "" ? "" : r.rows}</td>
                <td className="px-3 py-2">{r.date}</td>
                <td className="px-3 py-2 text-neutral-600 dark:text-neutral-400">{r.note}</td>
              </tr>
            ))}

            {!hasRows && (
              <tr>
                <td className="px-3 py-10 text-center text-neutral-500 dark:text-neutral-400" colSpan={8}>
                  폴더를 선택하면 파일 목록이 표시됩니다.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    );
  }, [rows, hasRows]);

  return (
    <div className="w-full p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Data Info</h1>
          <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
            폴더 내 파일 정보를 표로 표시합니다. (Excel만 변수/데이터 수 채움)
          </p>
          {pickedFolderName ? (
            <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
              선택 폴더: <span className="font-medium">{pickedFolderName}</span>
            </p>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handlePickFolder}
            disabled={loading}
            className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60 dark:bg-neutral-100 dark:text-neutral-900"
          >
            {loading ? "읽는 중..." : "폴더 선택"}
          </button>

          {hasRows ? (
            <button
              type="button"
              onClick={() => setRows([])}
              disabled={loading}
              className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-800 disabled:opacity-60 dark:border-neutral-700 dark:text-neutral-100"
            >
              초기화
            </button>
          ) : null}
        </div>
      </div>

      {table}
    </div>
  );
}
