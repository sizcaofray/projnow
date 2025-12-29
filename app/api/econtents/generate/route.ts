// app/api/econtents/generate/route.ts

import { NextResponse } from "next/server";
import path from "path";
import fs from "fs/promises";
import * as ExcelJS from "exceljs";
import mammoth from "mammoth";
import { load, type CheerioAPI, type Cheerio } from "cheerio";

export const runtime = "nodejs";

/* -----------------------------
 * 유틸: 확장자 판별
 * ---------------------------- */
function getExt(filename: string) {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".docx")) return "docx";
  if (lower.endsWith(".pdf")) return "pdf";
  return "unknown";
}

/* -----------------------------
 * DOCX: 텍스트/HTML 추출
 * ---------------------------- */
async function extractTextFromDocx(buffer: Buffer): Promise<string> {
  const result = await mammoth.extractRawText({ buffer });
  return result.value ?? "";
}

async function extractHtmlFromDocx(buffer: Buffer): Promise<string> {
  const result = await mammoth.convertToHtml({ buffer });
  return result.value ?? "";
}

/* -----------------------------
 * PDF: 텍스트 추출 (Turbopack/ESM 호환: 동적 import)
 * ---------------------------- */
async function extractTextFromPdf(buffer: Buffer): Promise<string> {
  const mod: unknown = await import("pdf-parse");
  const m = mod as { default?: unknown; pdfParse?: unknown };

  const pdfParseFn = (m.default ?? m.pdfParse ?? mod) as unknown;

  if (typeof pdfParseFn !== "function") {
    throw new Error("pdf-parse 모듈 로딩 실패: export 형태를 확인할 수 없습니다.");
  }

  const data = await (pdfParseFn as (b: Buffer) => Promise<{ text?: string }>)(buffer);
  return data?.text ?? "";
}

/* -----------------------------
 * Protocol 텍스트에서 정보 파싱
 * ---------------------------- */
function parseProtocolInfo(text: string) {
  const studyNo = text.match(/DW[_-]DWP\d{8}/)?.[0] ?? "";

  const sponsor =
    text.match(/의뢰자\s*[:\-]?\s*(.+)/)?.[1]?.split("\n")[0]?.trim() ??
    text.match(/Sponsor\s*[:\-]?\s*(.+)/i)?.[1]?.split("\n")[0]?.trim() ??
    "";

  const title =
    text.match(/임상시험\s*제목\s*[:\-]?\s*(.+)/)?.[1]?.split("\n")[0]?.trim() ??
    text.match(/Study\s*Title\s*[:\-]?\s*(.+)/i)?.[1]?.split("\n")[0]?.trim() ??
    "";

  const version =
    text.match(/\bVersion\s*[:\-]?\s*([0-9]+(\.[0-9]+)*)/i)?.[1]?.trim() ??
    text.match(/\bv\s*([0-9]+(\.[0-9]+)*)\b/i)?.[1]?.trim() ??
    "";

  const dateRaw =
    text.match(/\b(20\d{2}[-.\/](0[1-9]|1[0-2])[-.\/](0[1-9]|[12]\d|3[01]))\b/)?.[1] ??
    text.match(/\b(20\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01]))\b/)?.[1] ??
    text.match(/\b(\d{6})\b/)?.[1] ??
    "";

  return { studyNo, sponsor, title, version, dateRaw };
}

/* -----------------------------
 * 날짜 정규화
 * ---------------------------- */
function normalizeDate(dateRaw: string): string {
  const s = (dateRaw || "").trim();
  if (!s) return "";

  const m1 = s.match(/^(\d{4})[-.\/](\d{2})[-.\/](\d{2})$/);
  if (m1) return `${m1[1]}-${m1[2]}-${m1[3]}`;

  const m2 = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m2) return `${m2[1]}-${m2[2]}-${m2[3]}`;

  const m3 = s.match(/^(\d{2})(\d{2})(\d{2})$/);
  if (m3) return `20${m3[1]}-${m3[2]}-${m3[3]}`;

  return s;
}

/* -----------------------------
 * DOCX HTML에서 Schedule of Assessments 표 헤더(Visit) 추출
 * - cheerio 버전 의존 타입(AnyNode 등) 제거
 * - 타입은 unknown으로 받고, 사용할 때만 as any 처리
 * ---------------------------- */
function extractVisitsFromDocxHtml(docxHtml: string): string[] {
  const $: CheerioAPI = load(docxHtml);

  const scheduleNodes = $(":contains('Schedule of Assessments'), :contains('SCHEDULE OF ASSESSMENTS')");
  if (!scheduleNodes || scheduleNodes.length === 0) return [];

  // ✅ Cheerio<unknown>으로 고정(never 방지)
  let table: Cheerio<unknown> | null = null;

  scheduleNodes.each((idx: number, el: unknown) => {
    if (table) return;
    const nextTable = $(el as any).nextAll("table").first();
    if (nextTable && nextTable.length > 0) table = nextTable as Cheerio<unknown>;
  });

  if (!table) return [];

  const headerTds = (table as any).find("tr").first().find("td,th");
  if (!headerTds || headerTds.length === 0) return [];

  const headers: string[] = [];
  headerTds.each((idx: number, td: unknown) => {
    const t = $(td as any).text().replace(/\s+/g, " ").trim();
    headers.push(t);
  });

  const visitCandidates = headers.slice(1);
  return visitCandidates.map((v) => v.replace(/\s+/g, " ").trim()).filter(Boolean);
}

/* -----------------------------
 * Protocol 시트 채우기(라벨 기반)
 * ---------------------------- */
function fillProtocolSheetByLabels(
  ws: ExcelJS.Worksheet,
  info: {
    studyNo: string;
    title: string;
    sponsor: string;
    version: string;
    blankCrfDate: string;
  }
) {
  const map: Record<string, string> = {
    "Study No": info.studyNo,
    "Study Title": info.title,
    "Sponsor": info.sponsor,
    "Blank CRF Ver": info.version || "",
    "Blank CRF Date": info.blankCrfDate || "",
  };

  ws.eachRow((row) => {
    const label = String(row.getCell(1).value ?? "").trim();
    if (label && Object.prototype.hasOwnProperty.call(map, label)) {
      const val = map[label];
      if (val !== undefined && val !== null && String(val).trim() !== "") {
        row.getCell(2).value = val;
      }
    }
  });
}

/* -----------------------------
 * 템플릿 내 기존 StudyNo -> 새 StudyNo 전체 치환
 * ---------------------------- */
function replaceStudyNoEverywhere(workbook: ExcelJS.Workbook, oldStudyNo: string, newStudyNo: string) {
  if (!oldStudyNo || !newStudyNo || oldStudyNo === newStudyNo) return;

  workbook.eachSheet((ws) => {
    ws.eachRow((row) => {
      row.eachCell((cell) => {
        const v = cell.value;
        if (typeof v === "string" && v.includes(oldStudyNo)) {
          cell.value = v.split(oldStudyNo).join(newStudyNo);
        }
      });
    });
  });
}

/* -----------------------------
 * Visit 시트 업데이트(Visit n 라인만 교체)
 * ---------------------------- */
function updateVisitSheetFromVisits(ws: ExcelJS.Worksheet, visits: string[]) {
  if (!visits || visits.length === 0) return;

  const visitRowIndexes: number[] = [];
  ws.eachRow((row, rowNumber) => {
    const visitName = String(row.getCell(2).value ?? "").trim();
    if (visitName.toLowerCase().startsWith("visit ")) visitRowIndexes.push(rowNumber);
  });

  if (visitRowIndexes.length === 0) return;

  const n = Math.min(visitRowIndexes.length, visits.length);
  for (let i = 0; i < n; i++) {
    const r = visitRowIndexes[i];
    ws.getRow(r).getCell(2).value = visits[i];
    ws.getRow(r).getCell(3).value = 101 + i;
  }
}

/* -----------------------------
 * Navigation 업데이트 시도(가능할 때만)
 * ---------------------------- */
function tryUpdateNavigationFromDocxHtml(workbook: ExcelJS.Workbook, docxHtml: string) {
  const nav = workbook.getWorksheet("Navigation");
  const formSheet = workbook.getWorksheet("Form");
  if (!nav || !formSheet) return;

  const $: CheerioAPI = load(docxHtml);

  const scheduleNodes = $(":contains('Schedule of Assessments'), :contains('SCHEDULE OF ASSESSMENTS')");
  if (!scheduleNodes || scheduleNodes.length === 0) return;

  let table: Cheerio<unknown> | null = null;

  scheduleNodes.each((idx: number, el: unknown) => {
    if (table) return;
    const nextTable = $(el as any).nextAll("table").first();
    if (nextTable && nextTable.length > 0) table = nextTable as Cheerio<unknown>;
  });

  if (!table) return;

  const formNames = new Set<string>();
  formSheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const name = String(row.getCell(2).value ?? "").trim();
    if (name) formNames.add(name);
  });

  const navFormRowMap = new Map<string, number>();
  nav.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const name = String(row.getCell(2).value ?? "").trim();
    if (name) navFormRowMap.set(name, rowNumber);
  });

  const rows = (table as any).find("tr");
  if (!rows || rows.length < 2) return;

  const headerCells = rows.first().find("td,th");
  const visitCount = Math.max(0, headerCells.length - 1);

  rows.slice(1).each((idx: number, tr: unknown) => {
    const cells = $(tr as any).find("td,th");
    if (cells.length < 2) return;

    const rowLabel = $(cells[0] as any).text().replace(/\s+/g, " ").trim();
    if (!formNames.has(rowLabel)) return;

    const navRowNumber = navFormRowMap.get(rowLabel);
    if (!navRowNumber) return;

    for (let i = 0; i < visitCount; i++) {
      const cellText = $(cells[i + 1] as any).text().replace(/\s+/g, " ").trim();
      const hasMark = cellText !== "" && cellText !== "-" && cellText.toUpperCase() !== "NA";
      if (hasMark) {
        nav.getRow(navRowNumber).getCell(3 + i).value = "X";
      }
    }
  });
}

/* -----------------------------
 * 메인
 * ---------------------------- */
export async function POST(req: Request) {
  try {
    const formData = await req.formData();

    const docx = formData.get("docx") as File | null;
    const pdf = formData.get("pdf") as File | null;

    if (!docx && !pdf) {
      return NextResponse.json(
        { message: "Protocol DOCX 또는 PDF 중 하나를 업로드해 주세요." },
        { status: 400 }
      );
    }

    const file = docx ?? pdf!;
    const ext = getExt(file.name);

    if (ext === "unknown") {
      return NextResponse.json({ message: "docx 또는 pdf만 업로드 가능합니다." }, { status: 400 });
    }

    const fileBuffer = Buffer.from(await file.arrayBuffer());

    let text = "";
    let docxHtml = "";

    if (ext === "docx") {
      text = await extractTextFromDocx(fileBuffer);
      docxHtml = await extractHtmlFromDocx(fileBuffer);
    } else {
      text = await extractTextFromPdf(fileBuffer);
      docxHtml = "";
    }

    const parsed = parseProtocolInfo(text);
    if (!parsed.studyNo) {
      return NextResponse.json(
        { message: "Study No(DW_DWPxxxxxxxx)를 문서에서 찾지 못했습니다. 문서 형식을 확인해 주세요." },
        { status: 422 }
      );
    }

    const blankCrfDate = normalizeDate(parsed.dateRaw);

    const templatePath = path.join(process.cwd(), "public", "templates", "econtents_template.xlsx");
    const templateBuffer = await fs.readFile(templatePath);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(templateBuffer);

    const protocolWs = workbook.getWorksheet("Protocol");
    if (!protocolWs) throw new Error("템플릿에서 'Protocol' 시트를 찾지 못했습니다.");

    const oldStudyNo = String(protocolWs.getCell("B1").value ?? "").trim();

    fillProtocolSheetByLabels(protocolWs, {
      studyNo: parsed.studyNo,
      title: parsed.title,
      sponsor: parsed.sponsor,
      version: parsed.version,
      blankCrfDate,
    });

    replaceStudyNoEverywhere(workbook, oldStudyNo, parsed.studyNo);

    if (ext === "docx" && docxHtml) {
      const visits = extractVisitsFromDocxHtml(docxHtml);

      const visitWs = workbook.getWorksheet("Visit");
      if (visitWs && visits.length > 0) {
        updateVisitSheetFromVisits(visitWs, visits);
      }

      tryUpdateNavigationFromDocxHtml(workbook, docxHtml);
    }

    const outBuffer = await workbook.xlsx.writeBuffer();
    const outName = `${parsed.studyNo}_eCRF_contents.xlsx`;

    return new NextResponse(outBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${encodeURIComponent(outName)}"`,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ message: e?.message ?? "서버 처리 중 오류가 발생했습니다." }, { status: 500 });
  }
}
