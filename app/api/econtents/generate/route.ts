// app/api/econtents/generate/route.ts
import { NextResponse } from "next/server";

/**
 * eContents 생성 API (MVP)
 * - 클라이언트에서 업로드된 파일(DOCX/PDF)과 템플릿 XLSX를 받아
 * - Protocol/Visit/Form/Navigation 시트를 채운 결과 XLSX를 반환합니다.
 *
 * 주의:
 * - 실제 추출 규칙(섹션 탐지/표 파싱)은 문서마다 다르므로 MVP는 "텍스트 기반"으로 시작합니다.
 * - 고도화 단계에서 Visit/Form을 표 기반으로 정교화합니다.
 */
export async function POST(req: Request) {
  try {
    const formData = await req.formData();

    // 업로드 파일들
    const docxFile = formData.get("docx") as File | null;
    const pdfFile = formData.get("pdf") as File | null;
    const templateXlsx = formData.get("template") as File | null;

    if (!templateXlsx) {
      return NextResponse.json({ ok: false, message: "템플릿 XLSX가 필요합니다." }, { status: 400 });
    }
    if (!docxFile && !pdfFile) {
      return NextResponse.json({ ok: false, message: "DOCX 또는 PDF 중 최소 1개가 필요합니다." }, { status: 400 });
    }

    // 템플릿을 버퍼로 읽기
    const templateBuf = Buffer.from(await templateXlsx.arrayBuffer());

    // 여기서부터 실제 XLSX 채우기 로직이 들어갑니다.
    // MVP: 템플릿 그대로 반환(연결 확인용) + 향후 프로토콜 메타만 채우는 식으로 단계 확장

    // TODO(1단계): XLSX 로드 후 Protocol 시트에 meta 채우기
    // TODO(2단계): Visit/Form/Navigation 자동 생성 및 채우기

    return new NextResponse(templateBuf, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="econtents_generated.xlsx"`,
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, message: err?.message ?? "서버 처리 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
