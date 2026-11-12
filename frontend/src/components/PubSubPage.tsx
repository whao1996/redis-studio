import { useEffect, useState } from "react";
import { Events } from "@wailsio/runtime";
import { api } from "../api";
import { errorText } from "../format";
import { useSettings } from "../settings";
import type { PubSubMessage, SubscriptionInfo } from "../types";

interface Props {
  id: string;
  db: number;
}

const MAX_MESSAGES = 500;

export default function PubSubPage({ id, db }: Props) {
  const { t, language } = useSettings();
  const [subscriptions, setSubscriptions] = useState<SubscriptionInfo[]>([]);
  const [messages, setMessages] = useState<PubSubMessage[]>([]);
  const [target, setTarget] = useState("");
  const [pattern, setPattern] = useState(false);
  const [channel, setChannel] = useState("");
  const [payload, setPayload] = useState("");
  const [busySubscribe, setBusySubscribe] = useState(false);
  const [busyPublish, setBusyPublish] = useState(false);
  const [selectedSubscription, setSelectedSubscription] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [published, setPublished] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    setSubscriptions([]);
    setMessages([]);
    setSelectedSubscription(null);
    setError(null);
    setPublished(null);

    api
      .listSubscriptions(id)
      .then((list) => {
        if (active) setSubscriptions(list);
      })
      .catch(() => {
        // 首次加载失败不阻塞页面，订阅时会再次暴露错误。
      });

    const off = Events.On("pubsub:message", (event: any) => {
      const message = event?.data as PubSubMessage;
      if (!message || message.connectionId !== id) return;
      setMessages((prev) => [message, ...prev].slice(0, MAX_MESSAGES));
      setSubscriptions((prev) =>
        prev.map((item) =>
          item.id === message.subscriptionId ? { ...item, messages: item.messages + 1 } : item
        )
      );
    });

    return () => {
      active = false;
      off();
    };
  }, [id]);

  const locale = language === "zh" ? "zh-CN" : "en-US";
  const timeLabel = (timestamp: number) => new Date(timestamp).toLocaleTimeString(locale);

  const subscribe = async () => {
    const value = target.trim();
    if (!value) {
      setError(t("pubsubTargetRequired"));
      return;
    }

    setBusySubscribe(true);
    setError(null);
    try {
      const info = await api.subscribe(id, db, value, pattern);
      setSubscriptions((prev) => [...prev.filter((item) => item.id !== info.id), info]);
      setTarget("");
    } catch (err) {
      setError(errorText(err, t));
    } finally {
      setBusySubscribe(false);
    }
  };

  const unsubscribe = async (subscriptionID: string) => {
    setError(null);
    try {
      await api.unsubscribe(id, subscriptionID);
      setSubscriptions((prev) => prev.filter((item) => item.id !== subscriptionID));
      setSelectedSubscription((prev) => (prev === subscriptionID ? null : prev));
    } catch (err) {
      setError(errorText(err, t));
    }
  };

  const toggleFilter = (subscriptionID: string) => {
    setSelectedSubscription((prev) => (prev === subscriptionID ? null : subscriptionID));
  };

  const activeFilter = subscriptions.some((item) => item.id === selectedSubscription)
    ? selectedSubscription
    : null;
  const selectedInfo = subscriptions.find((item) => item.id === activeFilter) ?? null;
  const filteredMessages = activeFilter
    ? messages.filter((message) => message.subscriptionId === activeFilter)
    : messages;

  const publish = async () => {
    const publishChannel = channel.trim();
    if (!publishChannel) {
      setError(t("pubsubChannelRequired"));
      return;
    }
    if (!payload.trim()) {
      setError(t("pubsubMessageRequired"));
      return;
    }

    setBusyPublish(true);
    setError(null);
    setPublished(null);
    try {
      const receivers = await api.publish(id, db, publishChannel, payload);
      setPublished(receivers);
    } catch (err) {
      setError(errorText(err, t));
    } finally {
      setBusyPublish(false);
    }
  };

  return (
    <div className="pubsub-page">
      <div className="pubsub-head">
        <h2>{t("pubsubTitle")}</h2>
        <div className="console-meta">
          <span className="status-chip">db{db}</span>
          <span className="console-hint">{t("pubsubHint")}</span>
        </div>
      </div>

      {error && <p className="notice err pubsub-error">{error}</p>}

      <div className="pubsub-subscribe-bar">
        <div className="pubsub-kind">
          <button
            type="button"
            className={pattern ? "" : "active"}
            onClick={() => setPattern(false)}
          >
            {t("pubsubKindChannel")}
          </button>
          <button
            type="button"
            className={pattern ? "active" : ""}
            onClick={() => setPattern(true)}
          >
            {t("pubsubKindPattern")}
          </button>
        </div>

        <input
          className="bar-input pubsub-target-input"
          value={target}
          onChange={(event) => {
            setTarget(event.target.value);
            setError(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") void subscribe();
          }}
          placeholder={t("pubsubTargetPlaceholder")}
          spellCheck={false}
        />

        <button
          type="button"
          className="btn btn-primary"
          onClick={() => void subscribe()}
          disabled={busySubscribe}
        >
          {t("pubsubSubscribe")}
        </button>
      </div>

      <div className="pubsub-body">
        <aside className="pubsub-side">
          <section className="pubsub-section">
            <h3>{t("pubsubSubscriptions")}</h3>

            <div className="pubsub-list">
              {subscriptions.length === 0 ? (
                <p className="notice">{t("pubsubNoSubscriptions")}</p>
              ) : (
                subscriptions.map((item) => (
                  <div
                    className={"pubsub-item" + (activeFilter === item.id ? " active" : "")}
                    key={item.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => toggleFilter(item.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        toggleFilter(item.id);
                      }
                    }}
                  >
                    <span className="pubsub-item-main">
                      <span className="pubsub-item-target" title={item.target}>
                        {item.target}
                      </span>
                      <span className="pubsub-item-meta">
                        {item.kind === "pattern" ? t("pubsubKindPattern") : t("pubsubKindChannel")} ·{" "}
                        {t("pubsubCount", { count: item.messages })}
                      </span>
                    </span>
                    <button
                      type="button"
                      className="icon-btn"
                      title={t("pubsubUnsubscribe")}
                      onClick={(event) => {
                        event.stopPropagation();
                        void unsubscribe(item.id);
                      }}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                        <path d="M18 6 6 18M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ))
              )}
            </div>
          </section>
        </aside>

        <section className="pubsub-feed">
          <div className="pubsub-feed-head">
            <div className="pubsub-feed-title">
              <h3>
                {t("pubsubMessages")}{" "}
                <span className="pubsub-message-count">{filteredMessages.length}</span>
              </h3>
              {selectedInfo && (
                <span className="pubsub-filter">
                  <span className="pubsub-filter-target" title={selectedInfo.target}>
                    {selectedInfo.target}
                  </span>
                  <button
                    type="button"
                    className="pubsub-filter-clear"
                    title={t("pubsubShowAll")}
                    onClick={() => setSelectedSubscription(null)}
                  >
                    ×
                  </button>
                </span>
              )}
            </div>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setMessages([])}
              disabled={messages.length === 0}
            >
              {t("pubsubClear")}
            </button>
          </div>

          <div className="pubsub-messages">
            {messages.length === 0 ? (
              <p className="pubsub-empty">{t("pubsubNoMessages")}</p>
            ) : filteredMessages.length === 0 ? (
              <p className="pubsub-empty">{t("pubsubNoMessagesFor")}</p>
            ) : (
              filteredMessages.map((message) => (
                <div className="pubsub-message" key={`${message.subscriptionId}-${message.timestamp}-${message.channel}`}>
                  <div className="pubsub-message-head">
                    <span className="pubsub-channel">{message.channel}</span>
                    {message.pattern && (
                      <span className="status-chip pubsub-pattern">{message.pattern}</span>
                    )}
                    <span className="pubsub-time">{timeLabel(message.timestamp)}</span>
                  </div>
                  <pre className="pubsub-payload">{message.payload || "—"}</pre>
                </div>
              ))
            )}
          </div>
        </section>
      </div>

      <div className="pubsub-publish-bar">
        <span className="pubsub-publish-label">{t("pubsubPublishTitle")}</span>
        <input
          className="bar-input pubsub-publish-channel"
          value={channel}
          onChange={(event) => {
            setChannel(event.target.value);
            setError(null);
            setPublished(null);
          }}
          placeholder={t("pubsubPublishChannel")}
          spellCheck={false}
        />
        <textarea
          className="pubsub-textarea pubsub-publish-message"
          value={payload}
          onChange={(event) => {
            setPayload(event.target.value);
            setError(null);
            setPublished(null);
          }}
          placeholder={t("pubsubPublishMessage")}
          rows={2}
          spellCheck={false}
        />
        <div className="pubsub-publish-actions">
          <span className="muted">
            {published !== null ? t("pubsubPublished", { count: published }) : ""}
          </span>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void publish()}
            disabled={busyPublish}
          >
            {t("pubsubPublish")}
          </button>
        </div>
      </div>
    </div>
  );
}
