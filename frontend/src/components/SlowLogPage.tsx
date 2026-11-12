import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { errorText } from "../format";
import { useSettings } from "../settings";
import type { SlowLogData } from "../types";

interface Props {
  id: string;
}

const LIMIT = 100;

export default function SlowLogPage({ id }: Props) {
  const { t, language } = useSettings();
  const [data, setData] = useState<SlowLogData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [clearing, setClearing] = useState(false);
  const tokenRef = useRef(0);

  const load = async (silent = false) => {
    const token = ++tokenRef.current;
    if (silent) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    try {
      const next = await api.getSlowLog(id, LIMIT);
      if (token !== tokenRef.current) return;
      setData(next);
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
    setData(null);
    setConfirming(false);
    void load();
    const timer = window.setInterval(() => void load(true), 5000);
    return () => {
      window.clearInterval(timer);
      tokenRef.current++;
    };
  }, [id]);

  const clear = async () => {
    setClearing(true);
    setError(null);
    try {
      await api.clearSlowLog(id);
      setConfirming(false);
      await load(true);
    } catch (err) {
      setError(errorText(err, t));
    } finally {
      setClearing(false);
    }
  };

  const locale = language === "zh" ? "zh-CN" : "en-US";
  const timeLabel = (unix: number) => new Date(unix * 1000).toLocaleString(locale);
  const durationLabel = (ms: number) => (ms >= 100 ? `${Math.round(ms)} ms` : `${ms.toFixed(1)} ms`);
  const durationClass = (ms: number) => (ms >= 100 ? "high" : ms >= 50 ? "warn" : "");
  const thresholdLabel = data
    ? Number.isInteger(data.thresholdMs)
      ? String(data.thresholdMs)
      : data.thresholdMs.toFixed(1)
    : "—";

  if (loading && !data) {
    return (
      <div className="slowlog-page">
        <div className="value-loading">
          <span className="spinner" />
          {t("statusLoading")}
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="slowlog-page">
        <div className="slowlog-head">
          <h2>{t("slowlogTitle")}</h2>
          <button type="button" className="btn btn-ghost" onClick={() => void load()}>
            {t("statusRefresh")}
          </button>
        </div>
        <p className="notice err">{error ?? t("slowlogEmpty")}</p>
      </div>
    );
  }

  return (
    <div className="slowlog-page">
      <div className="slowlog-head">
        <div>
          <h2>{t("slowlogTitle")}</h2>
          <div className="console-meta">
            <span className="console-hint">{t("slowlogHint")}</span>
          </div>
        </div>
        <div className="slowlog-actions">
          <span className="muted">{t("statusAutoRefresh")}</span>
          <button
            type="button"
            className="icon-btn"
            title={t("statusRefresh")}
            onClick={() => void load(true)}
            disabled={refreshing}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 12a9 9 0 1 1-2.64-6.36" />
              <path d="M21 3v6h-6" />
            </svg>
          </button>
          <button
            type="button"
            className="btn btn-danger"
            onClick={() => setConfirming(true)}
            disabled={data.total === 0}
          >
            {t("slowlogClear")}
          </button>
        </div>
      </div>

      {confirming && (
        <div className="confirm-bar slowlog-confirm">
          <span>{t("slowlogClearConfirm")}</span>
          <button type="button" className="btn btn-ghost" onClick={() => setConfirming(false)} disabled={clearing}>
            {t("cancel")}
          </button>
          <button type="button" className="btn btn-danger" onClick={() => void clear()} disabled={clearing}>
            {clearing ? t("saving") : t("slowlogConfirmClear")}
          </button>
        </div>
      )}

      {error && <p className="notice err">{error}</p>}

      <div className="slowlog-stats">
        <span className="status-chip">
          {t("slowlogThreshold")} {thresholdLabel} ms
        </span>
        <span className="status-chip">
          {t("slowlogMaxLen")} {data.maxLen > 0 ? data.maxLen : "—"}
        </span>
        <span className="status-chip">
          {t("slowlogTotal")} {data.total}
        </span>
        <span className="muted">{t("slowlogRecent", { count: data.entries.length })}</span>
      </div>

      <div className="slowlog-table">
        <div className="slowlog-row head">
          <span>{t("slowlogID")}</span>
          <span>{t("slowlogTime")}</span>
          <span>{t("slowlogDuration")}</span>
          <span>{t("slowlogCommand")}</span>
          <span>{t("slowlogClient")}</span>
        </div>

        {data.entries.length === 0 ? (
          <div className="slowlog-empty">{t("slowlogEmpty")}</div>
        ) : (
          data.entries.map((entry) => (
            <div className="slowlog-row" key={entry.id}>
              <span className="slowlog-id">{entry.id}</span>
              <span className="slowlog-time">{timeLabel(entry.time)}</span>
              <span className={"slowlog-duration " + durationClass(entry.durationMs)}>
                {durationLabel(entry.durationMs)}
              </span>
              <span className="slowlog-command" title={entry.command || entry.summary}>
                {entry.command || entry.summary || "—"}
              </span>
              <span className="slowlog-client" title={entry.clientAddr}>
                {entry.clientAddr || "—"}
              </span>
            </div>
          ))
        )}
      </div>

      {data.total > data.entries.length && (
        <p className="slowlog-foot">
          {t("slowlogShowing", { shown: data.entries.length, total: data.total })}
        </p>
      )}
    </div>
  );
}
