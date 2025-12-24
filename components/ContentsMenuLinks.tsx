"use client";

/**
 * components/ContentsMenuLinks.tsx
 *
 * ✅ 역할
 * - Firestore "menus" 컬렉션을 onSnapshot으로 실시간 구독
 * - isActive=true 만 노출
 * - adminOnly=true 는 관리자만 노출
 * - hasPage=false(카테고리)면 링크 없이 표시
 * - hasPage=true(기능)면 path로 Link 이동
 *
 * ✅ 요구사항(이번 수정)
 * - "부모(카테고리) 메뉴"에 마우스오버 시,
 *   오버된 메뉴 옆(오른쪽)에 "기능이 있는 메뉴(hasPage=true)"만 표시하는 패널을 노출
 *
 * ✅ 버그/현상 수정
 * - 이전 구현은 "좌측 트리(펼침)" + "오른쪽 호버 패널"이 동시에 동작하여
 *   하위 메뉴가 좌측에도 생기는 현상이 있었습니다.
 * - 이번 수정으로: 카테고리는 좌측에서 하위를 펼치지 않고(트리 렌더 제거),
 *   오른쪽 호버 패널에서만 하위 기능 메뉴를 보여줍니다.
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

export default function ContentsMenuLinks(props: { isAdmin: boolean }) {
  const { isAdmin } = props;

  const db = useMemo(() => {
    try {
      return getFirebaseDb();
    } catch {
      return null;
    }
  }, []);

  const [menus, setMenus] = useState<MenuDoc[]>([]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({}); // (유지) 다른 곳에서 쓰고 있을 수 있어 유지
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

        // ✅ 기존 expanded 초기화 로직이 있었다면 유지(다른 기능 영향 최소)
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
        // ✅ 구독 실패해도 사이드바가 앱을 죽이지 않도록 무시
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

  // ✅ 트리 구성(parentId -> children)
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

  /**
   * ✅ hover 패널 열기
   * - 부모 메뉴 DOM의 위치를 기준으로 패널 top을 계산합니다.
   */
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

  /**
   * ✅ hover 패널 닫기 예약(딜레이로 깜빡임 방지)
   */
  const scheduleCloseHoverPanel = () => {
    if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = window.setTimeout(() => {
      setHoverParentId(null);
      closeTimerRef.current = null;
    }, 120);
  };

  /**
   * ✅ hover된 부모의 "직계 자식" 중 기능 메뉴(hasPage=true)만 추출
   */
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

          /**
           * ✅ 카테고리(페이지 없음)
           * - (핵심 수정) 좌측에서 하위를 "펼치지 않음"
           * - 호버로만 오른쪽 패널을 띄워서 하위 기능 메뉴를 보여줌
           */
          if (!m.hasPage) {
            return (
              <div
                key={m.id}
                onMouseEnter={(e) => openHoverPanel(m.id, e.currentTarget as unknown as HTMLElement)}
                onMouseLeave={scheduleCloseHoverPanel}
              >
                <button
                  type="button"
                  // ✅ 좌측 트리 펼침/접힘은 제거(원치 않는 좌측 하위 생성 방지)
                  className="w-full flex items-center justify-between px-3 py-2 rounded hover:bg-gray-50 dark:hover:bg-gray-800"
                  style={{ paddingLeft: padLeft }}
                  title="카테고리"
                >
                  <span className="truncate">{m.name}</span>
                  {/* ✅ 자식이 있으면 패널 존재를 암시하는 아이콘만 표시 */}
                  <span className="text-xs opacity-70">{hasChildren ? "▸" : ""}</span>
                </button>
              </div>
            );
          }

          /**
           * ✅ 기능(페이지 있음)
           * - Link 이동
           * - (선택) 기능 메뉴가 자식을 갖는 경우에만 hover 패널을 열도록 유지
           */
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
      {/* ✅ 좌측 메뉴 리스트 */}
      {renderNode(null, 0)}

      {/* ✅ 오른쪽 hover 패널 */}
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
