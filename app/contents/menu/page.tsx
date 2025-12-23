"use client";

/**
 * app/contents/menu/page.tsx
 *
 * ✅ 변경사항
 * - (요구사항 2) 목록 Row의 "같은레벨 추가 / 하위메뉴" 버튼 제거
 * - 계층 지정은 "상위 메뉴(소속)" select로만 처리
 */

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

// ✅ dnd-kit
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

type MenuDoc = {
  id: string;

  // ✅ 공통
  name: string;
  group: string;
  order: number;
  isActive: boolean;
  adminOnly: boolean;
  parentId: string | null;

  // ✅ 타입
  hasPage: boolean; // true=기능(페이지), false=카테고리

  // ✅ 기능 메뉴에서만 사용
  slug: string;
  path: string;
};

const COL = "menus";
const SLUG_REGEX = /^[a-z0-9_]+$/;

const buildPath = (slug: string) => `/contents/${slug}`;
const normalizeSlug = (raw: string) => raw.replace(/\s+/g, "").toLowerCase();

const resequence = (ids: string[]) => {
  const map = new Map<string, number>();
  ids.forEach((id, idx) => map.set(id, (idx + 1) * 10));
  return map;
};

export default function MenuManagePage() {
  const { user, loading, initError } = useAuth();

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

  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const [form, setForm] = useState<{
    name: string;
    hasPage: boolean;
    slug: string;
    group: string;
    isActive: boolean;
    adminOnly: boolean;
    parentId: string | null;
  }>({
    name: "",
    hasPage: false,
    slug: "",
    group: "Workspace",
    isActive: true,
    adminOnly: false,
    parentId: null,
  });

  const [editId, setEditId] = useState("");
  const [edit, setEdit] = useState<{
    name: string;
    hasPage: boolean;
    slug: string;
    group: string;
    isActive: boolean;
    adminOnly: boolean;
    parentId: string | null;
  }>({
    name: "",
    hasPage: false,
    slug: "",
    group: "",
    isActive: true,
    adminOnly: false,
    parentId: null,
  });

  const [editOriginalSlug, setEditOriginalSlug] = useState("");
  const [editOriginalHasPage, setEditOriginalHasPage] = useState(false);

  /** ✅ 관리자 확인: users/{uid}.role === 'admin' */
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

        const hasPage = Boolean(v.hasPage ?? false);
        const slug = String(v.slug ?? "");
        const path = hasPage && slug ? String(v.path ?? buildPath(slug)) : String(v.path ?? "");

        const parentIdRaw = v.parentId ?? null;
        const parentId = parentIdRaw === "" ? null : (parentIdRaw as string | null);

        return {
          id: d.id,
          name: String(v.name ?? ""),
          hasPage,
          slug: hasPage ? slug : "",
          path: hasPage ? path : "",
          group: String(v.group ?? ""),
          order: Number(v.order ?? 0),
          isActive: Boolean(v.isActive ?? true),
          adminOnly: Boolean(v.adminOnly ?? false),
          parentId,
        };
      });

      setMenus(rows);

      setExpanded((prev) => {
        if (Object.keys(prev).length > 0) return prev;
        const next: Record<string, boolean> = {};
        rows.forEach((m) => {
          if (m.parentId === null) next[m.id] = true;
        });
        return next;
      });
    } catch (e: any) {
      setErr(e?.message ?? "메뉴 목록 로드에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!loading && !initError) loadMenus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, initError]);

  const childrenByParent = useMemo(() => {
    const map = new Map<string | null, MenuDoc[]>();
    menus.forEach((m) => {
      const key = m.parentId ?? null;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(m);
    });
    map.forEach((arr) => arr.sort((a, b) => a.order - b.order));
    return map;
  }, [menus]);

  const flatVisible = useMemo(() => {
    const out: Array<MenuDoc & { depth: number; hasChildren: boolean }> = [];

    const walk = (parentId: string | null, depth: number) => {
      const kids = childrenByParent.get(parentId) ?? [];
      for (const node of kids) {
        const hasChildren = (childrenByParent.get(node.id) ?? []).length > 0;
        out.push({ ...node, depth, hasChildren });

        const isOpen = expanded[node.id] ?? false;
        if (hasChildren && isOpen) walk(node.id, depth + 1);
      }
    };

    walk(null, 0);
    return out;
  }, [childrenByParent, expanded]);

  const siblingIdsByParentVisible = useMemo(() => {
    const map = new Map<string | null, string[]>();
    flatVisible.forEach((m) => {
      const key = m.parentId ?? null;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(m.id);
    });
    return map;
  }, [flatVisible]);

  const validate = (payload: { name: string; hasPage: boolean; slug: string }) => {
    if (!payload.name.trim()) return "메뉴명을 입력해주세요.";
    if (payload.hasPage) {
      if (!payload.slug.trim()) return "기능(페이지 있음) 메뉴는 폴더명(영문)이 필수입니다.";
      if (!SLUG_REGEX.test(payload.slug)) {
        return "폴더명은 소문자 영문/숫자/_ 만 가능합니다. (공백/특수문자 불가)";
      }
    }
    return "";
  };

  const nextOrderForParent = (parentId: string | null) => {
    const siblings = menus.filter((m) => (m.parentId ?? null) === (parentId ?? null));
    if (siblings.length === 0) return 10;
    const maxOrder = Math.max(...siblings.map((s) => s.order || 0));
    return maxOrder + 10;
  };

  const addMenu = async () => {
    try {
      setErr("");
      if (!isAdmin) return setErr("관리자만 메뉴를 추가할 수 있습니다.");
      if (!db) return;

      const normalizedSlug = normalizeSlug(form.slug);
      const msg = validate({ name: form.name, hasPage: form.hasPage, slug: normalizedSlug });
      if (msg) return setErr(msg);

      const order = nextOrderForParent(form.parentId);

      const finalSlug = form.hasPage ? normalizedSlug : "";
      const finalPath = form.hasPage ? buildPath(finalSlug) : "";

      setBusy(true);
      await addDoc(collection(db, COL), {
        name: form.name.trim(),
        hasPage: form.hasPage,
        slug: finalSlug,
        path: finalPath,
        group: form.group,
        isActive: form.isActive,
        adminOnly: form.adminOnly,
        parentId: form.parentId ?? null,
        order,
        updatedAt: serverTimestamp(),
      });

      setForm((p) => ({ ...p, name: "", slug: "" }));
      await loadMenus();
    } catch (e: any) {
      setErr(e?.message ?? "메뉴 추가에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  };

  const startEdit = (m: MenuDoc) => {
    setEditId(m.id);
    setEditOriginalSlug(m.slug || "");
    setEditOriginalHasPage(Boolean(m.hasPage));

    setEdit({
      name: m.name,
      hasPage: Boolean(m.hasPage),
      slug: m.slug || "",
      group: m.group,
      isActive: m.isActive,
      adminOnly: m.adminOnly,
      parentId: m.parentId ?? null,
    });
  };

  const saveEdit = async () => {
    try {
      setErr("");
      if (!isAdmin) return setErr("관리자만 메뉴를 수정할 수 있습니다.");
      if (!db) return;
      if (!editId) return;

      // ✅ 기능 → 카테고리 전환 금지
      if (editOriginalHasPage === true && edit.hasPage === false) {
        return setErr("기능(페이지 있음) 메뉴를 카테고리로 변경할 수 없습니다. 삭제 후 새로 생성해주세요.");
      }

      const normalizedSlug = normalizeSlug(edit.slug);

      // ✅ 기존 기능 메뉴는 slug 불변
      if (editOriginalHasPage === true && normalizedSlug !== editOriginalSlug) {
        return setErr("폴더명(영문)은 변경할 수 없습니다. 변경하려면 삭제 후 새로 생성해주세요.");
      }

      const msg = validate({ name: edit.name, hasPage: edit.hasPage, slug: normalizedSlug });
      if (msg) return setErr(msg);

      if (edit.parentId === editId) return setErr("부모 메뉴는 자기 자신이 될 수 없습니다.");

      const finalHasPage = Boolean(edit.hasPage);
      let finalSlug = "";
      let finalPath = "";

      if (finalHasPage) {
        finalSlug = editOriginalHasPage ? editOriginalSlug : normalizedSlug; // ✅ 카테고리→기능 전환 시 최초 설정
        finalPath = buildPath(finalSlug);
      }

      setBusy(true);

      const current = menus.find((m) => m.id === editId);
      const parentChanged = (current?.parentId ?? null) !== (edit.parentId ?? null);
      const nextOrder = parentChanged ? nextOrderForParent(edit.parentId) : (current?.order ?? 10);

      await updateDoc(doc(db, COL, editId), {
        name: edit.name.trim(),
        hasPage: finalHasPage,
        slug: finalSlug,
        path: finalPath,
        group: edit.group,
        isActive: edit.isActive,
        adminOnly: edit.adminOnly,
        parentId: edit.parentId ?? null,
        order: nextOrder,
        updatedAt: serverTimestamp(),
      });

      setEditId("");
      setEditOriginalSlug("");
      setEditOriginalHasPage(false);
      await loadMenus();
    } catch (e: any) {
      setErr(e?.message ?? "메뉴 수정에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  };

  const removeMenu = async (id: string) => {
    try {
      setErr("");
      if (!isAdmin) return setErr("관리자만 메뉴를 삭제할 수 있습니다.");
      if (!db) return;

      const hasChildren = menus.some((m) => m.parentId === id);
      if (hasChildren) return setErr("하위 메뉴가 존재합니다. 하위 메뉴를 먼저 삭제해주세요.");

      setBusy(true);
      await deleteDoc(doc(db, COL, id));
      await loadMenus();
    } catch (e: any) {
      setErr(e?.message ?? "메뉴 삭제에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor)
  );

  const onDragEnd = async (event: DragEndEvent) => {
    try {
      setErr("");
      if (!isAdmin) return;
      if (!db) return;

      const { active, over } = event;
      if (!over) return;
      if (active.id === over.id) return;

      const activeId = String(active.id);
      const overId = String(over.id);

      const activeMenu = menus.find((m) => m.id === activeId);
      const overMenu = menus.find((m) => m.id === overId);
      if (!activeMenu || !overMenu) return;

      const activeParent = activeMenu.parentId ?? null;
      const overParent = overMenu.parentId ?? null;

      if (activeParent !== overParent) {
        setErr("현재는 같은 레벨(같은 상위 메뉴) 내에서만 드래그 정렬이 가능합니다.");
        return;
      }

      const siblingsVisible = siblingIdsByParentVisible.get(activeParent) ?? [];
      const oldIndex = siblingsVisible.indexOf(activeId);
      const newIndex = siblingsVisible.indexOf(overId);
      if (oldIndex < 0 || newIndex < 0) return;

      const moved = arrayMove(siblingsVisible, oldIndex, newIndex);
      const orderMap = resequence(moved);

      setBusy(true);

      const updates: Promise<void>[] = [];
      const nextMenus = menus.map((m) => {
        if ((m.parentId ?? null) !== activeParent) return m;

        const nextOrder = orderMap.get(m.id);
        if (typeof nextOrder !== "number") return m;

        if (m.order !== nextOrder) {
          updates.push(
            updateDoc(doc(db, COL, m.id), { order: nextOrder, updatedAt: serverTimestamp() }) as unknown as Promise<void>
          );
          return { ...m, order: nextOrder };
        }
        return m;
      });

      await Promise.all(updates);
      setMenus(nextMenus);
    } catch (e: any) {
      setErr(e?.message ?? "드래그 정렬 처리 중 오류가 발생했습니다.");
    } finally {
      setBusy(false);
    }
  };

  const canWrite = isAdmin && !checkingAdmin && !busy;

  const previewFormSlug = normalizeSlug(form.slug || "slug_here");
  const previewPath = form.hasPage ? buildPath(previewFormSlug) : "(카테고리: 경로 없음)";

  const previewEditSlug = editOriginalHasPage ? editOriginalSlug : normalizeSlug(edit.slug || "slug_here");
  const previewEditPath = edit.hasPage ? buildPath(previewEditSlug) : "(카테고리: 경로 없음)";

  const parentOptions = useMemo(() => {
    const opts: Array<{ id: string | null; label: string }> = [{ id: null, label: "(최상위)" }];
    menus
      .slice()
      .sort((a, b) => a.order - b.order)
      .forEach((m) => opts.push({ id: m.id, label: m.name }));
    return opts;
  }, [menus]);

  const toggleExpand = (id: string) => setExpanded((p) => ({ ...p, [id]: !(p[id] ?? false) }));

  return (
    <main className="px-6 pb-10">
      <div className="mx-auto max-w-6xl">
        <h1 className="text-2xl font-bold">메뉴 관리</h1>

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

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <label className="text-sm">
              메뉴명<span className="text-red-500"> *</span>
              <input
                value={form.name}
                onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                className="mt-1 w-full rounded-lg border px-3 py-2"
              />
            </label>

            <label className="text-sm">
              메뉴 타입<span className="text-red-500"> *</span>
              <select
                value={form.hasPage ? "page" : "category"}
                onChange={(e) => {
                  const nextHasPage = e.target.value === "page";
                  setForm((p) => ({ ...p, hasPage: nextHasPage, slug: nextHasPage ? p.slug : "" }));
                }}
                className="mt-1 w-full rounded-lg border px-3 py-2"
              >
                <option value="category">카테고리(페이지 없음)</option>
                <option value="page">기능(페이지 있음)</option>
              </select>
            </label>

            <label className="text-sm">
              폴더명(영문){form.hasPage ? <span className="text-red-500"> *</span> : null}
              <input
                value={form.slug}
                onChange={(e) => setForm((p) => ({ ...p, slug: normalizeSlug(e.target.value) }))}
                disabled={!form.hasPage}
                className="mt-1 w-full rounded-lg border px-3 py-2 disabled:bg-gray-50 dark:disabled:bg-gray-900"
              />
            </label>

            <label className="text-sm">
              생성 경로(path)
              <input
                value={previewPath}
                readOnly
                className="mt-1 w-full rounded-lg border bg-gray-50 px-3 py-2 text-gray-700 dark:bg-gray-900 dark:text-gray-200"
              />
            </label>

            <label className="text-sm">
              상위 메뉴(소속)
              <select
                value={form.parentId ?? ""}
                onChange={(e) => setForm((p) => ({ ...p, parentId: e.target.value ? e.target.value : null }))}
                className="mt-1 w-full rounded-lg border px-3 py-2"
              >
                {parentOptions.map((o) => (
                  <option key={String(o.id ?? "null")} value={o.id ?? ""}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="text-sm">
              그룹(표시용)
              <input
                value={form.group}
                onChange={(e) => setForm((p) => ({ ...p, group: e.target.value }))}
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
            <div className="min-w-[980px]">
              <div className="grid grid-cols-[60px_1fr_160px_120px_120px_120px_180px] gap-2 border-b pb-2 text-sm font-semibold">
                <div> </div>
                <div>메뉴</div>
                <div className="text-gray-600 dark:text-gray-300">type</div>
                <div className="text-gray-600 dark:text-gray-300">group</div>
                <div>active</div>
                <div>adminOnly</div>
                <div>actions</div>
              </div>

              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
                <SortableContext items={flatVisible.map((m) => m.id)} strategy={verticalListSortingStrategy}>
                  <div className="mt-2 space-y-1">
                    {flatVisible.map((m) => (
                      <TreeRow
                        key={m.id}
                        m={m}
                        canWrite={canWrite}
                        onToggle={() => toggleExpand(m.id)}
                        onEdit={() => startEdit(m)}
                        onDelete={() => removeMenu(m.id)}
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            </div>
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
                  메뉴명<span className="text-red-500"> *</span>
                  <input
                    value={edit.name}
                    onChange={(e) => setEdit((p) => ({ ...p, name: e.target.value }))}
                    className="mt-1 w-full rounded-lg border px-3 py-2"
                  />
                </label>

                <label className="text-sm">
                  메뉴 타입<span className="text-red-500"> *</span>
                  <select
                    value={edit.hasPage ? "page" : "category"}
                    onChange={(e) => {
                      const nextHasPage = e.target.value === "page";
                      setEdit((p) => ({ ...p, hasPage: nextHasPage, slug: nextHasPage ? p.slug : "" }));
                    }}
                    className="mt-1 w-full rounded-lg border px-3 py-2"
                  >
                    <option value="category">카테고리(페이지 없음)</option>
                    <option value="page">기능(페이지 있음)</option>
                  </select>
                </label>

                <label className="text-sm">
                  폴더명(영문){edit.hasPage ? <span className="text-red-500"> *</span> : null}
                  <input
                    value={edit.slug}
                    onChange={(e) => setEdit((p) => ({ ...p, slug: normalizeSlug(e.target.value) }))}
                    disabled={editOriginalHasPage || !edit.hasPage}
                    className="mt-1 w-full rounded-lg border px-3 py-2 disabled:bg-gray-50 dark:disabled:bg-gray-900"
                  />
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
                  상위 메뉴(소속)
                  <select
                    value={edit.parentId ?? ""}
                    onChange={(e) => setEdit((p) => ({ ...p, parentId: e.target.value ? e.target.value : null }))}
                    className="mt-1 w-full rounded-lg border px-3 py-2"
                  >
                    {parentOptions
                      .filter((o) => o.id !== editId)
                      .map((o) => (
                        <option key={String(o.id ?? "null")} value={o.id ?? ""}>
                          {o.label}
                        </option>
                      ))}
                  </select>
                </label>

                <label className="text-sm">
                  그룹(표시용)
                  <input
                    value={edit.group}
                    onChange={(e) => setEdit((p) => ({ ...p, group: e.target.value }))}
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
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

/** ✅ 트리 Row(드래그 가능) - 버튼 최소화(수정/삭제만) */
function TreeRow(props: {
  m: MenuDoc & { depth: number; hasChildren: boolean };
  canWrite: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { m, canWrite, onToggle, onEdit, onDelete } = props;

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: m.id,
    disabled: !canWrite,
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };

  const indent = m.depth * 20;
  const typeLabel = m.hasPage ? "기능(페이지)" : "카테고리";
  const pathLabel = m.hasPage ? m.path : "(경로 없음)";

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="grid grid-cols-[60px_1fr_160px_120px_120px_120px_180px] items-center gap-2 rounded-lg border px-2 py-2 text-sm"
    >
      <div className="flex items-center gap-2">
        <button
          onClick={onToggle}
          disabled={!m.hasChildren}
          className="h-7 w-7 rounded border text-xs disabled:opacity-40"
          title={m.hasChildren ? "펼침/접힘" : "하위 없음"}
        >
          {m.hasChildren ? "▾" : "·"}
        </button>

        <button
          className="h-7 w-7 cursor-grab rounded border text-xs disabled:opacity-40"
          disabled={!canWrite}
          title="드래그로 순서 변경"
          {...attributes}
          {...listeners}
        >
          ≡
        </button>
      </div>

      <div className="flex items-center gap-3" style={{ paddingLeft: indent }}>
        <div className="min-w-0">
          <div className="truncate font-medium">{m.name}</div>
          <div className="truncate text-xs text-gray-500 dark:text-gray-400">{pathLabel}</div>
        </div>
      </div>

      <div className="text-gray-600 dark:text-gray-300">{typeLabel}</div>
      <div className="truncate text-gray-600 dark:text-gray-300">{m.group || "-"}</div>
      <div>{m.isActive ? "Y" : "N"}</div>
      <div>{m.adminOnly ? "Y" : "N"}</div>

      <div className="flex justify-end gap-2">
        <button onClick={onEdit} className="rounded-lg border px-3 py-1 hover:bg-gray-50 dark:hover:bg-gray-900">
          수정
        </button>
        <button
          onClick={onDelete}
          disabled={!canWrite}
          className="rounded-lg border px-3 py-1 text-red-600 hover:bg-red-50 disabled:opacity-60 dark:hover:bg-red-950"
        >
          삭제
        </button>
      </div>
    </div>
  );
}
