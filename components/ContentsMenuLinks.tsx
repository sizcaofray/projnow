"use client";

/**
 * components/ContentsMenuLinks.tsx
 *
 * ✅ 변경(빌드 에러 해결)
 * - isAdmin을 필수 props로 받지 않고 optional로 변경
 * - 기본값 false로 처리
 * - layout.tsx에서 props 누락되어도 빌드가 깨지지 않음
 *
 * ✅ 기능
 * - Firestore menus 실시간 구독
 * - isActive만 노출
 * - adminOnly는 isAdmin일 때만 노출
 * - 카테고리(hasPage=false)는 hover 패널로만 하위 기능 메뉴 노출(좌측 트리 확장 없음)
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
  // ✅ props가 없어도 동작하도록 기본값 처리
  const isAdmin = Boolean(props?.isAdmin);

  const db = useMemo(() => {
    try {
      return getFirebaseDb();
    } catch {
      return null;
    }
  }, []);

  const [menus, setMenus] = useState<MenuDoc[]>([]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({}); // 다른 코드 영향 최소화 차원 유지
  const [hoverParentId, setHoverParentId] = useState<string | null>(null);
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

        // ✅ 기존 expanded 초기화 로직 유지(실사용은 안 해도 영향 최소)
        setExpanded((prev) => {
          if (Object.keys(prev).length > 0) return prev;

          const parentSet = new Set<string>();
          rows.forEach((m) => {
            if (m.parentId) parentSet.add(m.parentId);
          });

          const next: Record<string, boolean> = {};
          parentSet.forEach((pid) => (next[pid] = true));
          rows.forEach((m) => {
            if (m.parentId === null) next[m.id] = true;
          });

          return next;
        });
      },
      () => {
        // 구독 실패 시 무시(앱 중단 방지)
      }
    );

    return () => unsub();
  }, [db]);

  // ✅ 노출 필터(활성 + adminOnly 처리)
  const visibleMenus = useMemo(() => {
    return menus
      .filter((m) => m.isActive)
      .filter((m) => (m.adminOnly ? isAdmin : true));
  }, [menus, isAdmin]);

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

  const openHoverPanel = (menuId: string, el: HTMLElement | null) => {
    if (closeTimerRef.current) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }

    setHoverParentId(menuId);

    const container = containerRef.current;
    if (container && el) {
      const cRect = container.getBoundingClientRect();
      const eRect = el.getBoundingClientRect();
      setPanelTop(eRect.top - cRect.top);
    } else {
      setPanelTop(0);
    }
  };

  const scheduleCloseHoverPanel = () => {
    if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = window.setTimeout(() => {
      setHoverParentId(null);
      closeTimerRef.current = null;
    }, 120);
  };

  const hoverLeafChildren = useMemo(() => {
    if (!hoverParentId) return [];
    const kids = childrenByParent.get(hoverParentId) ?? [];
    return kids.filter((m) => m.hasPage && !!m.path);
  }, [childrenByParent, hoverParentId]);

  const renderNode = (parentId: string | null, depth: number) => {
    const kids = childrenByParent.get(parentId) ?? [];
    if (kids.length === 0) return null;

    return (
      <div className="space-y-1">
        {kids.map((m) => {
          const hasChildren = (childrenByParent.get(m.id) ?? []).length > 0;
          const padLeft = 12 + depth * 12;

          // ✅ 카테고리: 좌측 트리 확장 없음, hover 패널만
          if (!m.hasPage) {
            return (
              <div
                key={m.id}
                onMouseEnter={(e) => openHoverPanel(m.id, e.currentTarget as unknown as HTMLElement)}
                onMouseLeave={scheduleCloseHoverPanel}
              >
                <button
                  type="button"
                  className="w-full flex items-center justify-between px-3 py-2 rounded hover:bg-gray-50 dark:hover:bg-gray-800"
                  style={{ paddingLeft: padLeft }}
                  title="카테고리"
                >
                  <span className="truncate">{m.name}</span>
                  <span className="text-xs opacity-70">{hasChildren ? "▸" : ""}</span>
                </button>
              </div>
            );
          }

          // ✅ 기능: Link 이동
          return (
            <div
              key={m.id}
              onMouseEnter={(e) => {
                if (hasChildren) openHoverPanel(m.id, e.currentTarget as unknown as HTMLElement);
              }}
              onMouseLeave={scheduleCloseHoverPanel}
            >
              <Link
                href={m.path || "#"}
                className="block px-3 py-2 rounded hover:bg-gray-50 dark:hover:bg-gray-800"
                style={{ paddingLeft: padLeft }}
                title={m.path}
              >
                {m.name}
              </Link>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div ref={containerRef} className="relative">
      {renderNode(null, 0)}

      {hoverParentId && hoverLeafChildren.length > 0 ? (
        <div
          className="absolute left-full ml-2 w-56 rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-lg"
          style={{ top: panelTop }}
          onMouseEnter={() => {
            if (closeTimerRef.current) {
              window.clearTimeout(closeTimerRef.current);
              closeTimerRef.current = null;
            }
          }}
          onMouseLeave={scheduleCloseHoverPanel}
        >
          <div className="p-2 space-y-1">
            {hoverLeafChildren.map((c) => (
              <Link
                key={c.id}
                href={c.path || "#"}
                className="block rounded px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-800"
                title={c.path}
              >
                {c.name}
              </Link>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
