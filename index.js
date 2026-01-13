import { spawnSync, spawn } from "child_process";
import path from "path";
import dotenv from "dotenv";
import { fileURLToPath } from "node:url";

// 1. .env から ID と Secret を読み込み
// スクリプト自身のディレクトリパスを取得（ルートディレクトリ）
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// .env のパスを、実行場所ではなくこのスクリプトがある場所（ルート）に固定する
dotenv.config({ path: path.resolve(__dirname, ".env") });
const { CLIENT_ID, CLIENT_SECRET, PROJECT_ID } = process.env;

if (!CLIENT_ID || !CLIENT_SECRET || !PROJECT_ID) {
  console.error(
    "❌ Error: CLIENT_ID or CLIENT_SECRET or PROJECT_ID is not set in .env"
  );
  process.exit(1);
}

// 2. 引数の解析
const rawArgs = process.argv.slice(2);
const options = {
  path: "/",
  cmdArgs: [],
};

let isCollectingCmd = false;

for (let i = 0; i < rawArgs.length; i++) {
  const arg = rawArgs[i];

  if (arg.startsWith("--path=")) {
    options.path = arg.split("=")[1];
  } else if (arg.startsWith("--cmd=")) {
    // --cmd=docker 形式と、その後に続く引数をすべて回収
    options.cmdArgs.push(arg.split("=")[1]);
    isCollectingCmd = true;
  } else if (isCollectingCmd) {
    // --cmd の後に続く空白区切りの引数をすべて追加
    options.cmdArgs.push(arg);
  } else if (!arg.startsWith("--")) {
    // 名前付き引数以外で、まだ cmd を収集中でない場合はここからコマンド開始とみなす
    options.cmdArgs.push(arg);
    isCollectingCmd = true;
  }
}

const finalCmd = options.cmdArgs.filter(Boolean);

if (finalCmd.length === 0) {
  console.error(
    "❌ Error: No command provided. Usage: node with-infisical.mjs --path=/path docker compose up"
  );
  process.exit(1);
}

// 3. Infisical Login してトークン取得
const login = spawnSync(
  "infisical",
  [
    "login",
    "--method=universal-auth",
    "--client-id",
    CLIENT_ID,
    "--client-secret",
    CLIENT_SECRET,
    "--plain",
    "--silent",
  ],
  { encoding: "utf-8", shell: true }
);

const token = login.stdout.trim();
if (!token || login.status !== 0) {
  console.error("❌ Failed to get Infisical token:", login.stderr);
  process.exit(1);
}

// 4. 指定されたコマンドを実行
console.log(`🚀 Path: ${options.path} | Command: ${finalCmd.join(" ")}`);

const child = spawn(
  "infisical",
  [
    "run",
    "--projectId",
    PROJECT_ID,
    "--token",
    token,
    "--path",
    options.path,
    "--",
    ...finalCmd,
  ],
  { stdio: "inherit", shell: true }
);

child.on("close", (code) => process.exit(code));
