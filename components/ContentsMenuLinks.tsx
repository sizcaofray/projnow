"use client";

/**
 * components/ContentsMenuLinks.tsx
 *
 * ✅ 반영 사항
 * 1) 비활성 메뉴(isActive=false / adminOnly 접근불가)는 "비활성 표시 + 무반응"
 * 2) 카테고리 하위에 "사용 가능한 기능 메뉴"가 하나도 없으면
 *    → 카테고리 자체를 비활성 표시
 * 3) 비활성 카테고리는 hover / click / panel 반응 없음
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
  const isAdmin = Boolean(props?.isAdmin);

  const db = useMemo(() => {
    try {
      return getFirebaseDb();
    } catch {
      return null;
    }
  }, []);

  const [menus, setMenus] = useState<MenuDoc[]>([]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [hoverCategoryId, setHoverCategoryId] = useState<string | null>(null);
  const [panelTop, setPanelTop] = useState(0);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const closeTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!db) return;

    const q = query(collection(db, COL), orderBy("order", "asc"));

    const unsub = onSnapshot(q, (snap) => {
      const rows: MenuDoc[] = snap.docs.map((d) => {
        const v = d.data() as any;
        return {
          id: d.id,
          name: String(v.name ?? ""),
          group: String(v.group ?? ""),
          order: Number(v.order ?? 0),
          isActive: Boolean(v.isActive ?? true),
          adminOnly: Boolean(v.adminOnly ?? false),
          parentId: v.parentId ?? null,
          hasPage: Boolean(v.hasPage ?? false),
          slug: String(v.slug ?? ""),
          path: String(v.path ?? ""),
        };
      });

      setMenus(rows);

      setExpanded((prev) => {
        if (Object.keys(prev).length > 0) return prev;

        const next: Record<string, boolean> = {};
        rows
          .filter((m) => !m.hasPage)
          .forEach((m) => {
            if (m.parentId === null) next[m.id] = true;
          });

        return next;
      });
    });

    return () => unsub();
  }, [db]);

  /** ✅ 접근 가능 여부 */
  const canUseMenu = (m: MenuDoc) => {
    if (!m.isActive) return false;
    if (m.adminOnly && !isAdmin) return false;
    return true;
  };

  /** ✅ parentId → children */
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

  /** ✅ 카테고리 하위에 "사용 가능한 기능 메뉴" 존재 여부 */
  const hasUsableLeafPages = (categoryId: string) => {
    const kids = childrenByParent.get(categoryId) ?? [];
    return kids.some((m) => m.hasPage && canUseMenu(m) && !!m.path);
  };

  const computeTop = (el: HTMLElement | null) => {
    const container = containerRef.current;
    if (!container || !el) return 0;
    const cRect = container.getBoundingClientRect();
    const eRect = el.getBoundingClientRect();
    return eRect.top - cRect.top;
  };

  const openHoverPanel = (categoryId: string, el: HTMLElement | null) => {
    setHoverCategoryId(categoryId);
    setPanelTop(computeTop(el));
  };

  const scheduleCloseHoverPanel = () => {
    closeTimerRef.current = window.setTimeout(() => {
      setHoverCategoryId(null);
    }, 120);
  };

  const cancelCloseHoverPanel = () => {
    if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
  };

  const toggleExpand = (id: string) => {
    setExpanded((p) => ({ ...p, [id]: !(p[id] ?? false) }));
  };

  const renderCategoryTree = (parentId: string | null, depth: number) => {
    const kids = (childrenByParent.get(parentId) ?? []).filter((m) => !m.hasPage);
    if (kids.length === 0) return null;

    return (
      <div className="space-y-1">
        {kids.map((cat) => {
          const usable = canUseMenu(cat) && hasUsableLeafPages(cat.id);
          const isOpen = expanded[cat.id] ?? false;
          const padLeft = 12 + depth * 12;

          const baseClass =
            "w-full flex items-center justify-between px-3 py-2 rounded text-sm";

          const activeClass =
            "hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer";

          const disabledClass =
            "opacity-50 cursor-not-allowed pointer-events-none";

          return (
            <div key={cat.id}>
              <div
                className={`${baseClass} ${
                  usable ? activeClass : disabledClass
                }`}
                style={{ paddingLeft: padLeft }}
                onMouseEnter={
                  usable
                    ? (e) =>
                        openHoverPanel(
                          cat.id,
                          e.currentTarget as unknown as HTMLElement
                        )
                    : undefined
                }
                onMouseLeave={usable ? scheduleCloseHoverPanel : undefined}
                onClick={
                  usable
                    ? () => toggleExpand(cat.id)
                    : undefined
                }
              >
                <span className="truncate">{cat.name}</span>
                <span className="text-xs opacity-70">
                  {usable ? (isOpen ? "▾" : "▸") : ""}
                </span>
              </div>

              {usable && isOpen ? (
                <div className="mt-1">
                  {renderCategoryTree(cat.id, depth + 1)}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    );
  };

  const hoverLeafPages = useMemo(() => {
    if (!hoverCategoryId) return [];
    const kids = childrenByParent.get(hoverCategoryId) ?? [];
    return kids.filter((m) => m.hasPage && canUseMenu(m) && !!m.path);
  }, [childrenByParent, hoverCategoryId]);

  return (
    <div ref={containerRef} className="relative">
      {renderCategoryTree(null, 0)}

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
