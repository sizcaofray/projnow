"use client";

/**
 * app/contents/menu/page.tsx
 *
 * ✅ 요구사항 반영
 * 1) 입력 폼에서 필수(*) 표시
 * 2) 메뉴는 "카테고리(페이지 없음)" 또는 "기능(페이지 있음)" 타입 지원
 * 3) 영문명(slug)은 "기능(페이지 있음)"일 때만 필수 (최하위/실제 기능 메뉴)
 * 4) 생성경로(path)는 계속 표시하되,
 *    - 카테고리면 "(경로 없음)" 표시
 *    - 기능이면 "/contents/{slug}" 표시
 * 5) slug 변경 불가:
 *    - 기능 메뉴(hasPage=true): 생성 후 slug 변경 불가(수정 모달 disabled)
 *    - 카테고리→기능 전환: 최초 1회 slug 입력 가능
 *    - 기능→카테고리 전환: 금지(삭제 후 재생성 안내)
 * 6) 트리(계층): parentId, 드래그정렬(같은 parentId 내에서만)
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
  hasPage: boolean; // true=기능(페이지 있음), false=카테고리(페이지 없음)

  // ✅ 기능 메뉴에서만 사용
  slug: string; // hasPage=true일 때 필수, 생성 후 변경 불가
  path: string; // hasPage=true일 때 /contents/{slug}
};

const COL = "menus";

// ✅ slug 규칙: 소문자 영문/숫자/_ 만
const SLUG_REGEX = /^[a-z0-9_]+$/;

const buildPath = (slug: string) => `/contents/${slug}`;
const normalizeSlug = (raw: string) => raw.replace(/\s+/g, "").toLowerCase();

const resequence = (ids: string[]) => {
  // ✅ 10,20,30.. 저장(추후 삽입/정렬에 유리)
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

  // ✅ 트리 펼침 상태
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  // ✅ 추가 폼
  const [form, setForm] = useState<{
    name: string;
    hasPage: boolean;
    slug: string; // hasPage=true일 때만 사용
    group: string;
    isActive: boolean;
    adminOnly: boolean;
    parentId: string | null;
  }>({
    name: "",
    hasPage: false, // ✅ 기본은 카테고리로 두는게 안전(원하시면 true로 변경 가능)
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

  // ✅ slug 변경 차단용 원본값
  const [editOriginalSlug, setEditOriginalSlug] = useState("");
  const [editOriginalHasPage, setEditOriginalHasPage] = useState(false);

  /**
   * ✅ 관리자 확인: users/{uid}.role === 'admin'
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

  /**
   * ✅ 메뉴 로드
   * - 기존 문서에 hasPage/slug/path/parentId가 없을 수도 있으므로 기본값 처리
   */
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
        const path =
          hasPage && slug ? String(v.path ?? buildPath(slug)) : String(v.path ?? "");

        const parentIdRaw = v.parentId ?? null;
        const parentId = parentIdRaw === "" ? null : (parentIdRaw as string | null);

        return {
          id: d.id,
          name: String(v.name ?? ""),
          hasPage,
          slug: hasPage ? slug : "", // ✅ 카테고리는 slug 비움
          path: hasPage ? path : "", // ✅ 카테고리는 path 비움
          group: String(v.group ?? ""),
          order: Number(v.order ?? 0),
          isActive: Boolean(v.isActive ?? true),
          adminOnly: Boolean(v.adminOnly ?? false),
          parentId,
        };
      });

      setMenus(rows);

      // ✅ 초기 expanded 세팅(최상위 기본 펼침)
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

  /** ✅ children map */
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

  /** ✅ 보여지는 트리(flat) */
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

  /** ✅ 입력 검증 */
  const validateCreateOrEdit = (payload: { name: string; hasPage: boolean; slug: string }) => {
    if (!payload.name.trim()) return "메뉴명을 입력해주세요.";

    // ✅ 기능 메뉴일 때만 slug 필수
    if (payload.hasPage) {
      if (!payload.slug.trim()) return "기능(페이지 있음) 메뉴는 폴더명(영문)이 필수입니다.";
      if (!SLUG_REGEX.test(payload.slug)) {
        return "폴더명은 소문자 영문/숫자/_ 만 가능합니다. (공백/특수문자 불가)";
      }
    }
    return "";
  };

  /** ✅ 새 메뉴 order 계산 */
  const nextOrderForParent = (parentId: string | null) => {
    const siblings = menus.filter((m) => (m.parentId ?? null) === (parentId ?? null));
    if (siblings.length === 0) return 10;
    const maxOrder = Math.max(...siblings.map((s) => s.order || 0));
    return maxOrder + 10;
  };

  /** ✅ 메뉴 추가 */
  const addMenu = async () => {
    try {
      setErr("");
      if (!isAdmin) return setErr("관리자만 메뉴를 추가할 수 있습니다.");
      if (!db) return;

      const normalizedSlug = normalizeSlug(form.slug);
      const msg = validateCreateOrEdit({ name: form.name, hasPage: form.hasPage, slug: normalizedSlug });
      if (msg) return setErr(msg);

      const order = nextOrderForParent(form.parentId);

      // ✅ 카테고리면 slug/path 비움
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

      // ✅ 하위로 추가했으면 부모 펼침
      if (form.parentId) setExpanded((p) => ({ ...p, [form.parentId!]: true }));

      // ✅ 폼 리셋(부모 유지)
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

  /** ✅ 편집 저장 */
  const saveEdit = async () => {
    try {
      setErr("");
      if (!isAdmin) return setErr("관리자만 메뉴를 수정할 수 있습니다.");
      if (!db) return;
      if (!editId) return;

      // ✅ 기능 → 카테고리 전환 금지(링크/운영 안정)
      if (editOriginalHasPage === true && edit.hasPage === false) {
        return setErr("기능(페이지 있음) 메뉴를 카테고리로 변경할 수 없습니다. 삭제 후 새로 생성해주세요.");
      }

      // ✅ slug 변경 불가 정책
      // - 원래 기능 메뉴였으면 slug 변경 금지
      // - 원래 카테고리였고 기능으로 전환하는 경우: 최초 1회 slug 입력 가능
      const normalizedSlug = normalizeSlug(edit.slug);

      if (editOriginalHasPage === true) {
        // ✅ 기능 메뉴는 slug 불변
        if (normalizedSlug !== editOriginalSlug) {
          return setErr("폴더명(영문)은 변경할 수 없습니다. 변경하려면 삭제 후 새로 생성해주세요.");
        }
      }

      // ✅ 기본 검증(기능이면 slug 필수)
      const msg = validateCreateOrEdit({ name: edit.name, hasPage: edit.hasPage, slug: normalizedSlug });
      if (msg) return setErr(msg);

      // ✅ 자기 자신을 부모로 지정 금지
      if (edit.parentId === editId) return setErr("부모 메뉴는 자기 자신이 될 수 없습니다.");

      // ✅ 최종 slug/path 결정
      // - 카테고리 유지: slug/path 비움
      // - 기능 유지: 기존 slug 유지
      // - 카테고리→기능 전환: 이번에 입력한 slug를 최초 1회 저장(이후 불변)
      const finalHasPage = Boolean(edit.hasPage);

      let finalSlug = "";
      let finalPath = "";

      if (finalHasPage) {
        finalSlug = editOriginalHasPage ? editOriginalSlug : normalizedSlug;
        finalPath = buildPath(finalSlug);
      } else {
        // ✅ 여기로 오면 editOriginalHasPage가 false인 케이스뿐(위에서 기능→카테고리 막음)
        finalSlug = "";
        finalPath = "";
      }

      setBusy(true);

      // ✅ 부모가 변경되면 새 parent의 맨 뒤로 붙임
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

      // ✅ 새 부모 펼침
      if (edit.parentId) setExpanded((p) => ({ ...p, [edit.parentId!]: true }));

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

  /** ✅ 삭제 */
  const removeMenu = async (id: string) => {
    try {
      setErr("");
      if (!isAdmin) return setErr("관리자만 메뉴를 삭제할 수 있습니다.");
      if (!db) return;

      // ✅ 자식 있으면 삭제 금지(안전)
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

  /** ✅ 드래그 종료: 같은 parentId 내 reorder */
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

  // ✅ 생성경로 표시(유지)
  const previewFormSlug = normalizeSlug(form.slug || "slug_here");
  const previewPath =
    form.hasPage ? buildPath(previewFormSlug) : "(카테고리: 경로 없음)";

  // ✅ 편집 경로 표시(유지)
  const previewEditSlug = editOriginalHasPage ? editOriginalSlug : normalizeSlug(edit.slug || "slug_here");
  const previewEditPath = edit.hasPage ? buildPath(previewEditSlug) : "(카테고리: 경로 없음)";

  // ✅ 부모 옵션
  const parentOptions = useMemo(() => {
    const opts: Array<{ id: string | null; label: string }> = [{ id: null, label: "(최상위)" }];
    menus
      .slice()
      .sort((a, b) => a.order - b.order)
      .forEach((m) => opts.push({ id: m.id, label: m.name }));
    return opts;
  }, [menus]);

  const toggleExpand = (id: string) => setExpanded((p) => ({ ...p, [id]: !(p[id] ?? false) }));

  // ✅ 행에서 버튼으로 부모 지정
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
          카테고리(페이지 없음) / 기능(페이지 있음) 메뉴를 관리합니다. 기능 메뉴만 /contents/{`{slug}`} 경로를 가집니다.
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
              메뉴명<span className="text-red-500"> *</span>
              <input
                value={form.name}
                onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                className="mt-1 w-full rounded-lg border px-3 py-2"
                placeholder="예: Reports"
              />
            </label>

            <label className="text-sm">
              메뉴 타입<span className="text-red-500"> *</span>
              <select
                value={form.hasPage ? "page" : "category"}
                onChange={(e) => {
                  const nextHasPage = e.target.value === "page";
                  setForm((p) => ({
                    ...p,
                    hasPage: nextHasPage,
                    // ✅ 카테고리로 바꾸면 slug 비우기(혼란 방지)
                    slug: nextHasPage ? p.slug : "",
                  }));
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
                placeholder="예: reports (기능 메뉴일 때만)"
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
            <div className="min-w-[980px]">
              <div className="grid grid-cols-[60px_1fr_160px_120px_120px_120px_220px] gap-2 border-b pb-2 text-sm font-semibold">
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
                      setEdit((p) => ({
                        ...p,
                        hasPage: nextHasPage,
                        // ✅ 카테고리로 바꾸면 slug 비움(단, 기능→카테고리는 저장에서 금지)
                        slug: nextHasPage ? p.slug : "",
                      }));
                    }}
                    className="mt-1 w-full rounded-lg border px-3 py-2"
                  >
                    <option value="category">카테고리(페이지 없음)</option>
                    <option value="page">기능(페이지 있음)</option>
                  </select>
                  {editOriginalHasPage && !edit.hasPage && (
                    <div className="mt-1 text-xs text-red-600 dark:text-red-300">
                      기능 → 카테고리 변경은 저장 시 차단됩니다(삭제 후 재생성).
                    </div>
                  )}
                </label>

                <label className="text-sm">
                  폴더명(영문)
                  {edit.hasPage ? <span className="text-red-500"> *</span> : null}
                  <input
                    value={edit.slug}
                    onChange={(e) => setEdit((p) => ({ ...p, slug: normalizeSlug(e.target.value) }))}
                    // ✅ 기능 메뉴였던 경우: slug 변경 금지
                    // ✅ 카테고리였던 경우 + 기능으로 전환: slug 입력 가능(최초 1회)
                    disabled={editOriginalHasPage || !edit.hasPage}
                    className="mt-1 w-full rounded-lg border px-3 py-2 disabled:bg-gray-50 dark:disabled:bg-gray-900"
                    placeholder="예: reports"
                  />
                  <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    {editOriginalHasPage
                      ? "폴더명은 변경할 수 없습니다. 변경하려면 삭제 후 새로 생성해주세요."
                      : edit.hasPage
                      ? "카테고리를 기능 메뉴로 전환하는 경우, 폴더명은 최초 1회 설정 후 변경 불가입니다."
                      : "카테고리 메뉴는 폴더명이 필요 없습니다."}
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

  const typeLabel = m.hasPage ? "기능(페이지)" : "카테고리";
  const pathLabel = m.hasPage ? m.path : "(경로 없음)";

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="grid grid-cols-[60px_1fr_160px_120px_120px_120px_220px] items-center gap-2 rounded-lg border px-2 py-2 text-sm"
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
