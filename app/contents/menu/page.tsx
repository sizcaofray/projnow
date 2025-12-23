"use client";

// app/contents/menu/page.tsx
// ✅ 트리(계층) + 드래그 정렬 + 하위메뉴 생성 UI
// ✅ 메뉴는 "표시/정렬/소속"만 관리
// - 입력: 메뉴명(name) + 폴더명(slug)
// - path는 자동 생성: /contents/{slug} (표시는 유지)
// - 실제 페이지(app/contents/{slug}/page.tsx)는 관리자가 직접 생성/개발
// ✅ 추가 요구사항 반영
// 1) 생성경로(path) 표시 유지
// 2) slug(영문명)은 생성 후 변경 불가 → 변경 필요 시 삭제 후 재생성

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
  name: string;
  slug: string; // ✅ 생성 후 변경 불가
  path: string; // ✅ /contents/{slug}
  group: string;
  order: number;
  isActive: boolean;
  adminOnly: boolean;
  parentId: string | null; // ✅ 트리 구조
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
    slug: string;
    group: string;
    isActive: boolean;
    adminOnly: boolean;
    parentId: string | null;
  }>({
    name: "",
    slug: "",
    group: "Workspace",
    isActive: true,
    adminOnly: false,
    parentId: null,
  });

  // ✅ 편집 모달
  const [editId, setEditId] = useState("");
  const [edit, setEdit] = useState<{
    name: string;
    slug: string; // ✅ UI에서는 disabled로 표시만
    group: string;
    isActive: boolean;
    adminOnly: boolean;
    parentId: string | null;
  }>({
    name: "",
    slug: "",
    group: "",
    isActive: true,
    adminOnly: false,
    parentId: null,
  });

  // ✅ slug 변경 차단을 위한 원본 slug 저장
  const [editOriginalSlug, setEditOriginalSlug] = useState("");

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
        const slug = String(v.slug ?? "");
        const parentIdRaw = v.parentId ?? null;
        const parentId = parentIdRaw === "" ? null : (parentIdRaw as string | null);

        return {
          id: d.id,
          name: String(v.name ?? ""),
          slug,
          path: String(v.path ?? (slug ? buildPath(slug) : "")),
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

  /** ✅ parent -> children */
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

  /** ✅ 보이는 트리 목록(flat) */
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

  /** ✅ parentId 별 보이는 형제 id */
  const siblingIdsByParentVisible = useMemo(() => {
    const map = new Map<string | null, string[]>();
    flatVisible.forEach((m) => {
      const key = m.parentId ?? null;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(m.id);
    });
    return map;
  }, [flatVisible]);

  /** ✅ 검증 */
  const validateMenuCreate = (m: { name: string; slug: string }) => {
    if (!m.name.trim()) return "메뉴명을 입력해주세요.";
    if (!m.slug.trim()) return "폴더명(영문)을 입력해주세요.";
    if (!SLUG_REGEX.test(m.slug)) {
      return "폴더명은 소문자 영문/숫자/_ 만 가능합니다. (공백/특수문자 불가)";
    }
    return "";
  };

  /** ✅ 새 메뉴 order */
  const nextOrderForParent = (parentId: string | null) => {
    const siblings = menus.filter((m) => (m.parentId ?? null) === (parentId ?? null));
    if (siblings.length === 0) return 10;
    const maxOrder = Math.max(...siblings.map((s) => s.order || 0));
    return maxOrder + 10;
  };

  /** ✅ 추가 */
  const addMenu = async () => {
    try {
      setErr("");
      if (!isAdmin) return setErr("관리자만 메뉴를 추가할 수 있습니다.");
      if (!db) return;

      const normalized = {
        name: form.name.trim(),
        slug: normalizeSlug(form.slug),
      };
      const msg = validateMenuCreate(normalized);
      if (msg) return setErr(msg);

      const path = buildPath(normalized.slug);
      const order = nextOrderForParent(form.parentId);

      setBusy(true);
      await addDoc(collection(db, COL), {
        name: normalized.name,
        slug: normalized.slug,
        path, // ✅ 표시 유지 + 저장도 유지
        group: form.group,
        isActive: form.isActive,
        adminOnly: form.adminOnly,
        parentId: form.parentId ?? null,
        order,
        updatedAt: serverTimestamp(),
      });

      if (form.parentId) setExpanded((p) => ({ ...p, [form.parentId!]: true }));

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
    setEditOriginalSlug(m.slug); // ✅ 원본 slug 저장
    setEdit({
      name: m.name,
      slug: m.slug, // ✅ 표시용(변경 금지)
      group: m.group,
      isActive: m.isActive,
      adminOnly: m.adminOnly,
      parentId: m.parentId ?? null,
    });
  };

  /** ✅ 편집 저장 */
  const saveEdit = async () => {
    try {
      setErr("");
      if (!isAdmin) return setErr("관리자만 메뉴를 수정할 수 있습니다.");
      if (!db) return;
      if (!editId) return;

      // ✅ slug 변경 불가 정책
      // - 혹시 상태값이 바뀌어도(개발자도구 등) 서버 업데이트는 막음
      const normalizedSlug = normalizeSlug(edit.slug);
      if (normalizedSlug !== editOriginalSlug) {
        return setErr("폴더명(영문)은 변경할 수 없습니다. 변경하려면 삭제 후 새로 생성해주세요.");
      }

      if (!edit.name.trim()) return setErr("메뉴명을 입력해주세요.");

      // ✅ 자기 자신을 부모로 지정 금지
      if (edit.parentId === editId) {
        return setErr("부모 메뉴는 자기 자신이 될 수 없습니다.");
      }

      // ✅ path는 slug 기반으로 유지(동일 slug이므로 동일)
      const path = buildPath(editOriginalSlug);

      setBusy(true);

      const current = menus.find((m) => m.id === editId);
      const parentChanged = (current?.parentId ?? null) !== (edit.parentId ?? null);
      const nextOrder = parentChanged ? nextOrderForParent(edit.parentId) : (current?.order ?? 10);

      await updateDoc(doc(db, COL, editId), {
        name: edit.name.trim(),
        slug: editOriginalSlug, // ✅ 강제 유지
        path, // ✅ 유지
        group: edit.group,
        isActive: edit.isActive,
        adminOnly: edit.adminOnly,
        parentId: edit.parentId ?? null,
        order: nextOrder,
        updatedAt: serverTimestamp(),
      });

      if (edit.parentId) setExpanded((p) => ({ ...p, [edit.parentId!]: true }));

      setEditId("");
      setEditOriginalSlug("");
      await loadMenus();
    } catch (e: any) {
      setErr(e?.message ?? "메뉴 수정에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  };

  /** ✅ 삭제 */
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

  /** ✅ 드래그 센서 */
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor)
  );

  /** ✅ 드래그 종료: 같은 레벨 내 reorder */
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
            updateDoc(doc(db, COL, m.id), {
              order: nextOrder,
              updatedAt: serverTimestamp(),
            }) as unknown as Promise<void>
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

  const previewPath = buildPath(normalizeSlug(form.slug || "slug_here"));
  const previewEditPath = buildPath(editOriginalSlug || normalizeSlug(edit.slug || "slug_here"));

  const parentOptions = useMemo(() => {
    const opts: Array<{ id: string | null; label: string }> = [{ id: null, label: "(최상위)" }];
    menus
      .slice()
      .sort((a, b) => a.order - b.order)
      .forEach((m) => opts.push({ id: m.id, label: m.name }));
    return opts;
  }, [menus]);

  const toggleExpand = (id: string) => setExpanded((p) => ({ ...p, [id]: !(p[id] ?? false) }));

  const setAddParentSameLevel = (m: MenuDoc) => setForm((p) => ({ ...p, parentId: m.parentId ?? null }));
  const setAddParentChild = (m: MenuDoc) => {
    setForm((p) => ({ ...p, parentId: m.id }));
    setExpanded((p) => ({ ...p, [m.id]: true }));
  };

  return (
    <main className="px-6 pb-10">
      <div className="mx-auto max-w-6xl">
        <h1 className="text-2xl font-bold">메뉴 관리</h1>
        <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
          메뉴는 표시/정렬/소속만 관리합니다. 실제 페이지(app/contents/...)는 관리자가 직접 생성/개발합니다.
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
              관리자만 추가/수정/삭제/정렬이 가능합니다.
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <label className="text-sm">
              메뉴명
              <input
                value={form.name}
                onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                className="mt-1 w-full rounded-lg border px-3 py-2"
                placeholder="예: User Management"
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

            {/* ✅ 생성경로 표시 유지 */}
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
                placeholder="예: Workspace / Tools / Admin"
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
            <div className="min-w-[900px]">
              <div className="grid grid-cols-[60px_1fr_220px_120px_120px_220px] gap-2 border-b pb-2 text-sm font-semibold">
                <div> </div>
                <div>메뉴</div>
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
                        onAddSame={() => setAddParentSameLevel(m)}
                        onAddChild={() => setAddParentChild(m)}
                      />
                    ))}

                    {flatVisible.length === 0 && (
                      <div className="py-4 text-sm text-gray-600 dark:text-gray-300">등록된 메뉴가 없습니다.</div>
                    )}
                  </div>
                </SortableContext>
              </DndContext>
            </div>
          </div>

          <div className="mt-3 text-xs text-gray-500 dark:text-gray-400">
            드래그 정렬은 같은 레벨(같은 상위 메뉴) 내에서만 가능합니다.
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
                  폴더명(영문) (변경 불가)
                  <input
                    value={edit.slug}
                    // ✅ 입력은 막습니다 (변경 필요 시 삭제 후 생성)
                    disabled
                    className="mt-1 w-full rounded-lg border bg-gray-50 px-3 py-2 text-gray-700 disabled:opacity-100 dark:bg-gray-900 dark:text-gray-200"
                  />
                  <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    폴더명은 변경할 수 없습니다. 변경하려면 삭제 후 새로 생성해주세요.
                  </div>
                </label>

                {/* ✅ 생성경로 표시 유지 */}
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

              {!isAdmin && (
                <div className="mt-3 text-sm text-gray-600 dark:text-gray-300">관리자만 저장할 수 있습니다.</div>
              )}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

/** ✅ 트리 Row(드래그 가능) */
function TreeRow(props: {
  m: MenuDoc & { depth: number; hasChildren: boolean };
  canWrite: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onAddSame: () => void;
  onAddChild: () => void;
}) {
  const { m, canWrite, onToggle, onEdit, onDelete, onAddSame, onAddChild } = props;

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

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="grid grid-cols-[60px_1fr_220px_120px_120px_220px] items-center gap-2 rounded-lg border px-2 py-2 text-sm"
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
          <div className="truncate text-xs text-gray-500 dark:text-gray-400">{m.path}</div>
        </div>
      </div>

      <div className="truncate text-gray-600 dark:text-gray-300">{m.group || "-"}</div>
      <div>{m.isActive ? "Y" : "N"}</div>
      <div>{m.adminOnly ? "Y" : "N"}</div>

      <div className="flex flex-wrap justify-end gap-2">
        <button onClick={onAddSame} className="rounded-lg border px-3 py-1 hover:bg-gray-50 dark:hover:bg-gray-900">
          같은레벨 추가
        </button>
        <button onClick={onAddChild} className="rounded-lg border px-3 py-1 hover:bg-gray-50 dark:hover:bg-gray-900">
          하위메뉴
        </button>
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
