// app/api/admin/ct-sync/route.ts
// - NCI EVS SDTM Controlled Terminology 엑셀을 내려받아 JSON으로 변환해 반환
// - Firestore upsert는 클라이언트(관리자 로그인)에서 수행합니다.

import { NextResponse } from 'next/server';
import * as XLSX from 'xlsx';

// ✅ NCI EVS SDTM CT Excel (공개 배포)
// 참고: NCI EVS가 SDTM CT를 FTP로 배포한다는 안내가 있습니다. :contentReference[oaicite:2]{index=2}
const DEFAULT_SDTM_XLS_URL =
  'https://evs.nci.nih.gov/ftp1/CDISC/SDTM/SDTM%20Terminology.xls';

// ✅ (선택) 간단한 호출 보호(관리자 페이지에서만 쓰는 용도)
// Vercel/로컬 env에 CT_SYNC_SECRET 세팅 후, 클라이언트에서 동일 헤더로 호출
const SECRET = process.env.CT_SYNC_SECRET || '';

type CtRow = {
  codelist_id: string;
  codelist_name: string;
  term_code?: string;
  term_decode?: string;
  synonyms_csv?: string;
  nci_code?: string;
  notes?: string;
};

function normKey(s: string) {
  return String(s ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replaceAll('\u00a0', ' ');
}

function pick(row: Record<string, any>, candidates: string[]) {
  const keys = Object.keys(row);
  for (const c of candidates) {
    const found = keys.find((k) => normKey(k) === normKey(c));
    if (found) return row[found];
  }
  // 느슨한 포함 매칭
  for (const c of candidates) {
    const found = keys.find((k) => normKey(k).includes(normKey(c)));
    if (found) return row[found];
  }
  return '';
}

function toCsv(val: any) {
  const s = String(val ?? '').trim();
  if (!s) return '';
  // 구분자가 ; 로 들어오는 경우도 있어 csv로 정리
  return s.replace(/;\s*/g, ',').replace(/\s*,\s*/g, ',');
}

export async function GET(req: Request) {
  // ✅ (선택) 헤더 시크릿 검사
  if (SECRET) {
    const h = req.headers.get('x-ct-sync-secret') || '';
    if (h !== SECRET) {
      return NextResponse.json({ ok: false, message: 'Unauthorized' }, { status: 401 });
    }
  }

  try {
    const url = process.env.SDTM_CT_XLS_URL || DEFAULT_SDTM_XLS_URL;

    // 1) 엑셀 다운로드
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) {
      throw new Error(`CT Excel download failed: ${res.status} ${res.statusText}`);
    }
    const buf = await res.arrayBuffer();

    // 2) 파싱
    const wb = XLSX.read(buf, { type: 'array' });
    const firstSheetName = wb.SheetNames[0];
    if (!firstSheetName) throw new Error('No sheets found in CT Excel');

    const ws = wb.Sheets[firstSheetName];
    const rows = XLSX.utils.sheet_to_json<Record<string, any>>(ws, { defval: '' });

    // 3) SDTM CT 엑셀은 보통 codelist/terms가 한 시트에 들어있습니다.
    //    컬럼명은 릴리즈/형식에 따라 약간 다를 수 있어 후보 키로 흡수합니다.
    const out: CtRow[] = [];
    for (const r of rows) {
      // 대표 후보 키들(형식 차이를 흡수)
      const codelist_id =
        String(
          pick(r, [
            'CDISC Codelist (Short Name)',
            'CDISC Codelist (Short Name) ',
            'CDISC Codelist (Short Name)',
            'Codelist Code',
            'Codelist',
            'Codelist Short Name',
            'Codelist (Short Name)',
          ])
        ).trim() || '';

      const codelist_name =
        String(
          pick(r, [
            'CDISC Codelist Name',
            'Codelist Name',
            'CDISC Codelist (Name)',
            'Codelist (Name)',
          ])
        ).trim() || '';

      // term_code(제출값/코드)
      const term_code =
        String(
          pick(r, [
            'CDISC Submission Value',
            'Submission Value',
            'CDISC Submission Value ',
            'Term Code',
            'Code',
          ])
        ).trim() || '';

      // term_decode(디코드/Preferred Term)
      const term_decode =
        String(
          pick(r, [
            'CDISC Preferred Term',
            'NCI Preferred Term',
            'Preferred Term',
            'Decode',
            'Term',
          ])
        ).trim() || '';

      const synonyms_csv = toCsv(
        pick(r, ['CDISC Synonym(s)', 'Synonym(s)', 'Synonyms', 'CDISC Synonyms'])
      );

      const nci_code =
        String(pick(r, ['NCI Code', 'NCIt Code', 'NCI C-Code', 'C-Code'])).trim() || '';

      // 필수 최소값: codelist_id + term_code(또는 term_decode)
      if (!codelist_id) continue;
      if (!term_code && !term_decode) continue;

      out.push({
        codelist_id,
        codelist_name,
        term_code,
        term_decode,
        synonyms_csv,
        nci_code,
        notes: 'source=NCI_EVS_SDTM_CT',
      });
    }

    return NextResponse.json({
      ok: true,
      source: 'NCI_EVS',
      sheet: firstSheetName,
      count: out.length,
      items: out,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, message: e?.message ?? 'CT sync failed' },
      { status: 500 }
    );
  }
}
