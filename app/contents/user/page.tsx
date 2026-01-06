"use client";

// app/contents/user/page.tsx
// ✅ 요구사항 반영
// - "상단 구독 버튼"을 유저별이 아닌 "전역"으로 관리
// - 다크/라이트 모드에서 select/input이 이상하지 않게 스타일 보정 (dark: 대응)

import { useEffect, useState } from "react";
import { getAuth, getIdTokenResult, onAuthStateChanged } from "firebase/auth";
import {
  collection,
  onSnapshot,
  updateDoc,
  setDoc,
  doc,
  Timestamp,
  getDoc,
} from "firebase/firestore";
import { db } from "@/lib/firebase/firebase";

type Role = "free" | "basic" | "premium" | "admin";

interface UserRow {
  uid: string;
  email: string;
  role: Role;
  isSubscribed?: boolean;
  subscriptionStartAt?: Timestamp | null;
  subscriptionEndAt?: Timestamp | null;
  remainingDays?: number | null; // 화면용
}

type UiConfig = {
  headerSubscribeVisible: boolean;
  headerSubscribeEnabled: boolean;
};

const norm = (v: string) => String(v || "").trim().toLowerCase();

/** 날짜 유틸(기존 흐름 유지) */
function kstToday(): Date {
  const now = new Date();
  const k = new Date(now.getTime() + 9 * 3600 * 1000);
  return new Date(Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate()));
}
function addDays(d: Date, n: number) {
  return new Date(d.getTime() + n * 86400000);
}
function clampEndAfterStart(start: Date | null, end: Date | null) {
  if (!start || !end) return end;
  return end.getTime() < start.getTime() ? start : end;
}
function tsToInputDate(ts: Timestamp | null | undefined) {
  if (!ts) return "";
  const d = ts.toDate();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}
function inputDateToDate(s: string) {
  if (!s) return null;
  const d = new Date(s + "T00:00:00Z");
  return isNaN(d.getTime()) ? null : d;
}
function calcRemainingDaysFromEnd(end: Timestamp | null | undefined) {
  if (!end) return null;
  const e = end.toDate();
  const eu = new Date(Date.UTC(e.getFullYear(), e.getMonth(), e.getDate()));
  const base = kstToday();
  const diff = eu.getTime() - base.getTime();
  const days = Math.floor(diff / 86400000) + 1;
  return days < 0 ? 0 : days;
}
function endFromRemainingDays(n: number): Date {
  const base = kstToday();
  const d = (isFinite(n) ? Math.max(1, Math.floor(n)) : 1) - 1;
  return addDays(base, d);
}

export default function UserManagementPage() {
  /** 관리자 판별 */
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
        const us = await getDoc(doc(db, "users", u.uid));
        const r = norm((us.exists() ? (us.data() as any)?.role : "user") ?? "user");
        setIsAdmin(r === "admin");
      } finally {
        setRoleLoading(false);
      }
    });
    return () => unsub();
  }, []);

  /** ✅ 전역 UI 설정 로드/저장 */
  const [ui, setUi] = useState<UiConfig>({
    headerSubscribeVisible: true,
    headerSubscribeEnabled: true,
  });
  const [uiSaving, setUiSaving] = useState(false);

  useEffect(() => {
    if (roleLoading || !isAdmin) return;

    const ref = doc(db, "appConfig", "ui");
    const unsub = onSnapshot(
      ref,
      (snap) => {
        const data = (snap.exists() ? snap.data() : null) as any;
        setUi({
          headerSubscribeVisible:
            typeof data?.headerSubscribeVisible === "boolean"
              ? data.headerSubscribeVisible
              : true,
          headerSubscribeEnabled:
            typeof data?.headerSubscribeEnabled === "boolean"
              ? data.headerSubscribeEnabled
              : true,
        });
      },
      () => {
        // 읽기 실패 시 기본값 유지
        setUi({ headerSubscribeVisible: true, headerSubscribeEnabled: true });
      }
    );

    return () => unsub();
  }, [roleLoading, isAdmin]);

  const saveUi = async () => {
    try {
      setUiSaving(true);
      await setDoc(
        doc(db, "appConfig", "ui"),
        {
          headerSubscribeVisible: ui.headerSubscribeVisible,
          headerSubscribeEnabled: ui.headerSubscribeEnabled,
        },
        { merge: true }
      );
      alert("상단 구독 버튼 설정이 저장되었습니다.");
    } catch (e: any) {
      console.error(e);
      alert(`저장 실패: ${e?.code || e?.message || "알 수 없는 오류"}`);
    } finally {
      setUiSaving(false);
    }
  };

  /** 사용자 목록 */
  const [rows, setRows] = useState<UserRow[]>([]);
  const [savingUid, setSavingUid] = useState<string | null>(null);

  useEffect(() => {
    if (roleLoading || !isAdmin) return;

    const unsub = onSnapshot(collection(db, "users"), (snap) => {
      const list: UserRow[] = [];
      snap.forEach((d) => {
        const data = d.data() as any;
        const endTs = (data.subscriptionEndAt ?? null) as Timestamp | null;

        list.push({
          uid: d.id,
          email: data.email ?? "",
          role: norm(data.role ?? "free") as Role,
          isSubscribed: data.isSubscribed ?? false,
          subscriptionStartAt: (data.subscriptionStartAt ?? null) as Timestamp | null,
          subscriptionEndAt: endTs,
          remainingDays: calcRemainingDaysFromEnd(endTs),
        });
      });
      setRows(list);
    });

    return () => unsub();
  }, [roleLoading, isAdmin]);

  const patchRow = (uid: string, patch: Partial<UserRow>) =>
    setRows((prev) => prev.map((r) => (r.uid === uid ? { ...r, ...patch } : r)));

  function deriveSubscriptionByRole(row: UserRow, safeRole: Role) {
    const today = kstToday();

    if (safeRole === "free") {
      return { isSubscribed: false, startTs: null as Timestamp | null, endTs: null as Timestamp | null };
    }

    const startD = row.subscriptionStartAt?.toDate() ?? today;
    const endD0 = row.subscriptionEndAt?.toDate() ?? addDays(startD, 30);
    const endD = clampEndAfterStart(startD, endD0) ?? addDays(startD, 30);

    return {
      isSubscribed: true,
      startTs: Timestamp.fromDate(startD),
      endTs: Timestamp.fromDate(endD),
    };
  }

  const handleSaveUser = async (row: UserRow) => {
    setSavingUid(row.uid);
    try {
      const vRole = norm(row.role) as Role;
      const safeRole = (["free", "basic", "premium", "admin"].includes(vRole) ? vRole : "free") as Role;

      let { isSubscribed, startTs, endTs } = deriveSubscriptionByRole(row, safeRole);

      // remainingDays를 입력한 경우 종료일 계산
      if (row.remainingDays != null && row.remainingDays > 0 && isSubscribed) {
        const endFromDays = endFromRemainingDays(row.remainingDays);
        const clamped = startTs
          ? clampEndAfterStart(startTs.toDate(), endFromDays) || endFromDays
          : endFromDays;
        endTs = Timestamp.fromDate(clamped);
      }

      // ✅ 기존 저장(프로젝트 룰이 허용하는 필드만)
      await updateDoc(doc(db, "users", row.uid), {
        role: safeRole,
        isSubscribed,
        subscriptionStartAt: startTs ?? null,
        subscriptionEndAt: endTs ?? null,
      });

      alert("저장되었습니다.");
    } catch (e: any) {
      console.error(e);
      alert(`저장 실패: ${e?.code || e?.message || "알 수 없는 오류"}`);
    } finally {
      setSavingUid(null);
    }
  };

  if (roleLoading) return <main className="p-6 text-sm text-gray-500">로딩 중...</main>;

  if (!isAdmin) {
    return (
      <main className="p-6">
        <h1 className="text-xl font-semibold mb-4">User Management</h1>
        <p className="text-red-600 dark:text-red-400">⛔ 관리자 권한이 없습니다.</p>
      </main>
    );
  }

  // ✅ 다크/라이트에서 자연스럽게 보이는 공통 입력 클래스 (색상 고정이 아니라 dark 대응)
  const inputCls =
    "border rounded px-2 py-1 text-sm " +
    "border-gray-300 bg-white text-gray-900 " +
    "dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100";

  return (
    <main className="p-6 space-y-6">
      <section>
        <h1 className="text-xl font-semibold mb-4">User Management</h1>

        {/* ✅ 전역: 상단 구독 버튼 설정 */}
        <div className="mb-4 flex flex-col gap-2 rounded border border-gray-200 dark:border-gray-800 p-3">
          <div className="font-medium text-sm text-gray-900 dark:text-gray-100">
            상단 구독 버튼 설정(전역)
          </div>

          <div className="flex flex-wrap items-center gap-6 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                className="w-4 h-4"
                checked={ui.headerSubscribeVisible}
                onChange={(e) => setUi((p) => ({ ...p, headerSubscribeVisible: e.target.checked }))}
              />
              <span className="text-gray-800 dark:text-gray-200">보이기</span>
            </label>

            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                className="w-4 h-4"
                checked={ui.headerSubscribeEnabled}
                onChange={(e) => setUi((p) => ({ ...p, headerSubscribeEnabled: e.target.checked }))}
              />
              <span className="text-gray-800 dark:text-gray-200">활성화</span>
              <span className="text-xs text-gray-500 dark:text-gray-400">
                (로그인되어야 클릭 가능)
              </span>
            </label>

            <button
              type="button"
              onClick={saveUi}
              disabled={uiSaving}
              className="text-xs bg-blue-600 text-white px-3 py-1 rounded hover:bg-blue-700 disabled:opacity-50"
            >
              {uiSaving ? "저장 중…" : "저장"}
            </button>
          </div>
        </div>

        {/* ✅ 사용자 테이블 */}
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="text-left border-b border-gray-700/40">
              <th className="py-2 pr-4">Email</th>
              <th className="py-2 pr-4">Role</th>
              <th className="py-2 pr-4">Subscribed</th>
              <th className="py-2 pr-4">Start</th>
              <th className="py-2 pr-4">End</th>
              <th className="py-2 pr-4">Days</th>
              <th className="py-2 pr-4">Action</th>
            </tr>
          </thead>

          <tbody>
            {rows.map((r) => (
              <tr key={r.uid} className="border-b border-gray-700/30 align-top">
                <td className="py-2 pr-4">{r.email}</td>

                <td className="py-2 pr-4">
                  <select
                    className={inputCls}
                    value={r.role}
                    onChange={(e) => {
                      const v = norm(e.target.value) as Role;
                      patchRow(r.uid, { role: (["free", "basic", "premium", "admin"].includes(v) ? v : "free") as Role });
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
                    disabled={r.role === "free"}
                    onChange={(e) => patchRow(r.uid, { isSubscribed: e.target.checked })}
                  />
                </td>

                <td className="py-2 pr-4">
                  <input
                    type="date"
                    className={inputCls}
                    value={tsToInputDate(r.subscriptionStartAt ?? null)}
                    onChange={(e) => {
                      const newStart = inputDateToDate(e.target.value);
                      const newStartTs = newStart ? Timestamp.fromDate(newStart) : null;
                      patchRow(r.uid, { subscriptionStartAt: newStartTs });
                    }}
                    disabled={r.role === "free" || !r.isSubscribed}
                  />
                </td>

                <td className="py-2 pr-4">
                  <input
                    type="date"
                    className={inputCls}
                    value={tsToInputDate(r.subscriptionEndAt ?? null)}
                    onChange={(e) => {
                      const newEnd = inputDateToDate(e.target.value);
                      const newEndTs = newEnd ? Timestamp.fromDate(newEnd) : null;
                      patchRow(r.uid, { subscriptionEndAt: newEndTs, remainingDays: calcRemainingDaysFromEnd(newEndTs) });
                    }}
                    disabled={r.role === "free" || !r.isSubscribed}
                  />
                </td>

                <td className="py-2 pr-4">
                  <input
                    type="number"
                    className={inputCls + " w-20"}
                    value={r.remainingDays ?? ""}
                    onChange={(e) => {
                      const v = e.target.value;
                      const n = v === "" ? null : Number(v);
                      patchRow(r.uid, { remainingDays: n == null || !isFinite(n) ? null : n });
                    }}
                    disabled={r.role === "free" || !r.isSubscribed}
                  />
                </td>

                <td className="py-2 pr-4">
                  <button
                    type="button"
                    className="text-xs bg-blue-600 text-white px-3 py-1 rounded hover:bg-blue-700 disabled:opacity-50"
                    onClick={() => handleSaveUser(r)}
                    disabled={savingUid === r.uid}
                  >
                    {savingUid === r.uid ? "저장 중…" : "저장"}
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
