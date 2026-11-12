import type { TranslationKey } from "./i18n";

type Translate = (key: TranslationKey, vars?: Record<string, string | number>) => string;

const TYPE_LABELS: Record<string, string> = {
  string: "String",
  hash: "Hash",
  list: "List",
  set: "Set",
  zset: "ZSet",
  stream: "Stream",
  none: "None",
  "ReJSON-RL": "JSON",
  ReJSON: "JSON",
  json: "JSON",
  "TSDB-TYPE": "TimeSeries",
  "MBbloom--": "Bloom",
  MBbloomCF: "Cuckoo",
  "CMSk-TYPE": "CMS",
  "TopK-TYPE": "TopK",
  "TDIS-TYPE": "TDigest",
  vectorset: "Vector",
};

export function typeLabel(type: string): string {
  return TYPE_LABELS[type] ?? type;
}

export function isJSONType(type: string): boolean {
  return type === "ReJSON-RL" || type === "ReJSON" || type === "json";
}

export function isModuleType(type: string): boolean {
  return (
    type === "TSDB-TYPE" ||
    type === "MBbloom--" ||
    type === "MBbloomCF" ||
    type === "CMSk-TYPE" ||
    type === "TopK-TYPE" ||
    type === "TDIS-TYPE" ||
    type === "vectorset"
  );
}

export function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(2)} MB`;
}

export function formatTTL(ttl: number, t: Translate): string {
  if (ttl === -1) return t("forever");
  if (ttl === -2) return t("ttlNone");
  if (ttl <= 0) return t("seconds", { s: ttl });

  const days = Math.floor(ttl / 86400);
  const hours = Math.floor((ttl % 86400) / 3600);
  const minutes = Math.floor((ttl % 3600) / 60);
  const seconds = ttl % 60;

  if (days > 0) return t("daysHours", { d: days, h: hours });
  if (hours > 0) return t("hoursMinutes", { h: hours, m: minutes });
  if (minutes > 0) return t("minutesSeconds", { m: minutes, s: seconds });
  return t("seconds", { s: seconds });
}

export function errorText(err: unknown, t: Translate): string {
  let message = "";
  if (typeof err === "string") {
    message = err;
  } else if (err instanceof Error) {
    message = err.message;
  } else if (err && typeof err === "object" && "message" in err) {
    message = String((err as { message: unknown }).message);
  }

  if (message.startsWith("APPERR:")) {
    try {
      const payload = JSON.parse(message.slice("APPERR:".length)) as {
        code?: string;
        params?: Record<string, string>;
      };
      if (payload.code) {
        const key = `err_${payload.code}` as TranslationKey;
        const translated = t(key, payload.params ?? {});
        if (translated !== key) return translated;
      }
    } catch {
      // 无法解析时回退到原始信息。
    }
  }

  return message || t("unknownError");
}
