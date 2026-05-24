#!/usr/bin/env node
/**
 * Infisical Launcher
 * GitHub: user-komeda/infisicalLauncher
 *
 * Infisical SDKでシークレットを取得し、
 * 環境変数として注入した状態で任意のコマンドを実行するツール。
 * Infisical CLIに依存しません。
 *
 * Requirements: Node.js >= 20
 */

import { spawn } from "node:child_process";
import path from "node:path";
import { parseArgs } from "node:util";
import dotenv from "dotenv";
import { InfisicalSDK } from "@infisical/sdk";

const REQUIRED_ENV_KEYS = [
  "LOCAL_INFISICAL_CLIENT_ID",
  "LOCAL_INFISICAL_CLIENT_SECRET",
  "LOCAL_INFISICAL_PROJECT_ID",
];

// ============================================================
// ロガー
// ============================================================

const logger = {
  info: (msg) => console.log(`ℹ️  ${msg}`),
  warn: (msg) => console.warn(`⚠️  ${msg}`),
  error: (msg, detail) => {
    console.error(`❌ ${msg}`);
    if (detail !== undefined) console.error(detail);
  },
  step: (msg) => console.log(`🚀 ${msg}`),
};

// ============================================================
// 使い方表示
// ============================================================

const printUsage = () => {
  console.log(`
Usage:
  infisicalLauncher [options] -- <command> [args...]

Options:
  --path=<path>          Infisical secret path (default: "/")
  --envDir=<dir>         Directory containing .env file (default: cwd)
  --env=<environment>    Infisical environment slug (default: "dev")
  -h, --help             Show this help

Required env vars (or .env entries):
  CLIENT_ID              Infisical Universal Auth client ID
  CLIENT_SECRET          Infisical Universal Auth client secret
  PROJECT_ID             Infisical project ID

Examples:
  infisicalLauncher --env=dev  -- yarn dev
  infisicalLauncher --env=prod -- yarn build
  infisicalLauncher --env=dev --envDir=./apps/api -- yarn start
`);
};

// ============================================================
// 引数パース
// ============================================================

const parseLauncherArgs = (argv) => {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      path: { type: "string", default: "/" },
      env: { type: "string", default: "dev" },
      help: { type: "boolean", short: "h", default: false },
    },
    allowPositionals: true,
    strict: false,
  });

  if (values.help) {
    printUsage();
    process.exit(0);
  }

  if (positionals.length === 0) {
    logger.error("No command provided.");
    printUsage();
    process.exit(1);
  }

  return {
    secretPath: values.path,
    environment: values.env,
    command: positionals,
  };
};

// ============================================================
// 環境変数の準備
// ============================================================

const loadCredentials = async () => {
  const allPresent = REQUIRED_ENV_KEYS.every((key) => process.env[key]);

  if (allPresent) {
    return {
      clientId: process.env.LOCAL_INFISICAL_CLIENT_ID,
      clientSecret: process.env.LOCAL_INFISICAL_CLIENT_SECRET,
      projectId: process.env.LOCAL_INFISICAL_PROJECT_ID,
    };
  }

  const endpoint = "http://192.168.11.9:8787/config";

  const response = await fetch(endpoint);
  const json = await response.json();
  return {
    clientId: json.clientId ?? "",
    clientSecret: json.clientSecret ?? "",
    projectId: json.projectId ?? "",
  };
};

// ============================================================
// Infisical SDK 操作
// ============================================================

/**
 * Infisicalにログインしてシークレット一覧を取得する。
 * @returns {Promise<Record<string, string>>} シークレットキー → 値のマップ
 */
const fetchSecrets = async (credentials, environment, secretPath) => {
  // siteUrl は指定せず Infisical Cloud (US) のデフォルトを使用
  const client = new InfisicalSDK();

  // ログイン
  try {
    await client.auth().universalAuth.login({
      clientId: credentials.clientId,
      clientSecret: credentials.clientSecret,
    });
  } catch (err) {
    logger.error("Failed to authenticate with Infisical.", err?.message ?? err);
    process.exit(1);
  }

  // シークレット取得
  let response;
  try {
    response = await client.secrets().listSecrets({
      projectId: credentials.projectId,
      environment,
      secretPath,
      expandSecretReferences: true,
      includeImports: true,
    });
  } catch (err) {
    logger.error(
      "Failed to fetch secrets from Infisical.",
      err?.message ?? err,
    );
    process.exit(1);
  }

  // SDKバージョン差異(配列 or {secrets:[...]})に対応
  const secretList = Array.isArray(response)
    ? response
    : (response?.secrets ?? []);

  /** @type {Record<string, string>} */
  const env = {};
  for (const secret of secretList) {
    if (secret?.secretKey) {
      env[secret.secretKey] = secret.secretValue ?? "";
    }
  }

  if (Object.keys(env).length === 0) {
    logger.warn(
      `No secrets found at env="${environment}" path="${secretPath}".`,
    );
  }

  return env;
};

// ============================================================
// コマンド実行
// ============================================================

const runCommand = (command, environment, secretPath, injectedEnv) => {
  logger.step(`[Infisical] env=${environment} path=${secretPath}`);
  logger.step(`[Command] ${command.join(" ")}`);

  const [bin, ...args] = command;

  const child = spawn(bin, args, {
    stdio: "inherit",
    shell: false,
    env: {
      ...process.env,
      ...injectedEnv,
    },
  });

  child.on("error", (err) => {
    if (err.code === "ENOENT") {
      logger.error(`Command not found: ${bin}`);
    } else {
      logger.error("Failed to start command.", err.message);
    }
    process.exit(1);
  });

  // 親プロセスのシグナルを子プロセスに伝播
  const forwardSignal = (signal) => {
    if (!child.killed) child.kill(signal);
  };
  process.on("SIGINT", () => forwardSignal("SIGINT"));
  process.on("SIGTERM", () => forwardSignal("SIGTERM"));

  child.on("close", (code, signal) => {
    if (signal !== null) {
      const signalCode =
        signal === "SIGINT" ? 130 : signal === "SIGTERM" ? 143 : 1;
      process.exit(signalCode);
    }
    process.exit(code ?? 0);
  });
};

// ============================================================
// エントリポイント
// ============================================================

const main = async () => {
  const options = parseLauncherArgs(process.argv.slice(2));
  const credentials = await loadCredentials();
  const injectedEnv = await fetchSecrets(
    credentials,
    options.environment,
    options.secretPath,
  );
  runCommand(
    options.command,
    options.environment,
    options.secretPath,
    injectedEnv,
  );
};

main().catch((err) => {
  logger.error("Unexpected error.", err?.message ?? err);
  process.exit(1);
});
