"use client";

// app/contents/menu/page.tsx
// - ProjNow 메뉴관리 페이지
// - Firestore(system_menus) 기반 CRUD
// - 비로그인/일반유저도 목록 조회는 가능(원칙상 사용 중에도 로그인 가능)
// - 추가/수정/삭제는 관리자(admin claim)만 가능
// - 리다이렉트 없음(요구사항 준수)

import { useEffect, useMemo, useState } from "react";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { getIdTokenResult } from "firebase/auth";

import { useAuth } from "@/lib/auth/useAuth";
import { getFirebaseAuth, getFirebaseDb } from "@/lib/firebase/client";

type MenuDoc = {
  id: string;
  name: string;
  path: string;
  group: string;
  order: number;
  isActive: boolean;
  adminOnly: boolean;
};

// ✅ 컬렉션명(원하시면 변경 가능)
const COL = "system_menus";

export default function MenuManagePage() {
  const { user, loading, initError } = useAuth();

  const auth = useMemo(() => {
    try {
      return getFirebaseAuth();
    } catch {
      return null;
    }
  }, []);

  const db = useMemo(() => {
    try {
      return getFirebaseDb();
    } catch {
      return null;
    }
  }, []);

  const [isAdmin, setIsAdmin] = useState(false);
  const [checkingAdmin, setCheckingAdmin] = useState(false);

  const [menus, setMenus] = useState<MenuDoc[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  // ✅ 추가 폼 상태
  const [form, setForm] = useState<Omit<MenuDoc, "id">>({
    name: "",
    path: "",
    group: "Workspace",
    order: 100,
    isActive: true,
    adminOnly: false,
  });

  // ✅ 편집 상태
  const [editId, setEditId] = useState("");
  const [edit, setEdit] = useState<Omit<MenuDoc, "id">>({
    name: "",
    path: "",
    group: "",
    order: 0,
    isActive: true,
    adminOnly: false,
  });

  /** ✅ 관리자 여부 확인: custom claim admin === true */
  useEffect(() => {
    const run = async () => {
      setErr("");
      if (!user || !auth) {
        setIsAdmin(false);
        return;
      }

      try {
        setCheckingAdmin(true);
        const token = await getIdTokenResult(user, true);
        setIsAdmin(token?.claims?.admin === true);
      } catch (e: any) {
        setIsAdmin(false);
        setErr(e?.message ?? "관리자 권한 확인 중 오류가 발생했습니다.");
      } finally {
        setCheckingAdmin(false);
      }
    };

    run();
  }, [user, auth]);

  /** ✅ 메뉴 로드 */
  const loadMenus = async () => {
    try {
      setErr("");
      if (!db) {
        setErr("Firestore 초기화에 실패했습니다. Firebase 환경변수를 확인해주세요.");
        return;
      }

      setBusy(true);
      const q = query(collection(db, COL), orderBy("order", "asc"));
      const snap = await getDocs(q);

      const rows: MenuDoc[] = snap.docs.map((d) => {
        const v = d.data() as any;
        return {
          id: d.id,
          name: String(v.name ?? ""),
          path: String(v.path ?? ""),
          group: String(v.group ?? ""),
          order: Number(v.order ?? 0),
          isActive: Boolean(v.isActive ?? true),
          adminOnly: Boolean(v.adminOnly ?? false),
        };
      });

      setMenus(rows);
    } catch (e: any) {
      setErr(e?.message ?? "메뉴 목록 로드에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    // ✅ 초기화 완료 후 로드
    if (!loading && !initError) {
      loadMenus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, initError]);

  /** ✅ 입력값 검증 */
  const validateMenu = (m: Omit<MenuDoc, "id">) => {
    if (!m.name.trim()) return "메뉴명을 입력해주세요.";
    if (!m.path.trim()) return "경로(path)를 입력해주세요.";
    if (!m.path.startsWith("/")) return "경로(path)는 반드시 / 로 시작해야 합니다.";
    return "";
  };

  /** ✅ 메뉴 추가(관리자만) */
  const addMenu = async () => {
    try {
      setErr("");
      if (!isAdmin) return setErr("관리자만 메뉴를 추가할 수 있습니다.");
      if (!db) return;

      const msg = validateMenu(form);
      if (msg) return setErr(msg);

      setBusy(true);
      await addDoc(collection(db, COL), {
        ...form,
        name: form.name.trim(),
        path: form.path.trim(),
        updatedAt: serverTimestamp(),
      });

      // ✅ 폼 최소 리셋
      setForm((p) => ({ ...p, name: "", path: "" }));
      await loadMenus();
    } catch (e: any) {
      setErr(e?.message ?? "메뉴 추가에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  };

  /** ✅ 편집 시작 */
  const startEdit = (m: MenuDoc) => {
    setEditId(m.id);
    setEdit({
      name: m.name,
      path: m.path,
      group: m.group,
      order: m.order,
      isActive: m.isActive,
      adminOnly: m.adminOnly,
    });
  };

  /** ✅ 편집 저장(관리자만) */
  const saveEdit = async () => {
    try {
      setErr("");
      if (!isAdmin) return setErr("관리자만 메뉴를 수정할 수 있습니다.");
      if (!db) return;
      if (!editId) return;

      const msg = validateMenu(edit);
      if (msg) return setErr(msg);

      setBusy(true);
      await updateDoc(doc(db, COL, editId), {
        ...edit,
        name: edit.name.trim(),
        path: edit.path.trim(),
        updatedAt: serverTimestamp(),
      });

      setEditId("");
      await loadMenus();
    } catch (e: any) {
      setErr(e?.message ?? "메뉴 수정에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  };

  /** ✅ 메뉴 삭제(관리자만) */
  const removeMenu = async (id: string) => {
    try {
      setErr("");
      if (!isAdmin) return setErr("관리자만 메뉴를 삭제할 수 있습니다.");
      if (!db) return;

      setBusy(true);
      await deleteDoc(doc(db, COL, id));
      await loadMenus();
    } catch (e: any) {
      setErr(e?.message ?? "메뉴 삭제에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  };

  const canWrite = isAdmin && !checkingAdmin && !busy;

  return (
    <main className="px-6 pb-10">
      <div className="mx-auto max-w-6xl">
        <h1 className="text-2xl font-bold">메뉴 관리</h1>
        <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
          메뉴 추가/수정/삭제는 이 페이지에서만 가능합니다.
        </p>

        <div className="mt-4 text-sm text-gray-600 dark:text-gray-300">
          {loading ? "로그인 상태 확인 중..." : user ? `로그인: ${user.email ?? ""}` : "비로그인"}
          {" · "}
          {checkingAdmin ? "관리자 권한 확인 중..." : isAdmin ? "관리자" : "일반 사용자"}
        </div>

        {(initError || err) && (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
            {initError || err}
          </div>
        )}

        {/* ✅ 메뉴 추가 */}
        <section className="mt-8 rounded-2xl border p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold">메뉴 추가</h2>
            <button
              onClick={addMenu}
              disabled={!canWrite}
              className="rounded-xl bg-gray-900 px-4 py-2 text-sm text-white disabled:opacity-60 dark:bg-white dark:text-gray-900"
            >
              추가
            </button>
          </div>

          {!isAdmin && (
            <div className="mb-4 text-sm text-gray-600 dark:text-gray-300">
              관리자만 추가/수정/삭제가 가능합니다.
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <label className="text-sm">
              메뉴명
              <input
                value={form.name}
                onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                className="mt-1 w-full rounded-lg border px-3 py-2"
                placeholder="예: Workspace"
              />
            </label>

            <label className="text-sm">
              경로(path)
              <input
                value={form.path}
                onChange={(e) => setForm((p) => ({ ...p, path: e.target.value }))}
                className="mt-1 w-full rounded-lg border px-3 py-2"
                placeholder="/workspace"
              />
            </label>

            <label className="text-sm">
              그룹
              <input
                value={form.group}
                onChange={(e) => setForm((p) => ({ ...p, group: e.target.value }))}
                className="mt-1 w-full rounded-lg border px-3 py-2"
                placeholder="Workspace / Tools / Admin"
              />
            </label>

            <label className="text-sm">
              정렬(order)
              <input
                type="number"
                value={form.order}
                onChange={(e) =>
                  setForm((p) => ({ ...p, order: Number(e.target.value) }))
                }
                className="mt-1 w-full rounded-lg border px-3 py-2"
              />
            </label>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(e) => setForm((p) => ({ ...p, isActive: e.target.checked }))}
              />
              노출(isActive)
            </label>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.adminOnly}
                onChange={(e) =>
                  setForm((p) => ({ ...p, adminOnly: e.target.checked }))
                }
              />
              관리자 전용(adminOnly)
            </label>
          </div>
        </section>

        {/* ✅ 메뉴 목록 */}
        <section className="mt-8 rounded-2xl border p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold">메뉴 목록</h2>
            <button
              onClick={loadMenus}
              disabled={busy}
              className="rounded-xl border px-4 py-2 text-sm hover:bg-gray-50 disabled:opacity-60 dark:hover:bg-gray-900"
            >
              새로고침
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b">
                <tr>
                  <th className="py-2">order</th>
                  <th className="py-2">name</th>
                  <th className="py-2">path</th>
                  <th className="py-2">group</th>
                  <th className="py-2">active</th>
                  <th className="py-2">adminOnly</th>
                  <th className="py-2">actions</th>
                </tr>
              </thead>
              <tbody>
                {menus.map((m) => (
                  <tr key={m.id} className="border-b">
                    <td className="py-2">{m.order}</td>
                    <td className="py-2">{m.name}</td>
                    <td className="py-2">{m.path}</td>
                    <td className="py-2">{m.group}</td>
                    <td className="py-2">{m.isActive ? "Y" : "N"}</td>
                    <td className="py-2">{m.adminOnly ? "Y" : "N"}</td>
                    <td className="py-2">
                      <div className="flex gap-2">
                        <button
                          onClick={() => startEdit(m)}
                          className="rounded-lg border px-3 py-1 hover:bg-gray-50 dark:hover:bg-gray-900"
                        >
                          수정
                        </button>
                        <button
                          onClick={() => removeMenu(m.id)}
                          disabled={!canWrite}
                          className="rounded-lg border px-3 py-1 text-red-600 hover:bg-red-50 disabled:opacity-60 dark:hover:bg-red-950"
                        >
                          삭제
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}

                {menus.length === 0 && (
                  <tr>
                    <td className="py-4 text-gray-600 dark:text-gray-300" colSpan={7}>
                      등록된 메뉴가 없습니다.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* ✅ 편집 모달 */}
        {editId && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
            <div className="w-full max-w-xl rounded-2xl bg-white p-6 dark:bg-black">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-lg font-semibold">메뉴 수정</h3>
                <button onClick={() => setEditId("")} className="rounded-lg border px-3 py-1">
                  닫기
                </button>
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <label className="text-sm">
                  메뉴명
                  <input
                    value={edit.name}
                    onChange={(e) => setEdit((p) => ({ ...p, name: e.target.value }))}
                    className="mt-1 w-full rounded-lg border px-3 py-2"
                  />
                </label>

                <label className="text-sm">
                  경로(path)
                  <input
                    value={edit.path}
                    onChange={(e) => setEdit((p) => ({ ...p, path: e.target.value }))}
                    className="mt-1 w-full rounded-lg border px-3 py-2"
                  />
                </label>

                <label className="text-sm">
                  그룹
                  <input
                    value={edit.group}
                    onChange={(e) => setEdit((p) => ({ ...p, group: e.target.value }))}
                    className="mt-1 w-full rounded-lg border px-3 py-2"
                  />
                </label>

                <label className="text-sm">
                  정렬(order)
                  <input
                    type="number"
                    value={edit.order}
                    onChange={(e) => setEdit((p) => ({ ...p, order: Number(e.target.value) }))}
                    className="mt-1 w-full rounded-lg border px-3 py-2"
                  />
                </label>

                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={edit.isActive}
                    onChange={(e) => setEdit((p) => ({ ...p, isActive: e.target.checked }))}
                  />
                  노출(isActive)
                </label>

                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={edit.adminOnly}
                    onChange={(e) => setEdit((p) => ({ ...p, adminOnly: e.target.checked }))}
                  />
                  관리자 전용(adminOnly)
                </label>
              </div>

              <div className="mt-6 flex justify-end gap-2">
                <button onClick={() => setEditId("")} className="rounded-xl border px-4 py-2 text-sm">
                  취소
                </button>
                <button
                  onClick={saveEdit}
                  disabled={!canWrite}
                  className="rounded-xl bg-gray-900 px-4 py-2 text-sm text-white disabled:opacity-60 dark:bg-white dark:text-gray-900"
                >
                  저장
                </button>
              </div>

              {!isAdmin && (
                <div className="mt-3 text-sm text-gray-600 dark:text-gray-300">
                  관리자만 저장할 수 있습니다.
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
