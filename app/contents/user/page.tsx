// app/user/page.tsx
// User Management
// - Firestore users 컬렉션의 사용자 목록 조회
// - role(admin/user) 수정 및 저장
// - 인터랙션이 있으므로 Client Component

"use client";

import { useEffect, useState } from "react";
import { collection, doc, getDocs, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase/firebase";

type UserDoc = {
  uid: string;
  email?: string;
  displayName?: string;
  role?: string;
  isSubscribed?: boolean;
};

export default function UserManagementPage() {
  const [users, setUsers] = useState<UserDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");
  const [savingUid, setSavingUid] = useState("");

  // 사용자 목록 로드
  const loadUsers = async () => {
    setLoading(true);
    setErrorMsg("");

    try {
      const snap = await getDocs(collection(db, "users"));
      const list: UserDoc[] = snap.docs.map((d) => {
        const data = d.data() as any;
        return {
          uid: d.id,
          email: data.email,
          displayName: data.displayName,
          role: data.role ?? "user",
          isSubscribed: Boolean(data.isSubscribed),
        };
      });
      setUsers(list);
    } catch (e: any) {
      setErrorMsg(e?.message ?? "유저 목록을 불러오는 중 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadUsers();
  }, []);

  // 로컬 role 변경
  const changeRoleLocal = (uid: string, nextRole: string) => {
    setUsers((prev) =>
      prev.map((u) => (u.uid === uid ? { ...u, role: nextRole } : u))
    );
  };

  // Firestore 저장
  const saveRole = async (uid: string) => {
    setSavingUid(uid);
    setErrorMsg("");

    try {
      const target = users.find((u) => u.uid === uid);
      if (!target) return;

      await updateDoc(doc(db, "users", uid), {
        role: target.role ?? "user",
      });
    } catch (e: any) {
      setErrorMsg(e?.message ?? "Role 저장 중 오류가 발생했습니다.");
    } finally {
      setSavingUid("");
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">User Management</h1>
        <p className="text-sm text-gray-600 dark:text-gray-300 mt-1">
          등록된 사용자 목록을 확인하고 Role을 관리합니다.
        </p>
      </div>

      {loading && (
        <div className="text-sm text-gray-600 dark:text-gray-300">
          사용자 목록을 불러오는 중입니다...
        </div>
      )}

      {errorMsg && (
        <div className="rounded border border-red-300 bg-red-50 dark:bg-red-900/20 px-4 py-3 text-sm text-red-700 dark:text-red-200">
          {errorMsg}
        </div>
      )}

      {!loading && (
        <div className="rounded-lg border border-gray-200 dark:border-gray-800 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-800 font-semibold">
            Users ({users.length})
          </div>

          <div className="divide-y divide-gray-200 dark:divide-gray-800">
            {users.map((u) => (
              <div
                key={u.uid}
                className="px-4 py-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between"
              >
                <div className="min-w-0">
                  <div className="font-medium truncate">
                    {u.displayName ?? "(no name)"}{" "}
                    <span className="text-sm text-gray-500 dark:text-gray-400">
                      {u.email ?? ""}
                    </span>
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    uid: {u.uid} · subscribed: {u.isSubscribed ? "true" : "false"}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <select
                    className="px-3 py-2 rounded border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 text-sm"
                    value={u.role ?? "user"}
                    onChange={(e) => changeRoleLocal(u.uid, e.target.value)}
                  >
                    <option value="user">user</option>
                    <option value="admin">admin</option>
                  </select>

                  <button
                    type="button"
                    className="px-3 py-2 rounded border border-gray-200 dark:border-gray-800 text-sm hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-60"
                    disabled={savingUid === u.uid}
                    onClick={() => saveRole(u.uid)}
                  >
                    {savingUid === u.uid ? "Saving..." : "Save"}
                  </button>
                </div>
              </div>
            ))}

            {users.length === 0 && (
              <div className="px-4 py-6 text-sm text-gray-600 dark:text-gray-300">
                등록된 사용자가 없습니다.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
