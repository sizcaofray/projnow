// next.config.js
// - ✅ sas7bdat/fs-ext(네이티브 .node 포함)가 서버 번들에 들어가면 Webpack이 .node 파일을 파싱하려고 하면서 빌드가 깨집니다.
// - ✅ Next.js의 serverExternalPackages로 해당 패키지들을 "서버 번들링 제외" 처리하여 런타임 require로만 로드되게 합니다.
//   (Server Components / Route Handlers에서 사용되는 의존성은 기본적으로 번들될 수 있음) :contentReference[oaicite:2]{index=2}

/** @type {import('next').NextConfig} */
const nextConfig = {
  // ✅ 서버 번들에서 제외 (런타임에 node_modules에서 require로 로드)
  serverExternalPackages: ["sas7bdat", "fs-ext"],

  // ✅ 추가 안전장치: Webpack 서버 번들 externals로도 확실히 제외
  webpack: (config, { isServer }) => {
    if (isServer) {
      const externalizeNativeDeps = ({ request }, callback) => {
        if (request === "sas7bdat" || request === "fs-ext") {
          // commonjs external 처리
          return callback(null, `commonjs ${request}`);
        }
        return callback();
      };

      // config.externals 형태(배열/함수/기타)에 따라 안전하게 처리
      if (Array.isArray(config.externals)) {
        config.externals.push(externalizeNativeDeps);
      } else if (typeof config.externals === "function") {
        const originalExternals = config.externals;
        config.externals = (ctx, callback) => {
          if (ctx?.request === "sas7bdat" || ctx?.request === "fs-ext") {
            return callback(null, `commonjs ${ctx.request}`);
          }
          return originalExternals(ctx, callback);
        };
      } else {
        config.externals = [config.externals, externalizeNativeDeps].filter(Boolean);
      }
    }

    return config;
  },
};

module.exports = nextConfig;
