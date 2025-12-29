// app/api/econtents/generate/route.ts

import { NextResponse } from "next/server";
import path from "path";
import fs from "fs/promises";
import * as ExcelJS from "exceljs"; // ✅ default import 금지
import mammoth from "mammoth";

export const runtime = "nodejs";

/**
 * DOCX 텍스트 추출
 */
async function extractTextFromDocx(buffer: Buffer): Promise<string> {
  const result = await mammoth.extractRawText({ buffer });
  return result.value ?? "";
}

/**
 * Protocol 문서에서 핵심 정보 추출
 */
function parseProtocolInfo(text: string) {
  // Study No (DW_DWPxxxxxxxx)
  const studyNo =
    text.match(/DW[_-]DWP\d{8}/)?.[0] ?? "";

  // Sponsor
  const sponsor =
    text.match(/의뢰자\s*[:\-]?\s*(.+)/)?.[1]?.split("\n")[0]?.trim() ??
    text.match(/Sponsor\s*[:\-]?\s*(.+)/i)?.[1]?.split("\n")[0]?.trim() ??
    "";

  // Study Title
  const title =
    text.match(/임상시험\s*제목\s*[:\-]?\s*(.+)/)?.[1]?.split("\n")[0]?.trim() ??
    text.match(/Study\s*Title\s*[:\-]?\s*(.+)/i)?.[1]?.split("\n")[0]?.trim() ??
    "";

  return { studyNo, sponsor, title };
}

/**
 * Protocol 시트 채우기 (라벨 기반)
 */
function fillProtocolSheet(
  ws: ExcelJS.Worksheet,
  info: { studyNo: string; sponsor: string; title: string }
) {
  const map: Record<string, string> = {
    "Study No": info.studyNo,
    "Study Title": info.title,
    "Sponsor": info.sponsor,
  };

  ws.eachRow((row) => {
    const label = String(row.getCell(1).value ?? "").trim();
    if (label && map[label]) {
      row.getCell(2).value = map[label];
    }
  });
}

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const file = formData.get("docx") as File | null;

    if (!file) {
      return NextResponse.json(
        { message: "Protocol DOCX 파일이 필요합니다." },
        { status: 400 }
      );
    }

    if (!file.name.toLowerCase().endsWith(".docx")) {
      return NextResponse.json(
        { message: "현재 DOCX 형식만 지원합니다." },
        { status: 400 }
      );
    }

    // DOCX → 텍스트
    const buffer = Buffer.from(await file.arrayBuffer());
    const text = await extractTextFromDocx(buffer);

    const info = parseProtocolInfo(text);

    if (!info.studyNo) {
      return NextResponse.json(
        {
          message:
            "Study No(DW_DWPxxxxxxxx)를 문서에서 찾지 못했습니다.",
        },
        { status: 422 }
      );
    }

    // 고정 템플릿 로드
    const templatePath = path.join(
      process.cwd(),
      "public",
      "templates",
      "econtents_template.xlsx"
    );

    const templateBuffer = await fs.readFile(templatePath);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(templateBuffer);

    // Protocol 시트
    const protocolWs = workbook.getWorksheet("Protocol");
    if (!protocolWs) {
      throw new Error("Protocol 시트를 찾을 수 없습니다.");
    }

    fillProtocolSheet(protocolWs, info);

    // XLSX 생성
    const outBuffer = await workbook.xlsx.writeBuffer();

    const filename = `${info.studyNo}_eCRF_contents.xlsx`;

    return new NextResponse(outBuffer, {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${encodeURIComponent(
          filename
        )}"`,
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      { message: err?.message ?? "서버 오류" },
      { status: 500 }
    );
  }
}
