"use client";

/**
 * components/ContentsMenuLinks.tsx
 *
 * ✅ 이번 수정(핵심)
 * - 최상위 메뉴(카테고리) adminOnly=true 인 경우:
 *   비로그인/비관리자에게 해당 카테고리 + 모든 하위 메뉴를 "숨김" 처리
 *
 * ✅ 기존 문제
 * - canUseLeafPage()가 hasPage(true)인 기능 메뉴에만 adminOnly를 적용함
 * - 카테고리(hasPage=false)는 adminOnly여도 렌더링되어 비로그인에서도 보임
 */

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { collection, onSnapshot, orderBy, query, doc, getDoc } from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import { getFirebaseAuth, getFirebaseDb } from "@/lib/firebase/client";

type MenuDoc = {
  id: string;
  name: string;
  group: string;
  order: number;
  isActive: boolean;
  adminOnly: boolean;
  parentId: string | null;
  hasPage: boolean;
  slug: string;
  path: string;
};

const COL = "menus";

export default function ContentsMenuLinks(props?: { isAdmin?: boolean }) {
  // ✅ props가 오면 우선 사용, 없으면 내부에서 계산
  const propIsAdmin = typeof props?.isAdmin === "boolean" ? props?.isAdmin : null;

  const db = useMemo(() => {
    try {
      return getFirebaseDb();
    } catch {
      return null;
    }
  }, []);

  const auth = useMemo(() => {
    try {
      return getFirebaseAuth();
    } catch {
      return null;
    }
  }, []);

  // ✅ 내부 계산 관리자 여부(기본 false)
  const [isAdminState, setIsAdminState] = useState(false);

  // ✅ 최종 isAdmin
  const isAdmin = propIsAdmin ?? isAdminState;

  const [menus, setMenus] = useState<MenuDoc[]>([]);

  // ✅ 카테고리 트리 펼침 상태
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  // ✅ 옆 패널: 오버된 카테고리
  const [hoverCategoryId, setHoverCategoryId] = useState<string | null>(null);
  const [panelTop, setPanelTop] = useState(0);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const closeTimerRef = useRef<number | null>(null);

  const isCategory = (m: MenuDoc) => !m.hasPage;

  // ✅ 관리자 판별(Props 미제공일 때만 동작)
  useEffect(() => {
    if (propIsAdmin !== null) return;

    if (!auth || !db) {
      setIsAdminState(false);
      return;
    }

    const unsub = onAuthStateChanged(auth, async (user) => {
      try {
        if (!user) {
          setIsAdminState(false);
          return;
        }

        const snap = await getDoc(doc(db, "users", user.uid));
        const role = String((snap.exists() ? (snap.data() as any)?.role : "") ?? "")
          .trim()
          .toLowerCase();

        setIsAdminState(role === "admin");
      } catch {
        setIsAdminState(false);
      }
    });

    return () => unsub();
  }, [auth, db, propIsAdmin]);

  // ✅ 동적 메뉴 로딩
  useEffect(() => {
    if (!db) return;

    const q = query(collection(db, COL), orderBy("order", "asc"));

    const unsub = onSnapshot(
      q,
      (snap) => {
        const rows: MenuDoc[] = snap.docs.map((d) => {
          const v = d.data() as any;

          const hasPage = Boolean(v.hasPage ?? false);
          const slug = String(v.slug ?? "");
          const path = String(v.path ?? "");

          const parentIdRaw = v.parentId ?? null;
          const parentId = parentIdRaw === "" ? null : (parentIdRaw as string | null);

          return {
            id: d.id,
            name: String(v.name ?? ""),
            group: String(v.group ?? ""),
            order: Number(v.order ?? 0),
            isActive: Boolean(v.isActive ?? true),
            adminOnly: Boolean(v.adminOnly ?? false),
            parentId,
            hasPage,
            slug: hasPage ? slug : "",
            path: hasPage ? path : "",
          };
        });

        setMenus(rows);
      },
      () => {
        // 구독 실패 시 앱 중단 방지
      }
    );

    return () => unsub();
  }, [db]);

  /** ✅ parentId -> children */
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

  /**
   * ✅ adminOnly 상속 숨김 계산
   * - adminOnly=true 인 메뉴는 (카테고리/페이지 모두) 비관리자에게 숨김
   * - 숨겨진 카테고리의 모든 하위도 숨김(상속)
   */
  const hiddenIds = useMemo(() => {
    const hidden = new Set<string>();

    const walk = (parentId: string | null, inheritedHidden: boolean) => {
      const kids = childrenByParent.get(parentId) ?? [];
      for (const m of kids) {
        const selfHidden = inheritedHidden || (m.adminOnly && !isAdmin);
        if (selfHidden) hidden.add(m.id);
        walk(m.id, selfHidden);
      }
    };

    walk(null, false);
    return hidden;
  }, [childrenByParent, isAdmin]);

  /** ✅ 보이는 메뉴인지 */
  const canSeeMenu = (m: MenuDoc) => !hiddenIds.has(m.id);

  /** ✅ 기능 메뉴(페이지)의 사용 가능 여부 */
  const canUseLeafPage = (m: MenuDoc) => {
    // 숨김이면 사용 불가 (링크 자체도 렌더링하지 않도록 밖에서 필터링도 함)
    if (!canSeeMenu(m)) return false;
    if (!m.hasPage) return true;
    if (!m.isActive) return false;
    // adminOnly는 hiddenIds에서 1차 차단되지만 안전하게 한 번 더
    if (m.adminOnly && !isAdmin) return false;
    return true;
  };

  /** ✅ "하위에 메뉴가 없는 카테고리" 판정 (children 0개) */
  const isEmptyCategory = (categoryId: string) => {
    const kids = (childrenByParent.get(categoryId) ?? []).filter(canSeeMenu);
    return kids.length === 0;
  };

  /** ✅ 카테고리 하위 카테고리 수 */
  const categoryChildrenCount = (categoryId: string) => {
    const kids = (childrenByParent.get(categoryId) ?? []).filter(canSeeMenu);
    return kids.filter(isCategory).length;
  };

  /** ✅ 옆 패널: 오버된 카테고리의 직계 기능 메뉴(hasPage=true) */
  const hoverLeafPages = useMemo(() => {
    if (!hoverCategoryId) return [];
    const kids = (childrenByParent.get(hoverCategoryId) ?? []).filter(canSeeMenu);
    return kids.filter((m) => m.hasPage && !!m.path);
  }, [childrenByParent, hoverCategoryId, hiddenIds]);

  // ✅ 최초 1회: 최상위 카테고리 기본 펼침 (보이는 것만)
  useEffect(() => {
    setExpanded((prev) => {
      if (Object.keys(prev).length > 0) return prev;

      const next: Record<string, boolean> = {};
      menus
        .filter((m) => !m.hasPage)
        .filter(canSeeMenu)
        .forEach((m) => {
          if (m.parentId === null) next[m.id] = true;
        });

      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menus, hiddenIds]);

  const computeTop = (el: HTMLElement | null) => {
    const container = containerRef.current;
    if (!container || !el) return 0;
    const cRect = container.getBoundingClientRect();
    const eRect = el.getBoundingClientRect();
    return eRect.top - cRect.top;
  };

  const openHoverPanel = (categoryId: string, el: HTMLElement | null) => {
    if (closeTimerRef.current) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }

    setHoverCategoryId(categoryId);
    setPanelTop(computeTop(el));
  };

  const scheduleCloseHoverPanel = () => {
    if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = window.setTimeout(() => {
      setHoverCategoryId(null);
      closeTimerRef.current = null;
    }, 120);
  };

  const cancelCloseHoverPanel = () => {
    if (closeTimerRef.current) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  };

  const toggleExpand = (id: string) => {
    setExpanded((p) => ({ ...p, [id]: !(p[id] ?? false) }));
  };

  const renderCategoryTree = (parentId: string | null, depth: number) => {
    // ✅ 보이는 카테고리만 렌더
    const kids = (childrenByParent.get(parentId) ?? []).filter(isCategory).filter(canSeeMenu);
    if (kids.length === 0) return null;

    return (
      <div className="space-y-1">
        {kids.map((cat) => {
          const padLeft = 12 + depth * 12;

          const hasChildCategories = categoryChildrenCount(cat.id) > 0;
          const isOpen = expanded[cat.id] ?? false;

          const isTopLevel = cat.parentId === null;
          const empty = isEmptyCategory(cat.id);
          const categoryDisabled = !isTopLevel && empty;

          const baseClass = "w-full flex items-center justify-between px-3 py-2 rounded text-sm text-slate-100";
          const activeClass = "hover:bg-white/10 cursor-pointer";
          const disabledClass = "opacity-50 cursor-not-allowed pointer-events-none select-none";

          return (
            <div key={cat.id}>
              <button
                type="button"
                className={`${baseClass} ${categoryDisabled ? disabledClass : activeClass}`}
                style={{ paddingLeft: padLeft }}
                title={categoryDisabled ? "하위 메뉴가 없어 사용할 수 없습니다." : "카테고리"}
                onMouseEnter={
                  categoryDisabled
                    ? undefined
                    : (e) => openHoverPanel(cat.id, e.currentTarget as unknown as HTMLElement)
                }
                onMouseLeave={categoryDisabled ? undefined : scheduleCloseHoverPanel}
                onClick={() => {
                  if (categoryDisabled) return;
                  if (hasChildCategories) toggleExpand(cat.id);
                }}
              >
                <span className="truncate">{cat.name}</span>
                <span className="text-xs opacity-70">
                  {categoryDisabled ? "" : hasChildCategories ? (isOpen ? "▾" : "▸") : ""}
                </span>
              </button>

              {!categoryDisabled && hasChildCategories && isOpen ? (
                <div className="mt-1">{renderCategoryTree(cat.id, depth + 1)}</div>
              ) : null}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div ref={containerRef} className="relative z-[600]">
      {/* ✅ 좌측: 카테고리 트리 */}
      {renderCategoryTree(null, 0)}

      {/* ✅ 우측(옆) 패널: 기능 메뉴 */}
      {hoverCategoryId && hoverLeafPages.length > 0 ? (
        <div
          className="absolute left-full ml-2 w-56 rounded-lg border border-slate-700 bg-slate-900 text-slate-100 shadow-lg z-[700]"
          style={{ top: panelTop }}
          onMouseEnter={cancelCloseHoverPanel}
          onMouseLeave={scheduleCloseHoverPanel}
        >
          <div className="p-2 space-y-1">
            {hoverLeafPages.map((p) => {
              // ✅ 보이는 메뉴만 들어오지만, 안전하게 usable 체크
              const usable = canUseLeafPage(p);

              if (!usable) {
                return (
                  <div
                    key={p.id}
                    className="block rounded px-3 py-2 text-sm opacity-50 cursor-not-allowed pointer-events-none select-none"
                    title="사용할 수 없는 메뉴입니다."
                  >
                    {p.name}
                  </div>
                );
              }

              return (
                <Link
                  key={p.id}
                  href={p.path}
                  className="block rounded px-3 py-2 text-sm hover:bg-white/10"
                  title={p.path}
                >
                  {p.name}
                </Link>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
