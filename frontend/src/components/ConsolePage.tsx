import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { api } from "../api";
import { errorText } from "../format";
import { useSettings } from "../settings";
import type { CommandResult } from "../types";

interface Props {
  id: string;
  db: number;
}

interface Entry {
  id: number;
  db: number;
  command: string;
  result: CommandResult | null;
  pending: boolean;
}

const FALLBACK_COMMANDS = `
APPEND AUTH BGREWRITEAOF BGSAVE BITCOUNT BITFIELD BITOP BLPOP BRPOP BZPOPMAX BZPOPMIN
CLIENT CLUSTER COMMAND CONFIG DBSIZE DECR DECRBY DEL DUMP ECHO EVAL EVALSHA EXISTS EXPIRE
EXPIREAT EXPIRETIME FLUSHALL FLUSHDB GEOADD GEODIST GEOHASH GEOPOS GEORADIUS GET GETBIT GETDEL
GETEX GETRANGE GETSET HDEL HEXISTS HGET HGETALL HINCRBY HINCRBYFLOAT HKEYS HLEN HMGET HMSET
HRANDFIELD HSCAN HSET HSETNX HSTRLEN HVALS INCR INCRBY INCRBYFLOAT INFO KEYS LASTSAVE LINDEX
LINSERT LLEN LMOVE LPOP LPOS LPUSH LPUSHX LRANGE LREM LSET LTRIM MEMORY MGET MIGRATE MONITOR
MOVE MSET MSETNX MULTI OBJECT PERSIST PEXPIRE PEXPIREAT PFADD PFCOUNT PFMERGE PING PSETEX
PSUBSCRIBE PTTL PUBLISH PUBSUB PUNSUBSCRIBE QUIT RANDOMKEY RENAME RENAMENX RESET RESTORE ROLE
RPOP RPOPLPUSH RPUSH RPUSHX SADD SAVE SCAN SCARD SCRIPT SDIFF SDIFFSTORE SELECT SET SETBIT
SETEX SETNX SETRANGE SHUTDOWN SINTER SINTERSTORE SISMEMBER SLOWLOG SMEMBERS SMOVE SORT SPOP
SRANDMEMBER SREM SSCAN STRLEN SUBSCRIBE SUNION SUNIONSTORE SWAPDB TIME TOUCH TTL TYPE UNLINK
UNSUBSCRIBE UNWATCH WAIT WATCH XACK XADD XCLAIM XDEL XGROUP XINFO XLEN XPENDING XRANGE XREAD
XREADGROUP XREVRANGE XTRIM ZADD ZCARD ZCOUNT ZINCRBY ZINTER ZINTERSTORE ZLEXCOUNT ZMSCORE
ZPOPMAX ZPOPMIN ZRANDMEMBER ZRANGE ZRANGEBYLEX ZRANGEBYSCORE ZRANK ZREM ZREMRANGEBYLEX
ZREMRANGEBYRANK ZREMRANGEBYSCORE ZREVRANGE ZREVRANGEBYLEX ZREVRANGEBYSCORE ZREVRANK ZSCAN
ZSCORE ZUNION ZUNIONSTORE
`
  .trim()
  .split(/\s+/)
  .sort();

export default function ConsolePage({ id, db }: Props) {
  const { t } = useSettings();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [busy, setBusy] = useState(false);
  const [allCommands, setAllCommands] = useState<string[]>(FALLBACK_COMMANDS);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [selectedSuggestion, setSelectedSuggestion] = useState(-1);
  const seq = useRef(0);
  const outputRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setEntries([]);
    setHistory([]);
    setHistoryIndex(-1);
    setInput("");
    setBusy(false);
    setAllCommands(FALLBACK_COMMANDS);
    setSuggestions([]);
    setSelectedSuggestion(-1);
    inputRef.current?.focus();

    let active = true;
    api
      .listCommands(id)
      .then((commands) => {
        if (active && commands.length > 0) setAllCommands(commands);
      })
      .catch(() => {
        // 使用内置命令表兜底。
      });
    return () => {
      active = false;
    };
  }, [id]);

  useEffect(() => {
    const output = outputRef.current;
    if (output) output.scrollTop = output.scrollHeight;
  }, [entries]);

  useEffect(() => {
    if (input.trim()) updateSuggestions(input);
  }, [allCommands]);

  const updateSuggestions = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed || /\s/.test(trimmed)) {
      setSuggestions([]);
      setSelectedSuggestion(-1);
      return;
    }

    const prefix = trimmed.toUpperCase();
    const starts = allCommands.filter((command) => command.startsWith(prefix));
    const contains = allCommands.filter((command) => !command.startsWith(prefix) && command.includes(prefix));
    const next = [...starts, ...contains].slice(0, 8);
    setSuggestions(next);
    setSelectedSuggestion(next.length > 0 ? 0 : -1);
  };

  const complete = (command: string) => {
    setInput(command + " ");
    setSuggestions([]);
    setSelectedSuggestion(-1);
    inputRef.current?.focus();
  };

  const codeMessage = (code: string) => {
    switch (code) {
      case "selectNotAllowed":
        return t("consoleSelectUseDb");
      case "blockingNotAllowed":
        return t("consoleBlockingNotAllowed");
      case "transactionNotAllowed":
        return t("consoleTransactionNotAllowed");
      case "invalidCommandLine":
        return t("consoleInvalidLine");
      case "emptyCommand":
        return t("consoleEmpty");
      default:
        return "";
    }
  };

  const run = async () => {
    const command = input.trim();
    if (!command || busy) return;

    const entryId = ++seq.current;
    const entryDB = db;
    setEntries((prev) => [...prev, { id: entryId, db: entryDB, command, result: null, pending: true }]);
    setHistory((prev) => (prev[prev.length - 1] === command ? prev : [...prev, command]));
    setHistoryIndex(-1);
    setInput("");
    setSuggestions([]);
    setSelectedSuggestion(-1);
    setBusy(true);

    try {
      const result = await api.executeCommand(id, entryDB, command);
      setEntries((prev) => prev.map((entry) => (entry.id === entryId ? { ...entry, result, pending: false } : entry)));
    } catch (err) {
      const display = errorText(err, t);
      setEntries((prev) =>
        prev.map((entry) =>
          entry.id === entryId
            ? {
                ...entry,
                result: { display, isError: true, durationMs: 0, errorCode: "" },
                pending: false,
              }
            : entry
        )
      );
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Tab" && suggestions.length > 0) {
      event.preventDefault();
      const choice = selectedSuggestion >= 0 ? selectedSuggestion : 0;
      complete(suggestions[choice]);
      return;
    }

    if (event.key === "Escape" && suggestions.length > 0) {
      event.preventDefault();
      setSuggestions([]);
      setSelectedSuggestion(-1);
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      const exact = input.trim().toUpperCase();
      if (suggestions.length > 0 && selectedSuggestion >= 0 && exact && !allCommands.includes(exact)) {
        complete(suggestions[selectedSuggestion]);
        return;
      }
      void run();
      return;
    }

    if (event.key === "ArrowUp") {
      if (suggestions.length > 0) {
        event.preventDefault();
        setSelectedSuggestion((prev) => (prev <= 0 ? suggestions.length - 1 : prev - 1));
        return;
      }
      if (history.length === 0) return;
      event.preventDefault();
      const next = historyIndex < 0 ? history.length - 1 : Math.max(0, historyIndex - 1);
      setHistoryIndex(next);
      setInput(history[next]);
      return;
    }

    if (event.key === "ArrowDown") {
      if (suggestions.length > 0) {
        event.preventDefault();
        setSelectedSuggestion((prev) => (prev >= suggestions.length - 1 ? 0 : prev + 1));
        return;
      }
      if (historyIndex < 0) return;
      event.preventDefault();
      const next = historyIndex + 1;
      if (next >= history.length) {
        setHistoryIndex(-1);
        setInput("");
      } else {
        setHistoryIndex(next);
        setInput(history[next]);
      }
      return;
    }

    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "l") {
      event.preventDefault();
      setEntries([]);
      setSuggestions([]);
      setSelectedSuggestion(-1);
    }
  };

  return (
    <div className="console-page">
      <div className="console-head">
        <div>
          <h2>{t("consoleTitle")}</h2>
          <div className="console-meta">
            <span className="status-chip">db{db}</span>
            <span className="console-hint">{t("consoleHint")}</span>
          </div>
        </div>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => setEntries([])}
          disabled={entries.length === 0}
        >
          {t("consoleClear")}
        </button>
      </div>

      <div className="console-output" ref={outputRef}>
        {entries.length === 0 ? (
          <p className="console-welcome">{t("consoleWelcome")}</p>
        ) : (
          entries.map((entry) => (
            <div className="console-entry" key={entry.id}>
              <div className="console-prompt">
                <span className="console-prompt-label">db{entry.db}&gt;</span>
                <span className="console-prompt-command">{entry.command}</span>
              </div>
              {entry.pending ? (
                <div className="console-result pending">
                  <span className="spinner" />
                  {t("consoleRunning")}
                </div>
              ) : (
                entry.result && (
                  <div className={"console-result" + (entry.result.isError ? " error" : "")}>
                    <pre className="console-pre">
                      {entry.result.errorCode
                        ? codeMessage(entry.result.errorCode) || entry.result.display
                        : entry.result.display || "—"}
                    </pre>
                    <span className="console-duration">{entry.result.durationMs.toFixed(2)} ms</span>
                  </div>
                )
              )}
            </div>
          ))
        )}
      </div>

      <div className="console-foot">
        <span className="console-prompt-label">db{db}&gt;</span>
        <div className="console-input-wrap">
          {suggestions.length > 0 && (
            <div className="console-suggestions" role="listbox" aria-label={t("consoleSuggestions")}>
              {suggestions.map((command, index) => (
                <button
                  type="button"
                  key={command}
                  className={"suggestion-item" + (index === selectedSuggestion ? " active" : "")}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    complete(command);
                  }}
                >
                  {command}
                </button>
              ))}
              <div className="console-suggest-hint">{t("consoleSuggestHint")}</div>
            </div>
          )}
          <input
            ref={inputRef}
            className="console-input"
            value={input}
            onChange={(event) => {
              const value = event.target.value;
              setInput(value);
              setHistoryIndex(-1);
              updateSuggestions(value);
            }}
            onKeyDown={onKeyDown}
            placeholder={t("consolePlaceholder")}
            spellCheck={false}
            autoFocus
          />
        </div>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={() => void run()}
          disabled={busy || !input.trim()}
        >
          {busy ? t("consoleRunning") : t("consoleRun")}
        </button>
      </div>
    </div>
  );
}
