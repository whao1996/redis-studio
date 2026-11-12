import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { errorText, formatBytes, formatTTL, typeLabel } from "../format";
import { useSettings } from "../settings";
import type { KeyAnalysis } from "../types";

interface Props {
  id: string;
  db: number;
}

const TYPE_COLORS = [
  "#7db8ff",
  "#c19dff",
  "#5fd3a2",
  "#ecc57a",
  "#f28fb3",
  "#63d8cc",
  "#ff9d66",
  "#a6b8ff",
  "#f2a3c0",
  "#8fd0ff",
  "#c9a7ff",
  "#7fd6b0",
  "#e8e06f",
  "#ff7f9d",
];

interface DonutSlice {
  key: string;
  label: string;
  value: string;
  percent: number;
  color: string;
}

function donutPercent(value: number) {
  return value > 0 && value < 1 ? "<1%" : `${Math.round(value)}%`;
}

function Donut({
  title,
  centerValue,
  centerSub,
  slices,
}: {
  title: string;
  centerValue: string;
  centerSub: string;
  slices: DonutSlice[];
}) {
  const radius = 44;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  return (
    <div className="type-donut">
      <div className="donut-head">
        <h4>{title}</h4>
      </div>
      <div className="donut-body">
        <svg className="donut-chart" viewBox="0 0 110 110" role="img" aria-label={title}>
          <circle className="donut-track" cx="55" cy="55" r={radius} />
          {slices.map((slice) => {
            const length = (slice.percent / 100) * circumference;
            const dash = `${length} ${circumference - length}`;
            const circle = (
              <circle
                key={slice.key}
                cx="55"
                cy="55"
                r={radius}
                fill="none"
                stroke={slice.color}
                strokeWidth="13"
                strokeDasharray={dash}
                strokeDashoffset={-offset}
                transform="rotate(-90 55 55)"
              />
            );
            offset += length;
            return circle;
          })}
          <text x="55" y="52" textAnchor="middle" className="donut-value">
            {centerValue}
          </text>
          <text x="55" y="68" textAnchor="middle" className="donut-label">
            {centerSub}
          </text>
        </svg>
        <ul className="donut-legend">
          {slices.map((slice) => (
            <li key={slice.key}>
              <span className="legend-dot" style={{ background: slice.color }} />
              <span className="legend-name" title={slice.label}>
                {slice.label}
              </span>
              <span className="legend-pct">{donutPercent(slice.percent)}</span>
              <span className="legend-value">{slice.value}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export default function AnalysisPage({ id, db }: Props) {
  const { t, language } = useSettings();
  const [analysis, setAnalysis] = useState<KeyAnalysis | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [namespaceSort, setNamespaceSort] = useState<"memory" | "keys">("memory");
  const [keySort, setKeySort] = useState<"memory" | "length">("memory");
  const tokenRef = useRef(0);

  const load = async (silent = false) => {
    const token = ++tokenRef.current;
    if (silent) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    try {
      const next = await api.getKeyAnalysis(id, db, 15);
      if (token !== tokenRef.current) return;
      setAnalysis(next);
      setError(null);
    } catch (err) {
      if (token === tokenRef.current) setError(errorText(err, t));
    } finally {
      if (token === tokenRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  };

  useEffect(() => {
    setAnalysis(null);
    setLoading(true);
    setError(null);
    setNamespaceSort("memory");
    setKeySort("memory");
    void load();
    return () => {
      tokenRef.current++;
    };
  }, [id, db]);

  const locale = language === "zh" ? "zh-CN" : "en-US";
  const numberFormat = new Intl.NumberFormat(locale);
  const num = (value: number) => numberFormat.format(value);

  const analysisTypes = analysis?.types ?? [];
  const typeColors = new Map<string, string>();
  analysisTypes.forEach((item, index) => {
    typeColors.set(item.type, TYPE_COLORS[index % TYPE_COLORS.length]);
  });

  const memorySlices: DonutSlice[] = analysis
    ? analysisTypes.map((item) => ({
        key: item.type,
        label: typeLabel(item.type),
        value: formatBytes(item.memory),
        percent: analysis.totalMemory > 0 ? (item.memory / analysis.totalMemory) * 100 : 0,
        color: typeColors.get(item.type) ?? TYPE_COLORS[0],
      }))
    : [];

  const keysSlices: DonutSlice[] = analysis
    ? [...analysisTypes]
        .sort((a, b) => b.keys - a.keys)
        .map((item) => ({
          key: item.type,
          label: typeLabel(item.type),
          value: num(item.keys),
          percent: analysis.totalKeys > 0 ? (item.keys / analysis.totalKeys) * 100 : 0,
          color: typeColors.get(item.type) ?? TYPE_COLORS[0],
        }))
    : [];

  const namespaceRows = analysis
    ? [...(analysis.namespaces ?? [])]
        .sort((a, b) => (namespaceSort === "keys" ? b.keys - a.keys : b.memory - a.memory))
        .slice(0, 10)
    : [];
  const keyRows = analysis
    ? keySort === "length"
      ? analysis.topByLength ?? []
      : analysis.topByMemory ?? []
    : [];

  const isEmpty = !analysis || analysis.totalKeys === 0;

  return (
    <div className="status-page analysis-page">
      <div className="status-head">
        <div className="status-head-left">
          <h2>{t("analysisTitle")}</h2>
          <span className="status-chip">{t("analysisDb", { db })}</span>
          {analysis && (
            <span className="status-uptime">
              {t("analysisScanned", {
                keys: num(analysis.totalKeys),
                memory: formatBytes(analysis.totalMemory),
              })}
            </span>
          )}
        </div>
        <div className="status-head-right">
          {analysis && <span className="status-chip">{t("analysisTypes", { n: analysisTypes.length })}</span>}
          <button
            type="button"
            className="icon-btn"
            title={t("analysisRefresh")}
            onClick={() => void load(true)}
            disabled={refreshing || loading}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 12a9 9 0 1 1-2.64-6.36" />
              <path d="M21 3v6h-6" />
            </svg>
          </button>
        </div>
      </div>

      {error && <p className="notice err">{error}</p>}

      {loading && !analysis ? (
        <div className="analysis-loading">
          <span className="spinner" />
          {t("analysisLoading")}
        </div>
      ) : isEmpty ? (
        <div className="status-panel">
          <p className="notice">{t("analysisEmpty")}</p>
        </div>
      ) : (
        <>
          <section className="status-panel analysis-panel">
            <div className="analysis-head">
              <h3>{t("analysisSummary")}</h3>
              {analysis?.truncated && (
                <span className="analysis-warn">
                  {t("analysisTruncated", { count: num(analysis.totalKeys) })}
                </span>
              )}
            </div>

            <div className="donut-grid">
              <Donut
                title={t("analysisMemory")}
                centerValue={formatBytes(analysis!.totalMemory)}
                centerSub={t("analysisTotal")}
                slices={memorySlices}
              />
              <Donut
                title={t("analysisKeys")}
                centerValue={num(analysis!.totalKeys)}
                centerSub={t("analysisTotal")}
                slices={keysSlices}
              />
            </div>
          </section>

          <section className="status-panel analysis-table-panel">
            <div className="analysis-head">
              <h3>{t("analysisTopNamespaces")}</h3>
              <div className="analysis-toggle">
                <button
                  type="button"
                  className={namespaceSort === "memory" ? "active" : ""}
                  onClick={() => setNamespaceSort("memory")}
                >
                  {t("analysisByMemory")}
                </button>
                <button
                  type="button"
                  className={namespaceSort === "keys" ? "active" : ""}
                  onClick={() => setNamespaceSort("keys")}
                >
                  {t("analysisByKeys")}
                </button>
              </div>
            </div>

            {namespaceRows.length === 0 ? (
              <p className="notice">{t("analysisEmpty")}</p>
            ) : (
              <div className="analysis-table-wrap">
                <table className="analysis-table">
                  <thead>
                    <tr>
                      <th>{t("analysisKeyPattern")}</th>
                      <th>{t("analysisDataType")}</th>
                      <th className={"num" + (namespaceSort === "memory" ? " active" : "")}>
                        {t("analysisTotalMemory")}
                      </th>
                      <th className={"num" + (namespaceSort === "keys" ? " active" : "")}>
                        {t("analysisTotalKeys")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {namespaceRows.map((row) => (
                      <tr key={row.namespace || "__root__"}>
                        <td className="cell-key">
                          {row.namespace ? `${row.namespace}:*` : t("analysisNoNamespace")}
                        </td>
                        <td>
                          <div className="type-badges">
                            {(row.types ?? []).map((type) => (
                              <span key={type} className={`type-badge type-${type}`}>
                                {typeLabel(type)}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="num">{formatBytes(row.memory)}</td>
                        <td className="num">{num(row.keys)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="status-panel analysis-table-panel">
            <div className="analysis-head">
              <h3>{t("analysisTopKeys")}</h3>
              <div className="analysis-toggle">
                <button
                  type="button"
                  className={keySort === "memory" ? "active" : ""}
                  onClick={() => setKeySort("memory")}
                >
                  {t("analysisByMemory")}
                </button>
                <button
                  type="button"
                  className={keySort === "length" ? "active" : ""}
                  onClick={() => setKeySort("length")}
                >
                  {t("analysisByLength")}
                </button>
              </div>
            </div>

            {keyRows.length === 0 ? (
              <p className="notice">{t("analysisEmpty")}</p>
            ) : (
              <div className="analysis-table-wrap">
                <table className="analysis-table">
                  <thead>
                    <tr>
                      <th>{t("analysisKeyType")}</th>
                      <th>{t("analysisKeyName")}</th>
                      <th>{t("analysisTTL")}</th>
                      <th className={"num" + (keySort === "memory" ? " active" : "")}>
                        {t("analysisKeySize")}
                      </th>
                      <th className={"num" + (keySort === "length" ? " active" : "")}>
                        {t("analysisLength")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {keyRows.map((row) => (
                      <tr key={row.key}>
                        <td>
                          <span className={`type-badge type-${row.type}`}>{typeLabel(row.type)}</span>
                        </td>
                        <td className="cell-key" title={row.key}>
                          {row.key}
                        </td>
                        <td className="cell-muted">{formatTTL(row.ttl, t)}</td>
                        <td className="num">{formatBytes(row.size)}</td>
                        <td className="num">{row.length >= 0 ? num(row.length) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
