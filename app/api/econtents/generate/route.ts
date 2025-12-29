// app/api/econtents/generate/route.ts

import { NextResponse } from "next/server";
import path from "path";
import fs from "fs/promises";
import * as ExcelJS from "exceljs"; // ✅ default import 에러 방지
import mammoth from "mammoth";
import pdfParse from "pdf-parse";
import cheerio from "cheerio";

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
 * PDF: 텍스트 추출
 * ---------------------------- */
async function extractTextFromPdf(buffer: Buffer): Promise<string> {
  const data = await pdfParse(buffer);
  return data.text ?? "";
}

/* -----------------------------
 * Protocol 텍스트에서 정보 파싱
 * ---------------------------- */
function parseProtocolInfo(text: string) {
  // Study No: DW_DWPxxxxxxxx
  const studyNo = text.match(/DW[_-]DWP\d{8}/)?.[0] ?? "";

  // Sponsor
  const sponsor =
    text.match(/의뢰자\s*[:\-]?\s*(.+)/)?.[1]?.split("\n")[0]?.trim() ??
    text.match(/Sponsor\s*[:\-]?\s*(.+)/i)?.[1]?.split("\n")[0]?.trim() ??
    "";

  // Study Title
  const title =
    text.match(/임상시험\s*제목\s*[:\-]?\s*(.+)/)?.[1]?.split("\n")[0]?.trim() ??
    text.match(/Study\s*Title\s*[:\-]?\s*(.+)/i)?.[1]?.split("\n")[0]?.trim() ??
    "";

  // Protocol Version (예: Version 3.0, v3.0 등)
  const version =
    text.match(/\bVersion\s*[:\-]?\s*([0-9]+(\.[0-9]+)*)/i)?.[1]?.trim() ??
    text.match(/\bv\s*([0-9]+(\.[0-9]+)*)\b/i)?.[1]?.trim() ??
    "";

  // Date (가능한 패턴들)
  // - 2021-06-18 / 2021.06.18 / 20210618 / 200716(YYMMDD) 등
  const dateRaw =
    text.match(/\b(20\d{2}[-.\/](0[1-9]|1[0-2])[-.\/](0[1-9]|[12]\d|3[01]))\b/)?.[1] ??
    text.match(/\b(20\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01]))\b/)?.[1] ??
    text.match(/\b(\d{6})\b/)?.[1] ??
    "";

  return { studyNo, sponsor, title, version, dateRaw };
}

/* -----------------------------
 * 날짜 정규화 (가능한 경우만)
 * ---------------------------- */
function normalizeDate(dateRaw: string): string {
  const s = (dateRaw || "").trim();
  if (!s) return "";

  // 2021-06-18 / 2021.06.18 / 2021/06/18
  const m1 = s.match(/^(\d{4})[-.\/](\d{2})[-.\/](\d{2})$/);
  if (m1) return `${m1[1]}-${m1[2]}-${m1[3]}`;

  // 20210618
  const m2 = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m2) return `${m2[1]}-${m2[2]}-${m2[3]}`;

  // 200716 (YYMMDD) -> 2020-07-16 로 가정 (00~79 => 20xx, 80~99 => 19xx 같은 룰도 가능하지만 여기선 20xx 우선)
  const m3 = s.match(/^(\d{2})(\d{2})(\d{2})$/);
  if (m3) return `20${m3[1]}-${m3[2]}-${m3[3]}`;

  return s; // 모르면 원문 유지
}

/* -----------------------------
 * DOCX HTML에서 Schedule of Assessments 표 찾아 Visit 헤더 추출(최대 시도)
 * ---------------------------- */
function extractVisitsFromDocxHtml(docxHtml: string): string[] {
  // mammoth HTML은 <p>, <table>, <tr>, <td> 형태
  const $ = cheerio.load(docxHtml);

  // "Schedule of Assessments" 또는 "Schedule of assessment" 등 포함된 요소 찾기
  const scheduleNodes = $(":contains('Schedule of Assessments'), :contains('SCHEDULE OF ASSESSMENTS')");
  if (!scheduleNodes || scheduleNodes.length === 0) return [];

  // 가장 첫 schedule 노드 이후의 table 하나를 찾는다
  let table: cheerio.Cheerio | null = null;
  scheduleNodes.each((_, el) => {
    if (table) return;
    const nextTable = $(el).nextAll("table").first();
    if (nextTable && nextTable.length > 0) {
      table = nextTable;
    }
  });

  if (!table) return [];

  // table의 첫 번째 row를 헤더로 가정
  const headerTds = table.find("tr").first().find("td,th");
  if (!headerTds || headerTds.length === 0) return [];

  const headers: string[] = [];
  headerTds.each((_, td) => {
    const t = $(td).text().replace(/\s+/g, " ").trim();
    headers.push(t);
  });

  // 보통 첫 컬럼은 "Assessment/Procedure" 같은 라벨 → 제외
  const visitCandidates = headers.slice(1);

  // Visit 텍스트만 남기기 (너무 공격적으로 필터링하면 누락되므로 완화)
  // 예: "Visit 1 (Screening)", "Week 0", "EOT", "EOS" 등
  const cleaned = visitCandidates
    .map((v) => v.replace(/\s+/g, " ").trim())
    .filter((v) => v.length > 0);

  return cleaned;
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
    "Blank CRF Ver": info.version || "", // 없으면 빈 값 유지
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
 * 템플릿에 들어있는 기존 StudyNo를 전체 시트에서 새 StudyNo로 치환(메타 자동 반영)
 * - Form/Module 등에 "(System Variable - DW_DWP14012303 NA)" 같은 값 처리
 * ---------------------------- */
function replaceStudyNoEverywhere(
  workbook: ExcelJS.Workbook,
  oldStudyNo: string,
  newStudyNo: string
) {
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
 * Visit 시트: DOCX에서 추출된 방문 헤더로 "Visit n" 라인만 최대한 갱신
 * - 템플릿의 Registration/Informed Consent 등은 유지
 * - 템플릿의 "Visit 1 ~ Visit N" 형태 라인만 교체 (가능한 범위)
 * ---------------------------- */
function updateVisitSheetFromVisits(ws: ExcelJS.Worksheet, visits: string[]) {
  if (!visits || visits.length === 0) return;

  // 템플릿의 "Visit ..." 라인 찾기
  const visitRowIndexes: number[] = [];
  ws.eachRow((row, rowNumber) => {
    const visitName = String(row.getCell(2).value ?? "").trim();
    if (visitName.toLowerCase().startsWith("visit ")) {
      visitRowIndexes.push(rowNumber);
    }
  });

  if (visitRowIndexes.length === 0) return;

  // 교체 가능한 개수만큼만 업데이트
  const n = Math.min(visitRowIndexes.length, visits.length);

  for (let i = 0; i < n; i++) {
    const r = visitRowIndexes[i];
    const vName = visits[i];

    // No. 컬럼(1), Visit 컬럼(2), Stage(3)
    ws.getRow(r).getCell(2).value = vName;

    // Stage는 템플릿 규칙(101부터 증가)을 최대한 유지
    ws.getRow(r).getCell(3).value = 101 + i;
  }
}

/* -----------------------------
 * Navigation 자동 업데이트(가능할 때만)
 * - DOCX 표에서 "Form Name"까지 매칭 가능한 케이스는 제한적입니다.
 * - 그래서: 템플릿의 Navigation을 기본으로 두고,
 *   표의 row label이 템플릿 Form Name과 정확히 일치할 때만 체크(“X”)를 찍는 방식으로 "시도"합니다.
 * - 매칭이 거의 안 되면 결과는 템플릿 유지(안정성 우선).
 * ---------------------------- */
function tryUpdateNavigationFromDocxHtml(
  workbook: ExcelJS.Workbook,
  docxHtml: string
) {
  const nav = workbook.getWorksheet("Navigation");
  const formSheet = workbook.getWorksheet("Form");
  if (!nav || !formSheet) return;

  const $ = cheerio.load(docxHtml);

  // Schedule of Assessments 표 찾기
  const scheduleNodes = $(":contains('Schedule of Assessments'), :contains('SCHEDULE OF ASSESSMENTS')");
  if (!scheduleNodes || scheduleNodes.length === 0) return;

  let table: cheerio.Cheerio | null = null;
  scheduleNodes.each((_, el) => {
    if (table) return;
    const nextTable = $(el).nextAll("table").first();
    if (nextTable && nextTable.length > 0) table = nextTable;
  });
  if (!table) return;

  // Form Name 목록(템플릿) 수집: Form 시트의 B열(2)
  const formNames = new Set<string>();
  formSheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const name = String(row.getCell(2).value ?? "").trim();
    if (name) formNames.add(name);
  });

  // Navigation에서 form name => rowNumber 맵 생성 (B열)
  const navFormRowMap = new Map<string, number>();
  nav.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const name = String(row.getCell(2).value ?? "").trim();
    if (name) navFormRowMap.set(name, rowNumber);
  });

  // 표 파싱: 첫 행 = visit 헤더, 이후 행 = procedure/assessment
  const rows = table.find("tr");
  if (!rows || rows.length < 2) return;

  // visitCount는 표의 헤더 열 - 1
  const headerCells = rows.first().find("td,th");
  const visitCount = Math.max(0, headerCells.length - 1);

  // Navigation 컬럼은 C(3)부터 visit index (1..n)가 시작
  // 템플릿 Navigation의 컬럼 구조는 유지, visitCount 범위까지만 업데이트 시도
  rows.slice(1).each((_, tr) => {
    const cells = $(tr).find("td,th");
    if (cells.length < 2) return;

    const rowLabel = $(cells[0]).text().replace(/\s+/g, " ").trim();

    // 표의 rowLabel이 템플릿의 Form Name과 동일할 때만 처리(매칭 안정성)
    if (!formNames.has(rowLabel)) return;

    const navRowNumber = navFormRowMap.get(rowLabel);
    if (!navRowNumber) return;

    // 각 visit 칸에 마킹이 있으면 "X"로 반영
    for (let i = 0; i < visitCount; i++) {
      const cellText = $(cells[i + 1]).text().replace(/\s+/g, " ").trim();
      const hasMark = cellText !== "" && cellText !== "-" && cellText !== "NA";

      if (hasMark) {
        // Navigation: C열(3)부터 visit index
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

    // ✅ 업로드 파일 선택(DOCX 우선)
    const file = docx ?? pdf!;
    const ext = getExt(file.name);

    if (ext === "unknown") {
      return NextResponse.json(
        { message: "docx 또는 pdf만 업로드 가능합니다." },
        { status: 400 }
      );
    }

    const fileBuffer = Buffer.from(await file.arrayBuffer());

    // ✅ 텍스트/HTML 추출
    let text = "";
    let docxHtml = "";

    if (ext === "docx") {
      text = await extractTextFromDocx(fileBuffer);
      docxHtml = await extractHtmlFromDocx(fileBuffer);
    } else {
      text = await extractTextFromPdf(fileBuffer);
      // PDF는 HTML/표 추출이 안정적이지 않아 docxHtml은 비움
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

    // ✅ 템플릿 엑셀 로드(고정 서식)
    const templatePath = path.join(
      process.cwd(),
      "public",
      "templates",
      "econtents_template.xlsx"
    );

    const templateBuffer = await fs.readFile(templatePath);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(templateBuffer);

    // ✅ 템플릿의 기존 StudyNo 읽기(치환 기준)
    const protocolWs = workbook.getWorksheet("Protocol");
    if (!protocolWs) throw new Error("템플릿에서 'Protocol' 시트를 찾지 못했습니다.");

    const oldStudyNo = String(protocolWs.getCell("B1").value ?? "").trim();

    // ✅ Protocol 시트 채우기
    fillProtocolSheetByLabels(protocolWs, {
      studyNo: parsed.studyNo,
      title: parsed.title,
      sponsor: parsed.sponsor,
      version: parsed.version,
      blankCrfDate,
    });

    // ✅ Form/Module/Navigation/Visit 포함 전체에서 StudyNo 문자열 치환(메타 자동 반영)
    replaceStudyNoEverywhere(workbook, oldStudyNo, parsed.studyNo);

    // ✅ 1) 방문표 기반 시도(DOCX일 때만)
    if (ext === "docx" && docxHtml) {
      // Visit 헤더 추출 → Visit 시트의 "Visit n" 줄만 최대한 갱신
      const visits = extractVisitsFromDocxHtml(docxHtml);
      const visitWs = workbook.getWorksheet("Visit");
      if (visitWs && visits.length > 0) {
        updateVisitSheetFromVisits(visitWs, visits);
      }

      // Navigation은 "표 rowLabel == Form Name" 인 경우에만 제한적으로 업데이트 시도
      tryUpdateNavigationFromDocxHtml(workbook, docxHtml);
    }

    // ✅ 결과 파일 생성
    const outBuffer = await workbook.xlsx.writeBuffer();
    const outName = `${parsed.studyNo}_eCRF_contents.xlsx`;

    return new NextResponse(outBuffer, {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${encodeURIComponent(outName)}"`,
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { message: e?.message ?? "서버 처리 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
