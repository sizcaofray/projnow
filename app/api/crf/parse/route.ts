// app/api/crf/parse/route.ts
import { NextResponse } from "next/server";
import * as mammoth from "mammoth";
import * as cheerio from "cheerio";

export const runtime = "nodejs";

/**
 * 방문/폼/아이템 타입
 * - formCode는 "자동 추정" 금지 → 항상 빈값 시작 (사용자 수정)
 */
type Visit = {
  id: string;
  labelOriginal: string;
  labelDisplay: string;
  orderKey: number;
};

type Page = {
  id: string;        // formId
  name: string;      // formName
  formCode: string;  // always "", user editable
};

type Item = {
  id: string;
  nameOriginal: string;
  nameDisplay: string;
  pageId: string; // formId
  evidence?: string;
  visitMap: Record<string, boolean>;
};

function safeTrim(v: string) {
  return (v ?? "").replace(/\u00A0/g, " ").trim();
}

/**
 * Visit 헤더(방문 컬럼) 유사도 판단
 * - 문서/표가 달라도 대체로 공통 패턴을 포괄
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
 * Visit 라벨을 정규화하여 id/orderKey 부여
 * - 고정 포맷 의존 최소화
 */
function normalizeVisitLabel(label: string): Visit {
  const raw = safeTrim(label);

  let orderKey = 999999;
  let id =
    `v_${raw.replace(/\s+/g, "_").replace(/[^a-zA-Z0-9_]/g, "").toLowerCase() || "x"}`;

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

  const mVisit = raw.match(/visit\s*(\d+)/i) || raw.match(/\bv\s*(\d+)\b/i);
  if (mVisit?.[1]) {
    const n = Number(mVisit[1]);
    if (!Number.isNaN(n)) {
      orderKey = 100 + n;
      id = `visit${n}`;
    }
  }

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

  const mC = raw.match(/c(\d+)\s*d(\d+)/i) || raw.match(/c(\d+)d(\d+)/i);
  if (mC?.[1] && mC?.[2]) {
    const c = Number(mC[1]);
    const d = Number(mC[2]);
    if (!Number.isNaN(c) && !Number.isNaN(d)) {
      orderKey = 4000 + c * 100 + d;
      id = `c${c}d${d}`;
    }
  }

  return {
    id,
    labelOriginal: raw,
    labelDisplay: raw,
    orderKey,
  };
}

/**
 * 표의 체크/기호/숫자 등 “수행 여부”로 간주할 값 판단
 * - 문서마다 기호가 달라서 넉넉히 허용
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
 * “표 후보” 선택:
 * - visit-like 헤더가 많이 등장하는 table을 스코어링하여 선택
 */
function pickBestScheduleTable($: cheerio.CheerioAPI) {
  const tables = $("table").toArray();
  if (tables.length === 0) return null;

  let best: { score: number; table: any } | null = null;

  for (const tbl of tables) {
    const $tbl = $(tbl);

    const headerCells: string[] = [];
    $tbl
      .find("tr")
      .slice(0, 3)
      .each((_, tr) => {
        $(tr)
          .find("th,td")
          .each((__, c) => {
            headerCells.push(safeTrim($(c).text()));
          });
      });

    const visitLikeCount = headerCells.filter((h) => isVisitLikeHeader(h)).length;
    const rowCount = $tbl.find("tr").length;

    // visit-like 많을수록, row가 적당히 많을수록 점수 증가
    const score = visitLikeCount * 12 + Math.min(rowCount, 80);

    if (!best || score > best.score) best = { score, table: tbl };
  }

  if (!best || best.score < 24) return null;
  return best.table;
}

/**
 * Form 헤더 행(그룹 행) 추정:
 * - “visit 컬럼이 비어있고”, “비-visit 텍스트가 짧고 제목처럼 보이며”
 * - 또는 “colspan이 크거나”, “th 중심” 등의 특징을 사용
 * - 고정 키워드 매핑 없이 구조 특징 기반으로만 판단
 */
function isFormHeaderRow(params: {
  $: cheerio.CheerioAPI;
  rowEl: any;
  visitColIdxs: number[];
}) {
  const { $, rowEl, visitColIdxs } = params;

  const cells = $(rowEl).find("th,td").toArray();
  if (cells.length === 0) return { ok: false, title: "" };

  // visit 셀에 내용이 거의 없으면(비어있으면) 헤더 가능성 ↑
  const visitTexts = visitColIdxs
    .map((i) => safeTrim($(cells[i] ?? "").text()))
    .filter(Boolean);

  if (visitTexts.length > 0) return { ok: false, title: "" };

  // 비-visit 텍스트 모으기
  const nonVisitTexts = cells
    .map((c: any, idx: number) => ({ idx, t: safeTrim($(c).text()), el: c }))
    .filter((x) => !visitColIdxs.includes(x.idx))
    .map((x) => x.t)
    .filter(Boolean);

  const joined = safeTrim(nonVisitTexts.join(" ").replace(/\s+/g, " "));
  if (!joined) return { ok: false, title: "" };

  // 너무 길면(문단) Form 헤더로 보기 어려움
  if (joined.length > 90) return { ok: false, title: "" };

  // 숫자/기호 비율이 높으면(범위/수치) 헤더 가능성 낮음
  const digitCount = (joined.match(/[0-9]/g) || []).length;
  if (digitCount / Math.max(joined.length, 1) > 0.25) return { ok: false, title: "" };

  // colspan이 큰 단일 셀(또는 대표 셀)이 있으면 헤더 가능성 매우 높음
  let hasLargeColspan = false;
  for (const c of cells) {
    const colspanAttr = $(c).attr("colspan");
    const colspan = colspanAttr ? Number(colspanAttr) : 1;
    if (!Number.isNaN(colspan) && colspan >= Math.max(3, Math.floor(cells.length * 0.6))) {
      hasLargeColspan = true;
      break;
    }
  }

  // th가 포함되어 있으면(제목 행일 확률) 헤더 가능성 ↑
  const hasTh = $(rowEl).find("th").length > 0;

  // “짧은 제목” + (colspan 크거나 th 포함) 이면 Form 헤더로 채택
  const ok = joined.length >= 2 && (hasLargeColspan || hasTh);

  return { ok, title: joined };
}

/**
 * 실제 파싱:
 * - 표 1개를 선택
 * - visit 헤더 추출
 * - 이후 행을 순회하며 Form 헤더 / Item 행을 구분
 */
function parseScheduleTableFromHtml(html: string) {
  const $ = cheerio.load(html);

  const tableEl = pickBestScheduleTable($);
  if (!tableEl) {
    return {
      visits: [] as Visit[],
      pages: [] as Page[],
      items: [] as Item[],
      warnings: ["No schedule-like table detected."],
    };
  }

  const $tbl = $(tableEl);
  const rows = $tbl.find("tr").toArray();

  // (1) 헤더 행 찾기: visit-like가 가장 많은 행을 선택
  let headerRowIdx = 0;
  let maxVisitLike = -1;

  rows.slice(0, Math.min(rows.length, 6)).forEach((tr, idx) => {
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

  // (2) visit 컬럼 인덱스 수집
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

  // 방문 중복 제거/정렬
  const uniq: Record<string, Visit> = {};
  for (const vc of visitCols) uniq[vc.visit.id] = vc.visit;
  const visits = Object.values(uniq).sort((a, b) => a.orderKey - b.orderKey);

  const visitColIdxs = visitCols.map((v) => v.colIdx);

  // (3) Form/Item 추출
  const pagesByName: Record<string, Page> = {};
  const items: Item[] = [];
  const warnings: string[] = [];

  // 현재 Form(문서 내 그룹 헤더 기반)
  let currentFormName = "General";

  // General은 미리 만들지 않고, 실제로 필요할 때 생성
  const ensureForm = (formName: string) => {
    const key = safeTrim(formName) || "General";
    if (!pagesByName[key]) {
      pagesByName[key] = {
        id: `f_${Object.keys(pagesByName).length + 1}`,
        name: key,
        formCode: "", // 고정 매핑 금지 → 항상 빈값
      };
    }
    return pagesByName[key];
  };

  // 헤더 다음 행부터 순회
  for (let r = headerRowIdx + 1; r < rows.length; r++) {
    const rowEl = rows[r];
    const cells = $(rowEl).find("th,td").toArray();
    if (cells.length === 0) continue;

    // (A) Form 헤더 행인지 판단(구조 기반)
    const formHeader = isFormHeaderRow({ $, rowEl, visitColIdxs });
    if (formHeader.ok) {
      currentFormName = formHeader.title || "General";
      ensureForm(currentFormName);
      continue;
    }

    // (B) Item 행 처리: 비-visit 텍스트에서 itemName 추출
    const nonVisitCells = cells
      .map((c: any, idx: number) => ({ idx, c, t: safeTrim($(c).text()) }))
      .filter((x) => !visitColIdxs.includes(x.idx));

    // itemName 후보: 첫 번째 의미있는 텍스트(너무 짧은 텍스트는 제외)
    const itemNameCandidate =
      nonVisitCells.map((x) => x.t).find((t) => t && t.length >= 2) || "";

    // itemName이 없으면 스킵
    if (!itemNameCandidate) continue;

    // visitMap 생성
    const visitMap: Record<string, boolean> = {};
    const evidenceParts: string[] = [];

    for (const vc of visitCols) {
      const cellText = safeTrim($(cells[vc.colIdx] ?? "").text());
      const truthy = cellTruthy(cellText);
      visitMap[vc.visit.id] = truthy;
      if (cellText) evidenceParts.push(`${vc.visit.labelDisplay}:${cellText}`);
    }

    // 모든 visit이 false이고, itemName이 “주석/설명”처럼 보이면 스킵(너무 공격적이면 제거 가능)
    const anyTrue = Object.values(visitMap).some(Boolean);
    if (!anyTrue && itemNameCandidate.length > 80) continue;

    // currentFormName 보장
    const form = ensureForm(currentFormName);

    items.push({
      id: `i_${items.length + 1}`,
      nameOriginal: itemNameCandidate,
      nameDisplay: itemNameCandidate,
      pageId: form.id,
      evidence: evidenceParts.join(" | "),
      visitMap,
    });
  }

  const pages = Object.values(pagesByName);

  if (pages.length === 0) {
    warnings.push("No form group headers detected. All items may be grouped into General.");
  }

  return { visits, pages, items, warnings };
}

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get("file");

    if (!file || !(file instanceof File)) {
      return NextResponse.json({ ok: false, message: "No file uploaded." }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // docx -> html
    const { value: html } = await mammoth.convertToHtml({ buffer });

    // 핵심: 표 후보에서 Form + Navigation(Item visitMap) 구성
    const parsed = parseScheduleTableFromHtml(html);

    return NextResponse.json({
      ok: true,
      fileName: file.name,
      ...parsed,
    });
  } catch (err: any) {
    return NextResponse.json({ ok: false, message: err?.message || "Parse failed." }, { status: 500 });
  }
}
