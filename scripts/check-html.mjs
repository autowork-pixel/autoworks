import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const files = ["public/index.html", "public/api-guide.html", "public/admin.html", "public/brand-search.html"];
const moduleFiles = ["public/brand-search.js"];
const directory = mkdtempSync(join(tmpdir(), "autoworks-html-"));

try {
  for (const file of files) {
    const html = readFileSync(file, "utf8");
    const scripts = [...html.matchAll(/<script(?<attrs>[^>]*)>(?<code>[\s\S]*?)<\/script>/g)];
    scripts.forEach((match, index) => {
      const module = /type=["']module["']/.test(match.groups.attrs);
      const path = join(directory, `${file.replace(/\W/g, "-")}-${index}.${module ? "mjs" : "js"}`);
      writeFileSync(path, match.groups.code, "utf8");
      const checked = spawnSync(process.execPath, ["--check", path], { encoding: "utf8" });
      if (checked.status !== 0) throw new Error(`${file} script ${index + 1}:\n${checked.stderr || checked.stdout}`);
    });
    console.log(`${file}: ${scripts.length}개 스크립트 구문 확인`);
  }
  for (const file of moduleFiles) {
    const checked = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
    if (checked.status !== 0) throw new Error(`${file}:\n${checked.stderr || checked.stdout}`);
    console.log(`${file}: 모듈 구문 확인`);
  }
} finally {
  rmSync(directory, { recursive: true, force: true });
}
