import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const htmlFiles = readdirSync(root).filter(file => file.endsWith(".html"));
const errors = [];

for (const file of htmlFiles) {
  const html = readFileSync(resolve(root, file), "utf8");
  if (/file:\/\//i.test(html)) errors.push(`${file}: file:// 링크를 사용할 수 없습니다.`);

  for (const match of html.matchAll(/<(?:a|link|script|img)\b[^>]*?\b(?:href|src)=["']([^"']+)["'][^>]*>/gi)) {
    const value = match[1];
    if (/^(?:https?:|mailto:|tel:|data:|javascript:|#)/i.test(value)) continue;
    const [pathPart, fragment] = value.split("#", 2);
    const cleanPath = decodeURIComponent(pathPart.split("?", 1)[0] || file);
    const target = resolve(root, cleanPath.replace(/^\.\//, ""));
    if (!existsSync(target)) {
      errors.push(`${file}: ${value} 대상 파일이 없습니다.`);
      continue;
    }
    if (fragment && target.endsWith(".html")) {
      const targetHtml = readFileSync(target, "utf8");
      if (!new RegExp(`\\bid=["']${fragment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`).test(targetHtml)) {
        errors.push(`${file}: ${value} 대상 id가 없습니다.`);
      }
    }
  }

  for (const anchor of html.matchAll(/<a\b[^>]*target=["']_blank["'][^>]*>/gi)) {
    if (!/rel=["'][^"']*noreferrer[^"']*["']/i.test(anchor[0])) errors.push(`${file}: 새 창 링크에 rel=noreferrer가 없습니다.`);
  }
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log(`${htmlFiles.length}개 HTML의 로컬 링크와 새 창 보안 속성 확인`);
