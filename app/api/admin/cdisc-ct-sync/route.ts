// app/api/admin/cdisc-ct-sync/route.ts
// -------------------------------------------------------------
// 목적: NCI EVS의 CDISC Controlled Terminology(ODM XML) 파일을 직접 받아
//      스트리밍(SAX)으로 파싱하고 Firestore에 청크 단위로 upsert합니다.
// 포인트:
//  - API pagination/limit(500건) 문제 회피 (XML 파일 직접 처리)
//  - 서버리스 타임아웃 회피: maxWrites 만큼만 처리 후 resumeToken 반환
//  - Vercel env의 private key가 줄바꿈/ \n 형태 모두 들어올 수 있어 둘 다 처리
// -------------------------------------------------------------

import { NextResponse } from "next/server";
import { getApps, initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import sax from "sax";
import { Readable } from "stream";

/** ---- NCI EVS CT ODM XML URL 매핑 ---- */
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
  lastCodelistOID?: string;
  lastCodedValue?: string;
};

type Body = {
  type: keyof typeof SOURCE_URLS;
  maxWrites?: number;
  resumeToken?: ResumeToken;
};

function initAdmin() {
  // NOTE: firebase-admin env 3종 필요
  if (getApps().length) return;

  const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;

  // ✅ Vercel UI 붙여넣기 시 줄바꿈이 실제 개행으로 들어오기도 하고,
  //    \n 문자열로 들어오기도 해서 둘 다 대응합니다.
  const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY
    ?.replace(/\\n/g, "\n")
    ?.replace(/\r?\n/g, "\n");

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
  const m = xmlHead.match(/FileOID="[^"]*?(\d{4}-\d{2}-\d{2})[^"]*?"/);
  return m?.[1] ?? null;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;

    const type = body.type;
    const sourceUrl = SOURCE_URLS[type];

    if (!sourceUrl) {
      return NextResponse.json(
        { ok: false, error: "Invalid type" },
        { status: 400 }
      );
    }

    const maxWrites = Math.max(100, Math.min(body.maxWrites ?? 4000, 20000));
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

    // 헤더 일부로 버전 추정
    let xmlHead = "";
    const reader = res.body.getReader();
    const first = await reader.read();
    if (!first.done && first.value) {
      xmlHead = Buffer.from(first.value).toString("utf-8");
    }
    const version = getVersionFromXmlHead(xmlHead);

    // 소비한 첫 chunk 포함해서 node stream 재구성
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

    // 재개 토큰
    let lastCodelistOID: string | undefined;
    let lastCodedValue: string | undefined;

    // resume 처리 플래그
    let started = !resumeToken.lastCodelistOID;
    let passedResumePoint = false;

    // 현재 파싱 상태
    let currentCodelist: { oid?: string; name?: string; dataType?: string } = {};
    let currentTerm: {
      codedValue?: string;
      decode?: string;
      preferredTerm?: string;
      definition?: string;
      ncitCode?: string;
    } = {};

    // 텍스트 수집 대상(ODM XML 구조 상 Decode/TranslatedText 등)
    let textTarget:
      | null
      | "Decode"
      | "PreferredTerm"
      | "Definition"
      | "NCIConceptCode" = null;

    // ✅ xmlns 옵션을 끄고(name을 문자열로) 단순 처리합니다.
    const parser = sax.createStream(true, { trim: true });

    const flush = async () => {
      if (pendingWrites === 0) return;
      await batch.commit();
      batch = db.batch();
      pendingWrites = 0;
    };

    const codelistsCol = db.collection("cdisc_codelists");
    const termsCol = db.collection("cdisc_terms");

    parser.on("opentag", (node: any) => {
      const tagName: string = String(node.name || "");
      const local = tagName.split(":").pop(); // 혹시 prefix가 있어도 대비

      if (local === "CodeList") {
        currentCodelist = {
          oid: node.attributes?.OID,
          name: node.attributes?.Name,
          dataType: node.attributes?.DataType,
        };
        currentTerm = {};
      }

      if (local === "EnumeratedItem" || local === "CodeListItem") {
        currentTerm = {
          codedValue: node.attributes?.CodedValue,
        };
      }

      if (local === "Decode") textTarget = "Decode";
      if (local === "PreferredTerm") textTarget = "PreferredTerm";
      if (local === "CDISCDefinition") textTarget = "Definition";
      if (local === "NCIConceptCode") textTarget = "NCIConceptCode";
    });

    parser.on("text", (txt: string) => {
      if (!textTarget) return;

      if (textTarget === "Decode") {
        currentTerm.decode = (currentTerm.decode ?? "") + txt;
      } else if (textTarget === "PreferredTerm") {
        currentTerm.preferredTerm = (currentTerm.preferredTerm ?? "") + txt;
      } else if (textTarget === "Definition") {
        currentTerm.definition = (currentTerm.definition ?? "") + txt;
      } else if (textTarget === "NCIConceptCode") {
        currentTerm.ncitCode = (currentTerm.ncitCode ?? "") + txt;
      }
    });

    // ✅ closETag는 tagName(string)으로 들어오는 경우가 많아 문자열 처리합니다.
    parser.on("closetag", async (tagName: string) => {
      const local = String(tagName || "").split(":").pop();

      // 텍스트 수집 종료
      if (local === "Decode" && textTarget === "Decode") textTarget = null;
      if (local === "PreferredTerm" && textTarget === "PreferredTerm")
        textTarget = null;
      if (local === "CDISCDefinition" && textTarget === "Definition")
        textTarget = null;
      if (local === "NCIConceptCode" && textTarget === "NCIConceptCode")
        textTarget = null;

      // term 종료 시점 업서트
      if (local === "EnumeratedItem" || local === "CodeListItem") {
        const oid = currentCodelist.oid;
        const codedValue = currentTerm.codedValue;

        if (!oid || !codedValue) return;

        // resume 포인트 통과 전에는 스킵
        if (!started) {
          if (
            oid === resumeToken.lastCodelistOID &&
            codedValue === resumeToken.lastCodedValue
          ) {
            passedResumePoint = true;
            return; // resume 지점 자체는 이미 저장되었다고 보고 스킵
          }
          if (!passedResumePoint) return;
          started = true;
        }

        // maxWrites 도달 시 스트림 종료
        if (totalWrites >= maxWrites) {
          nodeStream.destroy(); // 파싱 종료 유도
          return;
        }

        const codelistDocId = `${type}__${oid}`;
        const termDocId = `${type}__${oid}__${codedValue}`;

        // codelist upsert
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

        // term upsert
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

        // batch 제한(500) 대비 여유 커밋
        if (pendingWrites >= 400) {
          await flush();
        }
      }

      if (local === "CodeList") {
        currentCodelist = {};
        currentTerm = {};
      }
    });

    const parsePromise = new Promise<void>((resolve, reject) => {
      parser.on("end", () => resolve());
      parser.on("error", (e: any) => reject(e));
    });

    nodeStream.pipe(parser);

    try {
      await parsePromise;
    } catch {
      // nodeStream.destroy()로 중단 시 에러로 들어올 수 있어 무시(필요 시 로깅 강화 가능)
    }

    await flush();

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
      // maxWrites 미만이면 "끝까지 간 가능성"이 높습니다.
      done: totalWrites < maxWrites,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}
