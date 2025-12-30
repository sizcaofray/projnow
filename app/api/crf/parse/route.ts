// app/api/crf/parse/route.ts
import { NextResponse } from "next/server";
import * as mammoth from "mammoth";
import * as cheerio from "cheerio";

export const runtime = "nodejs";

/* =========================
 * 타입 정의
 * ========================= */

type Visit = {
  id: string;
  labelOriginal: string;
  labelDisplay: string;
  orderKey: number;
};

type Page = {
  id: string;
  name: string;
};

type Item = {
  id: string;
  nameOriginal: string;
  nameDisplay: string;
  pageId: string;
  evidence?: string;
  visitMap: Record<string, boolean>;
};

/* =========================
 * 유틸 함수
 * ========================= */

const trim = (v: string) => (v ?? "").replace(/\u00A0/g, " ").trim();

/** Visit 헤더 판별 (형식 불문) */
function isVisitHeader(text: string) {
  const t = trim(text).toLowerCase();
  if (!t) return false;

  return (
    /(visit\s*\d+|v\d+|screening|baseline|random|eot|eos|follow|unscheduled)/i.test(t) ||
    /(day\s*\d+|d\d+|week\s*\d+|w\d+|month\s*\d+|m\d+|c\d+d\d+)/i.test(t)
  );
}

/** Visit 정규화 */
function normalizeVisit(label: string): Visit {
  const raw = trim(label);
  const low = raw.toLowerCase();

  let orderKey = 999999;
  let id = raw.replace(/\s+/g, "_").toLowerCase();

  if (/screening/.test(low)) orderKey = 0;
  if (/baseline/.test(low)) orderKey = 10;

  const num =
    raw.match(/visit\s*(\d+)/i)?.[1] ||
    raw.match(/\bd(\d+)/i)?.[1] ||
    raw.match(/\bw(\d+)/i)?.[1];

  if (num) orderKey = 100 + Number(num);

  return {
    id,
    labelOriginal: raw,
    labelDisplay: raw,
    orderKey,
  };
}

/** 셀 값이 "수집됨"인지 */
function cellTrue(text: string) {
  const t = trim(text).toLowerCase();
  if (!t) return false;
  return (
    ["○", "●", "✓", "✔", "x", "y", "yes"].some((s) => t.includes(s)) ||
    /\d/.test(t) ||
    t.includes("window")
  );
}

/** Item → Page 자동 그룹핑 */
function inferPage(name: string) {
  const t = name.toLowerCase();

  if (/consent/.test(t)) return "Informed Consent";
  if (/inclusion|exclusion/.test(t)) return "Eligibility";
  if (/demograph/.test(t)) return "Demographics";
  if (/history/.test(t)) return "Medical History";
  if (/vital/.test(t)) return "Vital Signs";
  if (/physical/.test(t)) return "Physical Exam";
  if (/lab/.test(t)) return "Laboratory";
  if (/ecg/.test(t)) return "ECG";
  if (/ae|adverse/.test(t)) return "Adverse Events";
  if (/drug|dose/.test(t)) return "Treatment";

  return "General";
}

/* =========================
 * 메인 파싱 로직
 * ========================= */

function parseScheduleTable(html: string) {
  const $ = cheerio.load(html);
  const tables = $("table").toArray();

  let bestTable: cheerio.Element | null = null;
  let bestScore = 0;

  // 스케줄 테이블 후보 선정
  for (const tbl of tables) {
    const headers = $(tbl)
      .find("tr")
      .first()
      .find("th,td")
      .toArray()
      .map((c) => trim($(c).text()));

    const visitCount = headers.filter(isVisitHeader).length;
    if (visitCount > bestScore) {
      bestScore = visitCount;
      bestTable = tbl;
    }
  }

  if (!bestTable) return null;

  const rows = $(bestTable).find("tr").toArray();

  // 헤더 행
  const headerCells = $(rows[0]).find("th,td").toArray();
  const visitIndexes: number[] = [];
  const visits: Visit[] = [];

  headerCells.forEach((c, idx) => {
    const text = trim($(c).text());
    if (isVisitHeader(text)) {
      visitIndexes.push(idx);
      visits.push(normalizeVisit(text));
    }
  });

  const pages: Record<string, Page> = {};
  const items: Item[] = [];

  // 데이터 행
  for (let i = 1; i < rows.length; i++) {
    const cells = $(rows[i]).find("td,th").toArray();
    if (!cells.length) continue;

    const itemName = trim($(cells[0]).text());
    if (!itemName) continue;

    const pageName = inferPage(itemName);
    if (!pages[pageName]) {
      pages[pageName] = { id: `p_${Object.keys(pages).length + 1}`, name: pageName };
    }

    const visitMap: Record<string, boolean> = {};
    visitIndexes.forEach((colIdx, vIdx) => {
      const cellText = trim($(cells[colIdx]).text());
      visitMap[visits[vIdx].id] = cellTrue(cellText);
    });

    items.push({
      id: `i_${items.length + 1}`,
      nameOriginal: itemName,
      nameDisplay: itemName,
      pageId: pages[pageName].id,
      visitMap,
    });
  }

  return {
    visits: visits.sort((a, b) => a.orderKey - b.orderKey),
    pages: Object.values(pages),
    items,
  };
}

/* =========================
 * Route Handler
 * ========================= */

export async function POST(req: Request) {
  const form = await req.formData();
  const file = form.get("file") as File;

  if (!file) {
    return NextResponse.json({ ok: false, message: "No file" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const { value: html } = await mammoth.convertToHtml({ buffer });

  const parsed = parseScheduleTable(html);
  if (!parsed) {
    return NextResponse.json({ ok: false, message: "No schedule table detected" });
  }

  return NextResponse.json({ ok: true, ...parsed });
}
