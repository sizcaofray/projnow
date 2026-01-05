// app/api/dataconvert/route.ts
// - 업로드된 파일을 입력 포맷에 맞게 파싱한 뒤, 사용자가 선택한 출력 포맷으로 변환해 다운로드 응답을 반환합니다.
// - SAS(.sas7bdat)는 파일 경로 기반 parse가 필요하여 /tmp에 임시 저장 후 처리합니다.
// - ✅ sas7bdat/fs-ext는 네이티브(.node) 포함 가능성이 있어, 반드시 "SAS 변환 분기 내부"에서만 런타임 로드합니다.

import { NextResponse } from "next/server";
import * as XLSX from "xlsx"; // SheetJS
import Papa from "papaparse"; // CSV parser
import { parseStringPromise, Builder as XmlBuilder } from "xml2js"; // XML parser/builder
import fs from "fs/promises";
import path from "path";
import os from "os";

// 서버 런타임은 Node가 필요합니다. (SAS 임시파일 저장/읽기)
export const runtime = "nodejs";

// ---- 유틸: 파일명 안전화 ----
function safeBaseName(name: string) {
  // 경로문자 제거 및 공백 정리
  return name.replace(/[\\\/:*?"<>|]/g, "_").trim() || "file";
}

// ---- 유틸: rows(JSON[]) -> XLSX Buffer ----
function rowsToXlsxBuffer(rows: Record<string, any>[]) {
  // JSON 배열을 시트로 변환
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");

  // Buffer로 생성 (서버 응답용)
  const buf = XLSX.write(wb, { bookType: "xlsx", type: "buffer" });
  return buf as Buffer;
}

// ---- 유틸: rows(JSON[]) -> CSV ----
function rowsToCsv(rows: Record<string, any>[]) {
  // Papa.unparse를 사용해 CSV로 변환
  return Papa.unparse(rows, { quotes: false });
}

// ---- 유틸: XLSX Buffer -> rows(JSON[]) ----
function xlsxBufferToRows(buf: Buffer) {
  const wb = XLSX.read(buf, { type: "buffer" });
  const firstSheetName = wb.SheetNames[0];
  const ws = wb.Sheets[firstSheetName];

  // defval: 빈 셀은 ""로 처리
  const rows = XLSX.utils.sheet_to_json<Record<string, any>>(ws, { defval: "" });
  return rows;
}

// ---- 유틸: TXT -> rows(JSON[]) (단순 delimited: 탭/쉼표 자동) ----
function txtToRows(text: string) {
  // 간단한 휴리스틱: 탭이 더 많으면 TSV, 아니면 CSV로 간주
  const tabCount = (text.match(/\t/g) || []).length;
  const commaCount = (text.match(/,/g) || []).length;
  const delimiter = tabCount > commaCount ? "\t" : ",";

  const parsed = Papa.parse<Record<string, any>>(text, {
    header: true,
    delimiter,
    skipEmptyLines: true
  });

  if (!parsed.data || parsed.data.length === 0) return [];
  return parsed.data as Record<string, any>[];
}

// ---- 유틸: XML -> rows(JSON[]) (기본 구조: <root><row>...</row></root> 기대) ----
function xmlToRows(xml: string) {
  // XML 구조가 다양한 점을 고려해 MVP는 row 배열 구조만 우선 지원
  return parseStringPromise(xml, { explicitArray: false }).then((obj) => {
    const root = obj?.root ?? obj;
    const maybeRows = root?.row ?? root?.rows ?? root?.data ?? [];
    const arr = Array.isArray(maybeRows) ? maybeRows : [maybeRows];
    return arr.filter(Boolean) as Record<string, any>[];
  });
}

// ---- 유틸: rows(JSON[]) -> XML ----
function rowsToXml(rows: Record<string, any>[]) {
  const builder = new XmlBuilder({ headless: true, rootName: "root" });
  return builder.buildObject({ row: rows });
}

export async function POST(req: Request) {
  try {
    // 1) multipart form-data 수신
    const formData = await req.formData();

    const file = formData.get("file");
    const inputType = String(formData.get("inputType") || "auto"); // auto | sas | xlsx | csv | json | xml | txt
    const outputType = String(formData.get("outputType") || "xlsx"); // xlsx | csv | json | xml | txt

    if (!(file instanceof File)) {
      return NextResponse.json({ ok: false, message: "파일이 없습니다." }, { status: 400 });
    }

    const originalName = file.name || "upload";
    const baseName = safeBaseName(originalName.replace(/\.[^/.]+$/, ""));
    const ext = (originalName.split(".").pop() || "").toLowerCase();

    // 2) 입력 타입 결정 (auto면 확장자 기반)
    const resolvedInput =
      inputType !== "auto"
        ? inputType
        : ext === "sas7bdat"
          ? "sas"
          : ext === "xlsx" || ext === "xls"
            ? "xlsx"
            : ext === "csv"
              ? "csv"
              : ext === "json"
                ? "json"
                : ext === "xml"
                  ? "xml"
                  : "txt";

    // 3) 파일을 Buffer로 변환
    const ab = await file.arrayBuffer();
    const buf = Buffer.from(ab);

    // 4) 표준 rows(JSON[])로 통일
    let rows: Record<string, any>[] = [];

    if (resolvedInput === "sas") {
      // ✅ 네이티브 모듈 번들링/파싱 문제 회피:
      // - 런타임에만 require되도록 eval('require') 사용
      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      const SAS7BDAT = (0, eval)("require")("sas7bdat");

      const tmpPath = path.join(os.tmpdir(), `${baseName}-${Date.now()}.sas7bdat`);
      await fs.writeFile(tmpPath, buf);

      rows = await SAS7BDAT.parse(tmpPath, { rowFormat: "object" });

      await fs.unlink(tmpPath).catch(() => {});
    } else if (resolvedInput === "xlsx") {
      rows = xlsxBufferToRows(buf);
    } else if (resolvedInput === "csv") {
      const text = buf.toString("utf8");
      const parsed = Papa.parse<Record<string, any>>(text, {
        header: true,
        skipEmptyLines: true
      });
      rows = (parsed.data || []) as Record<string, any>[];
    } else if (resolvedInput === "json") {
      const text = buf.toString("utf8");
      const parsed = JSON.parse(text);
      rows = Array.isArray(parsed) ? parsed : [parsed];
    } else if (resolvedInput === "xml") {
      const text = buf.toString("utf8");
      rows = await xmlToRows(text);
    } else {
      const text = buf.toString("utf8");
      rows = txtToRows(text);
    }

    // 5) 출력 생성
    let outBuf: Buffer;
    let outMime = "application/octet-stream";
    let outName = `${baseName}.${outputType}`;

    if (outputType === "xlsx") {
      outBuf = rowsToXlsxBuffer(rows);
      outMime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    } else if (outputType === "csv") {
      outBuf = Buffer.from(rowsToCsv(rows), "utf8");
      outMime = "text/csv; charset=utf-8";
    } else if (outputType === "json") {
      outBuf = Buffer.from(JSON.stringify(rows, null, 2), "utf8");
      outMime = "application/json; charset=utf-8";
    } else if (outputType === "xml") {
      outBuf = Buffer.from(rowsToXml(rows), "utf8");
      outMime = "application/xml; charset=utf-8";
    } else {
      outBuf = Buffer.from(rowsToCsv(rows), "utf8");
      outMime = "text/plain; charset=utf-8";
      outName = `${baseName}.txt`;
    }

    // 6) 다운로드 응답
    return new NextResponse(outBuf, {
      status: 200,
      headers: {
        "Content-Type": outMime,
        "Content-Disposition": `attachment; filename="${encodeURIComponent(outName)}"`
      }
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, message: e?.message || "변환 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
