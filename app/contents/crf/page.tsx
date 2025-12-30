"use client";

import { useState } from "react";
import * as XLSX from "xlsx";

export default function CRFPage() {
  const [visits, setVisits] = useState<any[]>([]);
  const [pages, setPages] = useState<any[]>([]);
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const upload = async (file: File) => {
    setLoading(true);
    const fd = new FormData();
    fd.append("file", file);

    const res = await fetch("/api/crf/parse", { method: "POST", body: fd });
    const json = await res.json();

    if (json.ok) {
      setVisits(json.visits);
      setPages(json.pages);
      setItems(json.items);
    }
    setLoading(false);
  };

  const downloadExcel = () => {
    const wb = XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(pages),
      "Pages"
    );

    const rows = items.map((i) => {
      const row: any = { Page: pages.find((p) => p.id === i.pageId)?.name, Item: i.nameDisplay };
      visits.forEach((v) => (row[v.labelDisplay] = i.visitMap[v.id] ? "Y" : ""));
      return row;
    });

    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "Items");

    XLSX.writeFile(wb, "CRF.xlsx");
  };

  return (
    <div style={{ padding: 20 }}>
      <h1>CRF Builder</h1>

      <input type="file" accept=".docx" onChange={(e) => e.target.files && upload(e.target.files[0])} />

      {loading && <p>Parsing...</p>}

      {items.length > 0 && (
        <>
          <button onClick={downloadExcel}>Excel 다운로드</button>
          <table border={1} cellPadding={6}>
            <thead>
              <tr>
                <th>Item</th>
                {visits.map((v) => (
                  <th key={v.id}>{v.labelDisplay}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.id}>
                  <td>{i.nameDisplay}</td>
                  {visits.map((v) => (
                    <td key={v.id}>
                      <input
                        type="checkbox"
                        checked={i.visitMap[v.id]}
                        onChange={() =>
                          setItems((prev) =>
                            prev.map((x) =>
                              x.id === i.id
                                ? { ...x, visitMap: { ...x.visitMap, [v.id]: !x.visitMap[v.id] } }
                                : x
                            )
                          )
                        }
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
