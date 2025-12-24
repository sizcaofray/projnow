"use client";

/**
 * components/ContentsMenuLinks.tsx
 * - Firestore menus를 읽어 Sidebar 메뉴를 렌더링합니다.
 * - "기능 페이지가 존재하는(= href/path가 있는) 메뉴"는 leaf로 간주합니다.
 * - 부모(카테고리) 메뉴에 마우스오버 시, 해당 부모의 자식(leaf) 메뉴만 오른쪽 패널로 노출합니다.
 *
 * ⚠️ Firestore 문서 필드명은 프로젝트에 맞게 아래 MenuDoc 타입의 키를 맞춰주세요.
 */

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

// ✅ 프로젝트에 이미 쓰고 있는 firebase export에 맞게 경로/이름만 맞추세요.
// 예: import { db } from "@/lib/firebase/firebase";
import { db } from "@/lib/firebase/firebase";

// ✅ firestore 모듈 사용
import {
  collection,
  onSnapshot,
  orderBy,
  query,
  Timestamp,
} from "firebase/firestore";

/** Firestore menu 문서 타입(필드명 프로젝트에 맞게 조정) */
type MenuDoc = {
  id: string; // 문서 ID
  label: string; // 표시명(한글)
  englishName?: string; // 영문명(변경 불가 정책이면 그냥 표시용)
  parentId?: string | null; // 상위 메뉴 id (최상위는 null/undefined)
  order?: number; // 정렬
  href?: string; // 기능 페이지 경로(leaf)
  path?: string; // 프로젝트에서 path를 쓰면 href 대신 path로 매핑
  isCategory?: boolean; // 카테고리 전용 여부(있으면 더 안정적)
  createdAt?: Timestamp;
};

/** 내부 렌더링용 */
type MenuNode = MenuDoc & {
  parentKey: string; // 정규화된 parentId
  link: string; // 정규화된 링크
  isLeaf: boolean; // 기능 페이지 존재 여부
};

export default function ContentsMenuLinks() {
  // ✅ 메뉴 원본
  const [menus, setMenus] = useState<MenuNode[]>([]);
  // ✅ 현재 hover된 부모 메뉴 id
  const [hoverParentId, setHoverParentId] = useState<string | null>(null);
  // ✅ 패널 유지용(부모/패널 사이 이동 시 깜빡임 방지)
  const closeTimerRef = useRef<number | null>(null);

  useEffect(() => {
    /**
     * Firestore 실시간 구독
     * - 컬렉션 경로는 실제 사용 중인 경로로 맞추세요.
     *   예) "menus" 또는 "appMenus" 등
     */
    const q = query(collection(db, "menus"), orderBy("order", "asc"));

    const unsub = onSnapshot(
      q,
      (snap) => {
        const next: MenuNode[] = snap.docs.map((d) => {
          const data = d.data() as Omit<MenuDoc, "id">;

          // ✅ 프로젝트에서 href / path 중 무엇을 쓰는지에 따라 정규화
          const rawLink = (data.href || (data as any).path || "") as string;

          // ✅ 기능 페이지 존재 여부: link가 있으면 leaf로 간주
          const isLeaf = !!rawLink;

          return {
            id: d.id,
            ...data,
            parentKey: (data.parentId ?? "") as string,
            link: rawLink,
            isLeaf,
          };
        });

        setMenus(next);
      },
      (err) => {
        console.error("menus onSnapshot error:", err);
        setMenus([]);
      }
    );

    return () => unsub();
  }, []);

  /** 최상위(부모) 메뉴: parentId가 비어있는 것들 */
  const topMenus = useMemo(() => {
    return menus
      .filter((m) => !m.parentKey)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }, [menus]);

  /** 부모별 자식 메뉴 그룹핑 */
  const childrenByParent = useMemo(() => {
    const map = new Map<string, MenuNode[]>();
    for (const m of menus) {
      if (!m.parentKey) continue;
      const arr = map.get(m.parentKey) ?? [];
      arr.push(m);
      map.set(m.parentKey, arr);
    }

    // 각 그룹 정렬
    for (const [k, arr] of map.entries()) {
      arr.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      map.set(k, arr);
    }

    return map;
  }, [menus]);

  /** hover된 부모에 대한 "기능(leaf) 메뉴"만 추출 */
  const hoverLeafChildren = useMemo(() => {
    if (!hoverParentId) return [];
    const raw = childrenByParent.get(hoverParentId) ?? [];

    // ✅ 요구사항: "기능페이지가 존재하는 메뉴"만 옆에 보이게
    return raw.filter((c) => c.isLeaf);
  }, [childrenByParent, hoverParentId]);

  /** hover open */
  const openPanel = (parentId: string) => {
    // 기존 닫기 타이머 제거
    if (closeTimerRef.current) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    setHoverParentId(parentId);
  };

  /** hover close (약간 딜레이로 깜빡임 방지) */
  const scheduleClosePanel = () => {
    if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = window.setTimeout(() => {
      setHoverParentId(null);
      closeTimerRef.current = null;
    }, 120);
  };

  return (
    /**
     * ✅ Sidebar 내부에서 relative로 잡아야
     *    오른쪽 "옆 패널"을 absolute로 정확히 붙일 수 있습니다.
     */
    <div className="relative">
      {/* ====== 부모(최상위) 메뉴 ====== */}
      <div className="space-y-1">
        {topMenus.map((m) => {
          // 최상위 자체가 기능 페이지를 가지는 경우도 있을 수 있으므로 처리
          const isTopLeaf = m.isLeaf;

          // hover 시 옆패널을 띄우는 대상은 "카테고리(또는 자식이 있는 부모)" 위주
          const hasChildren = (childrenByParent.get(m.id) ?? []).length > 0;

          // UI 텍스트
          const label = m.label ?? m.englishName ?? "메뉴";

          // ✅ 최상위에 기능 페이지가 있으면 클릭 링크 제공
          if (isTopLeaf) {
            return (
              <Link
                key={m.id}
                href={m.link}
                className="block rounded px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-800"
                title={label}
              >
                {label}
              </Link>
            );
          }

          // ✅ 카테고리(기능 없음): hover 대상
          return (
            <div
              key={m.id}
              onMouseEnter={() => openPanel(m.id)}
              onMouseLeave={scheduleClosePanel}
              className="block rounded px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-800 cursor-default"
              title={label}
            >
              {/* 카테고리 표시 */}
              <div className="flex items-center justify-between">
                <span className="truncate">{label}</span>

                {/* 자식이 있으면 ▶ 표시 */}
                {hasChildren ? (
                  <span className="text-xs text-gray-400 dark:text-gray-500">
                    ▶
                  </span>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      {/* ====== 오른쪽 옆 패널(hover 시) ====== */}
      {hoverParentId && hoverLeafChildren.length > 0 ? (
        <div
          /**
           * ✅ 부모 메뉴 리스트 오른쪽에 붙는 패널
           * - left-full: 부모 컨테이너의 오른쪽 바깥
           * - ml-2: 간격
           */
          className="absolute top-0 left-full ml-2 w-56 rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-lg"
          onMouseEnter={() => {
            // 패널 위에 올라오면 닫기 예약 해제
            if (closeTimerRef.current) {
              window.clearTimeout(closeTimerRef.current);
              closeTimerRef.current = null;
            }
          }}
          onMouseLeave={scheduleClosePanel}
        >
          <div className="p-2 space-y-1">
            {hoverLeafChildren.map((c) => {
              const label = c.label ?? c.englishName ?? "기능";
              return (
                <Link
                  key={c.id}
                  href={c.link}
                  className="block rounded px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-800"
                  title={label}
                >
                  {label}
                </Link>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
