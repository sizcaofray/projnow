"use client";

// app/contents/menu/page.tsx
// ✅ 목표
// - 관리자는 메뉴명 + 폴더명(slug)만 등록/수정/삭제
// - path는 자동으로 /contents/{slug} 생성 (사용자 입력 제거)
// - 실제 페이지 파일(app/contents/{slug}/page.tsx)은 관리자가 직접 생성/개발
// - 권한 판단은 Firestore users/{uid}.role === 'admin' 기준

import { useEffect, useMemo, useState } from "react";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";

import { useAuth } from "@/lib/auth/useAuth";
import { getFirebaseDb } from "@/lib/firebase/client";

type MenuDoc = {
  id: string;
  name: string; // 메뉴명(한글 가능)
  slug: string; // 폴더명(영문/숫자/_)
  path: string; // 자동 생성: /contents/{slug}
  group: string;
  order: number;
  isActive: boolean;
  adminOnly: boolean;
};

// ✅ rules에 match /menus 가 있으므로 그대로 사용
const COL = "menus";

// ✅ 폴더명 규칙: 소문자 영문/숫자/언더스코어만
const SLUG_REGEX = /^[a-z0-9_]+$/;

// ✅ slug로 path 자동 생성
const buildPath = (slug: string) => `/contents/${slug}`;

export default function MenuManagePage() {
  const { user, loading, initError } = useAuth();

  // ✅ Firestore 인스턴스
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

  // ✅ 추가 폼 상태 (path는 입력하지 않음)
  const [form, setForm] = useState<Omit<MenuDoc, "id" | "path">>({
    name: "",
    slug: "",
    group: "Workspace",
    order: 100,
    isActive: true,
    adminOnly: false,
  });

  // ✅ 편집 상태 (path는 slug로 자동 생성)
  const [editId, setEditId] = useState("");
  const [edit, setEdit] = useState<Omit<MenuDoc, "id" | "path">>({
    name: "",
    slug: "",
    group: "",
    order: 0,
    isActive: true,
    adminOnly: false,
  });

  /**
   * ✅ 관리자 여부 확인
   * - users/{uid}.role === 'admin' 기준 (rules와 동일 기준)
   */
  useEffect(() => {
    const run = async () => {
      setErr("");

      if (!user || !db) {
        setIsAdmin(false);
        return;
      }

      try {
        setCheckingAdmin(true);

        const snap = await getDoc(doc(db, "users", user.uid));
        const role = snap.exists() ? (snap.data() as any)?.role : null;

        setIsAdmin(role === "admin");
      } catch (e: any) {
        setIsAdmin(false);
        setErr(e?.message ?? "관리자 권한 확인 중 오류가 발생했습니다.");
      } finally {
        setCheckingAdmin(false);
      }
    };

    run();
  }, [user, db]);

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
        const slug = String(v.slug ?? "");
        const path = String(v.path ?? buildPath(slug));

        return {
          id: d.id,
          name: String(v.name ?? ""),
          slug,
          path,
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
    if (!loading && !initError) {
      loadMenus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, initError]);

  /** ✅ slug 정규화: 소문자 + 공백 제거(입력 중 보정) */
  const normalizeSlug = (raw: string) => {
    // ✅ 공백 제거 + 소문자 변환
    const trimmed = raw.replace(/\s+/g, "").toLowerCase();
    return trimmed;
  };

  /** ✅ 입력값 검증 */
  const validateMenu = (m: Omit<MenuDoc, "id" | "path">) => {
    if (!m.name.trim()) return "메뉴명을 입력해주세요.";
    if (!m.slug.trim()) return "폴더명(영문)을 입력해주세요.";
    if (!SLUG_REGEX.test(m.slug)) {
      return "폴더명은 소문자 영문/숫자/_ 만 가능합니다. (공백/특수문자 불가)";
    }
    return "";
  };

  /** ✅ 메뉴 추가(관리자만) */
  const addMenu = async () => {
    try {
      setErr("");
      if (!isAdmin) return setErr("관리자만 메뉴를 추가할 수 있습니다.");
      if (!db) return;

      const normalized = { ...form, name: form.name.trim(), slug: normalizeSlug(form.slug) };
      const msg = validateMenu(normalized);
      if (msg) return setErr(msg);

      const path = buildPath(normalized.slug);

      setBusy(true);
      await addDoc(collection(db, COL), {
        ...normalized,
        path, // ✅ 자동 생성 저장
        updatedAt: serverTimestamp(),
      });

      // ✅ 폼 최소 리셋
      setForm((p) => ({ ...p, name: "", slug: "" }));
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
      slug: m.slug,
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

      const normalized = { ...edit, name: edit.name.trim(), slug: normalizeSlug(edit.slug) };
      const msg = validateMenu(normalized);
      if (msg) return setErr(msg);

      const path = buildPath(normalized.slug);

      setBusy(true);
      await updateDoc(doc(db, COL, editId), {
        ...normalized,
        path, // ✅ slug 변경 시 path도 동기화
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

  // ✅ write 가능 조건: 관리자 + 권한확인 완료 + 현재 작업중 아님
  const canWrite = isAdmin && !checkingAdmin && !busy;

  // ✅ 화면 표시용 path(자동 생성)
  const previewPath = buildPath(normalizeSlug(form.slug));
  const previewEditPath = buildPath(normalizeSlug(edit.slug));

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
                placeholder="예: 사용자 관리"
              />
            </label>

            <label className="text-sm">
              폴더명(영문)
              <input
                value={form.slug}
                onChange={(e) => setForm((p) => ({ ...p, slug: normalizeSlug(e.target.value) }))}
                className="mt-1 w-full rounded-lg border px-3 py-2"
                placeholder="예: user_management"
              />
              <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                규칙: 소문자 영문/숫자/_ 만 가능 (공백/특수문자 불가)
              </div>
            </label>

            {/* ✅ path는 자동 생성이므로 표시만 */}
            <label className="text-sm">
              생성 경로(path)
              <input
                value={previewPath}
                readOnly
                className="mt-1 w-full rounded-lg border bg-gray-50 px-3 py-2 text-gray-700 dark:bg-gray-900 dark:text-gray-200"
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
                onChange={(e) => setForm((p) => ({ ...p, order: Number(e.target.value) }))}
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
                onChange={(e) => setForm((p) => ({ ...p, adminOnly: e.target.checked }))}
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
                  <th className="py-2">slug</th>
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
                    <td className="py-2">{m.slug}</td>
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
                    <td className="py-4 text-gray-600 dark:text-gray-300" colSpan={8}>
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
                  폴더명(영문)
                  <input
                    value={edit.slug}
                    onChange={(e) => setEdit((p) => ({ ...p, slug: normalizeSlug(e.target.value) }))}
                    className="mt-1 w-full rounded-lg border px-3 py-2"
                  />
                  <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    규칙: 소문자 영문/숫자/_ 만 가능 (공백/특수문자 불가)
                  </div>
                </label>

                <label className="text-sm">
                  생성 경로(path)
                  <input
                    value={previewEditPath}
                    readOnly
                    className="mt-1 w-full rounded-lg border bg-gray-50 px-3 py-2 text-gray-700 dark:bg-gray-900 dark:text-gray-200"
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
