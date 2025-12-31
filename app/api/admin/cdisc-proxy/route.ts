// app/api/admin/cdisc-proxy/route.ts
// ✅ CDISC Library API 프록시 (서버 전용)
// - CDISC API Key를 서버 env에만 저장하고, 클라이언트에는 노출하지 않습니다.
// - 클라이언트는 이 엔드포인트로 원하는 CDISC 경로(/mdr/...)를 요청합니다.
// - (권장) Firebase Admin으로 ID Token 검증하여 관리자만 호출 가능하게 막습니다.

import { NextResponse } from "next/server";

// (권장) firebase-admin로 토큰 검증 (사용 시: npm i firebase-admin 필요)
let adminAuth: any = null;

async function getAdminAuth() {
  // 이미 로드되어 있으면 재사용
  if (adminAuth) return adminAuth;

  // firebase-admin을 쓰지 않으면 여기서 null 반환 (프록시는 동작하지만 보호는 약해짐)
  // - 보호까지 하려면 아래 주석을 풀고 firebase-admin 설치 + env 세팅하세요.
  try {
    const admin = await import("firebase-admin");
    const adminApp = await import("firebase-admin/app");
    const adminAuthModule = await import("firebase-admin/auth");

    // 중복 초기화 방지
    if (!adminApp.getApps().length) {
      const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID;
      const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
      const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, "\n");

      // ✅ 서비스 계정 env가 없으면 보호 비활성(동작은 가능)
      if (!projectId || !clientEmail || !privateKey) {
        return null;
      }

      adminApp.initializeApp({
        credential: admin.credential.cert({
          projectId,
          clientEmail,
          privateKey,
        }),
      });
    }

    adminAuth = adminAuthModule.getAuth();
    return adminAuth;
  } catch {
    // firebase-admin 미설치/로드 실패 시: 보호 비활성
    return null;
  }
}

// ✅ POST만 사용 (클라이언트에서 path를 body로 전달)
export async function POST(req: Request) {
  try {
    // -----------------------------
    // 0) (권장) 관리자 인증: Firebase ID Token 검증
    // -----------------------------
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

    const auth = await getAdminAuth();
    if (auth) {
      if (!token) {
        return NextResponse.json({ message: "Missing Authorization token" }, { status: 401 });
      }

      // 토큰 검증
      const decoded = await auth.verifyIdToken(token);

      // ✅ admin claim이 없더라도, Firestore의 users/{uid}.role == 'admin' 방식이면
      // 여기서까지 DB 조회를 해야 하지만, route에서 Firestore Admin 접근까지 넣으면 커집니다.
      // 1차 방어로 "admin claim"만 체크하거나,
      // (권장) claim을 세팅하는 방식으로 운영하세요.
      if (!decoded?.admin) {
        return NextResponse.json({ message: "Not an admin" }, { status: 403 });
      }
    }
    // auth가 null이면 보호 비활성(동작은 가능)

    // -----------------------------
    // 1) 요청 바디 파싱
    // -----------------------------
    const body = (await req.json()) as {
      path: string; // 예: "/mdr/products" 또는 "/mdr/products/Terminology"
      accept?: "application/json" | "application/xml";
    };

    const path = body?.path?.trim();
    const accept = body?.accept || "application/json";

    if (!path || !path.startsWith("/mdr/")) {
      return NextResponse.json(
        { message: "Invalid path. path must start with /mdr/ ..." },
        { status: 400 }
      );
    }

    // -----------------------------
    // 2) CDISC 호출 (서버 env 키 사용)
    // -----------------------------
    const apiKey = process.env.CDISC_LIBRARY_API_KEY;
    const baseUrl = process.env.CDISC_LIBRARY_BASE_URL || "https://library.cdisc.org/api";

    if (!apiKey) {
      return NextResponse.json(
        { message: "Missing CDISC_LIBRARY_API_KEY in server env" },
        { status: 500 }
      );
    }

    const url = `${baseUrl}${path}`;

    const res = await fetch(url, {
      method: "GET",
      headers: {
        // ✅ CDISC Library 인증 헤더 (api-key)
        "api-key": apiKey,
        Accept: accept,
      },
      // 캐시 정책(표준 갱신 기능이므로 기본적으로 no-store 권장)
      cache: "no-store",
    });

    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json(
        {
          message: "CDISC request failed",
          status: res.status,
          detail: text?.slice(0, 2000),
          url,
        },
        { status: 502 }
      );
    }

    // -----------------------------
    // 3) 응답 반환 (JSON 기본)
    // -----------------------------
    if (accept === "application/xml") {
      const xml = await res.text();
      return new NextResponse(xml, {
        status: 200,
        headers: { "Content-Type": "application/xml; charset=utf-8" },
      });
    }

    const json = await res.json();
    return NextResponse.json({ url, data: json }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json(
      { message: "Unexpected error", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}
