"use client";

/**
 * components/ContentsMenuLinks.tsx
 *
 * ✅ 목표(요청 반영)
 * - 좌측에는 "최상위 메뉴"만 표시
 * - 최상위 메뉴에 마우스오버하면 오른쪽(1단) 패널에 "직계 자식(카테고리/기능)" 표시
 * - 1단 패널에서 카테고리에 마우스오버하면 오른쪽(2단) 패널에 "그 카테고리의 자식" 표시
 *
 * ✅ 왜 필요한가?
 * - 현재 사용자 메뉴 구조가 "카테고리 → 카테고리 → 기능" 형태라
 *   "기능만 필터링"하면 1단 패널이 비어 하위가 아예 안 보입니다.
 *
 * ✅ 기타
 * - isAdmin props는 optional 유지(빌드 안정)
 * - adminOnly 메뉴는 isAdmin일 때만 노출
 * - isActive=true만 노출
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

  // ✅ 1단/2단 패널 상태
  const [hoverParentId, setHoverParentId] = useState<string | null>(null); // 좌측 최상위에 hover된 id
  const [panelTop1, setPanelTop1] = useState(0);

  const [hoverChildCategoryId, setHoverChildCategoryId] = useState<string | null>(null); // 1단 패널에서 hover된 "카테고리" id
  const [panelTop2, setPanelTop2] = useState(0);

  const containerRef = useRef<HTMLDivElement | null>(null);

  // ✅ 닫힘 딜레이(패널 이동 시 깜빡임 방지)
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
      },
      () => {
        // ✅ 구독 실패 시 무시(앱 중단 방지)
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

  // ✅ 최상위 메뉴(좌측에 표시)
  const topLevelMenus = useMemo(() => {
    return childrenByParent.get(null) ?? [];
  }, [childrenByParent]);

  // ✅ hover된 최상위 메뉴의 직계 자식(1단 패널)
  const panelChildrenLevel1 = useMemo(() => {
    if (!hoverParentId) return [];
    return childrenByParent.get(hoverParentId) ?? [];
  }, [childrenByParent, hoverParentId]);

  // ✅ 1단 패널에서 hover된 "카테고리"의 자식(2단 패널)
  const panelChildrenLevel2 = useMemo(() => {
    if (!hoverChildCategoryId) return [];
    return childrenByParent.get(hoverChildCategoryId) ?? [];
  }, [childrenByParent, hoverChildCategoryId]);

  const computeTop = (el: HTMLElement | null) => {
    const container = containerRef.current;
    if (!container || !el) return 0;
    const cRect = container.getBoundingClientRect();
    const eRect = el.getBoundingClientRect();
    return eRect.top - cRect.top;
  };

  const openPanel1 = (menuId: string, el: HTMLElement | null) => {
    // ✅ 닫힘 타이머 취소
    if (closeTimerRef.current) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }

    setHoverParentId(menuId);
    setPanelTop1(computeTop(el));

    // ✅ 1단 패널이 바뀌면 2단 패널은 초기화(이전 상태 잔존 방지)
    setHoverChildCategoryId(null);
    setPanelTop2(0);
  };

  const openPanel2 = (categoryId: string, el: HTMLElement | null) => {
    setHoverChildCategoryId(categoryId);
    setPanelTop2(computeTop(el));
  };

  const scheduleCloseAllPanels = () => {
    if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = window.setTimeout(() => {
      setHoverParentId(null);
      setHoverChildCategoryId(null);
      closeTimerRef.current = null;
    }, 120);
  };

  const cancelClose = () => {
    if (closeTimerRef.current) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  };

  const hasChildren = (id: string) => (childrenByParent.get(id) ?? []).length > 0;

  return (
    <div ref={containerRef} className="relative" onMouseLeave={scheduleCloseAllPanels} onMouseEnter={cancelClose}>
      {/* ✅ 좌측: 최상위 메뉴만 표시 */}
      <div className="space-y-1">
        {topLevelMenus.map((m) => {
          const childExists = hasChildren(m.id);

          // ✅ 최상위가 기능 메뉴면 클릭 이동도 가능 (원하시면 막을 수 있음)
          if (m.hasPage) {
            return (
              <div
                key={m.id}
                onMouseEnter={(e) => {
                  // 기능 메뉴도 자식이 있으면 패널 오픈 가능
                  if (childExists) openPanel1(m.id, e.currentTarget as unknown as HTMLElement);
                }}
              >
                <Link
                  href={m.path || "#"}
                  className="block px-3 py-2 rounded hover:bg-gray-50 dark:hover:bg-gray-800"
                  title={m.path}
                >
                  <div className="flex items-center justify-between">
                    <span className="truncate">{m.name}</span>
                    <span className="text-xs opacity-70">{childExists ? "▸" : ""}</span>
                  </div>
                </Link>
              </div>
            );
          }

          // ✅ 최상위 카테고리: hover로 1단 패널 오픈
          return (
            <div key={m.id} onMouseEnter={(e) => openPanel1(m.id, e.currentTarget as unknown as HTMLElement)}>
              <button
                type="button"
                className="w-full flex items-center justify-between px-3 py-2 rounded hover:bg-gray-50 dark:hover:bg-gray-800"
                title="카테고리"
              >
                <span className="truncate">{m.name}</span>
                <span className="text-xs opacity-70">{childExists ? "▸" : ""}</span>
              </button>
            </div>
          );
        })}
      </div>

      {/* ✅ 1단 패널: hover된 최상위 메뉴의 직계 자식(카테고리/기능 모두 표시) */}
      {hoverParentId && panelChildrenLevel1.length > 0 ? (
        <div
          className="absolute left-full ml-2 w-56 rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-lg"
          style={{ top: panelTop1 }}
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleCloseAllPanels}
        >
          <div className="p-2 space-y-1">
            {panelChildrenLevel1.map((c) => {
              const childExists = hasChildren(c.id);

              // ✅ 1단 패널의 카테고리: hover 시 2단 패널 오픈
              if (!c.hasPage) {
                return (
                  <div
                    key={c.id}
                    onMouseEnter={(e) => {
                      if (childExists) openPanel2(c.id, e.currentTarget as unknown as HTMLElement);
                      else {
                        // 자식 없는 카테고리면 2단 패널 닫기
                        setHoverChildCategoryId(null);
                        setPanelTop2(0);
                      }
                    }}
                  >
                    <button
                      type="button"
                      className="w-full flex items-center justify-between rounded px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-800"
                      title="카테고리"
                    >
                      <span className="truncate">{c.name}</span>
                      <span className="text-xs opacity-70">{childExists ? "▸" : ""}</span>
                    </button>
                  </div>
                );
              }

              // ✅ 1단 패널의 기능 메뉴: 클릭 이동
              return (
                <Link
                  key={c.id}
                  href={c.path || "#"}
                  className="block rounded px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-800"
                  title={c.path}
                  onMouseEnter={() => {
                    // 기능 메뉴 hover 시 2단 패널은 닫아 깔끔하게
                    setHoverChildCategoryId(null);
                    setPanelTop2(0);
                  }}
                >
                  <div className="flex items-center justify-between">
                    <span className="truncate">{c.name}</span>
                    <span className="text-xs opacity-70">{childExists ? "▸" : ""}</span>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      ) : null}

      {/* ✅ 2단 패널: 1단 패널의 카테고리에 hover 시 그 자식 표시 */}
      {hoverChildCategoryId && panelChildrenLevel2.length > 0 ? (
        <div
          className="absolute left-full ml-[240px] w-56 rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-lg"
          style={{ top: panelTop2 }}
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleCloseAllPanels}
        >
          <div className="p-2 space-y-1">
            {panelChildrenLevel2.map((g) => {
              const childExists = hasChildren(g.id);

              // ✅ 2단 패널에서는 "기능 메뉴" 위주로 보이게 하되, 카테고리도 필요하면 표시
              if (!g.hasPage) {
                return (
                  <div key={g.id} className="rounded px-3 py-2 text-sm opacity-80">
                    <div className="flex items-center justify-between">
                      <span className="truncate">{g.name}</span>
                      <span className="text-xs opacity-70">{childExists ? "▸" : ""}</span>
                    </div>
                  </div>
                );
              }

              return (
                <Link
                  key={g.id}
                  href={g.path || "#"}
                  className="block rounded px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-800"
                  title={g.path}
                >
                  {g.name}
                </Link>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
