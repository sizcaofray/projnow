'use client';

/**
 * User Management Page
 * - 업로드된 AdminPage의 "사용자 관리" 섹션을 동일하게 분리 구현
 * - role 저장 시 isSubscribed/기간 자동 동기화(규칙 허용 4필드만 저장)
 * - 남은 일자(Days) 표시/수정 + +7/+30/+90 빠른 설정
 * - remainingDays는 DB에 쓰지 않고, 화면 계산 후 end일자를 저장
 * - 선택 사용자에 대해 남은일수 기준 "일괄 만료일 적용" 기능 포함
 *
 * ✅ 추가: 구독 버튼 활성화(subscribeButtonEnabled) 관리
 * - 테이블에 "구독버튼" 컬럼 추가(체크박스)
 * - 저장 시 기존 4필드 저장은 그대로 유지
 * - subscribeButtonEnabled는 별도로 updateDoc 시도(룰에 막히면 경고만)
 */

import { useEffect, useState } from 'react';
import { getAuth, getIdTokenResult, onAuthStateChanged } from 'firebase/auth';
import {
  collection,
  onSnapshot,
  updateDoc,
  doc,
  Timestamp,
  getDoc,
} from 'firebase/firestore';
import { db } from '@/lib/firebase/firebase';

type Role = 'free' | 'basic' | 'premium' | 'admin';
type Tier = 'free' | 'basic' | 'premium' | 'admin';

interface UserRow {
  uid: string;
  email: string;
  role: Role;
  uniqueId?: string | null;
  joinedAt?: Timestamp | null;
  isSubscribed?: boolean;
  subscriptionStartAt?: Timestamp | null;
  subscriptionEndAt?: Timestamp | null;
  remainingDays?: number | null; // 화면 계산용(읽기/편집), DB에 쓰지 않음
  subscriptionTier?: Tier; // 읽기 전용(파생)

  // ✅ 구독 버튼 활성화 여부(추가)
  subscribeButtonEnabled?: boolean; // 기본 true
}

const norm = (v: string) => String(v || '').trim().toLowerCase();

/* 날짜 유틸(업로드본과 동일) */
function kstToday(): Date {
  const now = new Date();
  const k = new Date(now.getTime() + 9 * 3600 * 1000);
  // 자정 기준(UTC)로 맞춰 보관
  return new Date(Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate()));
}
function addDays(d: Date, n: number) {
  return new Date(d.getTime() + n * 86400000);
}
function clampEndAfterStart(start: Date | null, end: Date | null) {
  if (!start || !end) return end;
  return end.getTime() < start.getTime() ? start : end;
}
function dateToInput(d: Date | null) {
  if (!d) return '';
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}
function tsToInputDate(ts: Timestamp | null | undefined) {
  if (!ts) return '';
  const d = ts.toDate();
  return dateToInput(new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())));
}
function inputDateToDate(s: string) {
  if (!s) return null;
  const d = new Date(s + 'T00:00:00Z');
  return isNaN(d.getTime()) ? null : d;
}

/** 종료일→남은일자(오늘 포함) */
function calcRemainingDaysFromEnd(end: Timestamp | null | undefined) {
  if (!end) return null;
  const e = end.toDate();
  const eu = new Date(Date.UTC(e.getFullYear(), e.getMonth(), e.getDate()));
  const base = kstToday();
  const diff = eu.getTime() - base.getTime();
  // 오늘 포함: 같으면 1일, 내일이면 2일...
  const days = Math.floor(diff / 86400000) + 1;
  return days < 0 ? 0 : days;
}

/** 남은일자→종료일(오늘 포함) : n<=0이면 오늘로 고정 */
function endFromRemainingDays(n: number): Date {
  const base = kstToday();
  const d = (isFinite(n) ? Math.max(1, Math.floor(n)) : 1) - 1; // n=1 → +0일(오늘)
  return addDays(base, d);
}

export default function UserManagementPage() {
  /** 내 계정 관리자 판별(업로드본과 동일) */
  const [roleLoading, setRoleLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    const auth = getAuth();
    const unsub = onAuthStateChanged(auth, async (u) => {
      setRoleLoading(true);
      try {
        if (!u) {
          setIsAdmin(false);
          return;
        }
        try {
          await getIdTokenResult(u, true);
        } catch {
          // ignore
        }
        const us = await getDoc(doc(db, 'users', u.uid));
        const r = norm((us.exists() ? (us.data() as any)?.role : 'user') ?? 'user');
        setIsAdmin(r === 'admin');
      } finally {
        setRoleLoading(false);
      }
    });
    return () => unsub();
  }, []);

  /* ───────────── 사용자 관리 (업로드본 동일) ───────────── */

  const [rows, setRows] = useState<UserRow[]>([]);
  const [saving, setSaving] = useState<string | null>(null);

  // ✅ 일괄 만료일 적용
  const [selectedUids, setSelectedUids] = useState<string[]>([]);
  const [bulkDays, setBulkDays] = useState<number | ''>('');
  const [bulkSaving, setBulkSaving] = useState(false);

  useEffect(() => {
    if (roleLoading || !isAdmin) return;

    const unsub = onSnapshot(collection(db, 'users'), (snap) => {
      const list: UserRow[] = [];

      snap.forEach((d) => {
        const data = d.data() as any;
        const endTs: Timestamp | null = (data.subscriptionEndAt ?? null) as Timestamp | null;

        list.push({
          uid: d.id,
          email: data.email ?? '',
          role: norm(data.role ?? 'free') as Role,
          uniqueId: data.uniqueId ?? null,
          joinedAt: data.joinedAt ?? null,
          isSubscribed: data.isSubscribed ?? false,
          subscriptionStartAt: (data.subscriptionStartAt ?? null) as Timestamp | null,
          subscriptionEndAt: endTs,
          remainingDays: calcRemainingDaysFromEnd(endTs),
          subscriptionTier: norm(data.subscriptionTier ?? data.role ?? 'free') as Tier,

          // ✅ 추가: 구독 버튼 활성(기본 true)
          subscribeButtonEnabled:
            typeof data.subscribeButtonEnabled === 'boolean' ? data.subscribeButtonEnabled : true,
        });
      });

      setRows(list);
      setSelectedUids((prev) => prev.filter((uid) => list.some((r) => r.uid === uid)));
    });

    return () => unsub();
  }, [roleLoading, isAdmin]);

  const patchRow = (uid: string, patch: Partial<UserRow>) =>
    setRows((prev) => prev.map((r) => (r.uid === uid ? { ...r, ...patch } : r)));

  const toggleSelect = (uid: string) => {
    setSelectedUids((prev) =>
      prev.includes(uid) ? prev.filter((id) => id !== uid) : [...prev, uid]
    );
  };

  const toggleSelectAll = () => {
    setSelectedUids((prev) => (prev.length === rows.length ? [] : rows.map((r) => r.uid)));
  };

  const handleBulkApplyDays = async () => {
    const n = typeof bulkDays === 'number' ? bulkDays : Number(bulkDays);
    if (!n || !isFinite(n) || n <= 0) {
      alert('일괄 적용할 남은 일수를 1 이상으로 입력해 주세요.');
      return;
    }

    const target = rows.filter(
      (r) => selectedUids.includes(r.uid) && r.role !== 'free' && r.isSubscribed
    );

    if (target.length === 0) {
      alert('선택된 사용자 중 적용 가능한 계정이 없습니다. (구독 중이 아닌 사용자 또는 free 역할)');
      return;
    }

    try {
      setBulkSaving(true);
      const baseEnd = endFromRemainingDays(n);

      for (const r of target) {
        const start = r.subscriptionStartAt?.toDate() ?? kstToday();
        const clamped = clampEndAfterStart(start, baseEnd) || baseEnd;
        const endTs = Timestamp.fromDate(clamped);

        await updateDoc(doc(db, 'users', r.uid), {
          subscriptionEndAt: endTs,
        });

        patchRow(r.uid, {
          subscriptionEndAt: endTs,
          remainingDays: calcRemainingDaysFromEnd(endTs),
        });
      }

      alert(`선택된 ${target.length}명의 사용자에 대해 남은 일수 ${n}일 기준으로 만료일이 일괄 적용되었습니다.`);
    } catch (e: any) {
      console.error('일괄 만료일 적용 오류:', e);
      alert(
        `일괄 만료일 적용 중 오류가 발생했습니다: ${e?.code || e?.message || '알 수 없는 오류'}`
      );
    } finally {
      setBulkSaving(false);
    }
  };

  /** role → 구독 상태/기간 산출(업로드본 동일) */
  function deriveSubscriptionByRole(row: UserRow, safeRole: Role) {
    const today = kstToday();

    if (safeRole === 'free') {
      return {
        isSubscribed: false,
        startTs: null as Timestamp | null,
        endTs: null as Timestamp | null,
      };
    }

    const startD = row.subscriptionStartAt?.toDate() ?? today;
    const endD0 = row.subscriptionEndAt?.toDate() ?? addDays(startD, 30);
    const endD = clampEndAfterStart(startD, endD0) ?? addDays(startD, 30);

    const endUTC = new Date(Date.UTC(endD.getUTCFullYear(), endD.getUTCMonth(), endD.getUTCDate()));
    const todayUTC = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
    const expired = endUTC.getTime() < todayUTC.getTime();

    if (expired) {
      return { isSubscribed: false, startTs: null, endTs: null };
    }

    return {
      isSubscribed: true,
      startTs: Timestamp.fromDate(startD),
      endTs: Timestamp.fromDate(endD),
    };
  }

  function previewRoleChange(uid: string, nextRole: Role) {
    const row = rows.find((r) => r.uid === uid);
    if (!row) return;

    const { isSubscribed, startTs, endTs } = deriveSubscriptionByRole(row, nextRole);

    patchRow(uid, {
      role: nextRole,
      isSubscribed,
      subscriptionStartAt: startTs,
      subscriptionEndAt: endTs,
      remainingDays: calcRemainingDaysFromEnd(endTs),
    });
  }

  /** 저장(규칙 허용 4필드만) + ✅ 구독 버튼 활성화 별도 저장 시도 */
  const handleSave = async (row: UserRow) => {
    setSaving(row.uid);
    try {
      const vRole = norm(row.role) as Role;
      const safeRole = (['free', 'basic', 'premium', 'admin'].includes(vRole) ? vRole : 'free') as Role;

      let { isSubscribed, startTs, endTs } = deriveSubscriptionByRole(row, safeRole);

      if (row.remainingDays != null && row.remainingDays > 0 && isSubscribed) {
        const endFromDays = endFromRemainingDays(row.remainingDays);
        const clamped = startTs
          ? clampEndAfterStart(startTs.toDate(), endFromDays) || endFromDays
          : endFromDays;
        endTs = Timestamp.fromDate(clamped);
      }

      // ✅ 기존 저장(룰 허용 4필드)
      await updateDoc(doc(db, 'users', row.uid), {
        role: safeRole,
        isSubscribed,
        subscriptionStartAt: startTs ?? null,
        subscriptionEndAt: endTs ?? null,
      });

      patchRow(row.uid, {
        role: safeRole,
        isSubscribed,
        subscriptionStartAt: startTs ?? null,
        subscriptionEndAt: endTs ?? null,
        remainingDays: calcRemainingDaysFromEnd(endTs),
      });

      // ✅ 추가 저장: subscribeButtonEnabled (룰에 막힐 수 있으므로 별도 try/catch)
      try {
        const enabled =
          typeof row.subscribeButtonEnabled === 'boolean' ? row.subscribeButtonEnabled : true;

        await updateDoc(doc(db, 'users', row.uid), {
          subscribeButtonEnabled: enabled,
        });

        patchRow(row.uid, { subscribeButtonEnabled: enabled });
      } catch (e: any) {
        console.error('subscribeButtonEnabled 저장 오류:', e);
        alert(
          `⚠️ 기본 저장은 완료됐지만, "구독버튼 활성화" 저장은 실패했습니다.\n` +
            `Firestore rules에서 users 문서의 subscribeButtonEnabled 필드 쓰기가 허용되어야 합니다.\n` +
            `오류: ${e?.code || e?.message || '알 수 없는 오류'}`
        );
      }

      alert('저장되었습니다.');
    } catch (e: any) {
      console.error('사용자 저장 오류:', e);
      alert(`저장 중 오류: ${e?.code || e?.message || '알 수 없는 오류'}`);
    } finally {
      setSaving(null);
    }
  };

  /* ───────────── 렌더 ───────────── */

  if (roleLoading) return <main className="p-6 text-sm text-gray-500">로딩 중...</main>;

  if (!isAdmin) {
    return (
      <main className="p-6">
        <h1 className="text-xl font-semibold mb-4">User Management</h1>
        <p className="text-red-600 dark:text-red-400">⛔ 관리자 권한이 없습니다.</p>
      </main>
    );
  }

  return (
    <main className="p-6 space-y-6">
      <section>
        <h1 className="text-xl font-semibold mb-4">User Management</h1>

        {/* ✅ 선택 사용자 일괄 만료일(남은 일수 기준) 설정 */}
        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-xs text-slate-500">
            선택한 사용자에게 동일한 남은 일수(일 기준)를 적용하여 만료일을 일괄 설정합니다.
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm">일괄 남은 일수</span>
            <input
              type="number"
              min={1}
              className="w-20 border rounded px-2 py-1 bg-transparent text-sm"
              value={bulkDays === '' ? '' : bulkDays}
              onChange={(e) => {
                const v = e.target.value;
                setBulkDays(v === '' ? '' : Number(v));
              }}
            />
            <div className="flex gap-1">
              {[7, 30, 90].map((d) => (
                <button
                  key={d}
                  type="button"
                  className="px-2 py-1 text-xs rounded border hover:bg-slate-50 dark:hover:bg-slate-800"
                  onClick={() => setBulkDays(d)}
                >
                  +{d}
                </button>
              ))}
            </div>
            <div className="text-xs text-slate-500">선택: {selectedUids.length}명</div>
            <button
              type="button"
              className="text-xs bg-blue-600 text-white px-3 py-1 rounded hover:bg-blue-700 disabled:opacity-50"
              onClick={handleBulkApplyDays}
              disabled={
                bulkSaving ||
                !bulkDays ||
                (typeof bulkDays === 'number' ? bulkDays : Number(bulkDays)) <= 0 ||
                selectedUids.length === 0
              }
            >
              {bulkSaving ? '일괄 적용 중…' : '일괄 적용'}
            </button>
          </div>
        </div>

        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="text-left border-b">
              <th className="py-2 pr-4">
                <input
                  type="checkbox"
                  className="w-4 h-4"
                  checked={rows.length > 0 && selectedUids.length === rows.length}
                  onChange={toggleSelectAll}
                />
              </th>
              <th className="py-2 pr-4">Email</th>
              <th className="py-2 pr-4">Role</th>
              <th className="py-2 pr-4">Subscribed</th>

              {/* ✅ 추가 컬럼 */}
              <th className="py-2 pr-4">구독버튼</th>

              <th className="py-2 pr-4">Start</th>
              <th className="py-2 pr-4">End</th>
              <th className="py-2 pr-4">Days</th>
              <th className="py-2 pr-4">Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.uid} className="border-b align-top">
                <td className="py-2 pr-4">
                  <input
                    type="checkbox"
                    className="w-4 h-4"
                    checked={selectedUids.includes(r.uid)}
                    onChange={() => toggleSelect(r.uid)}
                  />
                </td>

                <td className="py-2 pr-4">{r.email}</td>

                <td className="py-2 pr-4">
                  <select
                    className="border rounded px-2 py-1 bg-white dark:bg-transparent"
                    value={r.role}
                    onChange={(e) => {
                      const v = norm(e.target.value) as Role;
                      const safe: Role = (['free', 'basic', 'premium', 'admin'].includes(v) ? v : 'free') as Role;
                      previewRoleChange(r.uid, safe);
                    }}
                  >
                    <option value="free">free</option>
                    <option value="basic">basic</option>
                    <option value="premium">premium</option>
                    <option value="admin">admin</option>
                  </select>
                </td>

                <td className="py-2 pr-4">
                  <input
                    type="checkbox"
                    className="w-4 h-4"
                    checked={!!r.isSubscribed}
                    disabled={r.role === 'free'}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      if (!checked) {
                        patchRow(r.uid, {
                          isSubscribed: false,
                          subscriptionStartAt: null,
                          subscriptionEndAt: null,
                          remainingDays: null,
                        });
                      } else {
                        const { isSubscribed, startTs, endTs } = deriveSubscriptionByRole(r, r.role);
                        patchRow(r.uid, {
                          isSubscribed,
                          subscriptionStartAt: startTs,
                          subscriptionEndAt: endTs,
                          remainingDays: calcRemainingDaysFromEnd(endTs),
                        });
                      }
                    }}
                  />
                </td>

                {/* ✅ 구독 버튼 활성화 체크 */}
                <td className="py-2 pr-4">
                  <input
                    type="checkbox"
                    className="w-4 h-4"
                    checked={typeof r.subscribeButtonEnabled === 'boolean' ? r.subscribeButtonEnabled : true}
                    onChange={(e) => patchRow(r.uid, { subscribeButtonEnabled: e.target.checked })}
                    title="헤더의 구독 버튼 활성/비활성"
                  />
                </td>

                <td className="py-2 pr-4">
                  <input
                    type="date"
                    className="border rounded px-2 py-1 bg-transparent"
                    value={tsToInputDate(r.subscriptionStartAt ?? null)}
                    onChange={(e) => {
                      const newStart = inputDateToDate(e.target.value);
                      const currEnd = r.subscriptionEndAt?.toDate() ?? null;
                      const clampedEnd = clampEndAfterStart(newStart, currEnd);

                      const newStartTs = newStart ? Timestamp.fromDate(newStart) : null;
                      const newEndTs = clampedEnd ? Timestamp.fromDate(clampedEnd) : null;

                      patchRow(r.uid, {
                        subscriptionStartAt: newStartTs,
                        subscriptionEndAt: newEndTs,
                        remainingDays: calcRemainingDaysFromEnd(newEndTs),
                      });
                    }}
                    disabled={r.role === 'free' || !r.isSubscribed}
                  />
                </td>

                <td className="py-2 pr-4">
                  <input
                    type="date"
                    className="border rounded px-2 py-1 bg-transparent"
                    value={tsToInputDate(r.subscriptionEndAt ?? null)}
                    onChange={(e) => {
                      const newEnd = inputDateToDate(e.target.value);
                      const newEndTs = newEnd ? Timestamp.fromDate(newEnd) : null;
                      patchRow(r.uid, {
                        subscriptionEndAt: newEndTs,
                        remainingDays: calcRemainingDaysFromEnd(newEndTs),
                      });
                    }}
                    disabled={r.role === 'free' || !r.isSubscribed}
                  />
                </td>

                <td className="py-2 pr-4">
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      className="w-16 border rounded px-2 py-1 bg-transparent"
                      value={r.remainingDays ?? ''}
                      onChange={(e) => {
                        const v = e.target.value;
                        const n = v === '' ? null : Number(v);
                        patchRow(r.uid, {
                          remainingDays: n == null || !isFinite(n) ? null : (n as number),
                        });
                      }}
                      disabled={r.role === 'free' || !r.isSubscribed}
                    />
                    <div className="flex flex-col gap-0.5">
                      {[7, 30, 90].map((d) => (
                        <button
                          key={d}
                          type="button"
                          className="px-2 py-0.5 text-[11px] rounded border hover:bg-slate-50 dark:hover:bg-slate-800"
                          onClick={() =>
                            patchRow(r.uid, {
                              remainingDays: (r.remainingDays ?? 0) + d,
                            })
                          }
                          disabled={r.role === 'free' || !r.isSubscribed}
                        >
                          +{d}
                        </button>
                      ))}
                    </div>
                  </div>
                </td>

                <td className="py-2 pr-4">
                  <button
                    type="button"
                    className="text-xs bg-blue-600 text-white px-3 py-1 rounded hover:bg-blue-700 disabled:opacity-50"
                    onClick={() => handleSave(r)}
                    disabled={saving === r.uid}
                  >
                    {saving === r.uid ? '저장 중…' : '저장'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
