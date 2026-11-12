import { useEffect, useRef, useState, type ReactNode } from "react";
import { api } from "../api";
import { errorText, formatBytes } from "../format";
import { useSettings } from "../settings";
import type { InstanceStatus } from "../types";

interface Props {
  id: string;
}

function Kpi({
  label,
  value,
  sub,
  progress,
}: {
  label: string;
  value: string;
  sub: string;
  progress?: number;
}) {
  return (
    <div className="status-kpi">
      <span className="kpi-label">{label}</span>
      <span className="kpi-value">{value}</span>
      {progress !== undefined && (
        <div className="status-bar">
          <span style={{ width: `${Math.min(100, Math.max(0, progress))}%` }} />
        </div>
      )}
      <span className="kpi-sub">{sub}</span>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="status-panel">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function Line({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="status-line">
      <span className="status-line-label">{label}</span>
      <span className="status-line-value">{value}</span>
    </div>
  );
}

export default function StatusPage({ id }: Props) {
  const { t, language } = useSettings();
  const [status, setStatus] = useState<InstanceStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [peakOps, setPeakOps] = useState(0);
  const tokenRef = useRef(0);

  const load = async (silent = false) => {
    const token = ++tokenRef.current;
    if (silent) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    try {
      const next = await api.getInstanceStatus(id);
      if (token !== tokenRef.current) return;
      setStatus(next);
      setPeakOps((prev) => Math.max(prev, next.instantaneousOpsPerSec));
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
    setStatus(null);
    setPeakOps(0);
    setLoading(true);
    void load();
    const timer = window.setInterval(() => void load(true), 5000);
    return () => {
      window.clearInterval(timer);
      tokenRef.current++;
    };
  }, [id]);

  const locale = language === "zh" ? "zh-CN" : "en-US";
  const numberFormat = new Intl.NumberFormat(locale);
  const compactFormat = new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 });
  const num = (value: number) => numberFormat.format(value);
  const compact = (value: number) => compactFormat.format(value);

  const uptimeShort = (seconds: number) => {
    const days = Math.floor(seconds / 86400);
    if (days > 0) return t("statusDays", { n: days });
    const hours = Math.floor((seconds % 86400) / 3600);
    if (hours > 0) return t("statusHours", { n: hours });
    return t("statusMinutes", { n: Math.floor((seconds % 3600) / 60) });
  };

  const relativeTime = (unix: number) => {
    if (unix <= 0) return "—";
    const diff = Math.max(0, Math.floor(Date.now() / 1000) - unix);
    if (diff < 60) return t("statusJustNow");
    const minutes = Math.floor(diff / 60);
    if (minutes < 60) return t("statusMinutesAgo", { n: minutes });
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return t("statusHoursAgo", { n: hours });
    return t("statusDaysAgo", { n: Math.floor(hours / 24) });
  };

  const slowDuration = (ms: number) => (ms >= 100 ? `${Math.round(ms)} ms` : `${ms.toFixed(1)} ms`);

  if (loading && !status) {
    return (
      <div className="status-page">
        <div className="value-loading">
          <span className="spinner" />
          {t("statusLoading")}
        </div>
      </div>
    );
  }

  if (!status) {
    return (
      <div className="status-page">
        <div className="status-head">
          <h2>{t("statusTitle")}</h2>
          <button type="button" className="btn btn-ghost" onClick={() => void load()}>
            {t("statusRefresh")}
          </button>
        </div>
        <p className="notice err">{error ?? t("statusEmpty")}</p>
      </div>
    );
  }

  const roleLabel =
    status.role === "master" ? t("statusRoleMaster") : status.role ? t("statusRoleReplica") : "—";
  const healthy = status.masterLinkStatus !== "down";

  const totalKeys = status.databases.reduce((sum, database) => sum + database.keys, 0);
  const totalExpires = status.databases.reduce((sum, database) => sum + database.expires, 0);
  const expirePct = totalKeys > 0 ? (totalExpires / totalKeys) * 100 : 0;

  const memoryPct = status.maxMemory > 0 ? (status.usedMemory / status.maxMemory) * 100 : 0;
  const memoryLimit = status.maxMemory > 0 ? formatBytes(status.maxMemory) : t("statusUnlimited");
  const memorySub =
    status.maxMemory > 0
      ? t("statusMemoryLimit", { limit: memoryLimit, pct: memoryPct.toFixed(0) })
      : t("statusUnlimited");

  const topCommands = status.commands.slice(0, 4);
  const commandTotal =
    status.commandTotalCalls || status.commands.reduce((sum, command) => sum + command.calls, 0);
  const commandPct = (calls: number) => (commandTotal > 0 ? (calls / commandTotal) * 100 : 0);
  const pctLabel = (value: number) => (value > 0 && value < 1 ? "<1%" : `${Math.round(value)}%`);
  const slowRows = status.slowQueries.slice(0, 3);

  return (
    <div className="status-page">
      <div className="status-head">
        <div className="status-head-left">
          <h2>{status.name || status.address}</h2>
          <span className="status-chip">{roleLabel}</span>
          <span className="status-chip">Redis {status.version || "—"}</span>
          <span className="status-uptime">
            {t("statusRunning", { duration: uptimeShort(status.uptimeSeconds) })}
          </span>
        </div>
        <div className="status-head-right">
          <div className={"status-health" + (healthy ? "" : " degraded")}>
            <span className="status-health-dot" />
            {t(healthy ? "statusHealthy" : "statusUnhealthy")}
          </div>
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
        </div>
      </div>

      {error && <p className="notice err">{error}</p>}

      <div className="status-kpis">
        <Kpi
          label={t("statusInstantQPS")}
          value={num(status.instantaneousOpsPerSec)}
          sub={t("statusPeakQPS", { value: num(peakOps) })}
        />
        <Kpi
          label={t("statusCacheHitRate")}
          value={`${status.hitRate.toFixed(1)}%`}
          sub={t("statusHitMiss", {
            hits: compact(status.keyspaceHits),
            misses: compact(status.keyspaceMisses),
          })}
        />
        <Kpi
          label={t("statusMemoryUsage")}
          value={status.usedMemoryHuman || formatBytes(status.usedMemory)}
          sub={memorySub}
          progress={status.maxMemory > 0 ? memoryPct : undefined}
        />
        <Kpi
          label={t("statusClientConnections")}
          value={num(status.connectedClients)}
          sub={t("statusClientsLimit", {
            max: status.maxClients > 0 ? num(status.maxClients) : "—",
            blocked: num(status.blockedClients),
          })}
        />
      </div>

      <div className="status-columns">
        <Panel title={t("statusMemoryKeys")}>
          <div className="status-meter">
            <div className="meter-head">
              <span>{t("statusUsedMemory")}</span>
              <strong>
                {status.usedMemoryHuman || "—"} / {memoryLimit}
              </strong>
            </div>
            {status.maxMemory > 0 && (
              <div className="status-bar">
                <span style={{ width: `${Math.min(100, memoryPct)}%` }} />
              </div>
            )}
          </div>
          <Line label={t("statusRSS")} value={status.usedMemoryRSSHuman || "—"} />
          <Line label={t("statusFragmentation")} value={status.memoryFragmentation.toFixed(2)} />
          <Line
            label={t("statusKeysTotalExpire")}
            value={`${compact(totalKeys)} / ${expirePct.toFixed(0)}%`}
          />
          <Line
            label={t("statusEvictedExpired")}
            value={`${compact(status.evictedKeys)} / ${compact(status.expiredKeys)}`}
          />
        </Panel>

        <Panel title={t("statusReplicationPersistence")}>
          <Line
            label={t("statusRoleReplicas")}
            value={`${status.role || "—"} / ${num(status.connectedSlaves)}`}
          />
          <Line label={t("statusMasterLink")} value={status.masterLinkStatus || "—"} />
          <Line
            label={t("statusMaxReplicaLag")}
            value={status.maxReplicaLag > 0 ? `${status.maxReplicaLag} s` : "—"}
          />
          <Line label={t("statusRDBLastSave")} value={relativeTime(status.rdbLastSaveTime)} />
          <Line
            label={t("statusAOFStatusSize")}
            value={
              status.aofEnabled
                ? `${t("statusEnabled")} / ${formatBytes(status.aofCurrentSize)}`
                : `${t("statusDisabled")} / —`
            }
          />
        </Panel>
      </div>

      <div className="status-columns">
        <Panel title={t("statusCommandDistribution")}>
          {topCommands.length === 0 ? (
            <p className="notice">{t("statusNoCommands")}</p>
          ) : (
            <div className="command-list">
              {topCommands.map((command) => {
                const pct = commandPct(command.calls);
                return (
                  <div className="command-item" key={command.name}>
                    <div className="command-head">
                      <span className="command-name">{command.name}</span>
                      <span className="command-pct">{pctLabel(pct)}</span>
                    </div>
                    <div className="command-bar">
                      <span style={{ width: `${Math.min(100, pct)}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Panel>

        <Panel title={t("statusSlowQueries")}>
          {slowRows.length === 0 ? (
            <p className="notice">{t("statusNoSlowQueries")}</p>
          ) : (
            <div className="slow-list">
              {slowRows.map((query) => (
                <div className="slow-row" key={query.id}>
                  <span className="slow-query" title={query.summary}>
                    {query.summary || "—"}
                  </span>
                  <span className="slow-duration">{slowDuration(query.durationMs)}</span>
                </div>
              ))}
            </div>
          )}
          <p className="slow-foot">
            {t("statusSlowlogFooter", {
              threshold: status.slowlogThresholdMs.toFixed(0),
              count: num(status.slowlogCount),
            })}
          </p>
        </Panel>
      </div>

      <div className="status-foot">
        {t("statusMode")}: {status.mode || "—"} · {t("statusOS")}: {status.os || "—"} ·{" "}
        {t("statusProcessID")}: {status.processID > 0 ? status.processID : "—"} ·{" "}
        {t("statusTotalCommands")}: {num(status.totalCommandsProcessed)} ·{" "}
        {t("statusTotalConnections")}: {num(status.totalConnectionsReceived)} ·{" "}
        {t("statusRejectedConnections")}: {num(status.rejectedConnections)} · {t("statusAutoRefresh")}
      </div>
    </div>
  );
}
