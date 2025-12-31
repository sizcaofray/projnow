'use client';

/**
 * 📄 app/contents/admin/sdtm/page.tsx
 * - SDTM DB 관리 (A안) : 4개 탭 + 검색/필터 + 테이블 + 상세패널 + CRUD
 * - ✅ (A안 구현) Seed 재적재(관리자): 엑셀 업로드 → 시트별 파싱 → Firestore upsert(writeBatch)
 *
 * ✅ 주의
 * - Firestore Rules에서 아래 컬렉션에 adminLike 접근 허용이 필요합니다:
 *   standardsCatalog, sdtmDomains, cdiscCodeLists, formDomainMap
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

import { getAuth, onAuthStateChanged } from 'firebase/auth';
import { db } from '@/lib/firebase/firebase';

import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';

// ✅ xlsx 라이브러리(Seed 업로드 파싱용)
import * as XLSX from 'xlsx';

/** -------------------------
 * 타입 정의(탭별)
 * ------------------------ */
type TabKey = 'catalog' | 'domains' | 'codelists' | 'formmap';

type StandardsCatalog = {
  id: string;
  standard_key: string;
  current_version: string;
  published_date?: string;
  source_org?: string;
  notes?: string;
  updatedAt?: number;
};

type SdtmDomain = {
  id: string;
  domain_code: string;
  domain_label: string;
  domain_class?: string;
  description?: string;
  keywords_csv?: string;
  aliases_csv?: string;
  updatedAt?: number;
};

type CodeList = {
  id: string;
  codelist_id: string;
  codelist_name: string;
  term_code?: string;
  term_decode?: string;
  synonyms_csv?: string;
  nci_code?: string;
  notes?: string;
  updatedAt?: number;
};

type FormDomainMap = {
  id: string;
  form_name_pattern: string;
  suggested_domain_code: string;
  confidence_hint?: string;
  notes?: string;
  updatedAt?: number;
};

type RowAny = StandardsCatalog | SdtmDomain | CodeList | FormDomainMap;

/** -------------------------
 * 유틸
 * ------------------------ */
function nowTs() {
  return Date.now();
}
function safeLower(s: string) {
  return (s ?? '').toLowerCase();
}
function includesAny(text: string, keywords: string[]) {
  const t = safeLower(text);
  return keywords.some((k) => t.includes(safeLower(k)));
}

/**
 * Firestore 문서 ID에 쓸 수 없는 문자 제거
 * - Firestore docId는 "/" 포함 불가
 */
function sanitizeDocId(input: string) {
  const s = String(input ?? '').trim();
  if (!s) return '';
  // "/" 제거 + 제어문자 제거
  return s
    .replaceAll('/', '_')
    .replaceAll('\\', '_')
    .replaceAll('#', '_')
    .replaceAll('?', '_')
    .replaceAll('[', '(')
    .replaceAll(']', ')')
    .replace(/\s+/g, ' ')
    .slice(0, 150);
}

/** -------------------------
 * 탭 메타
 * ------------------------ */
const TAB_LABEL: Record<TabKey, string> = {
  catalog: 'Standards Catalog',
  domains: 'SDTM Domains',
  codelists: 'CDISC Code Lists',
  formmap: 'Form ↔ Domain Map',
};

type ColumnDef = {
  key: string;
  label: string;
  width?: string;
};

function getColumns(tab: TabKey): ColumnDef[] {
  switch (tab) {
    case 'catalog':
      return [
        { key: 'standard_key', label: 'Standard Key', width: '160px' },
        { key: 'current_version', label: 'Current Version', width: '160px' },
        { key: 'published_date', label: 'Published Date', width: '160px' },
        { key: 'source_org', label: 'Source Org', width: '160px' },
        { key: 'notes', label: 'Notes' },
      ];
    case 'domains':
      return [
        { key: 'domain_code', label: 'Domain Code', width: '140px' },
        { key: 'domain_label', label: 'Domain Label', width: '220px' },
        { key: 'domain_class', label: 'Domain Class', width: '180px' },
        { key: 'description', label: 'Description' },
        { key: 'keywords_csv', label: 'Keywords', width: '220px' },
        { key: 'aliases_csv', label: 'Aliases', width: '220px' },
      ];
    case 'codelists':
      return [
        { key: 'codelist_id', label: 'Codelist ID', width: '180px' },
        { key: 'codelist_name', label: 'Codelist Name', width: '240px' },
        { key: 'term_code', label: 'Term Code', width: '140px' },
        { key: 'term_decode', label: 'Term Decode', width: '220px' },
        { key: 'synonyms_csv', label: 'Synonyms', width: '220px' },
        { key: 'nci_code', label: 'NCI Code', width: '140px' },
        { key: 'notes', label: 'Notes' },
      ];
    case 'formmap':
      return [
        { key: 'form_name_pattern', label: 'Form Name Pattern', width: '320px' },
        { key: 'suggested_domain_code', label: 'Suggested Domain', width: '200px' },
        { key: 'confidence_hint', label: 'Confidence Hint', width: '180px' },
        { key: 'notes', label: 'Notes' },
      ];
    default:
      return [];
  }
}

function getCollectionName(tab: TabKey) {
  if (tab === 'catalog') return 'standardsCatalog';
  if (tab === 'domains') return 'sdtmDomains';
  if (tab === 'codelists') return 'cdiscCodeLists';
  return 'formDomainMap';
}

/** -------------------------
 * 엑셀 시트 → 컬렉션 매핑
 * - 시트명이 정확히 일치하면 그대로 사용
 * - 다르면 "유사한 이름"을 찾아 매핑(최소 보정)
 * ------------------------ */
function normalizeSheetName(name: string) {
  return String(name ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replaceAll('-', '')
    .replaceAll('_', '');
}

function buildSheetMap(sheetNames: string[]) {
  // 기본 기대 시트명(컬렉션명과 동일)
  const target = {
    standardsCatalog: ['standardscatalog', 'catalog', 'standards'],
    sdtmDomains: ['sdtmdomains', 'domains', 'sdtmdomain'],
    cdiscCodeLists: ['cdisccodelists', 'codelists', 'cdisc', 'codelist'],
    formDomainMap: ['formdomainmap', 'formmap', 'form-domain-map', 'formdomain'],
  };

  const normalized = sheetNames.map((s) => ({ raw: s, norm: normalizeSheetName(s) }));

  // 각 컬렉션에 가장 먼저 매칭되는 시트를 찾음
  const pick = (aliases: string[]) => {
    for (const a of aliases) {
      const found = normalized.find((x) => x.norm === a);
      if (found) return found.raw;
    }
    // 부분 일치도 허용(최소 보정)
    for (const a of aliases) {
      const found = normalized.find((x) => x.norm.includes(a) || a.includes(x.norm));
      if (found) return found.raw;
    }
    return null;
  };

  return {
    standardsCatalog: pick(target.standardsCatalog),
    sdtmDomains: pick(target.sdtmDomains),
    cdiscCodeLists: pick(target.cdiscCodeLists),
    formDomainMap: pick(target.formDomainMap),
  };
}

/** -------------------------
 * 메인 컴포넌트
 * ------------------------ */
export default function SdtmAdminPage() {
  const router = useRouter();

  // 탭/검색/필터
  const [tab, setTab] = useState<TabKey>('domains');
  const [keyword, setKeyword] = useState<string>('');
  const [domainClassFilter, setDomainClassFilter] = useState<string>('ALL');

  // 데이터/로딩/에러
  const [rows, setRows] = useState<RowAny[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [err, setErr] = useState<string>('');

  // ✅ Seed 업로드 진행 상태(텍스트로 표시)
  const [seedStatus, setSeedStatus] = useState<string>('');

  // 관리자 가드
  const [isAdmin, setIsAdmin] = useState<boolean>(false);
  const [checking, setChecking] = useState<boolean>(true);

  // 선택 행
  const [selected, setSelected] = useState<RowAny | null>(null);

  // 모달(추가/수정)
  const [editOpen, setEditOpen] = useState<boolean>(false);
  const [editMode, setEditMode] = useState<'create' | 'update'>('create');
  const [draft, setDraft] = useState<any>({});

  // ✅ 파일 input (UI 변경 최소화를 위해 숨김 처리)
  const fileRef = useRef<HTMLInputElement | null>(null);

  /** -------------------------
   * 1) 관리자 여부 확인
   * ------------------------ */
  useEffect(() => {
    const auth = getAuth();

    const unsub = onAuthStateChanged(auth, async (user) => {
      setChecking(true);

      try {
        if (!user) {
          setIsAdmin(false);
          setChecking(false);
          router.replace('/');
          return;
        }

        const uref = doc(db, 'users', user.uid);
        const usnap = await getDoc(uref);
        const roleRaw = usnap.exists() ? (usnap.data() as any)?.role : '';
        const role = String(roleRaw ?? '').trim().toLowerCase();

        const ok = role === 'admin';
        setIsAdmin(ok);
        setChecking(false);

        if (!ok) router.replace('/contents');
      } catch (e: any) {
        setIsAdmin(false);
        setChecking(false);
        setErr(e?.message ?? '권한 확인 중 오류가 발생했습니다.');
        router.replace('/contents');
      }
    });

    return () => unsub();
  }, [router]);

  /** -------------------------
   * 2) 데이터 로드
   * ------------------------ */
  useEffect(() => {
    if (!isAdmin) return;
    loadRows().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, isAdmin]);

  async function loadRows() {
    setLoading(true);
    setErr('');
    setSelected(null);

    try {
      const colName = getCollectionName(tab);
      const colRef = collection(db, colName);

      // ✅ 기본: updatedAt desc (Seed 업로드 시 updatedAt 넣어줌)
      const q = query(colRef, orderBy('updatedAt', 'desc'), limit(500));
      const snap = await getDocs(q);

      const list: any[] = [];
      snap.forEach((d) => list.push({ id: d.id, ...(d.data() as any) }));
      setRows(list);
    } catch (e: any) {
      setErr(e?.message ?? '데이터 로딩 중 오류가 발생했습니다.');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  /** -------------------------
   * 3) 필터 옵션
   * ------------------------ */
  const domainClassOptions = useMemo(() => {
    if (tab !== 'domains') return [];
    const set = new Set<string>();
    (rows as SdtmDomain[]).forEach((r) => {
      if (r.domain_class) set.add(r.domain_class);
    });
    return ['ALL', ...Array.from(set).sort()];
  }, [rows, tab]);

  const filteredRows = useMemo(() => {
    const k = keyword.trim();
    const keywords = k ? k.split(/\s+/).filter(Boolean) : [];

    return rows.filter((r: any) => {
      if (tab === 'domains' && domainClassFilter !== 'ALL') {
        if ((r?.domain_class ?? '') !== domainClassFilter) return false;
      }

      if (keywords.length === 0) return true;

      const haystack =
        tab === 'catalog'
          ? `${r.standard_key} ${r.current_version} ${r.published_date} ${r.source_org} ${r.notes}`
          : tab === 'domains'
            ? `${r.domain_code} ${r.domain_label} ${r.domain_class} ${r.description} ${r.keywords_csv} ${r.aliases_csv}`
            : tab === 'codelists'
              ? `${r.codelist_id} ${r.codelist_name} ${r.term_code} ${r.term_decode} ${r.synonyms_csv} ${r.nci_code} ${r.notes}`
              : `${r.form_name_pattern} ${r.suggested_domain_code} ${r.confidence_hint} ${r.notes}`;

      return includesAny(haystack, keywords);
    });
  }, [rows, keyword, tab, domainClassFilter]);

  /** -------------------------
   * 4) CRUD
   * ------------------------ */
  function openCreate() {
    setEditMode('create');
    setDraft(getEmptyDraft(tab));
    setEditOpen(true);
  }

  function openUpdate() {
    if (!selected) return;
    setEditMode('update');
    setDraft({ ...(selected as any) });
    setEditOpen(true);
  }

  async function handleSave() {
    const v = validateDraft(tab, draft);
    if (!v.ok) {
      alert(v.message);
      return;
    }

    setLoading(true);
    setErr('');

    try {
      const colName = getCollectionName(tab);
      const docId = computeDocId(tab, draft, editMode);
      const ref = doc(db, colName, docId);

      const payload = {
        ...draft,
        id: docId,
        updatedAt: nowTs(),
      };

      if (editMode === 'create') {
        await setDoc(ref, payload, { merge: false });
      } else {
        await updateDoc(ref, payload);
      }

      setEditOpen(false);
      setSelected(null);
      await loadRows();
    } catch (e: any) {
      setErr(e?.message ?? '저장 중 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete() {
    if (!selected) return;
    const ok = confirm('정말 삭제하시겠습니까?');
    if (!ok) return;

    setLoading(true);
    setErr('');

    try {
      const colName = getCollectionName(tab);
      const ref = doc(db, colName, (selected as any).id);
      await deleteDoc(ref);

      setSelected(null);
      await loadRows();
    } catch (e: any) {
      setErr(e?.message ?? '삭제 중 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  }

  /** -------------------------
   * 5) ✅ Seed 재적재(관리자) - A안 구현
   * - 버튼 클릭 → 파일 선택 → 파싱 → 컬렉션별 upsert(writeBatch)
   * ------------------------ */
  function handleSeedReloadClick() {
    // UI 변경 최소화를 위해 input을 숨겨두고 클릭만 트리거
    if (!fileRef.current) return;
    fileRef.current.value = '';
    fileRef.current.click();
  }

  async function handleSeedFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    // 간단 검증
    const name = file.name.toLowerCase();
    if (!name.endsWith('.xlsx') && !name.endsWith('.xls')) {
      alert('엑셀 파일(.xlsx/.xls)만 업로드 가능합니다.');
      return;
    }

    setErr('');
    setSeedStatus(`업로드 파일 읽는 중: ${file.name}`);
    setLoading(true);

    try {
      // 1) 엑셀 읽기
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });

      // 2) 시트 매핑 결정
      const map = buildSheetMap(wb.SheetNames);

      // 필수 시트 체크(최소 1개라도 있으면 진행)
      const mappedSheets = Object.entries(map).filter(([, v]) => !!v) as Array<[string, string]>;
      if (mappedSheets.length === 0) {
        throw new Error(
          `엑셀 시트를 인식하지 못했습니다. 시트명은 standardsCatalog/sdtmDomains/cdiscCodeLists/formDomainMap 중 하나여야 합니다.\n현재 시트: ${wb.SheetNames.join(', ')}`
        );
      }

      setSeedStatus(`시트 확인됨: ${mappedSheets.map(([k, v]) => `${k}←${v}`).join(' / ')}`);

      // 3) 컬렉션별 rows 추출 + upsert
      let totalUpsert = 0;

      // ✅ 컬렉션 처리 순서(의미상)
      const processOrder: Array<keyof typeof map> = [
        'standardsCatalog',
        'sdtmDomains',
        'cdiscCodeLists',
        'formDomainMap',
      ];

      for (const colName of processOrder) {
        const sheetName = (map as any)[colName] as string | null;
        if (!sheetName) continue;

        const ws = wb.Sheets[sheetName];
        if (!ws) continue;

        // 4) JSON 변환
        // defval: '' 로 비어있는 셀도 키 유지
        const rowsJson = XLSX.utils.sheet_to_json<Record<string, any>>(ws, {
          defval: '',
          raw: true,
        });

        if (!rowsJson || rowsJson.length === 0) continue;

        setSeedStatus(`적재 준비: ${colName} (${rowsJson.length}행)`);

        // 5) writeBatch upsert (500개 제한 고려)
        const colRef = collection(db, colName);
        const chunks: Array<Array<Record<string, any>>> = [];
        for (let i = 0; i < rowsJson.length; i += 450) {
          // 450: 안전 버퍼(필드가 많아도 안정)
          chunks.push(rowsJson.slice(i, i + 450));
        }

        for (let ci = 0; ci < chunks.length; ci++) {
          const batch = writeBatch(db);

          chunks[ci].forEach((r) => {
            const cleaned = normalizeRow(colName, r);

            // 문서ID 계산
            const id = computeSeedDocId(colName, cleaned);
            if (!id) return; // ID 못 만들면 skip

            const ref = doc(colRef, id);

            batch.set(
              ref,
              {
                ...cleaned,
                id,
                updatedAt: nowTs(),
              },
              { merge: true } // ✅ upsert
            );
          });

          setSeedStatus(`적재 중: ${colName} (batch ${ci + 1}/${chunks.length})`);
          await batch.commit();
        }

        totalUpsert += rowsJson.length;
      }

      setSeedStatus(`완료: 총 ${totalUpsert}행 upsert 완료`);
      alert(`Seed 재적재 완료: 총 ${totalUpsert}행 upsert 되었습니다.`);

      // 현재 탭 다시 로드
      await loadRows();
    } catch (e: any) {
      const msg = e?.message ?? 'Seed 재적재 중 오류가 발생했습니다.';
      setErr(msg);
      setSeedStatus('실패');
      alert(msg);
    } finally {
      setLoading(false);
    }
  }

  /**
   * 컬렉션별 row 정규화
   * - 키 공백 제거, undefined/null 처리
   */
  function normalizeRow(colName: string, row: Record<string, any>) {
    const out: Record<string, any> = {};

    Object.entries(row ?? {}).forEach(([k, v]) => {
      const key = String(k ?? '').trim();
      if (!key) return;

      // 값 정리
      let val: any = v;
      if (val === undefined || val === null) val = '';

      // 날짜 셀 등이 number로 들어오는 경우가 있어도 그대로 저장(필요시 다음 단계에서 변환)
      out[key] = typeof val === 'string' ? val.trim() : val;
    });

    // ID 필드가 들어있으면 무시(우리 정책이 우선)
    delete out.id;

    // 컬렉션 기대 필드가 아닌 값이 있어도 merge:true라 운영상 문제는 없지만,
    // 다음 단계에서 스키마 엄격화가 필요하면 여기서 필드 필터링 가능
    return out;
  }

  /**
   * Seed 업로드용 문서ID 계산
   * - 컬렉션명 기반으로 정책 적용
   */
  function computeSeedDocId(colName: string, row: Record<string, any>) {
    // standardsCatalog: standard_key
    if (colName === 'standardsCatalog') {
      return sanitizeDocId(row.standard_key);
    }

    // sdtmDomains: domain_code
    if (colName === 'sdtmDomains') {
      return sanitizeDocId(row.domain_code);
    }

    // cdiscCodeLists: codelist_id + term_code (없으면 자동)
    if (colName === 'cdiscCodeLists') {
      const a = sanitizeDocId(row.codelist_id);
      const b = sanitizeDocId(row.term_code);
      if (a && b) return `${a}__${b}`;
      if (a) return `${a}__${sanitizeDocId(row.term_decode) || 'TERM'}__${nowTs()}`;
      return `CL__${nowTs()}`;
    }

    // formDomainMap: suggested_domain_code + form_name_pattern (없으면 자동)
    if (colName === 'formDomainMap') {
      const a = sanitizeDocId(row.suggested_domain_code);
      const b = sanitizeDocId(row.form_name_pattern);
      if (a && b) return `${a}__${b}`.slice(0, 150);
      if (b) return `MAP__${b}__${nowTs()}`.slice(0, 150);
      return `MAP__${nowTs()}`;
    }

    // fallback
    return sanitizeDocId(row.id) || `DOC__${nowTs()}`;
  }

  /** -------------------------
   * 렌더
   * ------------------------ */
  if (checking) {
    return (
      <main className="p-6">
        <h1 className="text-xl font-bold mb-2">SDTM DB 관리</h1>
        <p className="text-gray-500">권한을 확인 중입니다...</p>
      </main>
    );
  }

  if (!isAdmin) return null;

  const cols = getColumns(tab);

  return (
    <main className="p-6 space-y-4">
      {/* ✅ 숨김 파일 input (UI 변경 최소화) */}
      <input
        ref={fileRef}
        type="file"
        accept=".xlsx,.xls"
        className="hidden"
        onChange={handleSeedFileChange}
      />

      {/* 제목 */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">SDTM DB 관리</h1>
          <p className="text-sm text-gray-500">
            Standards/Domain/CodeList/FormMap 기준 데이터를 관리합니다.
          </p>
        </div>

        <div className="flex gap-2">
          <button
            onClick={handleSeedReloadClick}
            className="px-3 py-2 rounded border hover:bg-gray-50 dark:hover:bg-gray-800 text-sm"
            disabled={loading}
            title="엑셀 업로드로 Seed 데이터를 Firestore에 upsert 합니다."
          >
            Seed 재적재(관리자)
          </button>
          <button
            onClick={openCreate}
            className="px-3 py-2 rounded bg-black text-white dark:bg-white dark:text-black text-sm"
            disabled={loading}
          >
            추가
          </button>
          <button
            onClick={openUpdate}
            disabled={!selected || loading}
            className="px-3 py-2 rounded border text-sm disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-800"
          >
            수정
          </button>
          <button
            onClick={handleDelete}
            disabled={!selected || loading}
            className="px-3 py-2 rounded border text-sm disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-800"
          >
            삭제
          </button>
        </div>
      </div>

      {/* ✅ Seed 상태 표시(텍스트만 추가: 기존 UI 영향 최소) */}
      {seedStatus && (
        <div className="text-xs text-gray-500">
          Seed: {seedStatus}
        </div>
      )}

      {/* 탭 */}
      <div className="flex gap-2 flex-wrap">
        {(['catalog', 'domains', 'codelists', 'formmap'] as TabKey[]).map((k) => (
          <button
            key={k}
            onClick={() => {
              setTab(k);
              setKeyword('');
              setDomainClassFilter('ALL');
            }}
            className={[
              'px-3 py-2 rounded text-sm border',
              tab === k
                ? 'bg-black text-white dark:bg-white dark:text-black'
                : 'hover:bg-gray-50 dark:hover:bg-gray-800',
            ].join(' ')}
          >
            {TAB_LABEL[k]}
          </button>
        ))}
      </div>

      {/* 검색/필터 */}
      <div className="flex items-center gap-3 flex-wrap">
        <input
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="검색 키워드 (공백으로 다중 검색)"
          className="w-full md:w-[420px] px-3 py-2 rounded border bg-transparent"
        />

        {tab === 'domains' && (
          <select
            value={domainClassFilter}
            onChange={(e) => setDomainClassFilter(e.target.value)}
            className="px-3 py-2 rounded border bg-transparent text-sm"
          >
            {domainClassOptions.map((v) => (
              <option key={v} value={v}>
                Domain Class: {v}
              </option>
            ))}
          </select>
        )}

        <div className="text-sm text-gray-500">
          총 {filteredRows.length}건 {loading ? '(로딩 중...)' : ''}
        </div>
      </div>

      {/* 에러 */}
      {err && (
        <div className="p-3 rounded border border-red-300 bg-red-50 text-red-700 dark:bg-red-950 dark:border-red-800 dark:text-red-200 text-sm">
          {err}
        </div>
      )}

      {/* 테이블 + 상세 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <div className="lg:col-span-2 border rounded overflow-hidden">
          <div className="overflow-auto max-h-[70vh]">
            <table className="min-w-full text-sm">
              <thead className="sticky top-0 bg-gray-100 dark:bg-gray-800">
                <tr>
                  {cols.map((c) => (
                    <th
                      key={c.key}
                      className="text-left px-3 py-2 border-b font-semibold"
                      style={{ width: c.width }}
                    >
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>

              <tbody>
                {filteredRows.map((r: any) => {
                  const isSel = selected?.id === r.id;
                  return (
                    <tr
                      key={r.id}
                      onClick={() => setSelected(r)}
                      className={[
                        'cursor-pointer',
                        isSel ? 'bg-yellow-50 dark:bg-yellow-900/20' : '',
                        'hover:bg-gray-50 dark:hover:bg-gray-800/40',
                      ].join(' ')}
                    >
                      {cols.map((c) => (
                        <td key={c.key} className="px-3 py-2 border-b align-top">
                          <CellText value={r?.[c.key]} />
                        </td>
                      ))}
                    </tr>
                  );
                })}

                {filteredRows.length === 0 && !loading && (
                  <tr>
                    <td colSpan={cols.length} className="px-3 py-10 text-center text-gray-500">
                      표시할 데이터가 없습니다.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="border rounded p-4">
          <h2 className="text-lg font-bold mb-2">상세</h2>

          {!selected ? (
            <p className="text-sm text-gray-500">왼쪽 테이블에서 행을 선택해 주세요.</p>
          ) : (
            <div className="space-y-3">
              <DetailBlock tab={tab} row={selected as any} />

              <div className="flex gap-2 pt-2">
                <button
                  onClick={openUpdate}
                  className="px-3 py-2 rounded border text-sm hover:bg-gray-50 dark:hover:bg-gray-800"
                  disabled={loading}
                >
                  수정
                </button>
                <button
                  onClick={handleDelete}
                  className="px-3 py-2 rounded border text-sm hover:bg-gray-50 dark:hover:bg-gray-800"
                  disabled={loading}
                >
                  삭제
                </button>
              </div>

              <div className="text-xs text-gray-500">
                updatedAt:{' '}
                {(selected as any)?.updatedAt ? new Date((selected as any).updatedAt).toLocaleString() : '-'}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 추가/수정 모달 */}
      {editOpen && (
        <Modal
          title={editMode === 'create' ? '추가' : '수정'}
          onClose={() => setEditOpen(false)}
          onSave={handleSave}
          saving={loading}
        >
          <EditForm tab={tab} mode={editMode} draft={draft} setDraft={setDraft} />
          {editMode === 'update' && (tab === 'catalog' || tab === 'domains') && (
            <p className="text-xs text-gray-500 mt-2">
              * 수정 모드에서는 문서 ID 역할(standard_key / domain_code) 변경을 권장하지 않습니다. 변경이 필요하면 삭제 후 재생성 방식이 안전합니다.
            </p>
          )}
        </Modal>
      )}
    </main>
  );
}

/** -------------------------
 * 테이블 셀
 * ------------------------ */
function CellText({ value }: { value: any }) {
  if (value === null || value === undefined) return <span className="text-gray-400">-</span>;
  const s = String(value);
  if (s.length > 120) return <span title={s}>{s.slice(0, 120)}…</span>;
  return <span>{s}</span>;
}

/** -------------------------
 * 상세(탭별)
 * ------------------------ */
function DetailBlock({ tab, row }: { tab: TabKey; row: any }) {
  if (tab === 'catalog') {
    return (
      <div className="space-y-2 text-sm">
        <KV k="Standard Key" v={row.standard_key} />
        <KV k="Current Version" v={row.current_version} />
        <KV k="Published Date" v={row.published_date} />
        <KV k="Source Org" v={row.source_org} />
        <KV k="Notes" v={row.notes} multiline />
      </div>
    );
  }

  if (tab === 'domains') {
    return (
      <div className="space-y-2 text-sm">
        <KV k="Domain Code" v={row.domain_code} />
        <KV k="Domain Label" v={row.domain_label} />
        <KV k="Domain Class" v={row.domain_class} />
        <KV k="Description" v={row.description} multiline highlight />
        <KV k="Keywords" v={row.keywords_csv} />
        <KV k="Aliases" v={row.aliases_csv} />
      </div>
    );
  }

  if (tab === 'codelists') {
    return (
      <div className="space-y-2 text-sm">
        <KV k="Codelist ID" v={row.codelist_id} />
        <KV k="Codelist Name" v={row.codelist_name} />
        <KV k="Term Code" v={row.term_code} />
        <KV k="Term Decode" v={row.term_decode} />
        <KV k="Synonyms" v={row.synonyms_csv} />
        <KV k="NCI Code" v={row.nci_code} />
        <KV k="Notes" v={row.notes} multiline />
      </div>
    );
  }

  return (
    <div className="space-y-2 text-sm">
      <KV k="Form Name Pattern" v={row.form_name_pattern} multiline />
      <KV k="Suggested Domain" v={row.suggested_domain_code} />
      <KV k="Confidence Hint" v={row.confidence_hint} />
      <KV k="Notes" v={row.notes} multiline />
    </div>
  );
}

function KV({
  k,
  v,
  multiline,
  highlight,
}: {
  k: string;
  v: any;
  multiline?: boolean;
  highlight?: boolean;
}) {
  const val = v ?? '-';
  return (
    <div>
      <div className="text-xs text-gray-500">{k}</div>
      <div
        className={[
          'text-sm',
          multiline ? 'whitespace-pre-wrap break-words' : '',
          highlight ? 'p-2 rounded border bg-gray-50 dark:bg-gray-800/40' : '',
        ].join(' ')}
      >
        {String(val)}
      </div>
    </div>
  );
}

/** -------------------------
 * 모달
 * ------------------------ */
function Modal({
  title,
  children,
  onClose,
  onSave,
  saving,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  onSave: () => void;
  saving: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-3xl rounded bg-white dark:bg-gray-900 border shadow-lg">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <div className="font-bold">{title}</div>
          <button onClick={onClose} className="px-2 py-1 rounded border text-sm">
            닫기
          </button>
        </div>

        <div className="p-4">{children}</div>

        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t">
          <button onClick={onClose} className="px-3 py-2 rounded border text-sm">
            취소
          </button>
          <button
            onClick={onSave}
            disabled={saving}
            className="px-3 py-2 rounded bg-black text-white dark:bg-white dark:text-black text-sm disabled:opacity-60"
          >
            {saving ? '저장 중...' : '저장'}
          </button>
        </div>
      </div>
    </div>
  );
}

/** -------------------------
 * 폼(탭별)
 * ------------------------ */
function EditForm({
  tab,
  mode,
  draft,
  setDraft,
}: {
  tab: TabKey;
  mode: 'create' | 'update';
  draft: any;
  setDraft: (v: any) => void;
}) {
  if (tab === 'catalog') {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Input
          label="Standard Key *"
          value={draft.standard_key ?? ''}
          disabled={mode === 'update'}
          onChange={(v) => setDraft({ ...draft, standard_key: v })}
          placeholder="예: SDTM"
        />
        <Input
          label="Current Version *"
          value={draft.current_version ?? ''}
          onChange={(v) => setDraft({ ...draft, current_version: v })}
          placeholder="예: 3.3"
        />
        <Input
          label="Published Date"
          value={draft.published_date ?? ''}
          onChange={(v) => setDraft({ ...draft, published_date: v })}
          placeholder="YYYY-MM-DD"
        />
        <Input
          label="Source Org"
          value={draft.source_org ?? ''}
          onChange={(v) => setDraft({ ...draft, source_org: v })}
          placeholder="예: CDISC"
        />
        <Textarea
          label="Notes"
          value={draft.notes ?? ''}
          onChange={(v) => setDraft({ ...draft, notes: v })}
          placeholder="메모"
        />
      </div>
    );
  }

  if (tab === 'domains') {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Input
          label="Domain Code *"
          value={draft.domain_code ?? ''}
          disabled={mode === 'update'}
          onChange={(v) => setDraft({ ...draft, domain_code: v })}
          placeholder="예: DM"
        />
        <Input
          label="Domain Label *"
          value={draft.domain_label ?? ''}
          onChange={(v) => setDraft({ ...draft, domain_label: v })}
          placeholder="예: Demographics"
        />
        <Input
          label="Domain Class"
          value={draft.domain_class ?? ''}
          onChange={(v) => setDraft({ ...draft, domain_class: v })}
          placeholder="예: SPECIAL-PURPOSE"
        />
        <Input
          label="Keywords (csv)"
          value={draft.keywords_csv ?? ''}
          onChange={(v) => setDraft({ ...draft, keywords_csv: v })}
          placeholder="예: demographic,subject"
        />
        <Input
          label="Aliases (csv)"
          value={draft.aliases_csv ?? ''}
          onChange={(v) => setDraft({ ...draft, aliases_csv: v })}
          placeholder="예: DEMO"
        />
        <Textarea
          label="Description"
          value={draft.description ?? ''}
          onChange={(v) => setDraft({ ...draft, description: v })}
          placeholder="도메인 설명"
        />
      </div>
    );
  }

  if (tab === 'codelists') {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Input
          label="Codelist ID *"
          value={draft.codelist_id ?? ''}
          onChange={(v) => setDraft({ ...draft, codelist_id: v })}
          placeholder="예: CL.AESEV"
        />
        <Input
          label="Codelist Name *"
          value={draft.codelist_name ?? ''}
          onChange={(v) => setDraft({ ...draft, codelist_name: v })}
          placeholder="예: Severity"
        />
        <Input
          label="Term Code"
          value={draft.term_code ?? ''}
          onChange={(v) => setDraft({ ...draft, term_code: v })}
          placeholder="예: 1"
        />
        <Input
          label="Term Decode"
          value={draft.term_decode ?? ''}
          onChange={(v) => setDraft({ ...draft, term_decode: v })}
          placeholder="예: MILD"
        />
        <Input
          label="Synonyms (csv)"
          value={draft.synonyms_csv ?? ''}
          onChange={(v) => setDraft({ ...draft, synonyms_csv: v })}
          placeholder="예: mild,low"
        />
        <Input
          label="NCI Code"
          value={draft.nci_code ?? ''}
          onChange={(v) => setDraft({ ...draft, nci_code: v })}
          placeholder="예: Cxxxx"
        />
        <Textarea
          label="Notes"
          value={draft.notes ?? ''}
          onChange={(v) => setDraft({ ...draft, notes: v })}
          placeholder="메모"
        />
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      <Textarea
        label="Form Name Pattern *"
        value={draft.form_name_pattern ?? ''}
        onChange={(v) => setDraft({ ...draft, form_name_pattern: v })}
        placeholder="예: Demographics / DM / Subject Info 등"
      />
      <Input
        label="Suggested Domain *"
        value={draft.suggested_domain_code ?? ''}
        onChange={(v) => setDraft({ ...draft, suggested_domain_code: v })}
        placeholder="예: DM"
      />
      <Input
        label="Confidence Hint"
        value={draft.confidence_hint ?? ''}
        onChange={(v) => setDraft({ ...draft, confidence_hint: v })}
        placeholder="예: high / med / low 또는 0.8"
      />
      <Textarea
        label="Notes"
        value={draft.notes ?? ''}
        onChange={(v) => setDraft({ ...draft, notes: v })}
        placeholder="메모"
      />
    </div>
  );
}

function Input({
  label,
  value,
  onChange,
  placeholder,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <label className="block">
      <div className="text-xs text-gray-500 mb-1">{label}</div>
      <input
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-2 rounded border bg-transparent text-sm disabled:opacity-60"
      />
    </label>
  );
}

function Textarea({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block md:col-span-2">
      <div className="text-xs text-gray-500 mb-1">{label}</div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-2 rounded border bg-transparent text-sm min-h-[110px]"
      />
    </label>
  );
}

/** -------------------------
 * Draft/검증/ID
 * ------------------------ */
function getEmptyDraft(tab: TabKey) {
  if (tab === 'catalog') return { standard_key: '', current_version: '', published_date: '', source_org: '', notes: '' };
  if (tab === 'domains')
    return { domain_code: '', domain_label: '', domain_class: '', description: '', keywords_csv: '', aliases_csv: '' };
  if (tab === 'codelists')
    return { codelist_id: '', codelist_name: '', term_code: '', term_decode: '', synonyms_csv: '', nci_code: '', notes: '' };
  return { form_name_pattern: '', suggested_domain_code: '', confidence_hint: '', notes: '' };
}

function validateDraft(tab: TabKey, draft: any): { ok: boolean; message: string } {
  if (tab === 'catalog') {
    if (!draft.standard_key?.trim()) return { ok: false, message: 'Standard Key는 필수입니다.' };
    if (!draft.current_version?.trim()) return { ok: false, message: 'Current Version은 필수입니다.' };
  }
  if (tab === 'domains') {
    if (!draft.domain_code?.trim()) return { ok: false, message: 'Domain Code는 필수입니다.' };
    if (!draft.domain_label?.trim()) return { ok: false, message: 'Domain Label은 필수입니다.' };
  }
  if (tab === 'codelists') {
    if (!draft.codelist_id?.trim()) return { ok: false, message: 'Codelist ID는 필수입니다.' };
    if (!draft.codelist_name?.trim()) return { ok: false, message: 'Codelist Name은 필수입니다.' };
  }
  if (tab === 'formmap') {
    if (!draft.form_name_pattern?.trim()) return { ok: false, message: 'Form Name Pattern은 필수입니다.' };
    if (!draft.suggested_domain_code?.trim()) return { ok: false, message: 'Suggested Domain은 필수입니다.' };
  }
  return { ok: true, message: 'OK' };
}

function computeDocId(tab: TabKey, draft: any, mode: 'create' | 'update') {
  if (mode === 'update' && draft?.id) return String(draft.id);

  if (tab === 'catalog') return sanitizeDocId(String(draft.standard_key).trim());
  if (tab === 'domains') return sanitizeDocId(String(draft.domain_code).trim());

  const base =
    tab === 'codelists'
      ? `${sanitizeDocId(draft.codelist_id ?? 'CL')}__${sanitizeDocId(draft.term_code ?? 'TERM')}`
      : `${sanitizeDocId(draft.suggested_domain_code ?? 'DM')}__${sanitizeDocId((draft.form_name_pattern ?? 'FORM').slice(0, 20))}`;

  return `${base}__${Date.now()}`.slice(0, 150);
}
