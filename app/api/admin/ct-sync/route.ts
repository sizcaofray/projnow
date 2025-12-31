// app/api/admin/ct-sync/route.ts
import { NextResponse } from "next/server";
import * as XLSX from "xlsx";

// ✅ NCI EVS SDTM CT (공개 배포)
const DEFAULT_SDTM_XLS_URL =
  "https://evs.nci.nih.gov/ftp1/CDISC/SDTM/SDTM%20Terminology.xls";

const SECRET = process.env.CT_SYNC_SECRET || "";

type CtRow = {
  codelist_id: string;
  codelist_name: string;
  term_code?: string;
  term_decode?: string;
  synonyms_csv?: string;
  nci_code?: string;
  notes?: string;
};

function norm(s: any) {
  return String(s ?? "")
    .trim()
    .toLowerCase()
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ");
}

function toCsv(val: any) {
  const s = String(val ?? "").trim();
  if (!s) return "";
  return s.replace(/;\s*/g, ",").replace(/\s*,\s*/g, ",");
}

/**
 * ✅ ReadMe/표지/설명 시트 제외
 */
function isNonDataSheetName(sheetName: string) {
  const n = norm(sheetName).replace(/\s+/g, "");
  return (
    n.includes("readme") ||
    n.includes("read") && n.includes("me") ||
    n.includes("cover") ||
    n.includes("instruction") ||
    n.includes("note") ||
    n.includes("about")
  );
}

/**
 * ✅ 헤더 후보 점수
 * - "submission value", "preferred term", "codelist" 중 2개 이상 있으면 강하게
 */
function scoreHeaderRow(row: any[]): number {
  const cells = row.map((c) => norm(c));

  const hasSubmission = cells.some((x) => x.includes("submission value") || x.includes("cdisc submission"));
  const hasPreferred = cells.some((x) => x.includes("preferred term") || x.includes("cdisc preferred") || x.includes("nci preferred"));
  const hasCodelist = cells.some((x) => x.includes("codelist"));

  let score = 0;
  if (hasSubmission) score += 4;
  if (hasPreferred) score += 4;
  if (hasCodelist) score += 4;

  // synonym/nci code도 가산점
  if (cells.some((x) => x.includes("synonym"))) score += 1;
  if (cells.some((x) => x.includes("nci code") || x.includes("ncit"))) score += 1;

  // 컬럼 수가 너무 적으면 헤더 가능성 낮음
  const filled = cells.filter(Boolean).length;
  if (filled >= 6) score += 1;
  if (filled >= 10) score += 1;

  // ✅ 필수 3요소 중 2개 미만이면 사실상 헤더로 인정하지 않음
  const mustCount = [hasSubmission, hasPreferred, hasCodelist].filter(Boolean).length;
  if (mustCount < 2) score -= 999; // 강제 탈락

  return score;
}

/**
 * ✅ 전체 시트에서 “데이터 시트 + 헤더 행” 찾기
 */
function findBestHeaderAndSheet(wb: XLSX.WorkBook) {
  let best = {
    sheetName: "",
    headerRowIndex: -1,
    score: -9999,
    header: [] as string[],
  };

  const skippedSheets: string[] = [];

  for (const sheetName of wb.SheetNames) {
    if (isNonDataSheetName(sheetName)) {
      skippedSheets.push(sheetName);
      continue;
    }

    const ws = wb.Sheets[sheetName];
    if (!ws) continue;

    const aoa = XLSX.utils.sheet_to_json<any[]>(ws, {
      header: 1,
      defval: "",
      blankrows: false,
    });

    const scanMax = Math.min(aoa.length, 80);

    for (let i = 0; i < scanMax; i++) {
      const row = aoa[i] || [];
      const sc = scoreHeaderRow(row);

      if (sc > best.score) {
        best = {
          sheetName,
          headerRowIndex: i,
          score: sc,
          header: row.map((c) => String(c ?? "").trim()),
        };
      }
    }
  }

  return { best, skippedSheets };
}

function pick(row: Record<string, any>, candidates: string[]) {
  const keys = Object.keys(row);

  // 1) 정규화 정확 매칭
  for (const c of candidates) {
    const target = norm(c);
    const found = keys.find((k) => norm(k) === target);
    if (found) return row[found];
  }

  // 2) 포함 매칭
  for (const c of candidates) {
    const target = norm(c);
    const found = keys.find((k) => norm(k).includes(target) || target.includes(norm(k)));
    if (found) return row[found];
  }

  return "";
}

export async function GET(req: Request) {
  if (SECRET) {
    const h = req.headers.get("x-ct-sync-secret") || "";
    if (h !== SECRET) {
      return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });
    }
  }

  const startedAt = Date.now();
  const url = process.env.SDTM_CT_XLS_URL || DEFAULT_SDTM_XLS_URL;

  try {
    console.log("[ct-sync] start", { url });

    // 1) 다운로드
    const res = await fetch(url, { cache: "no-store" });
    console.log("[ct-sync] download status", res.status, res.statusText);
    if (!res.ok) throw new Error(`CT Excel download failed: ${res.status} ${res.statusText}`);

    const buf = await res.arrayBuffer();
    console.log("[ct-sync] downloaded bytes", buf.byteLength);

    // 2) 파싱
    const wb = XLSX.read(buf, { type: "array" });
    console.log("[ct-sync] sheets", wb.SheetNames);

    // 3) 최적 시트/헤더 찾기 (ReadMe 제외 + 필수 컬럼 기반)
    const { best, skippedSheets } = findBestHeaderAndSheet(wb);
    console.log("[ct-sync] skippedSheets", skippedSheets);
    console.log("[ct-sync] best", best);

    // ✅ 여기서 실패를 명확히 반환 (ok:true인데 0건 방지)
    if (!best.sheetName || best.headerRowIndex < 0 || best.score < 0) {
      return NextResponse.json(
        {
          ok: false,
          message: "CT data sheet/header not detected. Source format may have changed.",
          debug: {
            url,
            sheets: wb.SheetNames,
            skippedSheets,
            best,
            elapsedMs: Date.now() - startedAt,
          },
        },
        { status: 500 }
      );
    }

    const ws = wb.Sheets[best.sheetName];
    if (!ws) throw new Error("Selected sheet not found");

    // 4) JSON 변환(헤더 기준)
    const rows = XLSX.utils.sheet_to_json<Record<string, any>>(ws, {
      range: best.headerRowIndex,
      defval: "",
      raw: true,
    });

    console.log("[ct-sync] json rows count", rows.length);
    console.log("[ct-sync] sample row keys", rows[0] ? Object.keys(rows[0]).slice(0, 30) : []);
    console.log("[ct-sync] sample row 0", rows[0] || null);

    // 5) 매핑
    const out: CtRow[] = [];
    let skippedNoCodelist = 0;
    let skippedNoTerm = 0;

    for (const r of rows) {
      const codelist_id = String(
        pick(r, [
          "CDISC Codelist (Short Name)",
          "Codelist Short Name",
          "Codelist (Short Name)",
          "Codelist",
          "Codelist Code",
        ])
      ).trim();

      const codelist_name = String(
        pick(r, [
          "CDISC Codelist Name",
          "Codelist Name",
          "CDISC Codelist (Name)",
          "Codelist (Name)",
          "Codelist Long Name",
        ])
      ).trim();

      const term_code = String(
        pick(r, [
          "CDISC Submission Value",
          "Submission Value",
          "Term Code",
          "Code",
        ])
      ).trim();

      const term_decode = String(
        pick(r, [
          "CDISC Preferred Term",
          "NCI Preferred Term",
          "Preferred Term",
          "Decode",
          "Term",
        ])
      ).trim();

      const synonyms_csv = toCsv(pick(r, ["CDISC Synonym(s)", "Synonym(s)", "Synonyms", "Code Synonym"]));
      const nci_code = String(pick(r, ["NCI Code", "NCIt Code", "NCI C-Code", "C-Code"])).trim();

      if (!codelist_id) {
        skippedNoCodelist++;
        continue;
      }
      if (!term_code && !term_decode) {
        skippedNoTerm++;
        continue;
      }

      out.push({
        codelist_id,
        codelist_name,
        term_code,
        term_decode,
        synonyms_csv,
        nci_code,
        notes: "source=NCI_EVS_SDTM_CT",
      });
    }

    console.log("[ct-sync] mapped out count", out.length, { skippedNoCodelist, skippedNoTerm });

    return NextResponse.json({
      ok: true,
      source: "NCI_EVS",
      url,
      sheet: best.sheetName,
      headerRowIndex: best.headerRowIndex,
      headerScore: best.score,
      count: out.length,
      debug: {
        elapsedMs: Date.now() - startedAt,
        sheets: wb.SheetNames,
        skippedSheets,
        detectedHeader: best.header.slice(0, 30),
        sampleKeys: rows[0] ? Object.keys(rows[0]).slice(0, 40) : [],
        sampleRow0: rows[0] || null,
        skippedNoCodelist,
        skippedNoTerm,
      },
      items: out,
      hint: out.length === 0 ? "mapped out=0. Check debug.sampleKeys/detectedHeader." : "ok",
    });
  } catch (e: any) {
    console.error("[ct-sync] failed", e);
    return NextResponse.json(
      { ok: false, message: e?.message ?? "CT sync failed", url },
      { status: 500 }
    );
  }
}
