"use client";

/**
 * components/ContentsMenuLinks.tsx
 *
 * ✅ 사용자 요구사항 반영(원래 계획대로)
 * 1) 좌측 메뉴에는 "카테고리(hasPage=false)"만 트리로 표시합니다.
 * 2) 마지막 기능 메뉴(hasPage=true)는 좌측에 표시하지 않습니다.
 * 3) 카테고리에 마우스 오버하면, 그 카테고리의 직계 자식 중
 *    "기능 메뉴(hasPage=true)"만 오른쪽(옆) 패널에 펼쳐서 보여줍니다.
 *
 * ✅ 기타
 * - isAdmin props는 optional 처리(레이아웃에서 props 누락되어도 빌드 깨짐 방지)
 * - isActive=true만 노출
 * - adminOnly=true는 isAdmin일 때만 노출
 */

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import { getFirebaseDb } from "@/lib/firebase/client";

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
  // ✅ props 누락 대비(빌드 안정)
  const isAdmin = Boolean(props?.isAdmin);

  const db = useMemo(() => {
    try {
      return getFirebaseDb();
    } catch {
      return null;
    }
  }, []);

  const [menus, setMenus] = useState<MenuDoc[]>([]);

  // ✅ 좌측 트리(카테고리) 펼침 상태
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  // ✅ 옆 패널 상태: "오버된 카테고리"
  const [hoverCategoryId, setHoverCategoryId] = useState<string | null>(null);
  const [panelTop, setPanelTop] = useState(0);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const closeTimerRef = useRef<number | null>(null);

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

        // ✅ 최초 1회만: 자식 카테고리가 있는 카테고리를 기본 펼침
        setExpanded((prev) => {
          if (Object.keys(prev).length > 0) return prev;

          // "카테고리"들만 대상으로 펼침 계산
          const categories = rows.filter((m) => !m.hasPage);
          const catIds = new Set(categories.map((c) => c.id));

          // 자식이 "카테고리"인 경우에만 펼침 대상으로 잡습니다.
          const parentSet = new Set<string>();
          categories.forEach((m) => {
            if (m.parentId && catIds.has(m.parentId)) parentSet.add(m.parentId);
          });

          const next: Record<string, boolean> = {};
          parentSet.forEach((pid) => (next[pid] = true));

          // 최상위 카테고리도 기본 펼침(원치 않으면 false로 바꾸셔도 됩니다)
          categories.forEach((m) => {
            if (m.parentId === null) next[m.id] = true;
          });

          return next;
        });
      },
      () => {
        // 구독 실패 시 앱 중단 방지
      }
    );

    return () => unsub();
  }, [db]);

  // ✅ 노출 필터(활성 + adminOnly)
  const visibleMenus = useMemo(() => {
    return menus
      .filter((m) => m.isActive)
      .filter((m) => (m.adminOnly ? isAdmin : true));
  }, [menus, isAdmin]);

  // ✅ parentId -> children 구성
  const childrenByParent = useMemo(() => {
    const map = new Map<string | null, MenuDoc[]>();
    visibleMenus.forEach((m) => {
      const key = m.parentId ?? null;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(m);
    });
    map.forEach((arr) => arr.sort((a, b) => a.order - b.order));
    return map;
  }, [visibleMenus]);

  // ✅ 좌측 트리에 표시할 대상은 "카테고리(hasPage=false)"만
  const isCategory = (m: MenuDoc) => !m.hasPage;

  const categoryChildrenCount = (categoryId: string) => {
    const kids = childrenByParent.get(categoryId) ?? [];
    return kids.filter(isCategory).length;
  };

  // ✅ 오버된 카테고리의 "직계 자식 중 기능 메뉴(hasPage=true)"만 옆 패널에 표시
  const hoverLeafPages = useMemo(() => {
    if (!hoverCategoryId) return [];
    const kids = childrenByParent.get(hoverCategoryId) ?? [];
    return kids.filter((m) => m.hasPage && !!m.path);
  }, [childrenByParent, hoverCategoryId]);

  const computeTop = (el: HTMLElement | null) => {
    const container = containerRef.current;
    if (!container || !el) return 0;
    const cRect = container.getBoundingClientRect();
    const eRect = el.getBoundingClientRect();
    return eRect.top - cRect.top;
  };

  const openHoverPanel = (categoryId: string, el: HTMLElement | null) => {
    // ✅ 닫힘 예약 취소
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
    const kids = (childrenByParent.get(parentId) ?? []).filter(isCategory);
    if (kids.length === 0) return null;

    return (
      <div className="space-y-1">
        {kids.map((cat) => {
          const childCatsCount = categoryChildrenCount(cat.id);
          const hasChildCategories = childCatsCount > 0;
          const isOpen = expanded[cat.id] ?? false;
          const padLeft = 12 + depth * 12;

          return (
            <div key={cat.id}>
              {/* ✅ 카테고리는 좌측에 표시 + hover 시 옆 패널에 "기능 메뉴"만 표시 */}
              <button
                type="button"
                className="w-full flex items-center justify-between px-3 py-2 rounded hover:bg-gray-50 dark:hover:bg-gray-800"
                style={{ paddingLeft: padLeft }}
                title="카테고리"
                onMouseEnter={(e) => openHoverPanel(cat.id, e.currentTarget as unknown as HTMLElement)}
                onMouseLeave={scheduleCloseHoverPanel}
                onClick={() => {
                  // ✅ 좌측에서는 카테고리만 접기/펼치기
                  if (hasChildCategories) toggleExpand(cat.id);
                }}
              >
                <span className="truncate">{cat.name}</span>
                <span className="text-xs opacity-70">
                  {hasChildCategories ? (isOpen ? "▾" : "▸") : ""}
                </span>
              </button>

              {/* ✅ 카테고리 하위 카테고리는 좌측에 계속 표시 */}
              {hasChildCategories && isOpen ? (
                <div className="mt-1">{renderCategoryTree(cat.id, depth + 1)}</div>
              ) : null}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div ref={containerRef} className="relative">
      {/* ✅ 좌측: 카테고리 트리만 */}
      {renderCategoryTree(null, 0)}

      {/* ✅ 오른쪽(옆) 패널: 해당 카테고리의 "기능 메뉴"만 */}
      {hoverCategoryId && hoverLeafPages.length > 0 ? (
        <div
          className="absolute left-full ml-2 w-56 rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-lg"
          style={{ top: panelTop }}
          onMouseEnter={cancelCloseHoverPanel}
          onMouseLeave={scheduleCloseHoverPanel}
        >
          <div className="p-2 space-y-1">
            {hoverLeafPages.map((p) => (
              <Link
                key={p.id}
                href={p.path}
                className="block rounded px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-800"
                title={p.path}
              >
                {p.name}
              </Link>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
