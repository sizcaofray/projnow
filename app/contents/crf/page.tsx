"use client";

import React, { useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";

/**
 * 서버 응답과 동일한 형태의 타입(주석 포함)
 */
type Visit = {
  id: string;
  labelOriginal: string;
  labelDisplay: string;
  orderKey: number;
};

type Page = {
  id: string;
  name: string;
};

type Item = {
  id: string;
  nameOriginal: string;
  nameDisplay: string;
  pageId: string;
  evidence?: string;
  visitMap: Record<string, boolean>;
};

type ParseResponse = {
  ok: boolean;
  fileName?: string;
  visits?: Visit[];
  pages?: Page[];
  items?: Item[];
  warnings?: string[];
  message?: string;
};

function downloadBlob(filename: string, blob: Blob) {
  // 브라우저 기본 다운로드
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function CRFPage() {
  const inputRef = useRef<HTMLInputElement | null>(null);

  const [loading, setLoading] = useState(false);
  const [fileName, setFileName] = useState<string>("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState<string>("");

  const [visits, setVisits] = useState<Visit[]>([]);
  const [pages, setPages] = useState<Page[]>([]);
  const [items, setItems] = useState<Item[]>([]);

  // 드래그 UI 상태
  const [isDragging, setIsDragging] = useState(false);

  // Visit 정렬(표시용)
  const sortedVisits = useMemo(() => {
    return [...visits].sort((a, b) => a.orderKey - b.orderKey);
  }, [visits]);

  /**
   * 업로드/파싱
   */
  const handleUpload = async (file: File) => {
    // docx만 허용 (최소 안전장치)
    if (!/\.docx$/i.test(file.name)) {
      setError("docx 파일만 업로드할 수 있습니다.");
      return;
    }

    setLoading(true);
    setError("");
    setWarnings([]);

    try {
      const form = new FormData();
      form.append("file", file);

      const res = await fetch("/api/crf/parse", {
        method: "POST",
        body: form,
      });

      const data = (await res.json()) as ParseResponse;

      if (!data.ok) {
        setError(data.message || "Parse failed.");
        return;
      }

      setFileName(data.fileName || file.name);
      setVisits(data.visits || []);
      setPages(data.pages || []);
      setItems(data.items || []);
      setWarnings(data.warnings || []);
    } catch (e: any) {
      setError(e?.message || "Upload failed.");
    } finally {
      setLoading(false);
    }
  };

  /**
   * Drag & Drop 이벤트
   */
  const onDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const onDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const f = e.dataTransfer.files?.[0];
    if (f) handleUpload(f);
  };

  /**
   * Visit 라벨 수정
   */
  const updateVisitLabel = (visitId: string, labelDisplay: string) => {
    setVisits((prev) => prev.map((v) => (v.id === visitId ? { ...v, labelDisplay } : v)));
  };

  /**
   * Page 추가/수정/삭제
   */
  const addPage = () => {
    setPages((prev) => [
      ...prev,
      { id: `p_${prev.length + 1}_${Date.now()}`, name: `New Page ${prev.length + 1}` },
    ]);
  };

  const updatePageName = (pageId: string, name: string) => {
    setPages((prev) => prev.map((p) => (p.id === pageId ? { ...p, name } : p)));
  };

  const removePage = (pageId: string) => {
    // 삭제될 페이지의 아이템은 General로 이동 (General 없으면 생성)
    const general = pages.find((p) => p.name === "General") || null;
    const fallbackId = general?.id || `p_general_${Date.now()}`;

    if (!general) {
      setPages((pPrev) => [...pPrev, { id: fallbackId, name: "General" }]);
    }

    setPages((prev) => prev.filter((p) => p.id !== pageId));
    setItems((prev) => prev.map((it) => (it.pageId === pageId ? { ...it, pageId: fallbackId } : it)));
  };

  /**
   * Item 편집
   */
  const updateItemName = (itemId: string, nameDisplay: string) => {
    setItems((prev) => prev.map((it) => (it.id === itemId ? { ...it, nameDisplay } : it)));
  };

  const updateItemPage = (itemId: string, pageId: string) => {
    setItems((prev) => prev.map((it) => (it.id === itemId ? { ...it, pageId } : it)));
  };

  const toggleItemVisit = (itemId: string, visitId: string) => {
    setItems((prev) =>
      prev.map((it) => {
        if (it.id !== itemId) return it;
        const current = !!it.visitMap?.[visitId];
        return { ...it, visitMap: { ...it.visitMap, [visitId]: !current } };
      })
    );
  };

  const addItem = () => {
    const defaultPageId = pages[0]?.id || `p_general_${Date.now()}`;
    if (!pages[0]) setPages((prev) => [...prev, { id: defaultPageId, name: "General" }]);

    const visitMap: Record<string, boolean> = {};
    for (const v of sortedVisits) visitMap[v.id] = false;

    setItems((prev) => [
      ...prev,
      {
        id: `i_${prev.length + 1}_${Date.now()}`,
        nameOriginal: "",
        nameDisplay: "New Item",
        pageId: defaultPageId,
        evidence: "",
        visitMap,
      },
    ]);
  };

  const removeItem = (itemId: string) => setItems((prev) => prev.filter((it) => it.id !== itemId));

  /**
   * Excel 다운로드
   */
  const downloadExcel = () => {
    const wb = XLSX.utils.book_new();

    // Pages 시트
    const pagesRows = pages.map((p, idx) => ({
      ORDER: idx + 1,
      PAGE_ID: p.id,
      PAGE_NAME: p.name,
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(pagesRows), "Pages");

    // Items 시트(동적 Visit 컬럼)
    const visitCols = sortedVisits.map((v) => v.labelDisplay || v.labelOriginal || v.id);

    const itemsRows = items.map((it) => {
      const pageName = pages.find((p) => p.id === it.pageId)?.name || "";
      const row: Record<string, any> = {
        ITEM_ID: it.id,
        PAGE_NAME: pageName,
        ITEM_NAME: it.nameDisplay,
        EVIDENCE: it.evidence || "",
      };

      sortedVisits.forEach((v, idx) => {
        const colName = visitCols[idx] || v.id;
        row[colName] = it.visitMap?.[v.id] ? "Y" : "";
      });

      return row;
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(itemsRows), "Items");

    const out = XLSX.write(wb, { type: "array", bookType: "xlsx" });
    const blob = new Blob([out], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });

    const base = fileName ? fileName.replace(/\.(docx|doc)$/i, "") : "protocol";
    downloadBlob(`${base}_CRF.xlsx`, blob);
  };

  /**
   * 최소 스타일(인라인)
   */
  const cardStyle: React.CSSProperties = {
    border: "1px solid rgba(0,0,0,0.12)",
    borderRadius: 12,
    padding: 14,
    background: "rgba(255,255,255,0.75)",
    backdropFilter: "blur(6px)",
  };

  const btnStyle: React.CSSProperties = {
    padding: "8px 12px",
    borderRadius: 10,
    border: "1px solid rgba(0,0,0,0.18)",
    background: "white",
    cursor: "pointer",
    fontWeight: 600,
  };

  const subtleText: React.CSSProperties = { fontSize: 12, opacity: 0.75 };

  /**
   * 섹션 헤더(좌: 제목 / 우: 버튼) 공통 UI
   */
  const SectionHeader = ({
    title,
    right,
  }: {
    title: string;
    right?: React.ReactNode;
  }) => (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 10 }}>
      <div style={{ fontWeight: 800 }}>{title}</div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>{right}</div>
    </div>
  );

  return (
    <div style={{ padding: 18, maxWidth: 1300, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 12 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>CRF Builder</h1>
        <span style={subtleText}>/contents/crf</span>
      </div>

      {/* 업로드 카드 */}
      <div style={{ ...cardStyle, marginBottom: 14 }}>
        <SectionHeader
          title="Protocol 업로드"
          right={
            <>
              <input
                ref={inputRef}
                type="file"
                accept=".docx"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleUpload(f);
                }}
                style={{ display: "none" }}
              />

              <button type="button" style={btnStyle} onClick={() => inputRef.current?.click()} disabled={loading}>
                파일 선택
              </button>

              <button
                type="button"
                style={{
                  ...btnStyle,
                  opacity: items.length === 0 || visits.length === 0 ? 0.5 : 1,
                  cursor: items.length === 0 || visits.length === 0 ? "not-allowed" : "pointer",
                }}
                onClick={downloadExcel}
                disabled={items.length === 0 || visits.length === 0}
              >
                Excel 다운로드
              </button>
            </>
          }
        />

        <div style={subtleText}>
          docx 파일을 드래그&드롭하거나 파일 선택으로 업로드하세요. (형식이 달라도 자동 추출 후 수정 가능)
        </div>

        {fileName && (
          <div style={{ marginTop: 8, ...subtleText }}>
            현재 파일: <b style={{ opacity: 0.95 }}>{fileName}</b>
          </div>
        )}

        {/* Dropzone */}
        <div
          onDragEnter={onDragEnter}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
          role="button"
          tabIndex={0}
          style={{
            marginTop: 14,
            borderRadius: 14,
            border: isDragging ? "2px dashed #111" : "2px dashed rgba(0,0,0,0.25)",
            background: isDragging ? "rgba(0,0,0,0.04)" : "rgba(0,0,0,0.02)",
            padding: 18,
            textAlign: "center",
            cursor: "pointer",
            transition: "all 120ms ease",
            userSelect: "none",
          }}
        >
          <div style={{ fontWeight: 800, fontSize: 14 }}>
            {loading ? "파싱 중입니다..." : "여기에 Protocol(.docx)을 드래그&드롭"}
          </div>
          <div style={{ ...subtleText, marginTop: 6 }}>클릭해도 파일 선택창이 열립니다.</div>
        </div>

        {/* 에러/경고 */}
        {error && (
          <div style={{ marginTop: 12, color: "crimson", fontWeight: 700 }}>
            오류: <span style={{ fontWeight: 500 }}>{error}</span>
          </div>
        )}

        {warnings.length > 0 && (
          <div style={{ marginTop: 12, color: "#a36a00" }}>
            <div style={{ fontWeight: 800 }}>경고</div>
            <ul style={{ margin: "6px 0 0 18px" }}>
              {warnings.map((w, idx) => (
                <li key={idx} style={{ fontSize: 13 }}>
                  {w}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Visits 편집 */}
      {visits.length > 0 && (
        <div style={{ ...cardStyle, marginBottom: 14 }}>
          <SectionHeader title="Visits (방문)" />
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
            {sortedVisits.map((v) => (
              <div
                key={v.id}
                style={{
                  border: "1px solid rgba(0,0,0,0.12)",
                  borderRadius: 12,
                  padding: 10,
                  minWidth: 200,
                  background: "rgba(255,255,255,0.65)",
                }}
              >
                <div style={{ fontSize: 11, opacity: 0.75, marginBottom: 6 }}>ID: {v.id}</div>
                <input
                  value={v.labelDisplay}
                  onChange={(e) => updateVisitLabel(v.id, e.target.value)}
                  style={{
                    width: "100%",
                    padding: "8px 10px",
                    borderRadius: 10,
                    border: "1px solid rgba(0,0,0,0.18)",
                  }}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Pages 편집 */}
      {pages.length > 0 && (
        <div style={{ ...cardStyle, marginBottom: 14 }}>
          <SectionHeader
            title="Pages (CRF 페이지 그룹)"
            right={
              <button type="button" style={btnStyle} onClick={addPage} disabled={loading}>
                + 페이지 추가
              </button>
            }
          />

          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 640 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left", padding: 10, borderBottom: "1px solid rgba(0,0,0,0.12)" }}>
                    Page Name
                  </th>
                  <th style={{ width: 120, padding: 10, borderBottom: "1px solid rgba(0,0,0,0.12)" }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {pages.map((p) => (
                  <tr key={p.id}>
                    <td style={{ padding: 10, borderBottom: "1px solid rgba(0,0,0,0.08)" }}>
                      <input
                        value={p.name}
                        onChange={(e) => updatePageName(p.id, e.target.value)}
                        style={{
                          width: "100%",
                          padding: "8px 10px",
                          borderRadius: 10,
                          border: "1px solid rgba(0,0,0,0.18)",
                        }}
                      />
                      <div style={{ fontSize: 11, opacity: 0.6, marginTop: 4 }}>ID: {p.id}</div>
                    </td>
                    <td style={{ padding: 10, textAlign: "center", borderBottom: "1px solid rgba(0,0,0,0.08)" }}>
                      <button type="button" onClick={() => removePage(p.id)} style={{ ...btnStyle, padding: "6px 10px" }}>
                        삭제
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ ...subtleText, marginTop: 8 }}>
            ※ 페이지 삭제 시 해당 항목은 자동으로 <b>General</b>로 이동됩니다.
          </div>
        </div>
      )}

      {/* Items */}
      {items.length > 0 && visits.length > 0 && (
        <div style={{ ...cardStyle }}>
          <SectionHeader
            title="Items (수집 항목 × 방문 매핑)"
            right={
              <button type="button" style={btnStyle} onClick={addItem} disabled={loading}>
                + 항목 추가
              </button>
            }
          />

          <div style={{ overflowX: "auto", border: "1px solid rgba(0,0,0,0.10)", borderRadius: 12 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 980 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left", padding: 10, borderBottom: "1px solid rgba(0,0,0,0.12)" }}>
                    Item Name
                  </th>
                  <th style={{ textAlign: "left", padding: 10, borderBottom: "1px solid rgba(0,0,0,0.12)" }}>
                    Page
                  </th>
                  {sortedVisits.map((v) => (
                    <th key={v.id} style={{ padding: 10, borderBottom: "1px solid rgba(0,0,0,0.12)" }}>
                      {v.labelDisplay}
                    </th>
                  ))}
                  <th style={{ width: 80, padding: 10, borderBottom: "1px solid rgba(0,0,0,0.12)" }}>Del</th>
                </tr>
              </thead>

              <tbody>
                {items.map((it) => (
                  <tr key={it.id}>
                    <td style={{ padding: 10, borderBottom: "1px solid rgba(0,0,0,0.08)" }}>
                      <input
                        value={it.nameDisplay}
                        onChange={(e) => updateItemName(it.id, e.target.value)}
                        style={{
                          width: "100%",
                          padding: "8px 10px",
                          borderRadius: 10,
                          border: "1px solid rgba(0,0,0,0.18)",
                        }}
                      />
                      {it.evidence && (
                        <div style={{ fontSize: 11, opacity: 0.6, marginTop: 6, lineHeight: 1.3 }}>
                          {it.evidence}
                        </div>
                      )}
                    </td>

                    <td style={{ padding: 10, borderBottom: "1px solid rgba(0,0,0,0.08)" }}>
                      <select
                        value={it.pageId}
                        onChange={(e) => updateItemPage(it.id, e.target.value)}
                        style={{
                          width: "100%",
                          padding: "8px 10px",
                          borderRadius: 10,
                          border: "1px solid rgba(0,0,0,0.18)",
                          background: "white",
                        }}
                      >
                        {pages.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </td>

                    {sortedVisits.map((v) => (
                      <td
                        key={v.id}
                        style={{
                          padding: 10,
                          textAlign: "center",
                          borderBottom: "1px solid rgba(0,0,0,0.08)",
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={!!it.visitMap?.[v.id]}
                          onChange={() => toggleItemVisit(it.id, v.id)}
                          style={{ width: 16, height: 16 }}
                        />
                      </td>
                    ))}

                    <td style={{ padding: 10, textAlign: "center", borderBottom: "1px solid rgba(0,0,0,0.08)" }}>
                      <button type="button" onClick={() => removeItem(it.id)} style={{ ...btnStyle, padding: "6px 10px" }}>
                        X
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ ...subtleText, marginTop: 10 }}>
            ※ 자동 추출은 문서마다 오차가 있을 수 있습니다. 여기서 수정 후 Excel로 내려받으시면 됩니다.
          </div>
        </div>
      )}
    </div>
  );
}
