'use client';

/**
 * 📄 app/contents/admin/sdtm/page.tsx
 * - SDTM DB 관리 (A안) : 4개 탭 + 공통 검색/필터 + 테이블 + 상세패널 + CRUD
 * - Firestore 컬렉션(기본): standardsCatalog, sdtmDomains, cdiscCodeLists, formDomainMap
 * - 관리자만 접근(클라이언트 가드) : users/{uid}.role === 'admin' 가정
 *
 * ✅ 사용자 요청 반영
 * - 코드 주석 포함
 * - 기존 디자인/마크업 큰 변경 없이, 최소 UI 구성
 * - 신규 파일 최소화(1개)
 */

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

// ✅ Firebase Auth/Firestore import (프로젝트에 맞게 경로 수정 필요)
// 예시1) import { auth, db } from '@/lib/firebase/firebase';
// 예시2) import { auth, db } from '@/lib/firebase';
import { auth, db } from '@/lib/firebase/firebase';

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
  where,
} from 'firebase/firestore';

/** -------------------------
 * 타입 정의(탭별)
 * ------------------------ */
type TabKey = 'catalog' | 'domains' | 'codelists' | 'formmap';

type StandardsCatalog = {
  id: string; // 문서 ID (standard_key 권장)
  standard_key: string;
  current_version: string;
  published_date?: string; // YYYY-MM-DD
  source_org?: string;
  notes?: string;
  updatedAt?: number;
};

type SdtmDomain = {
  id: string; // 문서 ID (domain_code 권장)
  domain_code: string; // UNIQUE
  domain_label: string;
  domain_class?: string;
  description?: string;
  keywords_csv?: string;
  aliases_csv?: string;
  updatedAt?: number;
};

type CodeList = {
  id: string; // 문서 ID (자동/또는 codelist_id+term_code 조합)
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
  id: string; // 문서 ID (자동/또는 form_name_pattern+domain_code 조합)
  form_name_pattern: string; // 부분일치/정규식 정책은 이후 확장
  suggested_domain_code: string;
  confidence_hint?: string; // "high/med/low" 또는 "0~1"
  notes?: string;
  updatedAt?: number;
};

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

/** -------------------------
 * 탭 메타 정의
 * ------------------------ */
const TAB_LABEL: Record<TabKey, string> = {
  catalog: 'Standards Catalog',
  domains: 'SDTM Domains',
  codelists: 'CDISC Code Lists',
  formmap: 'Form ↔ Domain Map',
};

type RowAny = StandardsCatalog | SdtmDomain | CodeList | FormDomainMap;

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
  // ✅ A안에서 합의한 컬렉션명(기본)
  if (tab === 'catalog') return 'standardsCatalog';
  if (tab === 'domains') return 'sdtmDomains';
  if (tab === 'codelists') return 'cdiscCodeLists';
  return 'formDomainMap';
}

/** -------------------------
 * 메인 컴포넌트
 * ------------------------ */
export default function SdtmAdminPage() {
  const router = useRouter();

  // ✅ 탭/검색/필터
  const [tab, setTab] = useState<TabKey>('domains');
  const [keyword, setKeyword] = useState<string>('');
  const [domainClassFilter, setDomainClassFilter] = useState<string>('ALL'); // domains 탭 전용

  // ✅ 데이터/로딩/에러
  const [rows, setRows] = useState<RowAny[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [err, setErr] = useState<string>('');

  // ✅ 관리자 가드
  const [isAdmin, setIsAdmin] = useState<boolean>(false);
  const [checking, setChecking] = useState<boolean>(true);

  // ✅ 선택 행(상세패널)
  const [selected, setSelected] = useState<RowAny | null>(null);

  // ✅ 모달(추가/수정)
  const [editOpen, setEditOpen] = useState<boolean>(false);
  const [editMode, setEditMode] = useState<'create' | 'update'>('create');
  const [draft, setDraft] = useState<any>({}); // 탭별 동적 폼이므로 any 사용

  /** -------------------------
   * 1) 관리자 여부 확인 (users/{uid}.role === 'admin' 가정)
   * ------------------------ */
  useEffect(() => {
    let alive = true;

    async function run() {
      setChecking(true);
      try {
        const user = auth?.currentUser;

        // 로그인 자체가 안 되어 있으면, 기존 정책에 맞춰 리다이렉트
        if (!user) {
          // ✅ 프로젝트 정책에 맞게 경로 변경 가능
          router.replace('/');
          return;
        }

        // users/{uid} 문서에서 role 확인
        const uref = doc(db, 'users', user.uid);
        const usnap = await getDoc(uref);

        const role = usnap.exists() ? (usnap.data() as any)?.role : null;
        const ok = role === 'admin';

        if (!alive) return;

        setIsAdmin(ok);
        setChecking(false);

        // 관리자가 아니면 접근 차단
        if (!ok) {
          router.replace('/contents'); // ✅ 필요 시 수정
        }
      } catch (e: any) {
        if (!alive) return;
        setChecking(false);
        setIsAdmin(false);
        setErr(e?.message ?? '권한 확인 중 오류가 발생했습니다.');
        router.replace('/contents');
      }
    }

    run();
    return () => {
      alive = false;
    };
  }, [router]);

  /** -------------------------
   * 2) 데이터 로드 (탭 변경/필터 변경 시)
   * ------------------------ */
  useEffect(() => {
    if (!isAdmin) return; // 관리자만 로드
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

      // ✅ 기본 쿼리(최근 업데이트 순)
      // - 탭별로 필요한 where/orderBy 추가 가능
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
   * 3) 화면 표시용 필터(클라이언트)
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
      // domains 탭: Domain Class 필터
      if (tab === 'domains' && domainClassFilter !== 'ALL') {
        if ((r?.domain_class ?? '') !== domainClassFilter) return false;
      }

      // 키워드 검색(간단 contains)
      if (keywords.length === 0) return true;

      // 탭별로 검색 대상 필드 확장
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
   * 4) CRUD 핸들러
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
    // ✅ 탭별 필수값 검증
    const v = validateDraft(tab, draft);
    if (!v.ok) {
      alert(v.message);
      return;
    }

    setLoading(true);
    setErr('');

    try {
      const colName = getCollectionName(tab);

      // ✅ 문서 ID 정책
      // - catalog: standard_key
      // - domains: domain_code
      // - 나머지: 자동(id) 또는 조합키(간단히 자동) 사용
      const docId = computeDocId(tab, draft, editMode);

      const ref = doc(db, colName, docId);

      const payload = {
        ...draft,
        id: docId, // UI 편의용(문서 내 id 저장)
        updatedAt: nowTs(),
      };

      if (editMode === 'create') {
        // setDoc: 신규 생성(덮어쓰기 가능)
        await setDoc(ref, payload, { merge: false });
      } else {
        // updateDoc: 기존 수정
        // - 문서ID가 변경되는 경우가 있으므로, update에서는 docId 변경 허용 안 함(정책)
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
   * 5) Seed 재적재(placeholder)
   * - 사용자가 제공한 엑셀(seed)을 그대로 업로드해 Firestore에 적재하는 기능은
   *   프로젝트 의존성(xlsx 등) 확인 후 “다음 단계”에서 안전하게 붙이는 것을 권장합니다.
   * - 버튼은 먼저 노출하되, 현재는 안내만 출력합니다.
   * ------------------------ */
  function handleSeedReload() {
    alert(
      'Seed 재적재는 다음 단계에서 엑셀 업로드 → 시트 파싱 → 컬렉션별 upsert로 안전하게 구현하겠습니다.\n(현재는 UI/컬럼 구조(A안) 확정 단계입니다.)'
    );
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

  if (!isAdmin) {
    return null; // 라우터로 이동되므로 빈 렌더
  }

  const cols = getColumns(tab);

  return (
    <main className="p-6 space-y-4">
      {/* 제목 */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">SDTM DB 관리</h1>
          <p className="text-sm text-gray-500">
            Standards/Domain/CodeList/FormMap 기준 데이터를 관리합니다.
          </p>
        </div>

        {/* 우측 버튼 */}
        <div className="flex gap-2">
          <button
            onClick={handleSeedReload}
            className="px-3 py-2 rounded border hover:bg-gray-50 dark:hover:bg-gray-800 text-sm"
          >
            Seed 재적재(관리자)
          </button>
          <button
            onClick={openCreate}
            className="px-3 py-2 rounded bg-black text-white dark:bg-white dark:text-black text-sm"
          >
            추가
          </button>
          <button
            onClick={openUpdate}
            disabled={!selected}
            className="px-3 py-2 rounded border text-sm disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-800"
          >
            수정
          </button>
          <button
            onClick={handleDelete}
            disabled={!selected}
            className="px-3 py-2 rounded border text-sm disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-800"
          >
            삭제
          </button>
        </div>
      </div>

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

        {/* domains 탭 전용 필터 */}
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

      {/* 본문: 테이블 + 상세패널 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {/* 테이블 */}
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

        {/* 상세패널 */}
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
                >
                  수정
                </button>
                <button
                  onClick={handleDelete}
                  className="px-3 py-2 rounded border text-sm hover:bg-gray-50 dark:hover:bg-gray-800"
                >
                  삭제
                </button>
              </div>

              <div className="text-xs text-gray-500">
                updatedAt: {(selected as any)?.updatedAt ? new Date((selected as any).updatedAt).toLocaleString() : '-'}
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
          <EditForm tab={tab} mode={editMode} draft={draft} setDraft={setDraft} rows={rows} />
          {/* ✅ 정책 안내(문서ID 변경 제한) */}
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
 * 테이블 셀 텍스트
 * ------------------------ */
function CellText({ value }: { value: any }) {
  if (value === null || value === undefined) return <span className="text-gray-400">-</span>;
  const s = String(value);

  // ✅ 너무 긴 텍스트는 줄여서 표시
  if (s.length > 120) {
    return <span title={s}>{s.slice(0, 120)}…</span>;
  }
  return <span>{s}</span>;
}

/** -------------------------
 * 상세 블록(탭별)
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

  // formmap
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
 * 탭별 폼
 * ------------------------ */
function EditForm({
  tab,
  mode,
  draft,
  setDraft,
  rows,
}: {
  tab: TabKey;
  mode: 'create' | 'update';
  draft: any;
  setDraft: (v: any) => void;
  rows: RowAny[];
}) {
  // ✅ formmap 탭에서 suggested_domain_code 선택을 위해 domains 목록 만들기
  const domainOptions = useMemo(() => {
    // rows가 현재 탭 데이터일 수 있으므로, 안전하게 별도 조회를 붙이려면 다음 단계에서 개선
    // 여기서는 최소 구현: 사용자가 formmap 탭에서 도메인 코드를 직접 입력해도 됨
    return [];
  }, [rows]);

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

  // formmap
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
        placeholder='예: high / med / low 또는 0.8'
      />
      <Textarea
        label="Notes"
        value={draft.notes ?? ''}
        onChange={(v) => setDraft({ ...draft, notes: v })}
        placeholder="메모"
      />

      {/* ✅ 도메인 옵션을 붙이는 기능은 다음 단계에서(안전하게) 개선 */}
      {domainOptions.length > 0 && (
        <div className="md:col-span-2 text-xs text-gray-500">
          (도메인 목록 선택은 다음 단계에서 도메인 컬렉션을 별도 조회하여 셀렉트로 제공합니다.)
        </div>
      )}
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
 * Draft 초기값
 * ------------------------ */
function getEmptyDraft(tab: TabKey) {
  if (tab === 'catalog') {
    return {
      standard_key: '',
      current_version: '',
      published_date: '',
      source_org: '',
      notes: '',
    } as Partial<StandardsCatalog>;
  }
  if (tab === 'domains') {
    return {
      domain_code: '',
      domain_label: '',
      domain_class: '',
      description: '',
      keywords_csv: '',
      aliases_csv: '',
    } as Partial<SdtmDomain>;
  }
  if (tab === 'codelists') {
    return {
      codelist_id: '',
      codelist_name: '',
      term_code: '',
      term_decode: '',
      synonyms_csv: '',
      nci_code: '',
      notes: '',
    } as Partial<CodeList>;
  }
  return {
    form_name_pattern: '',
    suggested_domain_code: '',
    confidence_hint: '',
    notes: '',
  } as Partial<FormDomainMap>;
}

/** -------------------------
 * 필수값 검증
 * ------------------------ */
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

/** -------------------------
 * 문서 ID 정책
 * ------------------------ */
function computeDocId(tab: TabKey, draft: any, mode: 'create' | 'update') {
  // ✅ update 모드에서는 기존 id를 유지
  if (mode === 'update' && draft?.id) return String(draft.id);

  if (tab === 'catalog') return String(draft.standard_key).trim();
  if (tab === 'domains') return String(draft.domain_code).trim();

  // codelists/formmap: 자동 ID 대신 “조합키”를 쓰면 중복관리가 편하지만,
  // 사용자 데이터 특성에 따라 충돌 가능성이 있어 기본은 타임스탬프 기반으로 생성
  const base = tab === 'codelists'
    ? `${draft.codelist_id ?? 'CL'}_${draft.term_code ?? 'TERM'}`
    : `${draft.suggested_domain_code ?? 'DM'}_${(draft.form_name_pattern ?? 'FORM').slice(0, 20)}`;

  return `${base}_${Date.now()}`;
}
