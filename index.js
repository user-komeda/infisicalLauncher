import { spawnSync, spawn } from "child_process";
import path from "path";
import dotenv from "dotenv";

/**
 * Infisical Launcher
 * GitHub: user-komeda/infisicalLauncher
 */

// 1. 引数の解析
const rawArgs = process.argv.slice(2);
const options = {
  path: "/",
  envDir: process.cwd(), // デフォルトは現在の作業ディレクトリ
  cmdArgs: [],
};

let isCollectingCmd = false;

for (let i = 0; i < rawArgs.length; i++) {
  const arg = rawArgs[i];

  if (arg.startsWith("--path=")) {
    options.path = arg.split("=")[1];
  } else if (arg.startsWith("--envDir=")) {
    options.envDir = arg.split("=")[1];
  } else if (arg.startsWith("--cmd=")) {
    // --cmd="command" 形式への対応
    options.cmdArgs.push(arg.split("=")[1]);
    isCollectingCmd = true;
  } else if (isCollectingCmd) {
    options.cmdArgs.push(arg);
  } else if (!arg.startsWith("--")) {
    // オプション以外の引数が現れたら、そこから先をすべてコマンドとみなす
    options.cmdArgs.push(arg);
    isCollectingCmd = true;
  }
}

const finalCmd = options.cmdArgs.filter(Boolean);

if (finalCmd.length === 0) {
  console.error("❌ Error: No command provided.");
  console.error(
    "Usage: infisical-launcher [--path=/path] [--envDir=path/to/dir] <command>"
  );
  process.exit(1);
}

// 2. 指定されたディレクトリから .env を読み込み
const fullEnvPath = path.resolve(options.envDir, ".env");
dotenv.config({ path: fullEnvPath });

const { CLIENT_ID, CLIENT_SECRET, PROJECT_ID } = process.env;

if (!CLIENT_ID || !CLIENT_SECRET || !PROJECT_ID) {
  console.error(
    `❌ Error: Missing credentials (CLIENT_ID, CLIENT_SECRET, or PROJECT_ID) in: ${fullEnvPath}`
  );
  process.exit(1);
}

// 3. Infisical Login
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
console.log(`🚀 [Infisical] Path: ${options.path} | Project: ${PROJECT_ID}`);
console.log(`💻 [Command] ${finalCmd.join(" ")}`);

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

child.on("close", (code) => {
  process.exit(code);
});
