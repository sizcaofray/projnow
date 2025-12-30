// app/api/crf/parse/route.ts
import { NextResponse } from "next/server";
import * as mammoth from "mammoth";
import * as cheerio from "cheerio";

/**
 * docx 파싱(mammoth) + cheerio는 Node 런타임이 안정적이므로 명시합니다.
 */
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
 * 유틸
 * ========================= */

function safeTrim(v: string) {
  return (v ?? "").replace(/\u00A0/g, " ").trim();
}

/**
 * Visit 헤더인지 판단(형식 불문)
 * - Visit 1 / V1 / Screening / Baseline / Day 1 / Week 4 / C1D1 등
 */
function isVisitLikeHeader(text: string) {
  const t = safeTrim(text).toLowerCase();
  if (!t) return false;

  const patterns: RegExp[] = [
    /\bvisit\s*\d+\b/i,
    /\bv\s*\d+\b/i,
    /\bscreening\b/i,
    /\bbaseline\b/i,
    /\brandom/i,
    /\beot\b/i,
    /\beos\b/i,
    /\bfollow/i,
    /\bunscheduled\b/i,
    /\bday\s*\d+\b/i,
    /\bd\s*\d+\b/i,
    /\bweek\s*\d+\b/i,
    /\bw\s*\d+\b/i,
    /\bmonth\s*\d+\b/i,
    /\bm\s*\d+\b/i,
    /\bc\d+\s*d\d+\b/i,
    /\bc\d+d\d+\b/i,
  ];

  return patterns.some((p) => p.test(t));
}

/**
 * Visit 라벨을 내부 ID / 정렬키로 정규화
 */
function normalizeVisitLabel(label: string): Visit {
  const raw = safeTrim(label);
  const low = raw.toLowerCase();

  let orderKey = 999999;
  let id =
    `v_${raw.replace(/\s+/g, "_").replace(/[^a-zA-Z0-9_]/g, "").toLowerCase() || "x"}`;

  // 고정 키워드 우선 정렬
  const fixedOrder: Array<[RegExp, number, string]> = [
    [/screening/i, 0, "screening"],
    [/baseline/i, 10, "baseline"],
    [/random/i, 15, "randomization"],
    [/unscheduled/i, 900000, "unscheduled"],
    [/\beot\b/i, 950000, "eot"],
    [/\beos\b/i, 980000, "eos"],
    [/follow/i, 990000, "followup"],
  ];

  for (const [re, ok, key] of fixedOrder) {
    if (re.test(raw)) {
      orderKey = ok;
      id = key;
      break;
    }
  }

  // Visit 숫자
  const mVisit = raw.match(/visit\s*(\d+)/i) || raw.match(/\bv\s*(\d+)\b/i);
  if (mVisit?.[1]) {
    const n = Number(mVisit[1]);
    if (!Number.isNaN(n)) {
      orderKey = 100 + n;
      id = `visit${n}`;
    }
  }

  // Day/Week/Month 숫자
  const mDay = raw.match(/day\s*(\d+)/i) || raw.match(/\bd\s*(\d+)\b/i);
  if (mDay?.[1]) {
    const n = Number(mDay[1]);
    if (!Number.isNaN(n)) {
      orderKey = 1000 + n;
      id = `day${n}`;
    }
  }

  const mWeek = raw.match(/week\s*(\d+)/i) || raw.match(/\bw\s*(\d+)\b/i);
  if (mWeek?.[1]) {
    const n = Number(mWeek[1]);
    if (!Number.isNaN(n)) {
      orderKey = 2000 + n;
      id = `week${n}`;
    }
  }

  const mMonth = raw.match(/month\s*(\d+)/i) || raw.match(/\bm\s*(\d+)\b/i);
  if (mMonth?.[1]) {
    const n = Number(mMonth[1]);
    if (!Number.isNaN(n)) {
      orderKey = 3000 + n;
      id = `month${n}`;
    }
  }

  // Cycle-Day: CxDy
  const mC = raw.match(/c(\d+)\s*d(\d+)/i) || raw.match(/c(\d+)d(\d+)/i);
  if (mC?.[1] && mC?.[2]) {
    const c = Number(mC[1]);
    const d = Number(mC[2]);
    if (!Number.isNaN(c) && !Number.isNaN(d)) {
      orderKey = 4000 + c * 100 + d;
      id = `c${c}d${d}`;
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _ = low; // low는 디버깅 시 유용하므로 남김

  return {
    id,
    labelOriginal: raw,
    labelDisplay: raw,
    orderKey,
  };
}

/**
 * 셀 값이 수행/수집을 의미하는지 판단
 */
function cellTruthy(text: string) {
  const t = safeTrim(text);
  if (!t) return false;

  const normalized = t.toLowerCase();
  const symbols = ["○", "●", "◯", "✓", "✔", "y", "yes", "true", "x"];

  if (symbols.includes(normalized)) return true;
  if (symbols.some((s) => t.includes(s))) return true;

  if (/[0-9]/.test(t)) return true;
  if (normalized.includes("window")) return true;
  if (normalized.includes("required")) return true;

  return false;
}

/**
 * Item -> Page 자동 그룹핑(MVP)
 */
function inferPageName(itemName: string) {
  const t = safeTrim(itemName).toLowerCase();

  const rules: Array<[RegExp, string]> = [
    [/informed\s*consent|동의/i, "Informed Consent"],
    [/inclusion|exclusion|선정|제외/i, "Eligibility"],
    [/demograph|인구학/i, "Demographics"],
    [/medical\s*history|병력|과거력/i, "Medical History"],
    [/vital|활력/i, "Vital Signs"],
    [/physical\s*exam|신체검사/i, "Physical Exam"],
    [/lab|laboratory|실험실/i, "Laboratory"],
    [/pregnan|임신/i, "Pregnancy Test"],
    [/ecg|electrocard/i, "ECG"],
    [/endoscopy|내시경/i, "Endoscopy"],
    [/symptom|증상/i, "Symptoms"],
    [/quality|qol|설문|questionnaire/i, "QoL / Questionnaire"],
    [/ae|adverse|이상반응/i, "Adverse Events"],
    [/concomitant|병용약/i, "Concomitant Meds"],
    [/drug|dose|투약|복약/i, "Treatment / Exposure"],
  ];

  for (const [re, page] of rules) {
    if (re.test(itemName) || re.test(t)) return page;
  }
  return "General";
}

/**
 * 모든 테이블 중 "Visit 헤더"가 가장 많이 잡히는 테이블을 스케줄표 후보로 선택
 * - cheerio.Element 타입을 쓰지 않도록 any로 처리 (ESM 타입 호환 이슈 방지)
 */
function pickBestScheduleTable($: cheerio.CheerioAPI) {
  const tables = $("table").toArray();
  if (tables.length === 0) return null;

  let best: { score: number; table: any } | null = null;

  for (const tbl of tables) {
    const $tbl = $(tbl);

    // 첫 2행까지 헤더 후보
    const headerCells: string[] = [];
    $tbl
      .find("tr")
      .slice(0, 2)
      .each((_, tr) => {
        $(tr)
          .find("th,td")
          .each((__, c) => headerCells.push(safeTrim($(c).text())));
      });

    const visitLikeCount = headerCells.filter((h) => isVisitLikeHeader(h)).length;
    const rowCount = $tbl.find("tr").length;

    const score = visitLikeCount * 10 + Math.min(rowCount, 50);

    if (!best || score > best.score) best = { score, table: tbl };
  }

  if (!best || best.score < 20) return null;
  return best.table;
}

/**
 * 스케줄 테이블에서 visits/pages/items 생성
 */
function parseScheduleTable(html: string) {
  const $ = cheerio.load(html);

  const tableEl = pickBestScheduleTable($);

  if (!tableEl) {
    return {
      visits: [] as Visit[],
      pages: [] as Page[],
      items: [] as Item[],
      warnings: ["No schedule-like table detected. (MVP: fallback not implemented)"],
    };
  }

  const $tbl = $(tableEl);
  const rows = $tbl.find("tr").toArray();

  // 1) 헤더 행 찾기(visit-like 가장 많은 행)
  let headerRowIdx = 0;
  let maxVisitLike = -1;

  rows.slice(0, Math.min(rows.length, 5)).forEach((tr, idx) => {
    const cells = $(tr).find("th,td").toArray();
    const texts = cells.map((c) => safeTrim($(c).text()));
    const cnt = texts.filter(isVisitLikeHeader).length;
    if (cnt > maxVisitLike) {
      maxVisitLike = cnt;
      headerRowIdx = idx;
    }
  });

  const headerCells = $(rows[headerRowIdx]).find("th,td").toArray();
  const headerTexts = headerCells.map((c) => safeTrim($(c).text()));

  // 2) Visit 컬럼 인덱스 + 라벨 수집(헤더 순서 유지)
  const visitCols: Array<{ colIdx: number; visit: Visit }> = [];
  headerTexts.forEach((h, idx) => {
    if (isVisitLikeHeader(h)) {
      visitCols.push({ colIdx: idx, visit: normalizeVisitLabel(h) });
    }
  });

  if (visitCols.length < 2) {
    return {
      visits: [] as Visit[],
      pages: [] as Page[],
      items: [] as Item[],
      warnings: ["Schedule table found but visit headers are insufficient."],
    };
  }

  // 중복 visitId 제거 + 정렬(표시/정렬용)
  const uniq: Record<string, Visit> = {};
  for (const vc of visitCols) uniq[vc.visit.id] = vc.visit;

  const visits = Object.values(uniq).sort((a, b) => a.orderKey - b.orderKey);

  // 3) 아이템 파싱
  const items: Item[] = [];
  const pagesMap: Record<string, Page> = {};

  for (let r = headerRowIdx + 1; r < rows.length; r++) {
    const cells = $(rows[r]).find("th,td").toArray();
    if (cells.length === 0) continue;

    // item명 후보: 첫 셀(가장 흔한 케이스)
    let itemName = safeTrim($(cells[0]).text());

    // 비어 있으면 visit 컬럼이 아닌 것 중 가장 긴 텍스트 선택
    if (!itemName) {
      const texts = cells.map((c) => safeTrim($(c).text()));
      const nonVisitTexts = texts
        .map((t, idx) => ({ t, idx }))
        .filter((x) => !visitCols.some((vc) => vc.colIdx === x.idx))
        .map((x) => x.t)
        .filter(Boolean);

      itemName = nonVisitTexts.sort((a, b) => b.length - a.length)[0] || "";
    }

    if (!itemName || itemName.length < 2) continue;

    // 페이지 추론
    const pageName = inferPageName(itemName);
    if (!pagesMap[pageName]) {
      pagesMap[pageName] = { id: `p_${Object.keys(pagesMap).length + 1}`, name: pageName };
    }

    // visitMap 생성
    const visitMap: Record<string, boolean> = {};
    const evidenceParts: string[] = [];

    for (const vc of visitCols) {
      const cellText = safeTrim($(cells[vc.colIdx]).text());
      visitMap[vc.visit.id] = cellTruthy(cellText);
      if (cellText) evidenceParts.push(`${vc.visit.labelDisplay}:${cellText}`);
    }

    items.push({
      id: `i_${items.length + 1}`,
      nameOriginal: itemName,
      nameDisplay: itemName,
      pageId: pagesMap[pageName].id,
      evidence: evidenceParts.join(" | "),
      visitMap,
    });
  }

  const pages = Object.values(pagesMap);

  return { visits, pages, items, warnings: [] as string[] };
}

/* =========================
 * Route Handler
 * ========================= */

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get("file");

    if (!file || !(file instanceof File)) {
      return NextResponse.json({ ok: false, message: "No file uploaded." }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const { value: html } = await mammoth.convertToHtml({ buffer });

    const parsed = parseScheduleTable(html);

    return NextResponse.json({
      ok: true,
      fileName: file.name,
      ...parsed,
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, message: err?.message || "Parse failed." },
      { status: 500 }
    );
  }
}
