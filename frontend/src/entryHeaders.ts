import type { TranslationKey } from "./i18n";

type Translate = (key: TranslationKey) => string;

export function entryHeaders(kind: string, t: Translate): [string, string] {
  switch (kind) {
    case "list":
      return ["#", t("value")];
    case "zset":
      return [t("member"), t("score")];
    case "hash":
      return [t("field"), t("value")];
    case "stream":
      return ["ID", t("content")];
    case "timeseries":
      return [t("time"), t("number")];
    case "topk":
      return [t("rank"), t("element")];
    case "tdigest":
      return [t("quantile"), t("number")];
    case "vectorset":
      return [t("element"), t("vector")];
    default:
      return [t("member"), ""];
  }
}
