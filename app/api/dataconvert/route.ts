// app/api/dataconvert/route.ts
// - 업로드된 파일을 입력 포맷에 맞게 파싱한 뒤, 사용자가 선택한 출력 포맷으로 변환해 다운로드 응답을 반환합니다.
// - ✅ 다중 파일 업로드 지원
//   - 여러 파일 + outputType=xlsx + excelMultiMode=singleWorkbook => 한 엑셀 파일(파일별 시트)로 생성
//   - 그 외는 단일 파일 변환(클라이언트가 각 파일을 개별 호출하여 다운로드)
// - SAS(.sas7bdat)는 파일 경로 기반 parse가 필요하여 /tmp에 임시 저장 후 처리합니다.
// - ✅ ESM 환경에서 require 사용을 위해 createRequire(import.meta.url) 사용 (require is not defined 해결)
// - ✅ NextResponse body 타입(BodyInit) 문제로 Buffer 대신 Uint8Array로 반환합니다.

import { NextResponse } from "next/server";
import * as XLSX from "xlsx"; // SheetJS
import Papa from "papaparse"; // CSV parser
import { parseStringPromise, Builder as XmlBuilder } from "xml2js"; // XML parser/builder
import fs from "fs/promises";
import path from "path";
import os from "os";
import { createRequire } from "module"; // ✅ ESM에서 require 만들기

// ✅ Node 런타임 강제 (Edge면 fs/tmp/native 모듈 불가)
export const runtime = "nodejs";

// ✅ ESM에서 require 대체
const nodeRequire = createRequire(import.meta.url);

// ---- 유틸: 파일명 안전화 ----
function safeBaseName(name: string) {
  return name.replace(/[\\\/:*?"<>|]/g, "_").trim() || "file";
}

// ---- 유틸: Excel 시트명 안전화/중복 방지 (최대 31자) ----
function makeUniqueSheetName(rawName: string, used: Set<string>) {
  // Excel 시트명 금지 문자: : \ / ? * [ ]
  const cleaned = rawName
    .replace(/[:\\\/\?\*\[\]]/g, "_")
    .replace(/\s+/g, " ")
    .trim();

  const base = (cleaned || "Sheet").slice(0, 31);
  let name = base;
  let i = 2;

  while (used.has(name)) {
    const suffix = `(${i})`;
    const cut = Math.max(0, 31 - suffix.length);
    name = base.slice(0, cut) + suffix;
    i++;
  }

  used.add(name);
  return name;
}

// ---- 유틸: rows(JSON[]) -> XLSX workbook(Buffer) ----
function rowsToXlsxBuffer(rows: Record<string, any>[]) {
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");

  const buf = XLSX.write(wb, { bookType: "xlsx", type: "buffer" });
  return buf as Buffer;
}

// ---- 유틸: 여러 시트 workbook(Buffer) 생성 ----
function multiSheetsToXlsxBuffer(
  sheets: { name: string; rows: Record<string, any>[] }[]
) {
  const wb = XLSX.utils.book_new();

  for (const s of sheets) {
    const ws = XLSX.utils.json_to_sheet(s.rows);
    XLSX.utils.book_append_sheet(wb, ws, s.name);
  }

  const buf = XLSX.write(wb, { bookType: "xlsx", type: "buffer" });
  return buf as Buffer;
}

// ---- 유틸: rows(JSON[]) -> CSV ----
function rowsToCsv(rows: Record<string, any>[]) {
  return Papa.unparse(rows, { quotes: false });
}

// ---- 유틸: XLSX Buffer -> rows(JSON[]) ----
function xlsxBufferToRows(buf: Buffer) {
  const wb = XLSX.read(buf, { type: "buffer" });
  const firstSheetName = wb.SheetNames[0];
  const ws = wb.Sheets[firstSheetName];
  return XLSX.utils.sheet_to_json<Record<string, any>>(ws, { defval: "" });
}

// ---- 유틸: TXT -> rows(JSON[]) ----
function txtToRows(text: string) {
  const tabCount = (text.match(/\t/g) || []).length;
  const commaCount = (text.match(/,/g) || []).length;
  const delimiter = tabCount > commaCount ? "\t" : ",";

  const parsed = Papa.parse<Record<string, any>>(text, {
    header: true,
    delimiter,
    skipEmptyLines: true,
  });

  if (!parsed.data || parsed.data.length === 0) return [];
  return parsed.data as Record<string, any>[];
}

// ---- 유틸: XML -> rows(JSON[]) ----
function xmlToRows(xml: string) {
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

// ---- 유틸: 단일 File -> rows(JSON[]) ----
async function parseFileToRows(file: File, inputType: string) {
  const originalName = file.name || "upload";
  const baseName = safeBaseName(originalName.replace(/\.[^/.]+$/, ""));
  const ext = (originalName.split(".").pop() || "").toLowerCase();

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

  const ab = await file.arrayBuffer();
  const buf = Buffer.from(ab);

  let rows: Record<string, any>[] = [];

  if (resolvedInput === "sas") {
    // ✅ require is not defined 해결: createRequire로 로드
    const SAS7BDAT = nodeRequire("sas7bdat");

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
      skipEmptyLines: true,
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

  return { baseName, rows };
}

export async function POST(req: Request) {
  try {
    const formData = await req.formData();

    // ✅ 단일(file) + 다중(files) 모두 지원
    const single = formData.get("file");
    const multi = formData.getAll("files");

    const inputType = String(formData.get("inputType") || "auto");
    const outputType = String(formData.get("outputType") || "xlsx");

    // ✅ 다중 Excel 모드 (기본: singleWorkbook)
    const excelMultiMode = String(
      formData.get("excelMultiMode") || "singleWorkbook"
    );

    const files: File[] =
      multi && multi.length > 0
        ? multi.filter((v): v is File => v instanceof File)
        : single instanceof File
          ? [single]
          : [];

    if (files.length === 0) {
      return NextResponse.json({ ok: false, message: "파일이 없습니다." }, { status: 400 });
    }

    // ✅ 여러 파일 + 한 엑셀(시트 분리) 모드
    const isMultiToSingleWorkbook =
      files.length > 1 &&
      outputType === "xlsx" &&
      excelMultiMode === "singleWorkbook";

    if (isMultiToSingleWorkbook) {
      const used = new Set<string>();
      const sheets: { name: string; rows: Record<string, any>[] }[] = [];

      for (const f of files) {
        const parsed = await parseFileToRows(f, inputType);
        const sheetName = makeUniqueSheetName(parsed.baseName, used);
        sheets.push({ name: sheetName, rows: parsed.rows });
      }

      const outBuf = multiSheetsToXlsxBuffer(sheets);
      const body = new Uint8Array(outBuf);

      const outName = `converted.xlsx`;
      return new NextResponse(body, {
        status: 200,
        headers: {
          "Content-Type":
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="${encodeURIComponent(outName)}"`,
        },
      });
    }

    // ✅ 그 외(단일 변환): 첫 파일만 처리
    const file = files[0];
    const originalName = file.name || "upload";
    const baseName = safeBaseName(originalName.replace(/\.[^/.]+$/, ""));

    const parsed = await parseFileToRows(file, inputType);
    const rows = parsed.rows;

    let outBuf: Buffer;
    let outMime = "application/octet-stream";
    let outName = `${baseName}.${outputType}`;

    if (outputType === "xlsx") {
      outBuf = rowsToXlsxBuffer(rows);
      outMime =
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
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

    const body = new Uint8Array(outBuf);

    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": outMime,
        "Content-Disposition": `attachment; filename="${encodeURIComponent(outName)}"`,
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, message: e?.message || "변환 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
