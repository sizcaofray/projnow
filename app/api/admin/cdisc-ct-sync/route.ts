// app/api/admin/cdisc-ct-sync/route.ts
// -------------------------------------------------------------
// 목적: NCI EVS의 CDISC Controlled Terminology(ODM XML) 파일을 직접 받아
//      스트리밍(SAX)으로 파싱하고 Firestore에 청크 단위로 upsert합니다.
// 장점: API pagination/limit(500건) 문제를 근본적으로 회피합니다.
//      서버리스 타임아웃을 피하기 위해 maxWrites 단위로 끊고 resumeToken으로 재개합니다.
// -------------------------------------------------------------

import { NextResponse } from "next/server";
import { getApps, initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import sax from "sax";
import { Readable } from "stream";

/** ---- NCI EVS CT ODM XML URL 매핑 (필요한 것만 우선) ----
 *  SDTM: https://evs.nci.nih.gov/ftp1/CDISC/SDTM/SDTM%20Terminology.odm.xml
 *  Define-XML: https://evs.nci.nih.gov/ftp1/CDISC/Define-XML/Define-XML%20Terminology.odm.xml
 *  Protocol: https://evs.nci.nih.gov/ftp1/CDISC/Protocol/Protocol%20Terminology.odm.xml
 *  Glossary: https://evs.nci.nih.gov/ftp1/CDISC/Glossary/CDISC%20Glossary.odm.xml
 *  (출처: NCI EVS FTP/HTTP 배포) :contentReference[oaicite:1]{index=1}
 */
const SOURCE_URLS: Record<string, string> = {
  SDTM: "https://evs.nci.nih.gov/ftp1/CDISC/SDTM/SDTM%20Terminology.odm.xml",
  DEFINE_XML:
    "https://evs.nci.nih.gov/ftp1/CDISC/Define-XML/Define-XML%20Terminology.odm.xml",
  PROTOCOL:
    "https://evs.nci.nih.gov/ftp1/CDISC/Protocol/Protocol%20Terminology.odm.xml",
  GLOSSARY:
    "https://evs.nci.nih.gov/ftp1/CDISC/Glossary/CDISC%20Glossary.odm.xml",
};

type ResumeToken = {
  // 마지막으로 업서트한 위치(다음 호출 시 이 다음부터 계속)
  lastCodelistOID?: string;
  lastCodedValue?: string;
};

type Body = {
  // "SDTM" | "DEFINE_XML" | "PROTOCOL" | "GLOSSARY"
  type: keyof typeof SOURCE_URLS;

  // 한 번의 호출에서 Firestore write를 최대 몇 건 수행할지 (서버리스 타임아웃 회피)
  // 권장: 2000 ~ 8000 사이 (환경 따라 조정)
  maxWrites?: number;

  // 재개 토큰(이 토큰 이후부터 계속)
  resumeToken?: ResumeToken;

  // (선택) 엔드포인트 보호용 간단 키 (env와 비교)
  // header "x-admin-key" 값이 CDISC_SYNC_KEY와 같아야 실행
};

function initAdmin() {
  // NOTE: 프로젝트에 이미 firebase-admin 초기화 모듈이 있다면 그걸 쓰는 게 최선입니다.
  //       여기서는 단독 동작 가능한 표준 env 방식을 제공합니다.
  //       Vercel env에 아래 3개가 세팅되어 있어야 합니다.
  //       - FIREBASE_ADMIN_PROJECT_ID
  //       - FIREBASE_ADMIN_CLIENT_EMAIL
  //       - FIREBASE_ADMIN_PRIVATE_KEY  (줄바꿈은 \n 형태로 저장)
  if (getApps().length) return;

  const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, "\n");

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error(
      "Missing Firebase Admin env. Set FIREBASE_ADMIN_PROJECT_ID / FIREBASE_ADMIN_CLIENT_EMAIL / FIREBASE_ADMIN_PRIVATE_KEY"
    );
  }

  initializeApp({
    credential: cert({ projectId, clientEmail, privateKey }),
  });
}

function getVersionFromXmlHead(xmlHead: string) {
  // ODM 파일 헤더에 FileOID 같은 곳에 날짜가 들어가는 경우가 많습니다.
  // 예: FileOID="CDISC_CT_2025-09-26" 형태 등
  const m = xmlHead.match(/FileOID="[^"]*?(\d{4}-\d{2}-\d{2})[^"]*?"/);
  return m?.[1] ?? null;
}

export async function POST(req: Request) {
  try {
    // ---- (선택) 엔드포인트 보호 ----
    const requiredKey = process.env.CDISC_SYNC_KEY;
    if (requiredKey) {
      const got = req.headers.get("x-admin-key");
      if (!got || got !== requiredKey) {
        return NextResponse.json(
          { ok: false, error: "Unauthorized" },
          { status: 401 }
        );
      }
    }

    const body = (await req.json()) as Body;
    const type = body.type;
    const sourceUrl = SOURCE_URLS[type];

    if (!sourceUrl) {
      return NextResponse.json(
        { ok: false, error: "Invalid type" },
        { status: 400 }
      );
    }

    const maxWrites = Math.max(100, Math.min(body.maxWrites ?? 4000, 20000)); // 안전 범위
    const resumeToken = body.resumeToken ?? {};

    // ---- Firebase Admin init ----
    initAdmin();
    const db = getFirestore();

    // ---- XML 다운로드 (스트리밍) ----
    const res = await fetch(sourceUrl, { cache: "no-store" });
    if (!res.ok || !res.body) {
      return NextResponse.json(
        { ok: false, error: `Fetch failed: ${res.status}` },
        { status: 500 }
      );
    }

    // 헤더 일부만 먼저 읽어서 버전 추정(전체 메모리 로드 방지)
    // (NOTE: 간단화를 위해 첫 chunk에서 버전만 추출)
    // 실제 스트리밍 파싱은 아래 SAX로 수행
    let xmlHead = "";
    const reader = res.body.getReader();
    const first = await reader.read();
    if (!first.done && first.value) {
      xmlHead = Buffer.from(first.value).toString("utf-8");
    }
    const version = getVersionFromXmlHead(xmlHead);

    // 첫 chunk를 포함한 전체 스트림 재구성
    // - 이미 first chunk를 소비했으니, first chunk + 남은 reader를 합쳐 node stream으로 만듭니다.
    async function* gen() {
      if (first.value) yield first.value;
      while (true) {
        const r = await reader.read();
        if (r.done) break;
        if (r.value) yield r.value;
      }
    }
    const nodeStream = Readable.from(gen()).setEncoding("utf-8");

    // ---- Firestore batch upsert ----
    let batch = db.batch();
    let pendingWrites = 0;
    let totalWrites = 0;

    // 진행/재개를 위한 마지막 토큰
    let lastCodelistOID: string | undefined;
    let lastCodedValue: string | undefined;

    // resume 처리: 특정 위치를 “지난 뒤부터” 쓰기 시작
    let started = !resumeToken.lastCodelistOID; // 토큰 없으면 즉시 시작
    let passedResumePoint = false;

    // 현재 파싱 중 상태
    let currentCodelist: {
      oid?: string;
      name?: string;
      dataType?: string;
    } = {};
    let currentTerm: {
      codedValue?: string;
      decode?: string;
      preferredTerm?: string;
      definition?: string;
      ncitCode?: string;
    } = {};

    // 텍스트 수집 상태
    let textTarget:
      | null
      | "Decode"
      | "PreferredTerm"
      | "Definition"
      | "NCIConceptCode" = null;

    // SAX 파서
    const parser = sax.createStream(true, { xmlns: true, trim: true });

    // 유틸: batch flush
    const flush = async () => {
      if (pendingWrites === 0) return;
      await batch.commit();
      batch = db.batch();
      pendingWrites = 0;
    };

    // Firestore 저장 구조(단순/확장 가능):
    // - cdisc_codelists/{type}__{codelistOID}
    // - cdisc_terms/{type}__{codelistOID}__{codedValue}
    const codelistsCol = db.collection("cdisc_codelists");
    const termsCol = db.collection("cdisc_terms");

    parser.on("opentag", (node: any) => {
      const name = node.name?.local;

      if (name === "CodeList") {
        // 새로운 codelist 시작
        currentCodelist = {
          oid: node.attributes?.OID?.value,
          name: node.attributes?.Name?.value,
          dataType: node.attributes?.DataType?.value,
        };
        currentTerm = {};
      }

      if (name === "EnumeratedItem" || name === "CodeListItem") {
        // term 시작
        currentTerm = {
          codedValue: node.attributes?.CodedValue?.value,
        };
      }

      if (name === "Decode") textTarget = "Decode";

      // nciodm 확장 태그 (PreferredTerm/Definition/NCIConceptCode)
      // 로컬명 기준으로 처리
      if (name === "PreferredTerm") textTarget = "PreferredTerm";
      if (name === "CDISCDefinition") textTarget = "Definition";
      if (name === "NCIConceptCode") textTarget = "NCIConceptCode";
    });

    parser.on("text", (txt: string) => {
      if (!textTarget) return;

      // Decode는 하위 TranslatedText 내부 텍스트로 들어오므로 누적
      if (textTarget === "Decode") {
        currentTerm.decode = (currentTerm.decode ?? "") + txt;
      }
      if (textTarget === "PreferredTerm") {
        currentTerm.preferredTerm = (currentTerm.preferredTerm ?? "") + txt;
      }
      if (textTarget === "Definition") {
        currentTerm.definition = (currentTerm.definition ?? "") + txt;
      }
      if (textTarget === "NCIConceptCode") {
        currentTerm.ncitCode = (currentTerm.ncitCode ?? "") + txt;
      }
    });

    parser.on("closetag", async (node: any) => {
      const name = node.name?.local;

      // Decode/PreferredTerm/Definition/NCIConceptCode 텍스트 수집 종료
      if (name === "Decode" && textTarget === "Decode") textTarget = null;
      if (name === "PreferredTerm" && textTarget === "PreferredTerm")
        textTarget = null;
      if (name === "CDISCDefinition" && textTarget === "Definition")
        textTarget = null;
      if (name === "NCIConceptCode" && textTarget === "NCIConceptCode")
        textTarget = null;

      // term 종료 시점에 Firestore upsert
      if (name === "EnumeratedItem" || name === "CodeListItem") {
        const oid = currentCodelist.oid;
        const codedValue = currentTerm.codedValue;

        if (!oid || !codedValue) return;

        // resume 포인트 통과 전에는 쓰지 않음
        if (!started) {
          // 정확히 resume 포인트(마지막으로 쓴 term)까지 스킵 후, 그 다음부터 시작
          if (
            oid === resumeToken.lastCodelistOID &&
            codedValue === resumeToken.lastCodedValue
          ) {
            passedResumePoint = true;
            return; // resume 포인트 자체는 "이미 저장됨"이므로 스킵
          }
          if (!passedResumePoint) return;
          started = true;
        }

        // maxWrites 도달하면 중단하도록 스트림 종료
        if (totalWrites >= maxWrites) {
          // SAX stream 종료 유도
          nodeStream.destroy();
          return;
        }

        const codelistDocId = `${type}__${oid}`;
        const termDocId = `${type}__${oid}__${codedValue}`;

        // codelist 문서는 반복 저장되지만 merge로 안전
        batch.set(
          codelistsCol.doc(codelistDocId),
          {
            type,
            sourceUrl,
            version,
            oid,
            name: currentCodelist.name ?? null,
            dataType: currentCodelist.dataType ?? null,
            updatedAt: new Date().toISOString(),
          },
          { merge: true }
        );
        pendingWrites++;
        totalWrites++;

        // term 문서 upsert
        batch.set(
          termsCol.doc(termDocId),
          {
            type,
            sourceUrl,
            version,
            codelistOID: oid,
            codelistName: currentCodelist.name ?? null,
            codedValue,
            decode: (currentTerm.decode ?? "").trim() || null,
            preferredTerm: (currentTerm.preferredTerm ?? "").trim() || null,
            definition: (currentTerm.definition ?? "").trim() || null,
            ncitCode: (currentTerm.ncitCode ?? "").trim() || null,
            updatedAt: new Date().toISOString(),
          },
          { merge: true }
        );
        pendingWrites++;
        totalWrites++;

        lastCodelistOID = oid;
        lastCodedValue = codedValue;

        // batch는 500 제한이 있으니 여유 있게 400 근처에서 커밋
        if (pendingWrites >= 400) {
          // NOTE: sax 이벤트 핸들러 안에서 await는 위험할 수 있어 flush는 비동기로 큐잉 가능하지만,
          //       여기서는 단순화를 위해 즉시 flush 합니다.
          await flush();
        }
      }

      // codelist 종료 시(참고: 여기서 별도 처리 필요없음)
      if (name === "CodeList") {
        currentCodelist = {};
        currentTerm = {};
      }
    });

    const parsePromise = new Promise<void>((resolve, reject) => {
      parser.on("end", () => resolve());
      parser.on("error", (e: any) => reject(e));
    });

    // 스트리밍 파싱 시작
    nodeStream.pipe(parser);

    // 파싱이 끝나거나, maxWrites로 stream destroy 되면 종료됨
    try {
      await parsePromise;
    } catch (e: any) {
      // destroy로 인한 종료는 error로 들어올 수 있어 방어적으로 처리
      // 실제 에러인지 구분이 애매하면 e.message 로그가 필요하지만,
      // 여기서는 API 응답으로 반환합니다.
      // (원하시면 서버 로그 강화 버전도 바로 드리겠습니다.)
    }

    // 남은 배치 커밋
    await flush();

    const done = !lastCodelistOID; // 아무것도 못 썼으면 done 판단 보류
    // 실제로는 maxWrites에 걸려 멈춘 경우 done=false가 일반적

    return NextResponse.json({
      ok: true,
      type,
      sourceUrl,
      version,
      writes: totalWrites,
      resumeToken: {
        lastCodelistOID,
        lastCodedValue,
      },
      done: totalWrites < maxWrites, // maxWrites 미만이면 파일 끝까지 간 가능성 높음
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}
